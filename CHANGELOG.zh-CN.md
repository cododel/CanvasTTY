# 更新日志

[English](CHANGELOG.md) · [Русский](CHANGELOG.ru.md) · [简体中文](CHANGELOG.zh-CN.md)

## 1.2.2

- 重绘画布导航:双轴滚动默认平移画布,捏合与 `Cmd/Ctrl+滚轮` 以焦点为中心缩放;旧的滚轮缩放配置仍可在设置中使用,并保留其方向与灵敏度。
- 引入逻辑控件输入所有权:控件在显式点击或可配置的悬停延迟后接管滚轮,直到点击空白处才释放焦点,捕获模式为 `Off / On / Key`;单独的按住绑定可临时接管完整画布导航(含拖拽)。
- 在原生 Browser 表面间保持手势连续:「页面/画布」所有权在滚轮静止 250 毫秒内锁定,捏合与 `Cmd/Ctrl+滚轮` 始终缩放画布,关闭捕获时聚焦的 Browser 页面继续原生滚动。

## 1.2.1

- 插件 canvas 应用现在以原生 `1.0` 比例打开和重新聚焦，避免小数缩放造成的模糊；透明 iframe 背景也消除了圆角插件窗口周围的亮色接缝。
- Terminal 与 Browser 的语义摘要现在会在反向缩放前预留宽度并保持内容居中，因此在画布大幅缩小时，图标和文本不再被裁切。

## 1.2.0

- macOS 新增原生窗口 chrome：隐藏式 title bar 配 traffic-light 按钮、紧凑 brand bar，并正确处理原生 fullscreen；Linux 和 Windows 保持现有自定义边框。
- 通过 Electron safeStorage 提供操作系统级加密的插件 secrets（无系统 keyring 时 fail-closed）：逐次调用权限检查、配额、变更事件，以及卸载时的清理。
- 插件现在可以提供在 sandboxed frame 中打开的设置入口、声明 canvas 最小尺寸，并在当前 canvas 旁打开同一插件的另一个 canvas。
- 插件 HOME 小组件在 Appearance → HOME composition 中与内置小组件并列显示，可像内置组件一样添加或移除——这弥补了 1.1.0 的已知不足；Settings → Plugins 仅保留安装/卸载。
- 新增插件可选模块：安装时勾选、逐文件 SHA-256 与字节数校验、带 rollback 的原子重配置，模块派生权限统一应用于 SDK 授权与插件资源 CSP。
- 插件 storage 变更事件现在由主进程广播：同一插件的 canvas、HOME 小组件和独立窗口可以互相看到对方的写入。
- 加固插件下载：重定向仅限 `api.github.com` 与 `raw.githubusercontent.com`，模块下载复用 1.1.0 的 retry/backoff。
- 文档补充了可选模块的信任模型：文件完整性锚定在经 TLS 从 GitHub 获取的插件 manifest 上，manifest 本身没有独立签名。

已知不足：已安装的插件暂时无法就地更新——请先卸载再重新安装以获取新版本。更新操作已在计划中。

## 1.1.0

- 浏览器原生页面通过 Chromium zoom factor 跟随画布缩放（限制在 0.5–3），任意画布缩放级别下浏览器内容都与画布比例一致。
- 浏览器 viewport bounds 改为同步上报，画布平移、拖拽和调整大小期间 native view 保持可见；这修复了 1.0.2 中主窗口未最大化时 native browser view 可能覆盖整个窗口、导致画布控件不可用的问题。
- 在画布上 pointer-down 时聚焦浏览器标签页的 web contents，无需额外点击即可输入。
- 设置中新增浏览器智能体 presence 指示器开关（默认开启）：badge/cursor 不再在认证时出现，光标显示为无名称的圆点，且仅显示真正使用过浏览器的智能体。
- GitHub 插件下载在临时失败（超时、连接错误、HTTP 408/429/5xx、流中断）时最多重试三次并带 backoff。
- 新增终端会话重启：已退出卡片上的重启按钮和 `Ctrl+D` 快捷键；PageUp/PageDown 现在在普通缓冲区中翻页 scrollback，终端光标改为块状。
- 应用上方的滚轮缩放现在默认开启。
- 文档已同步英语、俄语和简体中文。

