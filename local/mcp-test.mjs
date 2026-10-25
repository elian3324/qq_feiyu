import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '../ai-companion-kit/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../ai-companion-kit/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root=fileURLToPath(new URL('../',import.meta.url));
let reads=0;
const api=http.createServer(async(req,res)=>{
  assert.equal(req.url,'/get_qzone_msg_list');assert.equal(req.headers.authorization,'Bearer mcp-test-only');
  for await(const chunk of req) {}
  reads++;res.setHeader('content-type','application/json');
  res.end(JSON.stringify({status:'ok',retcode:0,data:[{tid:'local-test',content:'本地模拟说说',like_count:0,comment_count:0}]}));
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
try {
  for(const name of ['phone-mcp','qzone-mcp']) {
    const client=new Client({name:'local-install-check',version:'1.0.0'});
    const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,`ai-companion-kit/packages/${name}/src/${name==='phone-mcp'?'phone-mcp.js':'qzone-mcp.js'}`)],cwd:root,stderr:'pipe',env:{...process.env,SNOWLUMA_HTTP_URL:`http://127.0.0.1:${api.address().port}`,SNOWLUMA_ACCESS_TOKEN:'mcp-test-only',PHONE_ADB:(process.env.PHONE_ADB||'adb')}});
    try {
      await client.connect(transport);
      const tools=await client.listTools();
      assert(tools.tools.some(tool=>tool.name==='qzone_my_posts'));
      if(name==='phone-mcp') assert(tools.tools.some(tool=>tool.name==='phone_screenshot'));
      const result=await client.callTool({name:'qzone_my_posts',arguments:{num:1}});
      assert(!result.isError,JSON.stringify(result));assert.match(JSON.stringify(result),/本地模拟说说/);
      if(name==='phone-mcp') {
        const deviceResult=await client.callTool({name:'phone_screenshot',arguments:{}});
        assert(deviceResult.isError,'No phone connected: screenshot must give an actionable error.');
      }
      console.log(`PASS: ${name} MCP handshake, ${tools.tools.length} tools, authenticated mock read.`);
    } finally { await client.close(); }
  }
  assert.equal(reads,2);
  console.log('MCP checks passed; no real QQ reads, posts, likes or comments were made.');
} finally { await new Promise(resolve=>api.close(resolve)); }
