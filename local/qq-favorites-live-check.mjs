// Real QQ favorites read/collect and one explicitly authorized group image send.
// Receipts prevent accidental repeated external sends on a rerun.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {OneBot} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
import {Multimedia} from './multimedia.mjs';
import {QQFavorites} from './qq-favorites.mjs';
import {Stickers,selectNaturalSticker} from './stickers.mjs';
import {auditRequest,auditResponse} from './request-audit.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
const at=path.join(root,'logs/qq-favorites-live.json');
let receipt;try{receipt=JSON.parse(fs.readFileSync(at,'utf8'));}catch{receipt={startedAt:new Date().toISOString()};}
const save=()=>fs.writeFileSync(at,JSON.stringify(receipt,null,2));
const media=new Multimedia(cfg),favorites=new QQFavorites(cfg,{media});
const bot=new OneBot({...cfg.onebot,selfId:cfg.botQQ,ownerIds:cfg.ownerIds});
const identity=await favorites.api('get_login_info',{});assert.equal(String(identity.user_id),String(cfg.botQQ));
receipt.initialSync=await favorites.sync();save();
assert(receipt.initialSync.indexed>0,'No actual QQ favorite was indexed');
console.log('PASS actual QQ favorite fetch, original bytes and real vision indexing');
if(!receipt.collection||receipt.collection.alreadySaved) {
  if(receipt.collection?.alreadySaved){receipt.duplicateCheck=receipt.collection;delete receipt.collection;save();}
  const sources=[];
  for(const [kind,id] of [['group',cfg.allow.groups[0]],['private',cfg.ownerIds[0]]]) {
    const history=await favorites.api(kind==='group'?'get_group_msg_history':'get_friend_msg_history',{[kind==='group'?'group_id':'user_id']:id,count:30});
    for(const raw of (history.messages||[]).reverse()) {
      if(String(raw.user_id)===String(cfg.botQQ))continue;
      const segments=(raw.message||[]).filter(s=>s.type==='mface'||s.type==='image'&&Number(s.data?.sub_type)>0);
      if(!segments.length)continue;
      sources.push({key:kind+':'+id,userId:String(raw.user_id),raw:segments.slice(0,1),text:'这张表情好有趣，喜欢的话你也可以收藏，以后聊天用。'});
      break;
    }
  }
  const savedSource=path.join(root,'data/qq-favorites/acceptance-source.private.json');
  if(fs.existsSync(savedSource))sources.unshift(JSON.parse(fs.readFileSync(savedSource,'utf8')));
  assert(sources.length,'No recent actual received sticker available for collection acceptance');
  const source=sources[0],input={key:source.key,userId:source.userId,text:source.text,record:false};
  const prepared=await media.prepareMessages([source],bot);assert(prepared.media.length);
  input.media=prepared.media;input.collectableStickers=favorites.register([source],input,bot);assert(input.collectableStickers.length);
  const decisions=[];
  const provider={auditRequest,auditResponse,list:async turn=>{const spec=favorites.spec(turn);return spec?[spec]:[];},call:async(name,args,turn)=>{
    assert.equal(name,'collect_qq_sticker');
    receipt.collection={attempted:true,at:new Date().toISOString(),source:'actual-received-sticker'};save();
    const result=await favorites.collect(args.id,turn);decisions.push(result);
    receipt.collection={...receipt.collection,...result};save();
    return {content:[{type:'text',text:result.alreadySaved?'这张表情已在你的QQ收藏里。':'已实际收藏并回读确认。'}]};
  }};
  const brain=new Brain({...cfg,role:new Role({cardPath:cfg.roleCard}),memory:new Memory({dir:path.join(root,'data/validation/qq-favorite-memory')}),toolProvider:provider});
  const result=await brain.reply(input);
  receipt.collectionDecision={requestId:result.raw.id,model:result.raw.model,selected:decisions.length>0};save();
  assert(decisions.length&&decisions[0].verified,'Real model did not choose a verifiable collection');
  await favorites.sync();
  console.log('PASS actual model collection tool decision and QQ favorites readback');
}
if(!receipt.groupSend) {
  const input={key:'group:'+cfg.allow.groups[0],userId:cfg.ownerIds[0],text:'请从你QQ收藏的表情中选一张适合轻松打招呼的表情。'};
  const library=new Stickers(cfg),entries=library.entries(input).filter(e=>e.source==='qq');assert(entries.length);
  const originalEntries=library.entries.bind(library);library.entries=turn=>originalEntries(turn).filter(e=>e.source==='qq');
  const selected=await selectNaturalSticker(cfg,library,input,'大家好呀，来冒个泡～');assert(selected?.source==='qq','Real model did not choose a QQ favorite');
  receipt.groupSend={attempted:true,at:new Date().toISOString(),resourceId:selected.id,source:selected.source,selectionRequestId:selected.selectionRequestId};save();
  const sent=await bot.sendImage(input.key,selected.file,{sticker:true});
  const messageId=sent.data?.data?.message_id;
  receipt.groupSend={...receipt.groupSend,messageId,sent:true};save();
  const message=await favorites.api('get_msg',{message_id:messageId});
  assert.equal(String(message.sender?.user_id||message.user_id),String(cfg.botQQ));
  assert(message.message.some(segment=>segment.type==='image'));
  if(message.group_id)assert.equal(String(message.group_id),String(cfg.allow.groups[0]));
  receipt.groupSend.verified=true;save();
  console.log('PASS one actual QQ favorite sent to authorized configured group and read back');
}
receipt.completedAt=new Date().toISOString();receipt.finalSync=await favorites.sync();save();
assert(receipt.collection?.verified&&receipt.groupSend?.verified);
console.log(JSON.stringify({passed:true,indexed:receipt.finalSync.indexed,collectionVerified:receipt.collection.verified,alreadySaved:receipt.collection.alreadySaved,groupFavoriteSendVerified:receipt.groupSend.verified}));
bot.stop();
