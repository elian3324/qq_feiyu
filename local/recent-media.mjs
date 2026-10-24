import {extractImages} from './multimedia.mjs';
import {parseOneBotMessage} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
import {normalizeOneBotIdentity} from '../ai-companion-kit/packages/companion/src/message-context.js';
const hasMedia=message=>extractImages(message.raw).length>0||(message.raw||[]).some(segment=>['face','record','video','file'].includes(segment.type));
// Keep observed media even when a group message does not wake the bot.
// Original messages retain their real author/session; they never grant tool permissions.
export class RecentMedia {
  constructor({ttlMs=180000,maxPerSession=4,now=Date.now}={}) {this.ttlMs=ttlMs;this.max=maxPerSession;this.now=now;this.sessions=new Map();}
  observe(message) {
    if(!hasMedia(message))return;
    const now=this.now(),items=(this.sessions.get(message.key)||[]).filter(entry=>now-entry.at<this.ttlMs);
    if(!items.some(entry=>entry.message===message||message.messageId&&entry.message.messageId===message.messageId))items.push({at:now,message,used:false});
    this.sessions.set(message.key,items.slice(-this.max));
    for(const [key,entries] of this.sessions)if(entries.every(e=>now-e.at>=this.ttlMs))this.sessions.delete(key);
  }
  related(message) {
    const now=this.now(),currentHasMedia=hasMedia(message);
    if(currentHasMedia)return [];
    const referenced=/图|表情|视频|语音|录音|文件|文档|pdf|word|excel|ppt|这个|这张|刚才|上面|看.{0,3}(?:见|到)|识别|什么动物/i.test(message.text||'');
    if(!currentHasMedia&&!referenced&&!message.replyTo)return [];
    const candidates=(this.sessions.get(message.key)||[]).filter(entry=>entry.message!==message&&(!message.messageId||entry.message.messageId!==message.messageId)&&now-entry.at<this.ttlMs).sort((a,b)=>a.at-b.at);
    const exact=message.replyTo?candidates.filter(entry=>entry.message.messageId===message.replyTo):[];
    const multiple=/这些|这几|两张|多张|几张|分别|对比|都是什么/.test(message.text||'');
    const chosen=(exact.length?exact:candidates.filter(entry=>entry.message.userId===message.userId&&(!entry.used||!currentHasMedia))).slice(-(multiple?this.max:1));
    for(const entry of chosen)entry.used=true;
    for(const entry of this.sessions.get(message.key)||[])if(entry.message===message)entry.used=true;
    return chosen.map(entry=>entry.message);
  }
  restore(raw,{kind,id,botQQ,ownerIds}) {
    const timestamp=Number(raw.time||0)*1000;
    if(!timestamp||this.now()-timestamp>this.ttlMs||timestamp>this.now()+60000)return false;
    const event={...raw,post_type:'message',message_type:kind,self_id:botQQ,...(kind==='group'?{group_id:id}:{})};
    const identity=normalizeOneBotIdentity(event,{selfId:botQQ,ownerIds});
    if(!identity||identity.userId===String(botQQ)||kind==='private'&&identity.userId!==String(id))return false;
    const parsed=parseOneBotMessage(raw.message,botQQ);
    const message={...identity,name:'发言者',text:parsed.text,raw:parsed.segments,messageId:String(raw.message_id||''),mentions:parsed.mentions,attachments:parsed.attachments,time:timestamp};
    if(!hasMedia(message))return false;
    this.observe(message);
    const entry=(this.sessions.get(message.key)||[]).find(entry=>entry.message===message);if(entry)entry.at=timestamp;
    return true;
  }
}
