import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Autonomy,localTime} from './autonomy.mjs';
import {OneBot} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
const OWNER='10001',BOT='90009',OTHER='20002',MIN=60000,HOUR=60*MIN;
function fixture(options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-proactive-test-'));
  let now=Date.parse('2026-10-24T12:00:00+08:00'),calls=0;
  const sent=[],logged=[],contexts=[];
  const cfg={apiKey:'EXAMPLE_7ca8f3e9840b',baseUrl:'https://model.invalid/v1',model:'deepseek-mock',botQQ:BOT,ownerIds:[OWNER],
    allow:{private:[OWNER],groups:['30003']},onebot:{httpUrl:'http://127.0.0.1:1',accessToken:'EXAMPLE_aa6ab55f20ee'},autonomy:{timezone:'Asia/Shanghai',
      chat:{enabled:true,...options},qzone:{enabled:false}}};
  const turns={'private:10001':[{t:now-3*HOUR,schema_version:2,messages:[{sender_id:OWNER,text:'OWNER_PRIVATE_TOPIC'}],reply:'之前的回复'}],
    'group:30003':[{t:now-4*HOUR,schema_version:2,messages:[{sender_id:OTHER,text:'OTHER_PRIVATE_MARKER'},{sender_id:OWNER,text:'OWNER_GROUP_TOPIC'}],reply:'群里之前的回复'}]};
  const memory={dir,forSession:key=>({recentTurns:()=>turns[key]||[],snapshot:()=>({people:{[OWNER]:{facts:['管理员喜欢看星星']}}}),logTurn:turn=>logged.push(turn)})};
  fs.writeFileSync(path.join(dir,'owner-memory.json'),JSON.stringify({version:1,owners:{[OWNER]:{facts:[{source_sender_id:OWNER,fact:'管理员喜欢虚拟小猫',visibility:'private'}]},[OTHER]:{facts:[{source_sender_id:OTHER,fact:'OTHER_SECRET'}]}}}));
  const bot={connected:true,send:async(key,text)=>{sent.push({key,text});return {ok:true,data:{data:{message_id:sent.length}}};}};
  const qzone={onebot:async action=>action==='get_login_info'?{user_id:BOT}:{online:true},call:async()=>({msglist:[]})};
  const args={cfg,bot,memory,role:{build:ctx=>'ORIGINAL_PERSONA\n'+ctx.platform},qzone,now:()=>now,random:()=>0,
    reload:false,stateFile:path.join(dir,'state.json'),decision:async(kind,ctx)=>{calls++;contexts.push(ctx);return {action:'send',text:'刚刚冒出一个小想法，想拉你一起看星星。',mood:'tender',intensity:0.8,nextCheckMinutes:60};}};
  const a=new Autonomy(args);
  function arm(){a.state.chat.nextDecisionAt=now;a.save();}
  return {a,args,cfg,dir,bot,qzone,turns,sent,logged,contexts,arm,get calls(){return calls;},get now(){return now;},set now(v){now=v;}};
}
test('fresh install defaults off; independent wake is not a preplanned send slot',async()=>{
  const h=fixture();delete h.cfg.autonomy.chat.enabled;const a=new Autonomy(h.args);assert.equal(a.options.chat.enabled,false);await a.tick();assert.equal(h.calls,0);
  h.arm();await h.a.tick();assert.equal(h.sent.length,1);assert.equal(h.sent[0].key,'private:'+OWNER);
  assert.equal(h.a.state.chat.plan,undefined);assert.equal(h.a.state.chat.emotion.mood,'tender');assert.equal(h.a.state.chat.nextDecisionAt,h.now+HOUR);
});
test('context contains verified owner conversation, long-term memory and prior emotion, never ordinary identities',async()=>{
  const h=fixture();h.arm();await h.a.tick();const ctx=h.contexts[0],raw=JSON.stringify(ctx);
  assert(raw.includes('OWNER_PRIVATE_TOPIC'));assert(raw.includes('OWNER_GROUP_TOPIC'));assert(raw.includes('管理员喜欢虚拟小猫'));
  assert(!raw.includes('OTHER_PRIVATE_MARKER'));assert(!raw.includes('OTHER_SECRET'));assert.equal(ctx.recipient.is_owner,true);
  assert.equal(ctx.recipient.sender_id,OWNER);assert.equal(ctx.trigger,'independent-background-thought');
});
test('skip updates emotion and AI-selected next thought without sending or consuming quota',async()=>{
  const h=fixture();h.arm();h.a.decision=async()=>({action:'skip',mood:'pouty',intensity:0.4,nextCheckMinutes:45});
  await h.a.tick();assert.equal(h.sent.length,0);assert.equal(h.a.state.attempts.length,0);assert.equal(h.a.state.chat.nextDecisionAt,h.now+45*MIN);assert.equal(h.a.state.chat.emotion.mood,'pouty');
});
test('daily cap, unanswered exponential cooldown and persisted state prevent extra sends after restart',async()=>{
  const h=fixture();h.arm();await h.a.tick();h.now+=4*HOUR;h.arm();await h.a.tick();assert.equal(h.sent.length,1,'unanswered extends first gap to eight hours');
  h.now+=4*HOUR;h.arm();h.a.decision=async()=>({action:'send',text:'虚拟小猫把月亮揉成了一团毛线。'});await h.a.tick();assert.equal(h.sent.length,2);
  const next=new Autonomy(h.args);next.state.chat.nextDecisionAt=h.now;next.save();await next.tick();assert.equal(h.sent.length,2);assert.equal(next.state.chat.unanswered,2);
});
test('free initiative ignores daily count, recent sends, recent owner activity and unanswered backoff',async()=>{
  const h=fixture({dailyLimitEnabled:false,cooldownEnabled:false,minIntervalHours:0,ownerInactivityHours:0,wakeMinutes:[1,10]});
  h.a.state.chat.lastAttemptAt=h.now-1000;h.a.state.chat.unanswered=20;
  h.a.state.attempts=Array.from({length:30},(_,i)=>({kind:'chat',at:h.now-1000-i,day:localTime(h.now).day,status:'sent'}));
  h.a.noteIncoming({key:'private:'+OWNER,userId:OWNER,text:'你好'});h.arm();await h.a.tick();assert.equal(h.sent.length,1);
  h.a.decision=async()=>({action:'send',text:'突然又想起一个点子，虚拟小猫也该有自己的星球。',nextCheckMinutes:1});
  h.now+=MIN;h.arm();await h.a.tick();assert.equal(h.sent.length,2);
  const next=new Autonomy(h.args);next.decision=async()=>({action:'send',text:'这会儿心情有点像一团亮晶晶的毛线。',nextCheckMinutes:1});
  next.state.chat.nextDecisionAt=h.now;next.save();await next.tick();assert.equal(h.sent.length,3);
});
test('free mode still permits AI skip, respects explicit DND and quiet hours, and deduplicates uncertain delivery',async()=>{
  const options={dailyLimitEnabled:false,cooldownEnabled:false,minIntervalHours:0,ownerInactivityHours:0,wakeMinutes:[1,10]};
  const h=fixture(options);h.arm();h.a.decision=async()=>({action:'skip',nextCheckMinutes:2});await h.a.tick();assert.equal(h.sent.length,0);
  h.a.noteIncoming({key:'private:'+OWNER,userId:OWNER,text:'不要打扰'});h.arm();await h.a.tick();assert.equal(h.sent.length,0);
  const night=fixture(options);night.now=Date.parse('2026-10-25T02:00:00+08:00');night.arm();await night.a.tick();assert.equal(night.calls,0);
  const unknown=fixture(options);let attempts=0;unknown.bot.send=async()=>{attempts++;throw new Error('unknown');};
  unknown.arm();await unknown.a.tick();unknown.now+=MIN;unknown.arm();await unknown.a.tick();assert.equal(attempts,1);
});

