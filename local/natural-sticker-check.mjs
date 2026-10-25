// Real model, natural conversation with auto tool choice; selections are inspected locally, not sent to QQ.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {Stickers,selectNaturalSticker} from './stickers.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
let now=Date.now();
const library=new Stickers(cfg,{stateFile:path.join(root,'data/validation/natural-stickers-'+now+'.json'),now:()=>now});
const provider={suggestSticker:async(input,reply)=>selectNaturalSticker(cfg,library,input,reply.text,reply.recentConversation),list:async input=>{const spec=library.spec(input);return spec?[spec]:[];},call:async(name,args,input)=>{assert.equal(name,'send_sticker');return {content:[{type:'text',text:'已加入表情发送队列。'}],stickers:[library.choose(args.id,input)]};}};
const brain=new Brain({...cfg,role:new Role({cardPath:cfg.roleCard}),memory:new Memory({dir:path.join(root,'data/validation/natural-sticker-memory')}),toolProvider:provider});
const results=[];
for(const [scene,text] of [['affection','抱抱，今天也好喜欢小助手～'],['laughter','你刚才那个笑话把我笑到肚子疼，哈哈哈！'],['serious','我现在需要认真排查数据库故障，请给我排查方向。']]) {
  const output=await brain.reply({key:'private:'+cfg.ownerIds[0],userId:cfg.ownerIds[0],text,record:false});
  results.push({scene,text,toolChoice:'auto',selected:output.stickers.map(s=>s.id),selectionRequestIds:output.stickers.map(s=>s.selectionRequestId).filter(Boolean),requestId:output.raw.id,output:output.text});
}
const passed=results[0].selected.length===1&&results[1].selected.length===1&&results[2].selected.length===0;
fs.writeFileSync(path.join(root,'logs/context-stickers-real-api.json'),JSON.stringify({at:new Date().toISOString(),model:cfg.model,scope:'Real model context decisions, no random gate and unchanged clock between scenes; no QQ messages sent.',passed,results},null,2));
console.log(JSON.stringify({passed,results:results.map(({scene,selected,requestId})=>({scene,selected,requestId}))}));assert(passed);