已知不足：HOME 布局对外部插件的自定义尚未完成——插件磁贴暂时无法在 HOME 布局编辑器中放置和移动。该工作已向社区开放，欢迎贡献。

## 1.0.2

- 内置浏览器现已从 HOME 提供，作为可移动、可调整大小的画布应用，包含可信标签/导航、下载、网站 dialog、安全标签恢复、浏览器数据清理、语义摘要，以及画布/卡片移动时稳定的 native-view geometry。
- 为 CanvasTTY 启动的 Claude Code、Codex 与 Kimi 会话新增 scoped 浏览器自动化，通过内置 stdio MCP helper 和经过认证的当前用户 Unix socket 或受保护 Windows named pipe 接入；不会暴露 TCP listener、remote-debugging port、任意 JavaScript、cookie/storage API 或 raw CDP。
- 新增已连接智能体 badge/cursor、按智能体隔离的活动、绑定 document revision 的 element ref、每标签页 FIFO mutation、request 去重、有上限的 concurrency/rate limit/timeout、dialog/download 处理，以及在无法可靠遮挡敏感区域时 fail closed 的脱敏截图。
- 新增 Electron `userData/browser/audit` 下的持久化脱敏浏览器 hash-chain 审计：100 MB 轮转、轮转文件保留 30 天、integrity check，以及必需的 pre-action audit 无法写入时 fail-closed 的智能体 mutation。
- 浏览器卡片现与终端共享画布选中、click/hover focus、点击空白画布取消选中、window action、应用上方滚轮缩放，以及 native view 重定位时的稳定 renderer surface。
- Windows 智能体传输新增内置 native named-pipe host，仅允许当前用户准确 SID；release pipeline 新增真实 Electron/provider smoke 覆盖。
- 修复 linked Git worktree 的仓库 secret audit：在判断 entry 类型之前忽略 repository metadata 名称，同时继续检测可发布文件中的个人路径。
- 英语、俄语和简体中文的浏览器、安全、本地数据、审计日志与发布文档已同步。

已知问题：如果 CanvasTTY 主窗口启动时没有 maximized，打开 Browser 可能会让 native browser view 覆盖整个窗口，导致画布控件无法使用。本 prerelease 请先 maximized 启动 CanvasTTY，再打开 Browser；修复计划在下一个 patch 中提供。

## 1.0.1

- 新增终端 `Shift+Enter` 换行，不提交当前 prompt。
- 修复终端选择与键盘焦点：选中实时卡片后，输入立即进入 xterm；点击空白画布会清除选择和高亮边框。
- 新增可选的悬停聚焦，进入和离开均可选择慢速（`500ms`）、正常（`250ms`）或快速（`80ms`）延迟。程序触发的 hover focus 不再把 focus-report sequence 发送给智能体 TUI，也不会把历史位置跳回开头。
- 新增终端滚动与画布缩放相互独立的滚轮方向设置。默认滚轮向下会让终端向下滚动，画布缩放保留原有方向。
- PTY 输出以 16ms 为窗口合并后发送给渲染进程；反复复制 scrollback 字符串改为有界分块缓冲区，从而消除大量输出时的闪烁并减少历史重置。
- 设置、插件注册表和媒体目录授权的写入队列现在可在临时文件系统错误后恢复，服务商客户端元数据也与打包应用版本保持一致。
- 新增完整的简体中文 runtime 插件文档，同步英语、俄语和中文终端控制说明，并记录插件、媒体目录与浏览器的本地数据。
- 新增 MIT 许可证，以及 Security、Changelog、Architecture 和 UI Contract 的本地化版本。

## 1.0.0

- 新增轻量本地启动页，在设置、插件、媒体和 IPC 服务初始化之前显示；bootstrap 失败时会显示可见错误页，并以原生对话框作为 fallback，不再留下空白窗口。
- 新增 Electron 单实例锁：再次启动会恢复并聚焦现有窗口。
- 将终端指针坐标从画布的 CSS 变换矩形映射回 xterm layout 坐标，使文字选择、vim/tmux mouse reporting 和滚轮滚动在任意画布缩放下都能工作。
- 重做终端剪贴板快捷键：有选择时用 `Ctrl+C`、`Ctrl+Shift+C` 或 `Cmd+C` 复制；用 `Ctrl+Shift+V`、`Cmd+V` 或 `Shift+Insert` 通过 `Terminal.paste` 粘贴。快捷键按物理按键匹配，可在非拉丁键盘布局下工作。
- 新增打包应用 smoke harness（`CANVASTTY_SMOKE_TEST=1` 在首次绘制后输出 `CANVASTTY_SMOKE_READY`），并在 Linux release pipeline 中通过带 FUSE2 的 `xvfb-run` 执行。

