import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMessageContext,normalizeId} from './message-context.js';

/** Only a person's own direct text can change their preference; quotes/OCR cannot. */
export function mentionPreference(text='') {
  const plain=String(text).replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/g,'')
    .replace(/＠/g,'@').replace(/艾特|提及|\bat\b/gi,'@').replace(/[ \t]/g,'');
  let result=null;
  const prefix='(?:(?:请|你|麻烦你?|拜托你?|以后|今后|从现在起|在群里|这个群|本群|回复时|对了|但是|还是|也|就|那|嗯|好|能不能|可以)){0,8}';
  const filler='(?:(?:再|随便|随意|总是?|老是?|一直|每次|每句话|每一句|每条消息|次次|都|回复时|说话时|动不动|经常|主动|在群里|那么|这么|频繁|重复|乱|额外|继续|被|给|还|来|了|你|要)){0,10}';
  const deny=new RegExp('^'+prefix+'(?:不要|别|不用|不许|不准|禁止|停止)'+filler+'@(?:我|本人)');
  const allow=new RegExp('^'+prefix+'(?:(?:允许|可以)(?:你)?(?:继续|重新|恢复)?|恢复(?:允许)?(?:你)?|继续)@(?:我|本人)');
  for(const clause of plain.split(/[，,。！!？?\n；;]/).map(s=>s.trim()).filter(Boolean)) {
    if(/什么意思|怎么理解|这句话|这个词|的意思/.test(clause))continue;
    if(deny.test(clause)||/^我(?:不想|不希望|不喜欢)(?:再)?被@(?:我|了|啦|啊|呀|$)/.test(clause))result=false;
    else if(allow.test(clause)&&!/(?:吗|么|是否|怎么|如何|什么意思)/.test(clause))result=true;
  }
  return result;
}

