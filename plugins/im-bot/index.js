/**
 * Host-only multi-platform IM bridge for DeepSeek Harness.
 * Each configured connection owns its protocol adapter, session store and
 * conversation bridge; a failed connection never prevents its peers starting.
 */

import { normalizeConnection } from './lib/config.js'
import { ChatStore } from './lib/store.js'
import { ConversationBridge } from './lib/bridge.js'
import { createWeComAdapter } from './lib/platforms/wecom.js'
import { createQQAdapter } from './lib/platforms/qq.js'
import { createFeishuAdapter } from './lib/platforms/feishu.js'

export const name = 'im-bot'
export const inject = ['agents', 'sessions']

const defaultFactories = {
  wecom: createWeComAdapter,
  qq: createQQAdapter,
  feishu: createFeishuAdapter,
}

function errorText(error) {
  return error?.message ?? String(error)
}

export class IMBotRuntime {
  constructor(ctx, rawConfig, options = {}) {
    this.ctx = ctx
    this.rawConfig = rawConfig ?? {}
    this.logger = options.logger ?? ctx.logger ?? console
    this.factories = options.adapterFactories ?? defaultFactories
    this.env = options.env ?? process.env
    this.dshHome = options.dshHome ?? rawConfig?.dshHome ?? this.env.DSH_HOME
    this.storeFactory = options.storeFactory ?? ((config) => new ChatStore({ file: config.stateFile, logger: this.logger }))
    this.bridgeFactory = options.bridgeFactory ?? ((options) => new ConversationBridge(options))
    this.defaultSelection = options.defaultSelection ?? (() => ctx.get('agentDefaultModel')?.currentSelection?.() ?? {})
    this.connections = new Map()
    this.stateFiles = new Set()
    this.errors = []
    this.started = false
    this.stopping = false
  }

  async start() {
    if (this.started) return this
    this.started = true
    const rawConnections = this.rawConfig?.connections
    if (!Array.isArray(rawConnections)) {
      this.fail('config', new Error('仅支持 connections 数组配置；旧版扁平 dsh-wecom 配置不会被迁移'))
      return this
    }
    if (rawConnections.length === 0) {
      this.logger.warn?.('[im-bot] 尚未配置 connections，插件保持休眠')
      return this
    }

    const starting = []
    for (const raw of rawConnections) {
      if (this.stopping) break
      starting.push(this.startConnection(raw))
    }
    // A slow token/gateway request must not prevent healthy peers starting.
    await Promise.all(starting)
    return this
  }

  async startConnection(raw) {
    let config
    let ownedEntry
    try {
      config = normalizeConnection(raw, { env: this.env, dshHome: this.dshHome })
      if (!config.enabled) return
      if (this.connections.has(config.id)) throw new Error(`连接 ID 重复：${config.id}`)
      if (this.stateFiles.has(config.stateFile)) throw new Error(`状态文件不能共享：${config.stateFile}`)
      const factory = this.factories[config.type]
      if (typeof factory !== 'function') throw new Error(`不支持的平台：${config.type}`)
      if (!config.allowFrom?.length) {
        this.logger.warn?.(`[im-bot:${config.id}] allowFrom 为空：所有可触达用户都可调用本机 Agent，生产环境请配置白名单`)
      }

      this.stateFiles.add(config.stateFile)
      const store = this.storeFactory(config)
      const adapter = factory(config, { logger: this.logger, env: this.env })
      const entry = { config, store, adapter, bridge: null, status: { state: 'starting' } }
      ownedEntry = entry
      const bridge = this.bridgeFactory({
        config,
        logger: this.logger,
        store,
        agents: this.ctx.agents,
        sessions: this.ctx.sessions,
        defaultSelection: this.defaultSelection,
        createDelivery: (message) => adapter.createDelivery(message),
        getStatus: () => adapter.getStatus?.() ?? adapter.status ?? entry.status,
      })
      entry.bridge = bridge
      this.connections.set(config.id, entry)
      await bridge.start()
      if (this.stopping) return

      const handlers = {
        onMessage: (message) => {
          const normalized = { ...message, connectionId: config.id, platform: config.type }
          return Promise.resolve(bridge.handleMessage(normalized)).catch((error) => {
            this.fail(config.id, error, '接收消息')
          })
        },
        onReady: (status) => {
          entry.status = status ?? { state: 'ready' }
          this.logger.info?.(`[im-bot:${config.id}] ${config.type} 已就绪`)
        },
        onError: (error) => this.fail(config.id, error, '平台连接'),
      }
      await adapter.start(handlers)
      entry.status = adapter.getStatus?.() ?? adapter.status ?? { state: 'started' }
      this.logger.info?.(`[im-bot:${config.id}] 已启动`)
    } catch (error) {
      this.fail(raw?.id ?? raw?.type ?? 'unknown', error, '启动')
      const entry = ownedEntry
      if (entry) {
        if (this.connections.get(entry.config.id) === entry) this.connections.delete(entry.config.id)
        await this.stopEntry(entry)
      }
    }
  }

  fail(id, error, action = '运行') {
    const detail = { id, action, error: errorText(error) }
    this.errors.push(detail)
    this.logger.error?.(`[im-bot:${id}] ${action}失败：${detail.error}`)
  }

  async stopEntry(entry) {
    const errors = []
    try { await entry.adapter.stop() } catch (error) { errors.push(error) }
    try { await entry.bridge?.stop() } catch (error) { errors.push(error) }
    try {
      if (typeof entry.store?.flush === 'function') await entry.store.flush()
      entry.store?.dispose?.()
    } catch (error) { errors.push(error) }
    for (const error of errors) this.fail(entry.config.id, error, '关闭')
  }

  async stop() {
    if (this.stopping) return
    this.stopping = true
    const entries = [...this.connections.values()]
    this.connections.clear()
    await Promise.all(entries.map((entry) => this.stopEntry(entry)))
  }

  snapshot() {
    return {
      started: this.started,
      stopping: this.stopping,
      connections: [...this.connections.keys()],
      errors: [...this.errors],
    }
  }
}

export function apply(ctx, rawConfig) {
  ctx.effect(() => {
    const runtime = new IMBotRuntime(ctx, rawConfig)
    void runtime.start()
    return () => runtime.stop()
  }, 'im-bot: connections')
}
