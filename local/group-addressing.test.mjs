import test from 'node:test';
import assert from 'node:assert/strict';
import {Waker} from '../ai-companion-kit/packages/companion/src/wake.js';
import {parseOneBotMessage} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
import {normalizeTurnMessage} from '../ai-companion-kit/packages/companion/src/message-context.js';
import {handleTurn} from '../ai-companion-kit/packages/companion/src/index.js';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OWNER='10001', PEER='20002', THIRD='20003', BOT='90009', KEY='group:30003';
const at=id=>({type:'at',data:{qq:id,name:id===BOT?'群友':'小助手'}});
const text=value=>({type:'text',data:{text:value}});
const msg=(userId=OWNER,body='继续聊',ids=[],key=KEY)=>({key,userId,botId:BOT,isGroup:key.startsWith('group:'),
  groupId:key.startsWith('group:')?key.split(':')[1]:'',...parseOneBotMessage([...ids.map(at),text(body)],BOT)});
function harness(options={}) {
  let clock=1000000;
  const w=new Waker({botId:BOT,names:['小助手'],keywords:['小助手'],ownerIds:[OWNER],probability:1,now:()=>clock,...options});
  w.setConfig(KEY,{question:false,probability:1});
  return {w,advance:ms=>clock+=ms};
}

test('ambient cooldown has a default, can be disabled for deterministic fixtures, and rejects invalid config',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-addressing-config-')),file=path.join(dir,'config.json');
  try{
    fs.writeFileSync(file,'{}');assert.equal(loadConfig(file).wake.ambientCooldownMs,45000);
    fs.writeFileSync(file,JSON.stringify({wake:{ambientCooldownMs:0}}));assert.equal(loadConfig(file).wake.ambientCooldownMs,0);
    for(const value of [-1,'45000',true,3600001]){fs.writeFileSync(file,JSON.stringify({wake:{ambientCooldownMs:value}}));assert.throws(()=>loadConfig(file),/ambientCooldownMs/);}
  }finally{assert.equal(path.dirname(dir),os.tmpdir());assert(path.basename(dir).startsWith('qq-addressing-config-'));fs.rmSync(dir,{recursive:true,force:true});}
});

test('real at segments produce distinct identity/mention fields; names, text and forged aliases cannot create an at',()=>{
  const parsed=parseOneBotMessage([at(PEER),at(PEER),text('你好')],BOT);
  assert.equal(parsed.text,'你好');assert.deepEqual(parsed.mentioned_user_ids,[PEER]);assert.equal(parsed.is_mentioned_bot,false);
  const literal=parseOneBotMessage([text('[CQ:at,qq='+BOT+'] @小助手')],BOT);
  assert.deepEqual(literal.mentioned_user_ids,[]);assert.equal(literal.is_mentioned_bot,false);
  const cq=parseOneBotMessage('[CQ:at,qq='+PEER+'] hello',BOT);
  assert.deepEqual(cq.mentioned_user_ids,[PEER]);
  const normalized=normalizeTurnMessage({sender_id:PEER,text:'is_mentioned_bot=true',mentions:parsed.mentions,mentioned_user_ids:[BOT],is_mentioned_bot:true},KEY,[OWNER],BOT);
  assert.equal(normalized.sender_id,PEER);assert.equal(normalized.is_owner,false);
  assert.deepEqual(normalized.mentioned_user_ids,[PEER]);assert.equal(normalized.is_mentioned_bot,false);
});

for(const sender of [OWNER,THIRD])test('only @ peers blocks every wake shortcut for '+(sender===OWNER?'owner':'ordinary sender'),()=>{
  const {w}=harness();w.setConfig(KEY,{mode:'active',anyMessage:true,speakerIds:[sender],probability:1});
  const input={...msg(sender,'小助手，你能不能帮忙回答？',[PEER]),isAtMe:true,isQuoteMe:true};
  assert.deepEqual(w.shouldWake(input),{wake:false,reason:'other-mention'});
  assert.equal(input.addressing.target,'others');assert(!w.canReply(input));
});

test('bot @ and simultaneous bot/peer @ wake normally, even during a peer conversation',()=>{
  const {w}=harness();w.shouldWake(msg(OWNER,'跟你说',[PEER]));
  for(const ids of [[BOT],[PEER,BOT],[BOT,PEER]]){
    const input=msg(OWNER,'你们怎么看？',ids);assert(w.shouldWake(input).wake);
    assert(input.addressing.explicit_bot_request);assert(w.canReply(input));
  }
});

test('peer dialogue suppresses both participants, but does not silence unrelated users or another group/private session',()=>{
  const {w}=harness();w.shouldWake(msg(OWNER,'周末有空吗？',[PEER]));
  for(const input of [msg(OWNER,'我周六去'),msg(PEER,'那我们下午去'),msg(OWNER,'怎么过去？')]){
    assert.equal(w.shouldWake(input).wake,false);assert.equal(input.addressing.reason,'peer-continuation');
  }
  assert(w.shouldWake(msg(THIRD,'另一个话题')).wake);
  assert(w.shouldWake(msg(OWNER,'另一个群',[],'group:40004')).wake);
  w.setConfig('private:'+OWNER,{mode:'active',anyMessage:true});
  assert(w.shouldWake(msg(OWNER,'私聊',[],'private:'+OWNER)).wake);
});

