# 多平台 IM 机器人插件设计

日期：2026-10-31
状态：已确认，进入实施

## 目标

将 `dsh-wecom` 的企微机器人能力迁入插件市场仓库，重构为一个 Host-only 插件 `@hongxsen/dsh-im-bot`，同时支持：

- 企业微信智能机器人 WebSocket；
- QQ 官方机器人 C2C 与群 @机器人；
- 飞书自建应用官方 SDK 长连接；
- 同一插件内多个平台、多个连接并行运行；
- 与现有企微插件一致的 DSH agent、会话恢复、排队、命令和进度反馈。

本版只支持新的 `connections` 配置，不兼容旧 `dsh-wecom` 配置结构或状态文件。旧目录保留为只读参考，不作为运行时依赖。

## 决策记录

### ADR-1：单插件、共享核心、平台适配器

选择单包，而非一个核心包加三个插件。会话一致性由共享核心保证，协议差异留在适配器；安装、升级和日志归属也更简单。代价是未启用平台的依赖仍会安装，飞书官方 SDK 成为包依赖。

### ADR-2：仅新配置格式

所有连接写在 `connections` 数组中。每条连接有稳定且唯一的 `id`，独立配置凭据、白名单、工作区、模型和状态文件。核心会话键始终包含 `connectionId`，避免跨平台或跨机器人串会话。

不自动迁移旧配置和旧会话，避免把企微特有的 chat ID、req_id 和流式状态误映射到其他平台。

### ADR-3：保留各平台真实投递能力

不把三个平台强行抽象成最低公分母：

| 平台 | 接收 | 确认/进度 | 最终回复 |
| --- | --- | --- | --- |
| 企微 | 官方 WebSocket | 原 req_id 流式回复 | 原流结束，必要时主动分片 |
| QQ C2C | AccessToken + 官方 WebSocket | 优先被动 stream replace，失败降级普通被动回复 | stream done 或普通回复 |
| QQ 群 | 同上 | 少量普通被动回复，不能编辑/流式更新 | 普通被动回复，受 5 分钟/5 条限制 |
| 飞书 | 官方 SDK WSClient | 回复一条文本后更新自己发送的消息 | 更新该消息，超长内容另发分片 |

QQ 的被动回复额度和有效期由适配器控制；不承诺过期后一定能补发主动消息。飞书只编辑机器人自己发送的消息，且需限流。

### ADR-4：协议实现

- 企微：沿用已经验证的 `NodeWebSocket`，避免 Node undici 与企微网关握手后的 1006 问题。
- QQ：直接使用 Node HTTPS/fetch 与 `ws`。不使用 `qq-guild-bot@2.9.5`，因为其旧版 `Bot appID.token` 鉴权、intents 和 v1 API 不支持当前 C2C/group v2 协议。
- 飞书：使用 `@larksuiteoapi/node-sdk` 的 `Client`、`WSClient`、`EventDispatcher`。SDK 管理长连接重连和 tenant token，插件不重复实现。

## 模块结构

```text
plugins/im-bot/
├── index.js                 # Cordis 装配与多连接生命周期
├── lib/
│   ├── config.js            # connections 校验、默认值、状态路径
│   ├── bridge.js            # 平台无关 ConversationBridge
│   ├── session.js           # DSH agent/session 操作与模型路由
│   ├── commands.js          # /help /new /stop /status /whoami /ping
│   ├── store.js             # 原子持久化
│   ├── text.js              # 通用文本工具
│   ├── transport.js         # 企微 WebSocket
│   └── platforms/
│       ├── wecom.js
│       ├── qq.js
│       └── feishu.js
├── test/
├── examples/
├── locale/
├── cordis.patch.yml
├── icon.svg
├── package.json
└── README.md
```

## 适配器边界

适配器负责把平台事件标准化后交给核心：

```js
{
  connectionId,
  platform,
  eventId,       // 稳定的去重标识
  chatId,        // 平台原生、不可猜测的会话 ID
  userId,
  chatType,      // direct | group
  text,
  receivedAt,
  replyContext,  // 仅适配器使用的 req_id/msg_id/open_id 等
}
```

核心不读取平台原始 payload。适配器为一个收到的消息创建 delivery 对象，核心只表达 `ack`、`progress`、`final`、`notice` 和 `dispose`。delivery 自己保存流 ID、已发送消息 ID、被动回复序号和 Promise 写链。

