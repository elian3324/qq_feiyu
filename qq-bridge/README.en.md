# QQ bridge

This directory retains the DSH bridge, console, social modes, plugins, presets,
voice/media helpers, diagnostics and tests from the supplied project.

The two restricted SnowLuma npm packages are replaced on the active runtime path
by the project-owned OneBot client and safe MCP server. No third-party native
binary, login state, private role, chat archive or historical Git data is bundled.

Install dependencies using `npm --prefix qq-bridge ci --ignore-scripts` from the
project root. Configure your own DSH endpoint, OneBot gateway, credentials, owner
and allowlists. Use `配置DSH桥接.cmd` and `DSH桥接启动.cmd`, or the entry points in
`package.json`. See [DSH deployment](../docs/DSH_BRIDGE.md) and [all scripts](../docs/SCRIPTS.md).

Complete QQ space interaction requires an independently authorized backend.
The separately maintained standalone `voice-tool` was referenced but not included
in the supplied source directory; its optional launch commands are retained and
accept `QQ_BRIDGE_VOICE_TOOL_DIR`. The bot's integrated TTS does not need that tool.

Only static validation was performed. No project test, bot, service, QQ/API
connection or dependency installation was executed during preparation.
