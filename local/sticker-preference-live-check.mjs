// Real model/source policy and actual background collection, without sending QQ test messages.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {QQFavorites} from './qq-favorites.mjs';
import {StickerCollector} from './sticker-collector.mjs';
import {Stickers,selectNaturalSticker} from './stickers.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
const receipt={at:new Date().toISOString(),model:cfg.model,scope:'Real DeepSeek decisions; real group history media replay to independent collector; no outgoing QQ messages'};
const favorites=new QQFavorites(cfg);receipt.before=await favorites.sync();
const input={key:'group:'+cfg.allow.groups[0],userId:cfg.ownerIds[0],record:false};
const library=new Stickers(cfg,{stateFile:path.join(root,'data/validation/preference-'+randomUUID()+'.json')});
assert(library.choices(input).length&&library.choices(input).every(e=>e.source==='qq'));
const provider={list:async turn=>{const spec=library.spec(turn);return spec?[spec]:[];},suggestSticker:(turn,reply)=>selectNaturalSticker(cfg,library,turn,reply.text,reply.recentConversation),call:async(name,args,turn)=>{assert.equal(name,'send_sticker');return {content:[{type:'text',text:'测试已记录选图，不实际发消息。'}],stickers:[library.choose(args.id,turn)]};}};
const brain=new Brain({...cfg,role:new Role({cardPath:cfg.roleCard}),memory:new Memory({dir:path.join(root,'data/validation/sticker-preference-memory')}),toolProvider:provider});
receipt.selection=[];
for(const text of ['哈哈哈，笑死我了，群里今天也太欢乐了！','我都服了，这也太让人无语了吧哈哈','我需要认真排查数据库错误，请给排查顺序。']) {
 const output=await brain.reply({...input,text});
 const sources=output.stickers.map(s=>s.source);assert(sources.every(s=>s==='qq'));
 receipt.selection.push({sources,resourceIds:output.stickers.map(s=>s.id),requestId:output.raw.id,selectionRequestIds:output.stickers.map(s=>s.selectionRequestId).filter(Boolean)});
}
assert(receipt.selection.slice(0,2).some(row=>row.sources.length),'Real model did not select any QQ favorite in either light scene');
assert.equal(receipt.selection.at(-1).sources.length,0,'Serious scene should not force any sticker');
console.log('PASS real model selected QQ favorites for light chat and no sticker for serious chat');
const events=[];const collector=new StickerCollector(cfg,{favorites,audit:event=>events.push(event)});
const original=collector.analyze;receipt.assessments=[];
collector.analyze=async buffer=>{const result=await original(buffer);receipt.assessments.push({isMeme:result.isMeme,sensitive:result.sensitive,collect:result.collect,requestId:result.requestId});return result;};
const bot={api:async(action,args)=>({ok:true,data:{data:await favorites.api(action,args)}})};
const history=await favorites.api('get_group_msg_history',{group_id:cfg.allow.groups[0],count:100});
const known=new Set(favorites.state().entries.map(e=>String(e.md5).toUpperCase()));
let candidates=0;
for(const raw of [...(history.messages||[])].reverse()) {
 if(String(raw.user_id)===String(cfg.botQQ))continue;
 for(const segment of (raw.message||[]).filter(s=>s.type==='mface'||s.type==='image'&&Number(s.data?.sub_type)>0)) {
  try {
   const item=segment.data;
   const {buffer}=await favorites.media.resolveImage({file:item.file||'',url:item.url||'',emojiId:item.emoji_id||''},bot);
   const md5=createHash('md5').update(buffer).digest('hex').toUpperCase();if(known.has(md5))continue;known.add(md5);
   collector.observe({key:input.key,userId:String(raw.user_id),text:'',raw:[segment]},bot);await collector.drain();
   candidates++;
  }catch{}
  if(events.some(event=>event.decision==='saved')||candidates>=3)break;
 }
 if(events.some(event=>event.decision==='saved')||candidates>=3)break;
}
receipt.collectorEvents=events;receipt.after=await favorites.sync();
receipt.collectionVerified=events.some(event=>event.decision==='saved'&&event.verified);
receipt.passed=receipt.collectionVerified;
fs.writeFileSync(path.join(root,'logs/sticker-preference-live.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify({passed:receipt.passed,selectedQQ:receipt.selection.filter(row=>row.sources.includes('qq')).length,backgroundCollectionVerified:receipt.collectionVerified,before:receipt.before.count,after:receipt.after.count,indexed:receipt.after.indexed}));
assert(receipt.passed,'No new actual background collection was verified');
