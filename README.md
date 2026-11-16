# 拾光 · Focus On

按自己的节奏安排学习与休息的 Windows 桌面应用。暖白与鼠尾草绿界面，本地保存进度，无需注册。

桌面版使用 Tauri 2 + Rust，界面为原生 HTML、CSS、JavaScript。应用本身不调用模型、不上传学习记录，也不需要常驻开发服务器。

## 使用桌面版

构建产物放在 `releases/`：

| 目录 | 适用电脑 |
| --- | --- |
| `windows-arm64/` | Windows ARM64，例如搭载骁龙处理器的电脑 |
| `windows-x64/` | 普通 Intel / AMD 64 位 Windows 电脑 |

每个目录包含：

- `Shiguang-0.1.0-windows-<架构>-setup.exe`：安装版，可创建快捷方式和卸载入口。
- `Shiguang-0.1.0-windows-<架构>-portable.exe`：免安装执行文件，直接打开即可；数据仍保存在用户目录中。
- `SHA256SUMS.txt`：文件校验值。

也可双击项目根目录的 `启动桌面版.cmd`，自动选择这台电脑对应的免安装版本。

建议 Windows 10 / 11。界面依赖 Microsoft Edge WebView2 Runtime；安装包会检测它，缺失时联网下载安装。应用启动后可离线使用。目前构建未配置代码签名。

## 功能与提醒

- 自定学习 1–180 分钟、休息 1–60 分钟、循环 1–12 轮。
- 15/5、25/5、50/10 三组预设，以及当前学习任务。
- 暂停、继续、重置、跳过休息；最后一轮完成后直接结束计划。
- 自动开始下一阶段，或等待手动开始；支持声音开关。
- 到时显示页面提示和 Windows 系统通知；桌面版由原生后台线程负责截止时间。
- 关闭窗口后留在系统托盘继续计时；单击托盘图标打开，右键选择「退出拾光」才会退出程序。
- 单实例运行、全屏沉浸模式、空格键开始或暂停、Esc 退出沉浸模式。
- 今日专注分钟、完成轮数、最近完成记录；刷新或重启后恢复已保存的进度。

系统通知与提示音仍受 Windows 通知设置、勿扰模式和系统音量影响。退出程序、关机或电脑休眠期间无法保证准点提醒；再次打开或唤醒后会按实际时间校准。程序保持运行并从休眠中唤醒时，错过多个阶段仅补发最近一条通知；完全退出后重新打开会恢复进度，不补发退出期间的通知。关闭声音后，系统通知仍显示，但不请求播放提示音。

安装版使用应用自己的通知标识。开发模式和免安装版本没有注册开始菜单标识时，通知可能显示在 Windows PowerShell 来源下，通知内容仍标为「拾光」。

## 数据

设置、计时状态和已完成记录保存于当前用户的 WebView2 本地存储中（应用标识为 `app.shiguang.focus`）。不接入账号、云端同步或统计服务。

网页版本与桌面版本分别存储数据，目前不会自动迁移。删除应用的 WebView2 数据会清除学习记录。计时使用实际截止时间，恢复后不会因后台暂停而重头开始；只统计已完成的学习轮次。

## 本地开发

需要 Node.js 22 或更新版本、pnpm 11.25.0、Rust 1.90 或更新版本，以及 Visual Studio C++ 构建工具和 Windows SDK。构建 ARM64 还需要 MSVC ARM64 编译工具。

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm dev
```

前端静态文件在启动或打包前复制到 `dist/`。开发时修改页面文件后，重新运行 `pnpm dev` 以重新复制。也可以先运行 `pnpm build:web` 单独检查资源准备过程。

原生后台计时测试：

```powershell
pnpm build:web
pnpm test:native
```

## 打包 Windows 应用

```powershell
rustup target add aarch64-pc-windows-msvc x86_64-pc-windows-msvc

pnpm build:arm64
pnpm collect:arm64

pnpm build:x64
pnpm collect:x64
```

只需自己的架构时，运行对应的一组即可。底层产物位于 `src-tauri/target/<target>/release/`，收集脚本将安装包、执行文件与 SHA-256 校验文件整理到 `releases/windows-<架构>/`。

## GitHub 源码与构建

仓库应包含源代码、`pnpm-lock.yaml`、`src-tauri/Cargo.lock` 和 `.github/workflows/build.yml`。`.gitignore` 已排除依赖、编译缓存、生成页面、发布文件和环境变量文件。安装包可以另行上传至 GitHub Releases。

源码仓库：[shu-huangjunjie/shiguang-focus](https://github.com/shu-huangjunjie/shiguang-focus)。在其他电脑上获取项目：

```powershell
git clone https://github.com/shu-huangjunjie/shiguang-focus.git
cd shiguang-focus
pnpm install --frozen-lockfile
```

上传后，推送到 `main`、提交 Pull Request 或手动运行 Actions，都会分别测试并构建 Windows x64 和 ARM64 应用。完成后可从工作流的 Artifacts 下载打包文件。此工作流只保存构建产物，不会自动发布 GitHub Release，也不需要额外配置发布密钥。

项目暂未选择开源许可证，`package.json` 标记为 `UNLICENSED`。公开分发或接受贡献前，可以根据自己的授权意愿补充 `LICENSE`。

## 源码结构

```text
index.html / styles.css / app.js  界面与交互
timer-engine.js                  可恢复的前端计时状态机
desktop-bridge.js                界面与原生截止时间同步
src-tauri/src/scheduler.rs        后台计时与通知去重
src-tauri/src/lib.rs              桌面窗口、托盘与单实例
src-tauri/src/notification.rs     Windows 系统通知与声音开关
scripts/                         资源准备和打包文件整理
tests/                           计时引擎和桌面桥接测试
.github/workflows/build.yml       GitHub Actions 双架构构建
```

原先的网页入口仍可用：双击 `启动拾光.cmd` 或 `index.html`。网页关闭后无法继续发出提醒，需持续打开页面。

开发参考：[Tauri Windows 安装包](https://v2.tauri.app/distribute/windows-installer/)、[系统托盘](https://v2.tauri.app/learn/system-tray/)、[Windows 通知接口](https://microsoft.github.io/windows-docs-rs/doc/windows/UI/Notifications/struct.ToastNotificationManager.html)。
