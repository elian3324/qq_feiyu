# NapCat 与网关管理

主链路使用 OneBot v11 正向 WebSocket 接收事件，HTTP 服务端执行动作。网关必须由部署者获得授权、独立安装并登录自己的机器人账号；仓库不提供 QQ/NapCat/SnowLuma 程序、登录状态或原生组件。

先配置 `.env` 的 `ONEBOT_WS_URL`、`ONEBOT_HTTP_URL` 和 `ONEBOT_ACCESS_TOKEN`，并与自己的网关保持一致。根 README 有默认回环地址示例。

`Gateway.cmd` 保留了网关入口。若想由它运行自己安装的 NapCat，可将 `local/gateway-launcher.example.json` 复制为 `local/gateway-launcher.local.json`，填写自己的可执行文件、参数数组和工作目录，并显式设置 `allowLaunch=true`。此文件为私人配置，会被忽略。不要指向原账号正在使用的安装目录或其他人的程序。

`autoRecover` 默认 false；只有部署者显式启用，守护模式才允许请求重新运行这个启动器。脚本不下载、补丁或迁移第三方程序，不程序化控制 SnowLuma。GUI 登录、账号和具体端口仍由自己的网关管理。

停止/重启主机器人默认保留独立网关。它们只处理当前目录登记并通过身份核验的机器人进程，不按 `QQ.exe`、`node.exe` 等通用进程名批量结束进程。

原生桌面接入的自有适配源码没有删除，转到 [高级集成](ADVANCED_INTEGRATION.md)。这条路径需要单独满足外部组件的授权和版本要求，不属于普通 OneBot 部署的必需步骤。

网关停止是独立授权项：只有本地启动配置显式 allowStop=true、由此副本登记、启动时间/可执行文件匹配且命令行包含本项目路径的隔离网关，停止全部入口才会结束它。独立安装的外部网关或身份无法核验的进程保留，由用户手动管理。
