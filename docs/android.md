# Android 构建与使用

游戏 APK 内置同一份 `balatro.html`，单人模式不需要网络、账号或服务器。Android 与网页浏览器的存档相互独立；覆盖安装同签名的新 APK 会保留应用数据，不要先卸载。

## 安装

交付文件：`outputs/PixelBalatro-1.7.1-android.apk`。传到手机后从文件管理器打开，按系统提示允许该文件管理器安装应用。包名 `io.github.hellspace.pixelbalatro`，版本 1.7.1 / versionCode 10701。

手机端下载：[Release v1.7.1](https://github.com/Hell-space/pixel-balatro/releases/tag/v1.7.1) → Assets → `PixelBalatro-1.7.1-android.apk`，或[直接下载 APK](https://github.com/Hell-space/pixel-balatro/releases/download/v1.7.1/PixelBalatro-1.7.1-android.apk)。选择 APK 安装包；GitHub 自动提供的 Source code ZIP/TAR 是源码归档。

已经安装 1.3.x 到 1.7.0 的设备直接覆盖安装，使用同一签名，保留原有进度和设置；不要先卸载旧版。1.7.0 新增 Boss 破绽、碾压奖励、6 张小丑、推荐与滑动选牌和新动画，见 [玩法与动效](upgrade.md)；1.7.1 删除了出牌节奏和盲注悬赏，见 [玩法精简](cleanup.md)。

最低 Android 8（API 26），使用系统 Android WebView 渲染；本轮实际验证 Android 9 / WebView 91.0.4472.114。APK 不含架构限定的原生库。若系统网页组件太旧，应先更新系统 WebView。

返回键会依次关闭图鉴、菜单等界面；对局中返回键打开菜单，在标题页返回键离开应用。支持横竖屏、后台静音和自动存档。出牌动画被中断时，恢复至出牌前的稳定状态；不要把强行结束进程当作正常退出方法。

联网权限仅用于可选的多人对战。APK 内的对战地址须为 HTTPS；单人游戏始终从应用内资源加载。多人对战仍需要另行运行仓库中的 Node 服务。

## 从源码构建

使用已安装的 Python 3.10+、Node.js 18+、JDK 17、Android SDK platform 36 和 build-tools 36.0.0。无需 Gradle、npm 依赖或网络下载。

```powershell
python -X utf8 scripts/build-android.py --sdk "你的 Android SDK 目录" --java-home "你的 JDK 17 目录"
```

也可通过当前进程的 `ANDROID_HOME` / `JAVA_HOME` 指定。脚本只使用传入路径，不修改全局环境配置。Windows 的 Android 资源工具对中文绝对路径有限制，因此资源编译使用项目内的相对路径。

构建顺序为：生成 HTML → aapt2 资源打包 → javac → D8 → zipalign → 签名 → 签名与包内 HTML 一致性检查。`outputs/android-build.json` 记录版本、包名、摘要、签名验证和 Manifest 信息。Android 编译目录、交付包和签名材料已从 Git 排除。

首次构建会在 `android/private/` 创建本项目独立的发布证书和密码文件。后续构建复用它们；若只丢失其中之一，脚本拒绝重新生成。**备份整个 `android/private/`，不要提交或公开它。** 丢失签名材料将无法给已安装的本项目 APK 做保留数据的覆盖更新。

## 实机覆盖范围

1.7.0 和 1.7.1 只更新包内 HTML，Android 宿主代码与签名不变；这两轮只检查了 APK 签名、版本和内置 HTML 一致性，没有在模拟器或实体手机上实际运行，见 [1.7.1 验证记录](verification-1.7.1.md)。此前的模拟器检查使用独立雷电测试实例，界面见 [1.6.0 验证记录](verification-1.6.0.md)；底牌见 [1.5.0 验证记录](verification-1.5.0.md)，首次离线检查见 [1.3.0 验证记录](verification.md)。实体手机、Android 15/16 的系统栏和手势返回仍需要相应设备验证；SDK 36 编译成功不等于这些系统已实际测试。
