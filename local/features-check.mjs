import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {createTools} from './features.mjs';
const cfg=loadConfig(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const tools=await createTools({...cfg,dryRun:true});
const input={key:'private:'+cfg.ownerIds[0],userId:cfg.ownerIds[0],userName:'管理员'};
try {
  const listed=await tools.list(input);
  assert(listed.some(t=>t.function.name==='phone_dump'));
  assert(listed.some(t=>t.function.name==='qzone_post'));
  assert.equal((await tools.list({key:'private:other',userId:'other'})).length,0);
  assert.equal((await tools.list({...input,key:'group:555'})).length,0);
  const blocked=await tools.call('qzone_post',{content:'must never post during dry run'},input);
  assert(blocked.isError);
  console.log('PASS: phone and Qzone tools available only to owner private chat; dry-run publishing blocked.');
  for(const name of ['phone_status','qzone_my_posts','qzone_feeds']) {
    const result=await tools.call(name,name==='qzone_feeds'?{count:1}:name==='qzone_my_posts'?{num:1}:{},input);
    assert(!result.isError,JSON.stringify(result.content));
    console.log('PASS: '+name+' live read.');
  }
  const brain=new Brain({...cfg,role:new Role({cardPath:cfg.roleCard}),memory:new Memory({dir:cfg.dataDir}),toolProvider:tools,timeoutMs:60000});
  const before=fs.existsSync(new URL('../logs/tool-audit.jsonl',import.meta.url))?fs.readFileSync(new URL('../logs/tool-audit.jsonl',import.meta.url),'utf8').trim().split('\n').length:0;
  const result=await brain.reply({...input,text:'这是安装自检。请分别调用 phone_status 和 qzone_my_posts（num=1）两个工具检查真实状态，然后用一句话说明检查结果。不要发说说、点赞、评论、操作手机或发送截图。',record:false});
  assert(result.text.length>0);
  const events=fs.readFileSync(new URL('../logs/tool-audit.jsonl',import.meta.url),'utf8').trim().split('\n').slice(before).map(l=>JSON.parse(l));
  assert(events.some(e=>e.tool==='phone_status'&&e.ok));
  assert(events.some(e=>e.tool==='qzone_my_posts'&&e.ok));
  assert(events.every(e=>['phone_status','qzone_my_posts'].includes(e.tool)));
  console.log('PASS: real Bailian DeepSeek called both MCP tools and generated a result; no QQ message or space post sent.');
} finally {await tools.close();}