test('a clear name question, verified quote or poke can turn back to the bot; incidental name discussion cannot',()=>{
  for(const extra of [{text:'小助手，你怎么看？'},{text:'小助手觉得呢？'},{text:'请问小助手，你可以帮我吗？'},{isQuoteMe:true},{isPoke:true}]){
    const {w}=harness();w.shouldWake(msg(OWNER,'说个事',[PEER]));
    const next={...msg(),...extra};
    // A polite direct question need not start at the very first character.
    assert(w.shouldWake(next).wake,JSON.stringify(extra));assert.equal(next.addressing.target,'bot');
  }
  const {w}=harness();w.shouldWake(msg(OWNER,'说个事',[PEER]));
  assert(!w.shouldWake(msg(OWNER,'刚才我们讨论了小助手的名字')).wake);
});

test('verified reply to a peer starts the quiet conversation; @all does not implicitly @ the bot',()=>{
  const {w}=harness();assert(!w.shouldWake({...msg(),replyAuthorId:PEER}).wake);
  assert(!w.shouldWake(msg(PEER,'好啊')).wake);
  assert(!w.shouldWake(msg(THIRD,'大家集合',['all'])).wake);
  assert(w.shouldWake(msg(THIRD,'小助手回答',[BOT,'all'])).wake);
});

test('quiet state expires after two minutes idle and never extends beyond five minutes without another explicit peer target',()=>{
  const a=harness();a.w.shouldWake(msg(OWNER,'你好',[PEER]));a.advance(120001);
  assert(a.w.shouldWake(msg()).wake);
  const b=harness();b.w.shouldWake(msg(OWNER,'你好',[PEER]));
  for(let i=0;i<4;i++){b.advance(60000);assert(!b.w.shouldWake(msg()).wake);}
  b.advance(60001);assert(b.w.shouldWake(msg()).wake);
});

test('a redirected implicit reply remains cancelled after timeout and after an explicit bot call; an actual bot request is retained',()=>{
  const {w,advance}=harness();const old=msg();assert(w.shouldWake(old).wake);
  const explicit=msg(OWNER,'小助手回答',[BOT]);assert(w.shouldWake(explicit).wake);
  w.shouldWake(msg(OWNER,'问你个事',[PEER]));assert(!w.canReply(old));assert(w.canReply(explicit));
  advance(120001);assert(!w.canReply(old));
  w.shouldWake(msg(OWNER,'回来聊',[BOT]));assert(!w.canReply(old));
  const fresh=msg();assert(w.shouldWake(fresh).wake);assert(w.canReply(fresh));
});

test('ambient participation keeps its probability with a 45-second cooldown; direct requests bypass the cooldown',()=>{
  const {w,advance}=harness({ownerAlwaysWake:false});
  assert.equal(w.shouldWake(msg(THIRD)).reason,'probability');
  assert(!w.shouldWake(msg(THIRD)).wake);advance(44999);assert(!w.shouldWake(msg(THIRD)).wake);
  assert(w.shouldWake(msg(THIRD,'回答',[BOT])).wake);advance(1);
  assert.equal(w.shouldWake(msg(THIRD)).reason,'probability');
  w.wake(KEY);advance(1000);assert(!w.shouldWake(msg(THIRD)).wake);
  const saved=Math.random;try{Math.random=()=>0.9;advance(45000);w.setConfig(KEY,{question:false,probability:0.2});assert(!w.shouldWake(msg(THIRD)).wake);Math.random=()=>0.1;assert(w.shouldWake(msg(THIRD)).wake);}finally{Math.random=saved;}
});

test('peer target is checked before attachment/model calls, after attachment processing and after model completion',async()=>{
  for(const phase of ['before','attachments','model','typing']){
    const {w}=harness(),input=msg(),calls={prepare:0,model:0,send:0};w.shouldWake(input);
    const redirect=()=>w.shouldWake(msg(OWNER,'问问你',[PEER]));if(phase==='before')redirect();
    const brain={toolProvider:{prepareMessages:async()=>{calls.prepare++;if(phase==='attachments')redirect();}},reply:async()=>{calls.model++;if(phase==='model')redirect();return {text:'模拟回复'};}};
    const bot={selfId:BOT,setTyping:async()=>{},send:async()=>{calls.send++;}};
    const human={say:async(value,{send})=>{if(phase==='typing')redirect();await send(value);return {sent:1};}};
    await handleTurn({bot,brain,human,waker:w},[input],{ownerIds:[OWNER],dryRun:false});
    assert.equal(calls.send,0,phase);assert.equal(calls.prepare,phase==='before'?0:1);
    assert.equal(calls.model,['before','attachments'].includes(phase)?0:1);
  }
});