test('light spacing limits free proactive chat to 30 minutes without daily caps or unanswered exponential backoff, including after restart',async()=>{
  const h=fixture({dailyLimitEnabled:false,cooldownEnabled:false,minIntervalHours:0,ownerInactivityHours:0,minIntervalMinutes:30,ownerIdleMinutes:5,wakeMinutes:[1,10]});
  h.arm();await h.a.tick();assert.equal(h.sent.length,1);
  h.a.decision=async()=>({action:'send',text:'想出一个小点子，云朵可以当小猫的枕头。',nextCheckMinutes:1});
  h.now+=29*MIN;h.arm();await h.a.tick();assert.equal(h.sent.length,1);
  const next=new Autonomy(h.args);next.decision=h.a.decision;h.now+=MIN;next.state.chat.nextDecisionAt=h.now;next.save();await next.tick();assert.equal(h.sent.length,2);
  h.now+=30*MIN;const third=new Autonomy(h.args);third.decision=async()=>({action:'send',text:'小猫把星星装进了口袋，想分给你一颗。'});third.state.chat.nextDecisionAt=h.now;third.save();await third.tick();assert.equal(h.sent.length,3,'two unanswered messages do not impose a multi-day pause');
});

test('light idle gate prevents interrupting an active owner but becomes eligible after five minutes',async()=>{
  const h=fixture({dailyLimitEnabled:false,cooldownEnabled:false,minIntervalMinutes:30,ownerIdleMinutes:5,wakeMinutes:[1,10]});
  h.a.noteIncoming({key:'private:'+OWNER,userId:OWNER,text:'刚才那个话题继续聊'});h.arm();await h.a.tick();assert.equal(h.calls,0);
  h.now+=4*MIN;h.arm();await h.a.tick();assert.equal(h.calls,0);
  h.now+=MIN;h.arm();await h.a.tick();assert.equal(h.sent.length,1);assert.equal(h.contexts[0].minIntervalMinutes,30);
});
test('new owner conversation wakes free thought without waiting for the old background deadline',async()=>{
  const h=fixture({dailyLimitEnabled:false,cooldownEnabled:false,minIntervalHours:0,ownerInactivityHours:0,wakeMinutes:[1,10]});
  h.a.state.chat.wakePolicy='old-policy';h.a.state.chat.nextDecisionAt=h.now+90*MIN;h.a.save();
  await h.a.tick();assert.equal(h.sent.length,1);
  h.now+=MIN;h.a.noteIncoming({key:'private:'+OWNER,userId:OWNER,text:'你真可爱'});
  h.a.decision=async()=>({action:'send',text:'被夸得有点开心，想把小尾巴翘起来。',nextCheckMinutes:3});
  await h.a.tick();assert.equal(h.sent.length,2);
});
test('owner private reply resets unanswered, group chatter and self/ordinary messages do not',async()=>{
  const h=fixture();h.a.state.chat.unanswered=2;h.a.state.chat.lastAttemptAt=h.now-HOUR;h.a.save();
  for(const msg of [{key:'private:'+OWNER,userId:BOT},{key:'private:'+OTHER,userId:OTHER},{key:'group:30003',userId:OWNER}])h.a.noteIncoming({...msg,text:'恢复主动'});
  assert.equal(h.a.state.chat.unanswered,2);
  h.a.noteIncoming({key:'private:'+OWNER,userId:OWNER,text:'你好'});assert.equal(h.a.state.chat.unanswered,0);
  assert.equal(new Autonomy(h.args).state.chat.unanswered,0);
});
test('quiet window, explicit owner DND, busy session and owner inactivity all suppress API calls',async()=>{
  const h=fixture();h.now=Date.parse('2026-10-25T02:00:00+08:00');h.arm();await h.a.tick();assert.equal(h.calls,0);
  h.now=Date.parse('2026-10-25T12:00:00+08:00');h.a.noteIncoming({key:'private:'+OWNER,userId:OWNER,text:'我要睡了，不要打扰'});h.arm();await h.a.tick();assert.equal(h.calls,0);
  h.a.noteIncoming({key:'private:'+OWNER,userId:OWNER,text:'取消免打扰'});h.arm();await h.a.tick();assert.equal(h.calls,0,'recent owner activity');
  h.now+=HOUR;h.a.isSessionBusy=()=>true;h.arm();await h.a.tick();assert.equal(h.calls,0);
});
test('activity arriving while model thinks prevents a stale proactive send and persists across restart',async()=>{
  const h=fixture();h.arm();h.a.decision=async()=>{h.now+=MIN;h.a.noteIncoming({key:'private:'+OWNER,userId:OWNER,text:'我回来了'});return {action:'send',text:'不要抢在正常回复前面发这句。'};};
  await h.a.tick();assert.equal(h.sent.length,0);assert.equal(h.a.state.attempts.length,0);assert.equal(new Autonomy(h.args).state.chat.lastOwnerAt,h.now);
});
test('private-only dry run does not pause space or reserve a real send',async()=>{
  const h=fixture({dryRun:true});h.arm();await h.a.tick();assert.equal(h.sent.length,0);assert.equal(h.a.state.attempts.length,0);
  assert.equal(JSON.parse(fs.readFileSync(h.a.stateFile+'.preview.json')).kind,'chat');assert.equal(h.a.options.dryRun,undefined);
});
test('model cannot select another recipient; config whitelist and gateway identity are rechecked',async()=>{
  const h=fixture();h.arm();h.a.decision=async()=>({action:'send',recipient:OTHER,target:'group:30003',text:'带一朵小花来找你玩啦。'});await h.a.tick();assert.equal(h.sent[0].key,'private:'+OWNER);
  const denied=fixture({ownerId:OTHER});denied.arm();await denied.a.tick();assert.equal(denied.sent.length,0);
  const changed=fixture();changed.arm();changed.qzone.onebot=async()=>({user_id:OTHER,online:true});await changed.a.tick();assert.equal(changed.sent.length,0);
});
test('unknown delivery reserves quota before I/O and is never retried after restart',async()=>{
  const h=fixture();h.arm();let attempts=0;
  h.bot.send=async()=>{attempts++;const s=JSON.parse(fs.readFileSync(h.a.stateFile));assert.equal(s.attempts[0].status,'sending');throw new Error('timeout after acceptance');};
  await h.a.tick();assert.equal(h.a.state.attempts[0].status,'unknown-or-failed');
  const next=new Autonomy(h.args);next.state.chat.nextDecisionAt=h.now;next.save();await next.tick();assert.equal(attempts,1);
});
test('successful sends enter private assistant history; repeated text is blocked, self-message cannot loop',async()=>{
  const h=fixture();h.arm();await h.a.tick();assert.equal(h.logged.length,1);assert.equal(h.logged[0].source,'autonomy');assert.equal(h.logged[0].where,'private:'+OWNER);
  h.now+=8*HOUR;h.a.noteIncoming({key:'private:'+OWNER,userId:BOT,text:'自发回声'});h.arm();await h.a.tick();assert.equal(h.sent.length,1);assert.equal(h.a.state.chat.unanswered,1);
});
test('stop, disable and dry-run toggles during slow gateway checks all prevent delivery',async()=>{
  for(const mode of ['stop','off','dry']){
    const h=fixture();h.arm();const original=h.qzone.onebot;
    h.qzone.onebot=async action=>{if(action==='get_status'){if(mode==='stop')h.a.stop();if(mode==='off')h.a.options.chat.enabled=false;if(mode==='dry')h.a.options.chat.dryRun=true;}return original(action);};
    await h.a.tick();assert.equal(h.sent.length,0,mode);
  }
});
test('corruption preserves evidence, does not reset counters; malformed AI and credentials fail closed',async()=>{
  const h=fixture();h.arm();fs.writeFileSync(h.a.stateFile,'broken');await h.a.tick();assert.equal(fs.readFileSync(h.a.stateFile,'utf8'),'broken');assert.equal(h.sent.length,0);
  for(const d of [{action:'unknown'},{action:'send',text:'Bearer EXAMPLE_7ca8f3e9840b'},{action:'send',text:'短'},{action:'send',text:'看星星啦',mood:'fake',intensity:1}]){
    const x=fixture();x.arm();x.a.decision=async()=>d;await x.a.tick();assert.equal(x.sent.length,0);
  }
});
test('slow Qzone requests do not block proactive private delivery',async()=>{
  const h=fixture();h.arm();let release;
  h.a.space.tick=async()=>new Promise(resolve=>release=resolve);
  const pending=h.a.tick();while(!h.sent.length)await new Promise(r=>setTimeout(r,1));assert.equal(h.sent[0].key,'private:'+OWNER);release({skipped:'done'});await pending;
});
test('actual DeepSeek JSON request preserves full persona, memory and output protocol through Mock fetch',async()=>{
  const h=fixture(),original=globalThis.fetch;
  try{globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://model.invalid/v1/chat/completions');const b=JSON.parse(init.body);
    assert.deepEqual(b.messages.map(m=>m.role),['system','user']);assert(b.messages[0].content.includes('ORIGINAL_PERSONA'));
    assert(b.messages[1].content.includes('OWNER_PRIVATE_TOPIC'));assert(b.messages[1].content.includes('管理员喜欢虚拟小猫'));
    assert(!b.messages[1].content.includes('OTHER_SECRET'));assert.equal(b.model,'deepseek-mock');
    return Response.json({choices:[{message:{content:'{"action":"skip","mood":"curious","intensity":0.7,"nextCheckMinutes":50}'}}]});
  };
    h.a.decision=h.a.generate.bind(h.a);h.arm();await h.a.tick();assert.equal(h.sent.length,0);assert.equal(h.a.state.chat.nextDecisionAt,h.now+50*MIN);
  }finally{globalThis.fetch=original;}
});
test('real OneBot send path targets send_private_msg with owner ID and verifies actual NapCat message_id',async()=>{
  const h=fixture(),original=globalThis.fetch;
  const bot=new OneBot({wsUrl:'ws://127.0.0.1:1',httpUrl:'http://127.0.0.1:1',accessToken:'EXAMPLE_aa6ab55f20ee'});bot.stop();bot.connected=true;h.a.bot=bot;
  try{globalThis.fetch=async(url,init)=>{assert.equal(String(url),'http://127.0.0.1:1/send_private_msg');const body=JSON.parse(init.body);
    assert.equal(body.user_id,OWNER);assert.equal(body.auto_escape,true);assert(!body.group_id);return Response.json({status:'ok',retcode:0,data:{message_id:77}});
  };
    h.arm();await h.a.tick();assert.equal(h.a.state.attempts[0].status,'sent');assert.equal(h.a.state.attempts[0].messageId,'77');
  }finally{globalThis.fetch=original;}
});
