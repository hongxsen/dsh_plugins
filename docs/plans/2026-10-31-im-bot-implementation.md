# 多平台 IM 机器人插件实施计划

> 执行方式：在 `feat/im-bot` worktree 中分模块并行，共享核心与平台适配器写入范围分离；每个行为先写失败测试，再实现，再运行相关测试。

**目标：** 新建可安装的 `@hongxsen/dsh-im-bot`，只接受 `connections` 新配置，支持企微、QQ 官方机器人、飞书长连接和多连接并行。

**架构：** Host-only 单插件；共享会话/队列核心 + 三平台适配器；统一 normalized message 和 per-message delivery。详见 `docs/plans/2026-10-31-im-bot-design.md`。

**技术栈：** Node.js >=22 ESM、Cordis、DSH Sessions/Agents、企微自定义 RFC6455 客户端、QQ fetch + `ws`、飞书官方 Node SDK、Node 内置 test runner。

---

## Task 1：包骨架与基线迁移

**文件：**
- 新建 `plugins/im-bot/package.json`
- 新建 `plugins/im-bot/cordis.patch.yml`
- 新建 `plugins/im-bot/locale/{zh,en}.json`
- 复制并调整 `plugins/im-bot/icon.svg`
- 新建 `plugins/im-bot/test/package.test.mjs`

**步骤：**
1. 写 package wiring 测试，断言 `name`、`type: module`、Host exports、locale/icon exports、Node/DSH engines、文件清单和 Cordis 包名。
2. 运行测试，确认因包不存在而失败。
3. 创建包，依赖为 `@larksuiteoapi/node-sdk` 与 `ws`，测试脚本递归运行 `test/*.test.mjs`。
4. 安装依赖生成 lockfile；运行 package 测试与 `npm pack --dry-run`。

**验收：** 包可被 Node 解析，npm 包包含运行和 marketplace 所需文件，不包含测试、示例、凭据或 state。

## Task 2：抽取共享核心

**文件：**
- 新建 `plugins/im-bot/lib/{bridge,session,commands,store,text,config}.js`
- 新建 `plugins/im-bot/test/{bridge,store,config,commands}.test.mjs`
- 参考 `dsh-wecom/lib/bridge.js` 与其测试

**步骤：**
1. 将原 bridge 测试改为 normalized message + fake delivery，先覆盖 ack/progress/final、队列、去重、白名单、命令、超时和 session resume。
2. 把平台 frame 解析、chat key、回复发送从 bridge 移到适配器边界；核心仅使用 `connectionId/chatType/chatId/userId/text`。
3. 保留 `system-prompt/assemble` 与 `agent/request` 模型路由方式，不裸导入 DSH 内部包。
4. 泛化 ChatStore，状态包含 connection/chat/agent 映射，采用 0600 原子写。
5. 实现严格的 connections 校验：支持 `wecom|qq|feishu`，唯一安全 ID、必填凭据、`${ENV}` 展开、独立 stateFile 和通用默认值。

**验收：** 核心测试不出现 WeCom/QQ/Feishu payload；同一聊天串行、不同聊天并行；跨连接同 chatId 不串会话。

## Task 3：企微适配器

**文件：**
- 新建 `plugins/im-bot/lib/platforms/wecom.js`
- 复制 `plugins/im-bot/lib/transport.js`
- 新建 `plugins/im-bot/test/wecom.test.mjs`
- 迁移必要 fake gateway/runtime fixtures

**步骤：**
1. 先移植原 WeCom client/frame/流式回复测试，改为 normalized message/delivery 断言。
2. 保留 `aibot_subscribe`、req_id 回执、心跳、重连和每个 req_id 的串行写链。
3. 实现 text/markdown 提取、sender/chat 标准化和 WeCom delivery（ack/progress/final/overflow）。
4. 运行企微测试及原桌面集成场景的迁移版。

**验收：** 原核心行为不回归，终稿只在同一 req_id 的 progress 后发送，主动分片按序到达。

## Task 4：QQ 官方协议适配器

**文件：**
- 新建 `plugins/im-bot/lib/platforms/qq.js`
- 新建 `plugins/im-bot/test/qq.test.mjs`
- 新建 `plugins/im-bot/examples/qq-fake-gateway.mjs`（如需要）

