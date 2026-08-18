# 安全策略

[English](SECURITY.md) · [Русский](SECURITY.ru.md) · [简体中文](SECURITY.zh-CN.md)

## 支持的版本

CanvasTTY `1.0.2` 是当前版本，也是唯一持续接收修复的版本线。跨平台软件包尚未签名，因此操作系统可能要求额外确认后才能运行。

## 报告漏洞

不要在公开 issue 中发布凭据、终端历史、私有路径或漏洞利用细节。

如果仓库支持私密漏洞报告，请使用 **Security → Report a vulnerability**。如果不可用，只创建一个不含敏感信息的公开 issue，简短请求一个私密联系渠道。

请提供 CanvasTTY 版本、操作系统、受影响流程、影响范围和最小复现步骤。真实 token、用户名、home 目录、项目名、prompt 和终端输出都应替换为合成值。

## 数据边界

- 服务商凭据留在对应 CLI 的本地凭据存储中。CanvasTTY 只在可信主进程内读取，不会复制到项目文件或设置中。
- CanvasTTY 设置保存在 Electron 的每用户 `userData` 目录下。
- 有界 PTY scrollback 只保存在进程内存中，不会提交到仓库。
- CanvasTTY 没有项目自营的遥测端点，也不会上传应用日志。
- 用量请求只发往匹配的服务商适配器。跨越 IPC 的只有脱敏后的限额 snapshot，不包括原始响应或凭据。
- Runtime 插件是存放在 `userData/plugins` 下的静态 GitHub 包。CanvasTTY 不执行其 repository scripts，也不提供 Node.js。插件 UI 在 sandbox frame/window 中运行，只获得安装时确认的权限。插件仍然是第三方代码；安装前请检查源码及其申请的 `network`/`external:open`/`browser:open` 权限。
- 插件存储按插件 ID 隔离在 `userData/plugin-storage` 下，限制为 64 KB，并在卸载时删除。会话访问不包含 PTY buffer 和工作目录。
- 插件媒体目录授权保存在 `userData/plugin-media-libraries.json`，其中包含用户选择的绝对目录路径；卸载对应插件时会删除授权。拥有播放列表写权限的插件可以在所选媒体库的 `Playlists/` 目录中创建受大小限制的文件。
- 内置浏览器已在 `1.0.2` 从 HOME 提供，并使用持久化 Electron partition `canvastty-browser` 保存 cookie、cache 和网站存储。远程页面在 sandbox 中运行，不含 Node.js 或 CanvasTTY preload；导航仅限 HTTP(S)，且不会向智能体暴露 cookie、密码、authorization header、local storage、任意 JavaScript 或 raw CDP。除非访问的网站主动发送数据，否则浏览器数据留在 Electron `userData` 下。
- 浏览器命令会写入 `userData/browser/audit` 下的脱敏本地 hash-chain 审计。活动文件达到 100 MB 时轮转；超过 30 天的轮转文件会在初始化或轮转时清理。日志不会存储输入/页面文本、截图、凭据、URL query/fragment、header、cookie 或 token。清除浏览器数据会刻意保留这些审计证据。

仓库在 CI 和打包前运行 `npm run audit:secrets`。它只是防护措施，不代表可以“临时”提交秘密。如果真实秘密进入 Git 历史，请立即吊销，并在发布前重写或清理受影响的历史。
