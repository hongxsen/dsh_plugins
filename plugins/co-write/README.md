# DSH Co-write · 人机双写

给 [DeepSeek Harness](https://github.com/deepseek-ai) Web UI 的「人机双写」插件：在对话或工作区文件里选中一段文字，右上角点「评论」，就地写下批注。确认后，这条「原文 + 评论」会以编号引用的形式出现在输入框上方；下一条消息发送时，它们会一起提交给模型。

> 本仓库是插件集合，这个插件位于 `plugins/co-write/`。仓库根目录的 [README](../../README.md) 有索引源地址和完整插件列表。

## 功能

- **直接在原文上评论**：在对话消息或工作区文件预览中拖选文字，选区右上角出现「评论」按钮。
- **就地编辑**：点击按钮后在选区旁弹出小编辑器，上方显示选中的原文，下面写评论；`⌘/Ctrl + Enter` 或「确认」提交，`Esc` 或「取消」放弃。
- **输入框上方的编号引用**：确认后，输入框上方出现一条引用卡片，显示编号、来源、原文摘要和评论。多条评论按加入顺序编号。
- **删除后自动重新编号**：删除任意一条，剩下的评论会立刻按 1、2、3… 重新编号。
- **随下一条消息提交**：不需要手动复制。你正常输入并发送下一条消息时，插件会把当前的编号引用追加到消息末尾；发送成功后引用栏自动清空。
- **按会话保存**：未发送的评论按 Session 存在浏览器 `localStorage`，切换会话或刷新页面后还在。
- **支持两种来源**
  - **对话**：用户消息、助手回复，以及对话中的其他可选文本；
  - **工作区文件**：右侧文件预览中的 Markdown、代码、纯文本，以及 PDF/Office 预览里的可选择文本。

## 安装

**推荐：从插件市场安装**

在「插件 → 发现 → 添加索引源」填入 `https://hongxsen.github.io/dsh_plugins/index.json`，然后点「人机双写」卡片上的**安装**。

**命令行（固定到 commit，`path` 指向子目录）**

```sh
dsh plugin --profile desktop add \
  "git+https://github.com/hongxsen/dsh_plugins.git#<commit>&path:/plugins/co-write"
```

`<commit>` 用索引文件里该版本记录的 40 位哈希，或者一个标签，例如
`#co-write-v0.1.0`。

**本地目录**（自己改代码时）

```sh
dsh plugin --profile desktop add /绝对路径/dsh_plugins/plugins/co-write
```

安装后如未立即出现，重启一次 DSH。卸载：

```sh
dsh plugin --profile desktop remove @hongxsen/dsh-co-write
```

本包**没有任何安装脚本**，pnpm 不会要求你授权 build script。

## 用法

1. 在对话消息或右侧文件预览中拖选一段文字。
2. 点选区右上角的「评论」。
3. 在弹出的编辑器里写评论，按 `⌘/Ctrl + Enter` 或点「确认」。
4. 输入框上方出现带编号的引用卡片。继续选别的内容，可以追加第 2、3… 条。
5. 正常输入你的问题并发送。插件会把引用和评论追加到这条消息里。
6. 想删掉某条评论，点卡片右侧的「×」；剩下的编号会自动重排。

发出的消息大致长这样：

```markdown
以下是我对选中原文的评论，请把原文和评论一并作为本轮对话的输入：

### 评论 1 · 对话 · 用户消息
原文：
> 这一版首页的加载速度还是慢……

评论：先不要改视觉，只查首屏请求。

### 评论 2 · 工作区 · src/App.tsx
行 42–58
原文：
> 42 ...
> ...
评论：这里的 memo 依赖漏了 locale。
```

> 「评论」按钮只在对话和工作区文件预览里出现；在输入框、按钮、设置页等其他位置选字不会触发。

## 兼容性

`package.json` 声明 `"engines": { "dsh": ">=0.2.1-0 <0.3.0" }`，不满足时安装会在下载前被拒绝。真要在更新的预发布版本上试，用 DSH 给出的豁免命令：

```sh
dsh plugin --profile desktop allow-version @hongxsen/dsh-co-write@0.1.0 --dsh-version <运行时版本> --accept-risk
```

## 实现原理

- **选区监听**：在 `document` 上监听 `pointerup` / `keyup` / `selectionchange`，选区落在 `[data-conversation-region="chat"]` 或 `[data-textpreview-content]` 时，把选区范围克隆下来，在选区右上角显示「评论」。
- **浮动层**：按钮和就地编辑器放在一个 Shadow DOM 覆盖层里，`position: fixed` 跟随选区矩形；滚动、缩放窗口时重新定位。点击按钮时 `preventDefault`，避免点掉当前选区。
- **会话归属**：对话选区从 `data-conversation-session` 读取 Session；文件预览取当前主会话（`retainedBy.mainView`）。
- **引用栏**：注册到 `conversation.input.dock`（输入框上方的插槽），用 React 读取按 Session 分组的评论列表；编号由数组下标生成，删除后自然重排。
- **随消息提交**：插件在 `conversation.sendSession` 这个发送出口上包一层（安装时包上，插件卸载时恢复），在真正发送前把当前编号引用拼到消息末尾；Host 接受消息后清空引用栏。这是 DSH 当前版本里不改输入框、也不往草稿里塞隐藏文本的可行做法。
- **纯逻辑可测**：`src/core.mjs` 负责评论模型、Markdown 组装、截断、本地存储 key 和编号格式化，`tests/core.test.mjs` 用 `node:test` 直接测它。

## 目录结构

```
package.json          清单：bundle patch + dsh.client（platform: web）
cordis.patch.yml      往 profile 组合树插一行
index.js              Host 侧空实现（有这一行才能在插件页启停）
src/core.mjs          纯逻辑：评论模型、编号 Markdown、截断、存储 key
src/ui.js             浏览器 UI：选区浮层、就地编辑器、输入框上方引用栏、发送钩子
src/entry.js          Client 插件入口（inject + apply）
build.mjs             把 core/ui/entry 内联成 client.js
client.js             构建产物（浏览器实际加载，必须提交）
locale/{en,zh}.json   插件页标题与描述
icon.svg              插件页图标
tests/core.test.mjs   纯逻辑单元测试
```

改完源码运行：

```sh
node build.mjs
node --test tests/*.test.mjs
```

刷新页面即可看到效果（本地目录安装时不用重装）。

> `client.js` 是构建产物，但必须提交进仓库——安装者不会执行构建。

## 已知限制

- 只支持**浏览器可见的 DOM 选区**：对话消息、Markdown/代码/纯文本文件预览、PDF/Office 的文本层。HTML 预览在 iframe 里，Excel 是单元格选择，二者不支持。
- 跨多条消息的选区会把来源标为选区起点所在的角色；原文本身仍按完整选区提交。
- 按行号展示依赖文件预览渲染的 `data-textpreview-line`；Markdown 和代码预览没有逐行标记时不显示行号。
- 「随下一条消息提交」依赖 `conversation.sendSession` 这个发送出口。若未来 DSH 改了发送链路，插件需要跟着改；升级到不兼容版本时，引用栏仍能显示和编辑，但可能不会自动附加。
- 评论存在浏览器 `localStorage`；清理站点数据会一并清掉未发送的评论。
- 序号按当前列表顺序生成；删除后重排是预期行为，已发送的消息不会被改写。

## License

MIT
