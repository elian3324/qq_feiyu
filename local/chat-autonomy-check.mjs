// Actual persona/memory + read-only QQ identity probe + Mock model + private-only Dry Run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {QzoneAdapter} from './qzone-adapter.mjs';
import {Autonomy,localTime} from './autonomy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
const validation={...cfg,autonomy:{...cfg.autonomy,paused:false,chat:{...cfg.autonomy.chat,enabled:true,dryRun:true},qzone:{...cfg.autonomy.qzone,enabled:false}}};
const clock=Date.parse(localTime(Date.now(),cfg.autonomy.timezone).day+'T12:00:00+08:00');
const gateway=new QzoneAdapter(validation),login=await gateway.onebot('get_login_info'),status=await gateway.onebot('get_status');
assert.equal(String(login.user_id),String(cfg.botQQ));assert.equal(status.online,true);
let writes=0,modelRequests=0;
const a=new Autonomy({cfg:validation,role:new Role({cardPath:cfg.roleCard}),memory:new Memory({dir:cfg.dataDir,ownerIds:cfg.ownerIds}),
  bot:{connected:true,send:async()=>{writes++;throw new Error('Dry Run must not send');}},qzone:gateway,now:()=>clock,
  reload:false,stateFile:path.join(root,'data/validation/chat-autonomy-'+Date.now()+'.json')});
a.decision=async(kind,ctx)=>{
  modelRequests++;assert.equal(kind,'chat');assert.equal(ctx.recipient.sender_id,String(cfg.ownerIds[0]));
  assert(a.role.build({}).length>100);assert(Array.isArray(ctx.recentConversation));assert(Array.isArray(ctx.ownerMemory));
  return {action:'send',text:'悄悄把一只虚拟小猫放在这儿，想起来就摸摸它。',mood:'tender',intensity:0.7,nextCheckMinutes:60};
};
a.state.chat.nextDecisionAt=clock;a.save();const result=await a.tick();
assert.equal(result[0].dryRun,true);assert.equal(writes,0);assert.equal(a.state.attempts.length,0);assert(fs.existsSync(a.stateFile+'.preview.json'));
const report={at:new Date().toISOString(),ok:true,mode:'real persona/memory + read-only NapCat + Mock AI + private Dry Run',
  realModelCalls:0,mockModelCalls:modelRequests,actualPrivateSends:writes,qqOnline:true,ownerTargetVerified:true,draftGenerated:true,nextThoughtPersisted:true};
fs.writeFileSync(path.join(root,'logs/chat-autonomy-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
