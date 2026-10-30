# DSH Wallpaper · 壁纸

给 [DeepSeek Harness](https://github.com/deepseek-ai) 的 Web UI 铺一张原创渐变壁纸，并把界面刷成磨砂玻璃让壁纸透出来。深色与浅色各自一套画，跟随当前配色方案自动切换。

![深色](docs/wallpaper-dark.png)

![浅色](docs/wallpaper-light.png)

真实会话页（正文仍然清晰，壁纸只作为背景层）：

![会话页](docs/wallpaper-chat.png)

## 安装

**方式一：插件页**

侧栏 **插件 → 添加插件**，粘贴仓库地址：

```
git+https://github.com/hongxsen/dsh_plugins.git
```

然后在「已安装插件」里确认「壁纸」已开启。

**方式二：命令行**

```sh
dsh plugin --profile desktop add "git+https://github.com/hongxsen/dsh_plugins.git"
```

**方式三：本地目录**（自己改代码时）

```sh
dsh plugin --profile desktop add /绝对路径/dsh-wallpaper
```

安装后如未立即出现，重启一次 DSH。卸载：

```sh
dsh plugin --profile desktop remove @hongxsen/dsh-wallpaper
```

本包**没有任何安装脚本**，pnpm 不会要求你授权 build script。

## 兼容性

`package.json` 声明 `"engines": { "dsh": ">=0.2.1-0 <0.3.0" }`，不满足时安装会在下载前被拒绝。真要在更新的预发布版本上试，用 DSH 给出的豁免命令：

```sh
dsh plugin --profile desktop allow-version @hongxsen/dsh-wallpaper@0.1.0 --dsh-version <运行时版本> --accept-risk
```

## 自定义

| 想改什么 | 改哪里 |
|---|---|
| 磨砂强度 | `client.template.js` 里的 `--dsh-wallpaper-veil`（默认 52%；越大界面越不透明、壁纸越淡） |
| 画的颜色/构图 | `build.mjs` 的 `lightArt()` / `darkArt()`，或直接用同名文件覆盖 `art/light.svg`、`art/dark.svg` |
| 插件页显示的文字 | `locale/zh.json`、`locale/en.json` 的 `meta` |

改完运行：

```sh
node build.mjs
```

它会重新生成 `art/*.svg` 并把它们内联进 `client.js`。刷新页面即可看到效果（本地目录安装时不用重装）。

> `client.js` 是构建产物，但必须提交进仓库——安装者不会执行构建。

## 实现原理

系统壳把页面背景画在 `body` 上，再用 `--dsw-alias-bg-base` 在主画布上重画一层，所以只给 `body` 加背景图是看不见的。这个插件：

1. 在 `body` 上铺 SVG 壁纸（`cover` + `fixed`，深/浅各一张，data URI，不联网）；
2. 把 `--dsw-alias-bg-base` 改成半透明 tint——所有「重画背景」的容器因此自动变成磨砂玻璃。不依赖任何哈希类名，UI 改版不会失效；
3. 菜单、Tooltip、Toast 继续用它们自己的 `--dsw-specific-*` token，保持不透明；
4. 尊重 `prefers-reduced-transparency`；
5. 样式通过 `ctx.effect` 注册，停用或热重载时自动移除。

## 仓库结构

```
package.json          清单：bundle patch + dsh.client（platform: web）
cordis.patch.yml      往 profile 组合树插一行
index.js              Host 侧空实现（有这一行才能在插件页启停）
client.template.js    客户端源码：壁纸 + 磨砂样式
client.js             构建产物（浏览器实际加载，必须提交）
build.mjs             生成 art/*.svg 并内联进 client.js
art/light.svg         浅色壁纸
art/dark.svg          深色壁纸
locale/{en,zh}.json   插件页标题与描述
icon.svg              插件页图标
docs/*.png            README 截图
docs/index.json       插件市场索引（GitHub Pages）
```

## 发布到 npm（可选）

```sh
npm publish --access public
```

之后别人可以直接在「添加插件」里填包名 `@hongxsen/dsh-wallpaper`，市场索引里的安装目标也简化成 `name@version`。

## License

MIT