## 0.9.99 — 公开预览版

- 新增带权限模型的 runtime 插件 registry，可安装已构建好的静态 GitHub 仓库。
- 新增 manifest v1 contribution：sandbox HOME 小组件、可移动画布应用和 CanvasTTY 管理的独立窗口。
- 新增插件预览/权限审查、启用/禁用/卸载、隔离存储、受 CSP 约束的资源和共享 host SDK。
- 新增持久化的用户音乐目录授权、可 seek 的本地音频流，以及受限的播放列表读写 API。
- 新增 sandbox 内置浏览器核心框架，包含标签页、导航、持久化隔离 profile 和画布卡片几何；目前有意不从 HOME 暴露。
- 将固定 HOME 布局替换为可持久化的 `16 × 12` 宽松网格和可视化拖拽/缩放编辑器，同时保留批准的默认布局。
- 新增任意边缘窗口/HOME 小组件缩放、仅编辑时显示的 HOME 边界、越界 draft 摆放、保存校验和编辑模式隔离。
- 新增 runtime 插件架构/开发文档以及完整的 Studio Kit 示例包。

## 0.9.2 — 公开预览版

- 服务商 CLI 查找支持跨平台：Linux 和 Windows 都会解析用户 CLI 目录，因此 AppImage 与 Windows 构建可以找到已有的 `codex`、`claude` 和 `kimi`。

## 0.9.1 — 公开预览版

- 修复图形化 AppImage 启动时的 CLI 查找：使用现有用户 CLI 目录补充桌面会话 `PATH`，包括 `~/.kimi-code/bin`。
- PTY 退出与延迟的终端输入/尺寸事件发生竞态时，不再以 `EBADFD` 崩溃 Electron 主进程。

## 0.9.0 — 公开预览版

- 修复 renderer 在 `loadURL` 完成前绘制时主窗口无法出现的问题；`ready-to-show` listener 现在会提前注册。
- 新增 RTS 风格的边缘平移，默认关闭；指针位于交互界面上时暂停。
- Settings 新增边缘平移开关/速度和滚轮缩放灵敏度。
- Settings 重组为 General、Appearance 和 Controls。
- 新增 Off、Single click 和 Double click 终端聚焦/缩放模式；自动点击聚焦默认关闭。
- 新增可重映射快捷键：`Home` 聚焦 Home 区域，`F2` 行内重命名终端窗口，并提供可隐藏的实时快捷键提示。
- 切换配色、图案、设置和自定义窗口标题时保留 PTY 状态与 scrollback。
- 改进终端剪贴板快捷键、边缘缩放、语义缩放交互和多语言文档。

## 0.8.2 — 公开预览版

- Release job 只发布面向用户的安装包，不包含解包后的构建目录。
- Windows NSIS 与 portable 可执行文件使用不同的 artifact 名称。

## 0.8.1 — 公开预览版

- 仓库和文档安全检查兼容 LF/CRLF checkout 与 Windows drive path。
- 应用行为与 `0.8.0` preview candidate 相同。

## 0.8.0 — 公开预览版

- 面向真实本地 PTY 与 AI 智能体 CLI 会话的空间画布。
- 固定 Home 区域，包含 launcher、sessions、clock、media 和基于真实来源的服务商限额。
- 可移动、可调整尺寸、带 snapping 和 semantic zoom navigation 的终端卡片。
- Electron 进程隔离、类型化白名单 IPC 和仅本地设置。
- 英语、俄语与简体中文仓库入口和文档。
- 通过 GitHub Actions 可复现地打包 Linux、Windows 和 macOS。
- 仓库秘密审计和严格的包内容 allowlist。

已知预览限制：runtime widget 插件尚未实现；Windows 与 macOS 仍需要更广泛的真实设备验证；发布包尚未代码签名或 notarized。
