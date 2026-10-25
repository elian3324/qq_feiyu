// Test the project-owned safe QQ MCP using a full DSH client handshake.
// （initialize → tools/list → tools/call），确认动作执行工具可用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json'), 'utf8'));
const endpoint = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000/').replace(/\/?$/, '/');
const token = cfg.snowluma?.accessToken || '';

const mcpEntry = fileURLToPath(new URL('../src/mcp-snowluma-safe.js', import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mcpEntry],
  env: {
    SNOWLUMA_MCP_ENDPOINT: endpoint,
    SNOWLUMA_MCP_TOKEN: token,
    SNOWLUMA_MCP_MODE: 'write'
  }
});

const client = new Client({ name: 'bridge-test', version: '0.1.0' });
try {
  await client.connect(transport);
  console.log('✅ MCP 连接成功');

  const tools = await client.listTools();
  console.log(`✅ tools/list: ${tools.tools.length} 个工具`);
  const names = tools.tools.map((t) => t.name);
  console.log('   ', names.join(', '));
  const hasQuery = names.includes('qq_status');
  const hasInvoke = names.includes('qq_send_private_message');
  console.log(hasQuery ? '✅ qq_status 可用' : '❌ 缺 qq_status');
  console.log(hasInvoke ? '✅ qq_send_private_message 可用（write 模式）' : '❌ 缺 qq_send_private_message');

  if (hasQuery) {
    const result = await client.callTool({ name: 'qq_status', arguments: {} });
    console.log('✅ qq_status(get_login_info):', JSON.stringify(result).slice(0, 300));
  }
  process.exit(0);
} catch (error) {
  console.error('❌ MCP 测试失败:', error?.message ?? error);
  process.exit(1);
}
