import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Autonomy,localTime,validPublicText,validContextFacts} from './autonomy.mjs';
import {QzoneAdapter} from './qzone-adapter.mjs';
const owner='10001',botId='90009';
function harness(overrides={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-autonomy-'));
  let now=Date.parse('2026-10-23T12:00:00+08:00'),calls=0,sent=[],posts=[];
  const cfg={apiKey:'EXAMPLE_6c7a13257893',baseUrl:'https://example.invalid/v1',botQQ:botId,ownerIds:[owner],allow:{private:[owner],groups:[]},onebot:{accessToken:'EXAMPLE_4c5dc9b77089'},autonomy:{timezone:'Asia/Shanghai',chat:{enabled:true},qzone:{enabled:true},...overrides}};
  const memory={forSession:key=>{assert.equal(key,'private:'+owner);return {recentTurns:()=>[{text:'PRIVATE_TOPIC_MARKER',reply:'private reply'}],logTurn:()=>{}};}};
  const args={cfg,memory,role:{build:()=>''},bot:{connected:true,send:async(key,text)=>{sent.push({key,text});return {ok:true,data:{data:{message_id:sent.length}}};},sendImage:async()=>{}},qzone:{onebot:async action=>action==='get_login_info'?{user_id:botId}:{online:true},call:async(action,args)=>{if(action==='get_qzone_msg_list')return {msglist:[]};posts.push(args);return {tid:'test-tid'};}},decision:async(kind,ctx)=>{calls++;if(kind==='qzone')assert(!JSON.stringify(ctx).includes('PRIVATE_TOPIC_MARKER'));return {action:'send',text:kind==='chat'?'嘿嘿，路过送一朵小花，愿你今天轻松一点。':'今天想当一只会发呆的虚拟小猫。'};},now:()=>now,random:()=>0.1,stateFile:path.join(dir,'state.json'),reload:false};
  const a=new Autonomy(args);
  function arm(kind='chat') {a.plan();a.state[kind].nextDecisionAt=now;a.save();}
  return {a,args,cfg,dir,arm,sent,posts,get calls(){return calls;},get now(){return now;},set now(v){now=v;}};
}
test('timezone and public privacy validation',()=>{
  assert.equal(localTime(Date.parse('2026-10-22T16:01:00Z')).day,'2026-10-23');
  assert.equal(localTime(Date.parse('2026-10-22T16:01:00Z'),'America/New_York').day,'2026-10-22');
  for(const t of ['管理员QQ是12345678','联系 me@example.com','apiKey: secret','https://private.example','Bearer secret'])assert(!validPublicText(t));
  const friday=localTime(Date.parse('2026-10-23T12:00:00+08:00'));
  assert(!validContextFacts('今天是周四呀',friday));assert(!validContextFacts('今天好像降温了',friday));assert(validContextFacts('今天是星期五呀',friday));
});
test('independent scheduler works without an incoming message; repeated start registers once',async()=>{
  const h=harness();h.a.options.qzone.enabled=false;h.arm();h.a.start();const timer=h.a.timer;h.a.start();assert.equal(h.a.timer,timer);
  await new Promise(r=>setTimeout(r,1800));h.a.stop();assert.equal(h.sent.length,1);assert.equal(h.sent[0].key,'private:'+owner);
});
test('disabled and paused functions make no decisions or sends',async()=>{
  const h=harness();h.arm();h.a.options.paused=true;await h.a.tick();assert.equal(h.calls,0);
  h.a.options.paused=false;h.a.options.chat.enabled=false;h.a.options.qzone.enabled=false;await h.a.tick();assert.equal(h.calls,0);
});
test('quiet hours and recent owner activity prevent model calls',async()=>{
  const h=harness();h.arm();h.now=Date.parse('2026-10-23T23:10:00+08:00');await h.a.tick();assert.equal(h.calls,0);
  h.now=Date.parse('2026-10-24T12:00:00+08:00');h.arm();h.a.noteIncoming({key:'private:'+owner,userId:owner,text:'你好'});await h.a.tick();assert.equal(h.calls,0);
});
test('owner busy request pauses proactively, ordinary users cannot resume',async()=>{
  const h=harness();h.arm();h.a.noteIncoming({key:'private:'+owner,userId:owner,text:'我要睡了，不要打扰'});const quiet=h.a.state.chat.quietUntil;
  h.a.noteIncoming({userId:'20002',text:'取消免打扰'});assert.equal(h.a.state.chat.quietUntil,quiet);
  h.now+=3*3600000;h.arm();await h.a.tick();assert.equal(h.sent.length,0);
});
test('AI may skip; per-session busy check prevents generation',async()=>{
  const h=harness();h.arm();h.a.isSessionBusy=()=>true;await h.a.tick();assert.equal(h.calls,0);
  h.a.isSessionBusy=()=>false;h.arm();h.a.decision=async()=>({action:'skip'});await h.a.tick();assert.equal(h.sent.length,0);assert.equal(h.a.state.chat.lastDecision.action,'skip');
});
test('daily quota and cooldown survive restart; never send to unconfigured user',async()=>{
  const h=harness();h.a.options.chat.maxPerDay=1;h.arm();await h.a.tick();assert.equal(h.sent.length,1);
  const second=new Autonomy(h.args);second.options.chat.maxPerDay=1;second.state.chat.nextDecisionAt=h.now;second.save();await second.tick();assert.equal(h.sent.length,1);
  second.cfg.allow.private=[];h.now+=86400000;second.plan(localTime(h.now));await second.tick();assert.equal(h.sent.length,1);
});
test('no reply reduces frequency; two unanswered sends require at least a day',async()=>{
  const h=harness();h.a.state.chat.unanswered=2;h.a.state.chat.lastAttemptAt=h.now-8*3600000;h.arm();await h.a.tick();assert.equal(h.calls,0);
});
test('space delegates to independent event/wake engine without legacy posting slots',async()=>{
  const h=harness();h.a.options.chat.enabled=false;let ticks=0;
  h.a.space.tick=async options=>{ticks++;assert.equal(options.qzone.enabled,true);return {skipped:'ai-choice'};};
  await h.a.tick();assert.equal(ticks,1);assert.equal(h.posts.length,0);assert.equal(h.a.state.qzone.plan,undefined);
});
test('stopping shared scheduler stops space decisions as well',async()=>{
  const h=harness();h.a.stop();assert.equal(h.a.space.active,false);await h.a.tick();assert.equal(h.posts.length,0);
});
test('dry run saves preview and sends nothing; stopping during AI prevents delivery',async()=>{
  const h=harness();h.a.options.dryRun=true;h.arm();await h.a.tick();assert.equal(h.sent.length,0);assert(fs.existsSync(h.a.stateFile+'.preview.json'));
  h.a.options.dryRun=false;h.arm();h.a.decision=async()=>{h.a.stop();return {action:'send',text:'不应发送的消息'};};await h.a.tick();assert.equal(h.sent.length,0);
});
test('concurrent tick and second process lock cannot double execute',async()=>{
  const h=harness();h.arm();let release;h.a.decision=async()=>{await new Promise(r=>release=r);return {action:'send',text:'仅发送一次的小问候。'};};
  const pending=h.a.tick();while(!release)await new Promise(r=>setTimeout(r,1));await h.a.tick();
  const second=new Autonomy(h.args);assert.equal((await second.tick()).skipped,'locked');release();await pending;assert.equal(h.sent.length,1);
});
test('missed tasks are skipped rather than replayed at restart; corrupt state fails closed',async()=>{
  const h=harness();h.a.state.chat.plan={slots:[{minute:0,status:'waiting'}]};h.a.save();await h.a.tick();assert.equal(h.calls,0);assert(h.a.state.chat.nextDecisionAt>h.now);
  fs.writeFileSync(h.a.stateFile,'broken');assert.throws(()=>new Autonomy(h.args),/损坏/);
});
test('manual and autonomous entry points use the actual same QzoneAdapter and persisted cap',async()=>{
  const h=harness(),original=globalThis.fetch;let published=0;
  const adapter=new QzoneAdapter({...h.cfg,onebot:{httpUrl:'http://127.0.0.1:1',accessToken:'test'}},{stateDir:h.dir});
  try {globalThis.fetch=async(url,options)=>{assert(String(url).endsWith('/send_qzone_msg'));assert.equal(JSON.parse(options.body).ugc_right,64);published++;return Response.json({status:'ok',data:{tid:'mock-'+published}});};
    await adapter.call('send_qzone_msg',{content:'手动入口',ugc_right:64});
    await adapter.call('send_qzone_msg',{content:'自动入口',ugc_right:64});
    await assert.rejects(()=>adapter.call('send_qzone_msg',{content:'超过两次',ugc_right:64}),/频率/);assert.equal(published,2);
  }finally{globalThis.fetch=original;}
});
test('a changed gateway login cannot receive proactive sends or publish to the wrong space',async()=>{
  const h=harness();h.arm();h.a.qzone.onebot=async()=>({user_id:'80008'});await h.a.tick();assert.equal(h.sent.length,0);assert.equal(h.a.state.attempts.length,0);
});
test('invalid numeric frequency configuration fails closed before model calls',async()=>{
  const h=harness();h.arm();h.a.options.chat.maxPerDay=NaN;await h.a.tick();assert.equal(h.calls,0);assert.equal(h.sent.length,0);
});
