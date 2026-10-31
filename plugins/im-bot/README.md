# DSH 多平台 IM 机器人

把 [DeepSeek Harness](https://github.com/deepseek-ai) 接入企业微信、QQ 官方机器人和飞书。插件运行在本机 Node Host 中，消息进入真实的 DSH Agent/Session，支持上下文恢复、同会话排队、进度反馈、超时取消和常用命令。

- **企业微信**：智能机器人 WebSocket，原生流式回复与 Markdown 分片。
- **QQ**：AppID/AppSecret + AccessToken，C2C 与群 @机器人；C2C 优先流式回复。
- **飞书**：官方 Node SDK 长连接，无需公网回调；回复后更新机器人自己的消息。
- **多连接**：三个平台可同时在线，也可为一个平台配置多个机器人；连接之间互不影响。
- **安全边界**：凭据只在 Host 使用，不进入浏览器；支持用户/群白名单和独立工作区。

> 本包只接受新的 `connections` 配置，不读取旧版 `@hongxsen/dsh-wecom` 的扁平配置或 `dsh-wecom/state.json`。

## 安装

要求 Node.js 22 或更高版本，以及兼容的 DSH 0.2.x Host。

本地开发：

```sh
dsh plugin --profile desktop add /绝对路径/dsh_plugins/plugins/im-bot
```

从 Git 市场版本安装时，使用索引中对应版本的 commit，并指定子目录：

```sh
dsh plugin --profile desktop add \
  "git+https://github.com/hongxsen/dsh_plugins.git#<commit>&path:/plugins/im-bot"
```

安装后重启 DSH。然后在 `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `im-bot` 插件项中填写 `config.connections`。

## 最小配置

```yaml
- id: im-bot
  name: '@hongxsen/dsh-im-bot'
  config:
    connections:
      - id: work-wecom
        type: wecom
        botId: '${WECOM_BOT_ID}'
        secret: '${WECOM_SECRET}'
        cwd: '/Users/you/work'

      - id: personal-qq
        type: qq
        appId: '${QQ_APP_ID}'
        appSecret: '${QQ_APP_SECRET}'
        cwd: '/Users/you/work'

      - id: team-feishu
        type: feishu
        appId: '${FEISHU_APP_ID}'
        appSecret: '${FEISHU_APP_SECRET}'
        cwd: '/Users/you/work'
```

`${NAME}` 表示从 Host 进程的环境变量读取整个字段；变量未设置或为空时，该连接报告配置错误。也可以直接在 profile 的私有配置中填写凭据，但不要提交到仓库。每条连接只启动启用的必要协议，`enabled: false` 可暂时停用。

连接 `id` 必须唯一，只能包含字母、数字、下划线和中划线，且必须以字母或数字开头。它用于日志、会话隔离和默认状态文件名，创建后不要随意修改。

## 平台准备

### 企业微信

1. 在[企业微信管理后台](https://work.weixin.qq.com/)创建「智能机器人」，开启接收消息/长连接能力。
2. 获取机器人 ID 和 Secret，分别配置为 `botId`、`secret`。
3. 将机器人加入目标群，或放开成员单聊。私有化部署可用 `wsUrl` 覆盖默认 `wss://openws.work.weixin.qq.com`。
4. 一个机器人只保留一个长连接，避免不同 Host 相互顶替。

### QQ 官方机器人

1. 在 QQ 开放平台创建机器人，取得 AppID 和 AppSecret，并启用 C2C/群消息所需权限。
2. 插件请求 `https://api.bot.qq.com/app/getAppAccessToken`，使用 `QQBot <AccessToken>` 调用 `/gateway` 和 v2 消息接口。
3. 默认只订阅 `GROUP_AND_C2C_EVENT`（intent `33554432`）下的 `C2C_MESSAGE_CREATE` 和 `GROUP_AT_MESSAGE_CREATE`。群聊默认只响应 @机器人，不开启“接收所有消息”。
4. Host 需要出站 HTTPS/WSS；不需要 OneBot、公网回调或 `qq-guild-bot`。

QQ 被动回复受平台限制：群聊通常为 5 分钟、最多 5 条；C2C 的文档存在 5 分钟字段说明与 60 分钟概览说明并存的情况，应按较保守窗口设计。插件限制群进度条数，不保证过期后还能主动补发。C2C stream 不可用时降级为普通被动回复；群聊没有通用消息编辑/流式接口。

### 飞书

1. 在[飞书开放平台](https://open.feishu.cn/)创建企业自建应用，启用机器人能力，获取 App ID/App Secret。
2. 事件订阅选择**使用长连接接收事件**，添加「接收消息 v2.0」`im.message.receive_v1`。首次保存控制台选项时，先启动插件建立长连接。
3. 按需授予最小权限：单聊 `im:message.p2p_msg:readonly`、群 @机器人 `im:message.group_at_msg:readonly`，发送/回复/更新使用 `im:message:send_as_bot`（或平台要求的等价权限）。
4. 发布应用并确保使用者在可用范围内；群聊需要将机器人加入群。

飞书 SDK 自动维护 tenant token 和长连接重连。插件用 `reply` 创建首条回复，用其返回的**新 message_id** 执行 `update`，绝不编辑用户原消息；遵守官方每条消息最多编辑 20 次的限制，超长内容或更新次数耗尽后用 `create` 向原 chat 分片发送。

## 通用配置

以下字段放在每个 connection 内，可按连接覆盖：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否启动此连接 |
| `allowFrom` | `[]` | 允许的用户 ID；空数组表示不限制 |
| `allowChats` | `[]` | 允许的群 ID；空数组表示不限制 |
| `cwd` | Host 工作目录 | 新 DSH 会话工作区，必须是绝对路径 |
| `provider` / `model` | DSH 默认 | 覆盖模型提供方和模型 |
| `reasoningEffort` | 跟随默认 | 推理档位 |
| `streamUpdates` | `true` | 是否发送中间进度 |
| `streamIntervalMs` | `1500` | 进度最小间隔 |
| `maxStreamUpdates` | `80` | 单轮进度上限；平台可能采用更低实际发送量 |
| `pollIntervalMs` | `250` | 读取 Session 事件的间隔 |
| `turnTimeoutMs` | `600000` | 单轮超时 |
| `requestTimeoutMs` | `10000` | HTTP 请求/响应读取及 QQ WebSocket 协商超时 |
| `maxReplyChars` | `3000` | 保守分片长度 |
| `maxQueue` | `20` | 每个会话排队上限 |
| `ackText` | `收到，开始处理…` | 接单确认 |
| `queuedText` | `前面还有任务，已排队…` | 排队提示 |
| `welcomeText` | 空 | 每次插件运行期间，每个会话首次受理任务时的欢迎语 |
| `maxDedupeEntries` | `256` | 消息去重窗口 |
| `stateFile` | `$DSH_HOME/storages/dsh-im-bot/<id>.json` | 会话映射状态文件 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | 默认状态目录的根路径 |
| `debug` | `false` | 调试日志；仍不会输出凭据 |

平台专属字段包括企微 `wsUrl`、心跳/回执/重连参数，QQ `sandbox`、API/gateway 覆盖与重连参数，飞书 `domain`（默认飞书，可选 Lark）。QQ 会跟踪 heartbeat ACK，并在首次发现失败或 WebSocket 未完成 Hello/READY 协商时按退避策略重连。生产环境不要覆盖官方 API 地址，除非用于隔离测试。

## 使用

单聊直接发送任务；群聊 @机器人。每个 `connection + chat` 映射到一个持久 DSH Session，同一会话串行执行，不同会话/连接可并行。群成员共享群会话上下文。

| 命令 | 中文别名 | 作用 |
| --- | --- | --- |
| `/help` | `/帮助`、`?` | 命令说明 |
| `/new` | `/新会话`、`/重置` | 取消当前轮并开启新上下文 |
| `/stop` | `/停止`、`/cancel` | 取消当前轮并清空排队 |
| `/status` | `/状态` | 连接、模型、工作区、会话和队列状态 |
| `/whoami` | `/身份` | 当前平台用户、聊天与会话标识 |
| `/ping` | `/在吗` | 返回 `pong` |

只处理文本及平台可提取的富文本文字。图片、文件和其他媒体不会自动授予 Agent 访问权限。

## 安全须知

IM 消息可以让 Agent 在工作区读写文件、调用工具，权限等同于把本机操作入口开放给消息发送者：

- **生产环境务必配置 `allowFrom`**；需要限制群时同时配置 `allowChats`。默认空白名单仅为首次部署方便，不代表安全边界。
- 使用 `${ENV}` 或权限为 `0600` 的私有 profile 保存凭据；不要提交 Secret、AccessToken 或状态文件。
- 给不同机器人配置专用、最小权限的 `cwd`，群聊要视为多人共享上下文。
- OpenID/userid/chatid 都是平台标识，不是 QQ 号或人的全局身份；不要跨机器人复用白名单。
- 状态文件只保存会话恢复元数据，不保存 Secret、token 或完整消息正文。

## 排障

- 某条连接失败不会阻止其他连接启动。先看 Host 日志中的连接 ID 和平台错误码。
- QQ 401 会触发一次 token 刷新；4013/4014 表示 intent 或权限配置错误，修复平台设置后再启动，插件不会无限盲重试。
- 飞书 `start()` 返回不代表长连接已就绪；检查控制台事件订阅、应用发布状态和权限。
- 企微显示被顶替时，关闭使用同一机器人凭据的其他 Host。
- 最终发送失败不会被当作成功；请结合平台 trace ID/错误码排查额度、被动回复窗口或权限。

## 开发与测试

```sh
cd plugins/im-bot
npm install
npm test
npm pack --dry-run
# 在本机 Desktop 中验证真实 Agent/Session 持久化与恢复
ELECTRON_RUN_AS_NODE=1 \
  '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  test/desktop-integration.mjs
```

测试使用假 HTTP/WebSocket、飞书 SDK fake 和真实 DSH Session/Agent 测试替身，不需要真实平台凭据。`npm run test:desktop` 在普通 Node 下会提示改用 Desktop 二进制；上面的 Electron 命令会执行真实桌面集成测试。线上验收仍需分别检查：企微流式终稿、QQ C2C stream/群 @与被动额度、飞书长连接事件和 reply/update 权限。没有真实凭据的自动测试通过不等于完成线上联调。
