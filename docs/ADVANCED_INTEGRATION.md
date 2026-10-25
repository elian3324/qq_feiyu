# 原生、空间与外部组件的恢复边界

本版本保留原项目可公开的原生会话适配、认证审计、运行环境选择、桌面入口准备、连接监督和诊断源码。没有把依赖外部程序的模块一并删除，但外部 QQ/NapCat/SnowLuma 程序和登录数据不能随源码分发。

## 原生接入

相关源码包括 `local/gateway-runtime.cjs`、`gateway-entry.cjs`、`prepare-desktop-entry.cjs`、`prepare-desktop-framework.cjs`、`qq-session-bridge.cjs`、`qq-native-services.cjs`、`qq-auth-audit.cjs`、`qq-native-observe.mjs`、`qq-runtime-migrate.ps1` 和相应测试。

原 `gateway/start-native.cjs` 的自有入口映射为 `local/gateway-entry.cjs`；它通过 `COMPANION_GATEWAY_DIR` 或本项目自己的被忽略运行目录找到部署者提供的运行环境。旧项目的运行目录与账号信息没有复制。

这些源码使用外部程序的内部接口，具有版本约束。需要用户先取得组件和相应授权；涉及迁移/原生接入时显式设置 `COMPANION_ENABLE_NATIVE_TOOLS=1`。不要把原账号的数据库、Cookie 或修改后的第三方组件打包进公开仓库。默认 OneBot 接入无需这些高级工具。

## 空间完整后端

空间决策、限流、去重、隐私核验、发布和互动逻辑已保留，`local/qzone-adapter.mjs` 支持两种后端：

1. 配置实现 [QZONE.md](QZONE.md) 动作契约的空间网关。
2. 使用部署者自己获得授权的本地协议适配器：在 `.env` 设置 `QZONE_PROTOCOL_MODULE`。其命名导出需为 `getQzoneMsgList`、`getQzoneFeeds`、`getQzoneMsgDetail`、`setQzoneLike` 和 `commentQzoneMsg`，调用签名与保留的适配层一致。发布仍使用网关的 `send_qzone_msg`。

原 `local/vendor/qzone-protocol.mjs` 的来源许可证限制公开修改版，不能把它改名或删掉版权后分发。源码可见并不等于允许开源再分发。该文件及其安装副本没有进入此仓库。

保留的 `local/vendor-build.mjs` 是本项目自己的本地生成工具，不含协议实现。只有在自己已经合法取得源代码、明确确认许可允许自己的本地使用后，才能设置 `QZONE_SOURCE_DIR`、`COMPANION_ENABLE_NATIVE_TOOLS=1` 并自行调用。生成到被忽略的 `local/vendor/`；不得将生成文件公开。该工具没有在本次整理中运行。

如所用源树版本与导出接口不同，必须使用自己有权使用的兼容适配器。当前版本没有替使用者获得额外授权，也没有验证任意新版本的构建结果。

**这一部分不能承诺仅 npm 安装加填写 Key 就自动获得完整空间协议实现。** 要达到原项目在特定外部环境中的全部行为，还需要相同能力且获得授权的空间后端。限制来自原第三方实现的许可与外部程序接口，不是因为隐私清理而删除了自有业务逻辑。

## 测试和资源

原自有回归/探针源码已恢复并脱敏。需要媒体输入的测试应使用自己生成或具有权限的测试资源。`local/create-media-fixtures.py` 和 `local/build-stickers.ps1` 保留了本地生成能力；原个人媒体、来源不能确认的图片与真实聊天附件没有分发。

本次没有执行这些工具、安装外部组件、启动测试服务器、连接 QQ/API 或处理原机器人进程。
