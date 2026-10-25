import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {Stickers} from './stickers.mjs';
import {QzoneAdapter} from './qzone-adapter.mjs';
import {OneBot} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
const root=fileURLToPath(new URL('../',import.meta.url)),cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
const stateFile=path.join(root,'data/validation/sticker-live-state-'+Date.now()+'.json');
const library=new Stickers({...cfg,stickers:{...cfg.stickers,privateProbability:1,groupProbability:1,privateCooldownSeconds:0,groupCooldownSeconds:0}},{stateFile});
const provider={list:async input=>{const spec=library.spec(input);return spec?[spec]:[];},call:async(name,args,input)=>{assert.equal(name,'send_sticker');return {content:[{type:'text',text:'已排队发送'}],stickers:[library.choose(args.id,input)]};}};
const brain=new Brain({...cfg,role:new Role({cardPath:cfg.roleCard}),memory:new Memory({dir:path.join(root,'data/validation/sticker-memory')}),toolProvider:provider});
const owner={key:'private:'+cfg.ownerIds[0],userId:cfg.ownerIds[0],record:false};
const results=[];
const hug=await brain.reply({...owner,text:'抱抱，今天也想和小助手交流～'});
results.push({scene:'owner hug',requestId:hug.raw.id,selected:hug.stickers.map(s=>s.id),passed:hug.stickers.some(s=>['hug','comfort','clingy','shy'].includes(s.id))});
const group=await brain.reply({key:'group:'+String(cfg.allow.groups[0]||'30003'),userId:'20002',text:'我刚讲了个冷笑话，结果空调都觉得自己多余了，哈哈哈哈！',record:false});
results.push({scene:'ordinary group joke autonomous decision',requestId:group.raw.id,selected:group.stickers.map(s=>s.id),passed:group.stickers.every(s=>['happy','speechless','shock'].includes(s.id))&&!/管理员/.test(group.text),note:'Model may choose text only; stickers are optional.'});
const groupRequested=await brain.reply({key:'group:'+String(cfg.allow.groups[0]||'30003'),userId:'20002',text:'哈哈哈，这个笑话太好笑啦！小助手发个开心的表情包一起笑吧。',record:false});
results.push({scene:'group happy sticker selection',requestId:groupRequested.raw.id,selected:groupRequested.stickers.map(s=>s.id),passed:groupRequested.stickers.some(s=>s.id==='happy')});
const serious=await brain.reply({...owner,text:'生产数据库宕机了，帮我严肃排查，先给排查方向，不要发表情包。'});
results.push({scene:'serious technical issue',requestId:serious.raw.id,passed:serious.stickers.length===0&&serious.text.length>10});
// No notifications to the sleeping owner: exercise real QQ sending only in the bot's own private conversation.
if(hug.stickers.length) {
  const api=new QzoneAdapter(cfg),transport={api:async(action,args)=>{try{return {ok:true,data:{data:await api.onebot(action,args)}};}catch(error){return {ok:false,error:error.message};}}};
  const receiptFile=path.join(root,'logs/native-vision/sticker-send-self.json');
  if(!fs.existsSync(receiptFile)) {
    fs.writeFileSync(receiptFile,JSON.stringify({attemptedAt:new Date().toISOString(),destination:'bot-self',verified:false}));
    const sent=await OneBot.prototype.sendImage.call(transport,'private:'+cfg.botQQ,hug.stickers[0].file,{sticker:true});
    const messageId=sent.data?.data?.message_id;
    fs.writeFileSync(receiptFile,JSON.stringify({messageId,destination:'bot-self',verified:false}));
    const back=await api.onebot('get_msg',{message_id:messageId});
    assert(back.message.some(s=>s.type==='image'));assert.equal(String(back.user_id),cfg.botQQ);
    fs.writeFileSync(receiptFile,JSON.stringify({at:new Date().toISOString(),messageId,destination:'bot-self',verified:true},null,2));
  }
  results.push({scene:'real NapCat image delivery',destination:'bot-self',passed:JSON.parse(fs.readFileSync(receiptFile,'utf8')).verified});
}
fs.writeFileSync(path.join(root,'logs/native-vision/sticker-live-check.json'),JSON.stringify({at:new Date().toISOString(),model:cfg.model,results},null,2));
console.log(JSON.stringify(results));assert(results.every(r=>r.passed),'Some actual sticker behavior checks failed');
