# 恢复的 DSH 桥接与控制台

`qq-bridge/` 已恢复主桥接、控制台页面、DSH 客户端、会话路由、两代社交模式、预设、插件、搜索、表情与语音模块，以及可公开诊断和测试源码。它是 companion 之外的另一条运行路径。

1. 按根 README 安装 `qq-bridge` 的锁定依赖，命令带 `--ignore-scripts`。
2. 自己安装并运行与该桥接协议兼容的 DeepSeek Harness。这里不捆绑 DSH，不代替用户配置或启动模型服务。
3. 双击 `配置DSH桥接.cmd`，填写本地 `qq-bridge/config.json`：`dsh.baseUrl`、提供方/模型、必要的 DSH 鉴权、`snowluma.wsUrl/httpUrl/accessToken`、`ownerQQ` 与会话白名单。`snowluma` 是兼容旧配置的字段名称，可以指向兼容的 NapCat / OneBot 网关。
4. 将 `qq-bridge/roles/default.example.md` 复制为自己的 `default.md` 并按需编辑；个性化文件默认被忽略。
5. 双击 `DSH桥接启动.cmd` 或 `qq-bridge/start.bat`。控制台端口使用自己配置的 `consolePort`，不要与其他服务冲突；配置自己的访问 Token。

不要同时运行两个路径处理相同 QQ 会话。主项目 `.env` 的 AI Key 不会自动替代 DSH 自身的提供方配置或鉴权。

受限的 `@snowluma/sdk` 和 `@snowluma/mcp` 安装副本没有分发，也不再作为运行依赖。已用自写的 `src/onebot-client.js` 替代桥接实际使用的 SDK 接口，保留事件订阅、动作请求、重连和发送；安全 QQ MCP 使用项目自身的服务端。没有复制其能力目录快照或描述文本。接口事实的动作名与参数名用于互操作。

网关专有扩展仍由实际网关提供；支持标准消息动作并不代表支持所有收藏表情或空间动作。独立客户端、DSH 协议版本、UI 及实际网关兼容性本次都只做静态检查，未运行原回归测试。

`qq-bridge/scripts/test-mcp-exec.mjs` 已改为连接自己的安全 MCP，并检查其实际提供的查询/发送工具，不依赖已移除的第三方 MCP 包。其他 `scripts/test-*` 和探针仍属于业务测试，需要用户准备自己的隔离环境后自行执行。

原 package.json 引用但提供目录本身未包含独立 voice-tool 源码。voice-gui / voice-cli 入口保留，使用 QQ_BRIDGE_VOICE_TOOL_DIR 指向自己已有且具备使用权限的外部工具；该条件不是本次清理造成的。机器人内置百炼 TTS 和 QQ 语音发送模块已保留，不依赖这个独立工具。
