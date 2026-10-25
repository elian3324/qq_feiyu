import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
const ROOT=fileURLToPath(new URL('../',import.meta.url)),cfg=loadConfig();
async function api(action,body={}){const r=await fetch(cfg.onebot.httpUrl+'/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+cfg.onebot.accessToken},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok||j.status!=='ok')throw new Error('gateway read failed');return j.data;}
const login=await api('get_login_info'),gateway=String(login.user_id)===cfg.botQQ;
const health=JSON.parse(fs.readFileSync(path.join(ROOT,'logs/onebot-health.json'),'utf8'));
let quoteLookup=null;
if(cfg.allow?.groups?.[0]){
 const history=await api('get_group_msg_history',{group_id:cfg.allow.groups[0],count:100});
 const row=(history.messages||[]).find(m=>String(m.user_id??m.sender?.user_id)===cfg.botQQ);
 if(row){const msg=await api('get_msg',{message_id:String(row.message_id)});quoteLookup=String(msg.group_id)===cfg.allow.groups[0]&&String(msg.user_id??msg.sender?.user_id)===cfg.botQQ;}
}
const memory=JSON.parse(fs.readFileSync(path.join(cfg.dataDir,'owner-memory-health.json'),'utf8'));
const result={at:new Date().toISOString(),gatewayLoggedIn:gateway,chatReady:health.status==='ready',newCodeLoaded:health.mediaProtocolVersion===2&&health.ownerMemoryVersion===2,
 asrEnabled:health.asrEnabled,videoEnabled:health.videoEnabled,documentsEnabled:health.documentsEnabled,randomProbability:health.wakeProbability,onlyXiaojingKeyword:JSON.stringify(health.wakeKeywords)===JSON.stringify(['小助手']),
 quoteLookupVerified:quoteLookup,memoryReady:memory.ready,memoryPending:memory.pending,memoryFacts:memory.facts,qqTestMessagesSent:0};
result.ok=gateway&&result.chatReady&&result.newCodeLoaded&&result.asrEnabled&&result.videoEnabled&&result.documentsEnabled&&result.randomProbability===0.2&&result.onlyXiaojingKeyword&&result.memoryReady&&quoteLookup!==false;
fs.writeFileSync(path.join(ROOT,'logs/memory-media-runtime-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