export class GroupMentionPolicy {
  constructor({stateFile,ownerIds=[],now=Date.now,conversationIdleMs=20*60000,participantWindowMs=2*60000,maxPerUser=1,ownerMax=2,ownerMinTurns=6,enabled=true}={}) {
    Object.assign(this,{stateFile,ownerIds:ownerIds.map(String),now,conversationIdleMs,participantWindowMs,maxPerUser,ownerMax,ownerMinTurns,enabled});
    this.failed=false;this.seen=new Set();this.state={version:1,preferences:{},rooms:{}};
    if(stateFile)try{
      const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
      if(state.version!==1||!state.preferences||!state.rooms||Array.isArray(state.preferences)||Array.isArray(state.rooms))throw new Error('invalid');
      this.state=state;
    }catch(error){if(error.code!=='ENOENT'){this.failed=true;console.error('[mentions] 偏好文件不可读，暂停主动提及，正常聊天继续');}}
  }
  save() {
    if(!this.stateFile||this.failed)return;
    const tmp=this.stateFile+'.'+randomUUID()+'.tmp';
    try{fs.mkdirSync(path.dirname(this.stateFile),{recursive:true});fs.writeFileSync(tmp,JSON.stringify(this.state,null,2));fs.renameSync(tmp,this.stateFile);}
    catch{this.failed=true;console.error('[mentions] 偏好未能保存，暂停主动提及，正常聊天继续');}
    finally{try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}}
  }
  room(key) {
    let room=this.state.rooms[key];
    if(!room||this.now()-room.lastAt>this.conversationIdleMs)room=this.state.rooms[key]={lastAt:this.now(),turn:0,lastReplyTo:null,users:{}};
    return room;
  }
  observeIncoming(message,{trackActivity=true}={}) {
    let context;try{context=createMessageContext(message.key,message.userId,this.ownerIds);}catch{return;}
    if(context.chat_type!=='group')return;
    const event=message.messageId?message.key+':'+message.messageId:null;
    const seen=event&&this.seen.has(event);if(event)this.seen.add(event);
    if(this.seen.size>2000)this.seen.delete(this.seen.values().next().value);
    const at=trackActivity?this.now():(Number(message.time)||this.now()),preference=mentionPreference(message.text);
    if(preference!==null&&!seen) {
      const group=this.state.preferences[context.group_id]||(this.state.preferences[context.group_id]={});
      if(!group[context.sender_id]||at>group[context.sender_id].at||trackActivity&&at===group[context.sender_id].at) {
        group[context.sender_id]={allowed:preference,at};this.save();
      }
    }
    if(trackActivity) {
      const room=this.room(message.key),user=room.users[context.sender_id];
      if(!user||this.now()-user.lastSeen>this.conversationIdleMs)room.users[context.sender_id]={lastSeen:this.now(),count:0,lastMentionTurn:-100};
      else user.lastSeen=this.now();
      room.lastAt=this.now();
    }
  }
  isBlocked(key,userId) {
    const group=/^group:([1-9]\d*)$/.exec(key)?.[1];
    return this.failed||!this.enabled||!group||this.state.preferences[group]?.[String(userId)]?.allowed===false;
  }
  plan(key,userId,items) {
    if(this.isBlocked(key,userId))return {};
    const room=this.room(key),user=room.users[userId];if(!user)return {};
    const owner=this.ownerIds.includes(String(userId)),limit=owner?this.ownerMax:this.maxPerUser;
    if(user.count>=limit||owner&&user.count>0&&room.turn-user.lastMentionTurn<this.ownerMinTurns)return {};
    const text=String(items.at(-1)?.text||'');
    const explicit=mentionPreference(text)!==false&&/(?:请|给|来|你|麻烦)?(?:@|艾特)(?:我|本人)(?:一下|一次|一声)/.test(text);
    const distinct=new Set(items.map(m=>String(m.userId)));
    const active=Object.values(room.users).filter(u=>this.now()-u.lastSeen<this.participantWindowMs).length;
    // A mention clarifies a switched recipient in an active multi-person conversation.
    const ambiguity=(distinct.size>1||active>1)&&room.lastReplyTo&&room.lastReplyTo!==String(userId);
    return explicit||ambiguity?{atUserId:String(userId)}:{};
  }
  beginRound(key,userId,items) {
    let first=true,committed=false;
    return {
      options:()=>first&&key.startsWith('group:')?this.plan(key,userId,items):{},
      sent:options=>{
        first=false;if(committed||!key.startsWith('group:'))return;committed=true;
        const room=this.room(key);room.turn++;room.lastReplyTo=String(userId);room.lastAt=this.now();
        if(options.atUserId&&room.users[userId]){room.users[userId].count++;room.users[userId].lastMentionTurn=room.turn;}
        this.save();
      },
    };
  }
  cleanText(text,items) {
    // Strip only actual participants' leading display-name addresses; ordinary prose/code stays literal.
    const names=new Set(items.flatMap(m=>[m.name,...(m.senderNames||[]),String(m.userId)]).filter(Boolean));
    const escaped=[...names].map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).sort((a,b)=>b.length-a.length);
    if(!escaped.length)return String(text);
    const prefix=new RegExp('^[ \\t]*@(?:'+escaped.join('|')+')(?=[ \\t，,:：]|$)[ \\t，,:：]*','gm');
    return String(text).split(/(```[\s\S]*?```|`[^`\n]*`)/).map(part=>part.startsWith('`')?part:part.replace(prefix,'')).join('').trim();
  }
  restoreMemory(memory,groups) {
    let restored=0;
    for(const id of groups||[]) {
      const key='group:'+id,latest=new Map();
      for(const turn of (memory.forSession(key).dump().turns||[]).sort((a,b)=>a.t-b.t)) {
        if(turn.schema_version!==2||turn.where!==key)continue;
        for(const message of turn.messages||[])if(normalizeId(message.sender_id)&&mentionPreference(message.text)!==null)latest.set(message.sender_id,message.text);
      }
      for(const [userId,text] of latest)if(!this.state.preferences[id]?.[userId]) {
        // Fallback history is older than authoritative gateway events; never override newer preferences.
        this.observeIncoming({key,userId,text,time:1},{trackActivity:false});restored++;
      }
    }
    return restored;
  }
  async restorePreferences(bot,groups,selfId) {
    let matched=0;
    for(const id of groups||[]) {
      const response=await bot.api('get_group_msg_history',{group_id:String(id),count:100});
      if(!response.ok)continue;
      const {parseOneBotMessage}=await import('./transport-onebot.js');
      const messages=response.data?.data?.messages||[];
      for(const raw of [...messages].sort((a,b)=>Number(a.time)-Number(b.time))) {
        const userId=normalizeId(raw.user_id);if(!userId||userId===String(selfId))continue;
        const text=parseOneBotMessage(raw.message,selfId).text;if(mentionPreference(text)===null)continue;
        this.observeIncoming({key:'group:'+id,userId,text,time:Number(raw.time)*1000},{trackActivity:false});matched++;
      }
    }
    if(matched)console.log('[mentions] 已从真实群历史恢复提及偏好 '+matched+' 条');
    return matched;
  }
}