**步骤：**
1. 用 fake fetch/transport 写 token、gateway、Identify、heartbeat、READY、Resume、Invalid Session 测试。
2. 实现 AccessToken single-flight/提前刷新、`QQBot <token>` 鉴权、intent `33554432`、seq/session 状态与退避。
3. 写 C2C/group-at 事件标准化测试：使用 `author.user_openid`、`group_openid`、`member_openid`、incoming `d.id`，忽略其他事件/机器人消息。
4. 实现普通 v2 text/Markdown 被动回复，按 incoming message 维护 msg_seq 和回复额度。
5. 实现 C2C stream replace/done；首次保存 stream_msg_id，失败时降级普通回复。群聊不调用 stream/edit，只发送合并后的少量进度。
6. 覆盖 401 单次刷新、429/5xx 错误、4013/4014 禁止盲重试、stop 清理 timer/socket。

**验收：** 全部协议测试无需真实凭据；不会在群聊调用 C2C stream；secret/token 不出现在日志。

## Task 5：飞书 SDK 适配器

**文件：**
- 新建 `plugins/im-bot/lib/platforms/feishu.js`
- 新建 `plugins/im-bot/test/feishu.test.mjs`

**步骤：**
1. 在 SDK 边界注入 client/wsClient/eventDispatcher factory，先写生命周期与事件标准化测试。
2. 注册 `im.message.receive_v1`，处理器快速入队；按 message_id 去重、忽略 bot sender，提取 open_id/chat_id/chat_type。
3. 支持 text 与 post（优先 content_v2）正文解析，保留段落；不支持媒体时给明确提示。
4. delivery 首次用 `client.im.message.reply`，保存响应的新 message_id；进度/终稿用 `client.im.message.update` 更新该 ID，溢出用 create 到原 chat_id。
5. 限制更新频率和次数，发送错误向上传递；dispose 调用 WSClient close，不手工管理 tenant token。

**验收：** 测试证明不会更新 incoming user message_id，reply/create/update 参数正确，长连接启动失败不影响其他连接。

## Task 6：多连接装配与生命周期

**文件：**
- 新建 `plugins/im-bot/index.js`
- 新建 `plugins/im-bot/test/{plugin,multi-connection}.test.mjs`

**步骤：**
1. 写插件测试：三 fake adapter 同时启动、一个失败时其余可用、事件路由到正确 connection、重复 ID/未知类型被拒绝。
2. 实现 adapter registry、每连接独立 logger/store/bridge、Cordis effect cleanup。
3. 验证热 dispose：取消 agent、停止 socket/timer、结束 delivery、flush store。
4. 运行完整单元测试。

**验收：** 多连接隔离、无跨连接资源清理、无未处理 Promise rejection。

## Task 7：文档、图标与市场元数据

**文件：**
- 新建 `plugins/im-bot/README.md`
- 新建 `plugins/im-bot/examples/connections.example.json5`
- 更新仓库 `README.md`
- 更新 `docs/index.json`（代码提交后填入实际 commit）

**步骤：**
1. 写新配置、环境变量、每平台控制台权限/事件订阅、白名单、群会话语义和命令。
2. 明确 QQ 被动回复限制与 stream 降级、飞书权限和只编辑自发消息、企微凭据获取。
3. 列出模拟测试与真实平台人工验收步骤，不声称无凭据的线上验证。
4. 增加 marketplace 条目，Git source 使用 `path: "plugins/im-bot"`；commit 字段在代码提交后更新。

**验收：** 新用户只按 README 即可配置三平台，文档不含真实凭据或机器相关绝对路径。

## Task 8：集成、桌面与打包验证

**文件：**
- 新建/调整 `plugins/im-bot/test/{runtime,package}.test.mjs`
- 新建 `plugins/im-bot/test/desktop-integration.mjs`

**步骤：**
1. 用与当前桌面 Host 一致的 Sessions/Agents API 运行集成场景，覆盖 create/resume、turn/end、持久化和取消。
2. 在隔离 DSH_HOME 中按打包后的实际 exports/Cordis patch 加载插件，不依赖源码 checkout 内部模块。
3. 运行 `npm test`、`npm pack --dry-run`、JSON/YAML/索引校验和依赖审计。
4. 检查测试和日志无 secret、无真实聊天正文、无未处理 rejection。

**验收：** 所有自动测试通过；真实平台未联调项在最终报告中逐项注明。

## Task 9：审查与提交

1. 审查完整 diff、写入范围、依赖许可证/漏洞与 marketplace 元数据。
2. 先提交设计文档，再提交实现代码；得到实现 commit 后更新 `docs/index.json` 的 `source.commit` 并单独提交索引。
3. 最终运行全量测试和 `git status`，报告分支、commit、测试结果及未做的真实平台联调。
4. 未经用户明确要求不推送远端、不发布到 main。