共享核心负责：去重、白名单、串行队列、命令、agent 生命周期、session 事件解析、超时取消、状态持久化和文本分片策略。

## 配置示例

```json5
{
  connections: [
    {
      id: "work-wecom",
      type: "wecom",
      enabled: true,
      botId: "${WECOM_BOT_ID}",
      secret: "${WECOM_SECRET}"
    },
    {
      id: "personal-qq",
      type: "qq",
      appId: "${QQ_APP_ID}",
      appSecret: "${QQ_APP_SECRET}",
      sandbox: false
    },
    {
      id: "team-feishu",
      type: "feishu",
      appId: "${FEISHU_APP_ID}",
      appSecret: "${FEISHU_APP_SECRET}"
    }
  ]
}
```

环境变量展开只针对明确标记的 `${NAME}` 字符串；缺失变量视为配置错误，不回退为空凭据。默认状态文件为 `$DSH_HOME/storages/dsh-im-bot/<connection-id>.json`，显式 `stateFile` 可覆盖。ID 仅允许安全字符，防止路径穿越。

通用默认值沿用企微实践：1500ms 进度节流、80 次进度上限、250ms 事件轮询、10 分钟超时、20 条会话队列、256 条去重缓存、3000 字符保守分片。平台可进一步限制实际发送量。

## 会话、并发与顺序

- 会话键：`connectionId + chatType + chatId`；群聊内成员共享该会话，与原企微语义一致。
- 同一聊天串行执行，不同聊天和不同连接可以并行。
- `maxQueue` 限制待处理消息；溢出返回明确提示。
- 同一会话的 ack、progress、final 经由同一 delivery 写链，避免终稿越过进度。
- `/new` 只在新旧轮次边界清除映射；正在执行的轮次必须先取消，禁止旧终稿进入新会话。
- 持久化只保存恢复所需的 agent/chat 元数据，不保存 secret、access token 或完整消息正文。

## 安全

- 插件仅在 Node Host 运行，不提供 client bundle，不向前端暴露凭据。
- 默认空白名单保持原工具的“不限制”语义，但启动时输出醒目警告；生产文档要求配置 `allowFrom`，群聊另配 `allowChats`。
- 忽略机器人自身消息；飞书按 sender 类型过滤，QQ 只订阅所需 C2C/group-at 事件。
- 日志脱敏，记录平台错误码和 trace ID，不记录 AppSecret、AccessToken、Authorization。
- 文件名、状态路径和连接 ID 做校验；写入使用 0600 临时文件、flush/fsync/rename。

## 失败隔离与恢复

- 每条连接独立校验、启动、停止和重连；一个连接失败不影响其他连接。
- 缺少凭据或配置非法时，该连接保持 dormant 并给出可操作日志。
- QQ 管理 AccessToken single-flight 刷新、heartbeat、seq/session resume 和指数退避；鉴权/权限关闭码不盲目重试。
- 飞书依赖 SDK 自动重连；`start()` 返回不等于已连接，错误通过回调记录。
- 插件 dispose 时停止接收新消息、取消运行中的 agent、等待/终止发送链并 flush 状态。
- 平台发送失败不能伪造成功；最终投递失败要记录连接、聊天和平台错误，但不泄露正文或凭据。

## 测试与验收

1. 共享核心：命令、队列、去重、超时、终稿、会话恢复、事件增量读取、持久化。
2. 企微：保留原有 frame 解析、流式回复、重连和 runtime 集成覆盖。
3. QQ：token 响应、Identify/Resume、heartbeat、C2C/group 标准化、msg_seq、stream 降级和错误码，使用假 HTTP/WS 服务。
4. 飞书：SDK 边界 mock、text/post 解析、reply/create/update 的 ID 使用、仅编辑自发消息、dispose。
5. 多连接：三个适配器同时在线的隔离测试，同 ID/非法路径/缺 secret 的快速失败。
6. 桌面运行时：真实 `Sessions`/`Agents` API 的集成测试和包加载 smoke test。
7. `npm test`、`npm pack --dry-run`、仓库级配置/索引校验。

没有真实 QQ、飞书、企微凭据时，不声称已完成线上联调；文档列出各平台人工验收步骤。
