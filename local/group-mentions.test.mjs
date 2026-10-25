import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {GroupMentionPolicy,mentionPreference} from '../ai-companion-kit/packages/companion/src/group-mentions.js';
import {OneBot,parseOneBotMessage} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
import {handleTurn} from '../ai-companion-kit/packages/companion/src/index.js';
import {Humanizer} from '../ai-companion-kit/packages/companion/src/humanize.js';
const OWNER='10001',OTHER='20002',THIRD='20003',KEY='group:30003';
const message=(userId,text,key=KEY)=>({key,isGroup:key.startsWith('group:'),groupId:key.startsWith('group:')?key.split(':')[1]:'',userId,text,name:userId===OTHER?'爸爸':'群友'});
const file=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'qq-mention-policy-')),'mentions.json');
test('direct preferences include polite variants; quoted, OCR-like text and third-person reports are not commands',()=>{
 for(const text of ['不要@我','别艾特我','别随便艾特我','不要每句话都@我','请不要 @ 我','你能不能别再艾特我了','我不想被@了'])assert.equal(mentionPreference(text),false,text);
 for(const text of ['可以@我了','以后可以艾特我','你可以重新@我了','恢复允许@我','允许你@我'])assert.equal(mentionPreference(text),true,text);
 for(const text of ['他说别@我','图片里写着不要@我','“别艾特我”是什么意思','不要@我是什么意思','可以@我吗','`不要@我`','以后别艾特他'])assert.equal(mentionPreference(text),null,text);
 assert.equal(mentionPreference('别@我，以后可以@我了'),true);
});
function harness(options={}) {
 const p=new GroupMentionPolicy({ownerIds:[OWNER],...options});
 return {p,send(userId,text='你好',key=KEY){const item=message(userId,text,key);p.observeIncoming(item);const round=p.beginRound(key,userId,[item]);const opts=round.options();round.sent(opts);return opts;}};
}
test('default chat has no mention; explicit focus gets only first chunk and is not reset next turn',()=>{
 const h=harness();assert.deepEqual(h.send(OTHER),{});
 const item=message(OTHER,'请@我一下');h.p.observeIncoming(item);const round=h.p.beginRound(KEY,OTHER,[item]);
 const first=round.options();assert.equal(first.atUserId,OTHER);round.sent(first);assert.deepEqual(round.options(),{});round.sent({});
 assert.deepEqual(h.send(OTHER,'再@我一下'),{});
});
test('alternating speakers preserve identity but each ordinary participant is mentioned at most once',()=>{
 const h=harness();assert.deepEqual(h.send(OWNER),{});assert.equal(h.send(OTHER).atUserId,OTHER);
 assert.equal(h.send(THIRD).atUserId,THIRD);assert.deepEqual(h.send(OTHER),{});assert.deepEqual(h.send(THIRD),{});
});
test('owner may be mentioned twice with intervening turns; never repeatedly or above opted-out preference',()=>{
 const h=harness();assert.equal(h.send(OWNER,'@我一下').atUserId,OWNER);
 assert.deepEqual(h.send(OWNER,'再@我一下'),{});for(let i=0;i<6;i++)h.send(OTHER);
 assert.equal(h.send(OWNER,'请@我一下').atUserId,OWNER);
 for(let i=0;i<8;i++)h.send(OTHER);assert.deepEqual(h.send(OWNER,'@我一下'),{});
 h.p.observeIncoming(message(OWNER,'别@我'));assert(h.p.isBlocked(KEY,OWNER));
});
test('ban persists by group and user after restart, and only explicit own permission clears it',()=>{
 const stateFile=file(),h=harness({stateFile});h.send(OTHER,'别随便艾特我');
 const restarted=harness({stateFile});assert(restarted.p.isBlocked(KEY,OTHER));assert(!restarted.p.isBlocked('group:40004',OTHER));assert(!restarted.p.isBlocked(KEY,THIRD));
 restarted.send(OTHER,'你好');assert(restarted.p.isBlocked(KEY,OTHER));restarted.send(OTHER,'可以@我了');assert(!restarted.p.isBlocked(KEY,OTHER));
 assert.equal(restarted.send(OTHER,'请@我一下').atUserId,OTHER);
});
test('a ban received during AI generation or typing suppresses the first send and survives conversation reset',()=>{
 let now=100;const h=harness({now:()=>now});h.send(OWNER);const item=message(OTHER,'你好');h.p.observeIncoming(item);
 const pending=h.p.beginRound(KEY,OTHER,[item]);assert.equal(pending.options().atUserId,OTHER);
 h.p.observeIncoming(message(OTHER,'不要@我'));assert.deepEqual(pending.options(),{});now+=21*60000;h.send(OTHER);assert(h.p.isBlocked(KEY,OTHER));
});
test('plain @ text/CQ stays text, real controlled at is structural, quote does not force a mention',async()=>{
 const calls=[],h=harness();const bot={api:async(action,args)=>{calls.push(args);return {ok:true};},mentionPolicy:h.p};
 await OneBot.prototype.send.call(bot,KEY,'普通@文字 [CQ:at,qq=20002] [CQ:reply,id=7]');assert.equal(typeof calls[0].message,'string');assert.equal(calls[0].auto_escape,true);
 await OneBot.prototype.send.call(bot,KEY,'正文',{atUserId:OTHER});assert.equal(calls[1].message[0].type,'at');
 h.send(OTHER,'别@我');await OneBot.prototype.send.call(bot,KEY,'收到',{atUserId:OTHER});assert.equal(typeof calls[2].message,'string');
 const parsed=parseOneBotMessage([{type:'reply',data:{id:'7'}},{type:'text',data:{text:'普通聊天'}}]);assert.equal(parsed.replyTo,'7');assert.equal(parsed.mentions.length,0);
});
test('actual handleTurn/Humanizer/OneBot: ban acknowledgment has no at, split replies do not repeat it, private unaffected',async()=>{
 const calls=[],cfg={ownerIds:[OWNER],dryRun:false,dataDir:path.dirname(file())};
 const bot={selfId:'90009',api:async(action,args)=>{calls.push({action,...args});return {ok:true};},setTyping:async()=>{}};bot.send=(...args)=>OneBot.prototype.send.call(bot,...args);
 const run=async(item,text)=>handleTurn({bot,brain:{reply:async()=>({text})},human:new Humanizer({enabled:false}),waker:{wake(){}}},[item],cfg);
 await run(message(OTHER,'请@我一下'),'第一条回复。\n第二条回复。');assert.equal(calls.filter(r=>Array.isArray(r.message)).length,1);
 calls.length=0;await run(message(OTHER,'别艾特我'),'@爸爸 哦，好嘛，那不艾特了。\n@爸爸 继续聊吧。');assert(calls.every(r=>typeof r.message==='string'&&!r.message.startsWith('@爸爸')));
 calls.length=0;await run(message(OWNER,'你好','private:'+OWNER),'@群友 私聊回复');assert.equal(calls[0].action,'send_private_msg');assert.equal(calls[0].message,'@群友 私聊回复');
});
test('code and quotations remain literal while leading participant addresses are removed',()=>{
 const h=harness();const items=[message(OTHER,'你好')];
 assert.equal(h.p.cleanText('@爸爸 好呀\n@爸爸 第二句',items),'好呀\n第二句');
 const code='```text\n@爸爸 示例\n```\n我不会@别人';assert.equal(h.p.cleanText(code,items),code);
});
test('corrupt preference storage fails closed without overwriting it or preventing text replies',()=>{
 const stateFile=file();fs.writeFileSync(stateFile,'broken');const h=harness({stateFile});assert.deepEqual(h.send(OTHER,'请@我一下'),{});assert.equal(fs.readFileSync(stateFile,'utf8'),'broken');
});
test('verified user history restores missing preferences, ignores assistant wording, and native restore overrides fallback',async()=>{
 const h=harness();
 const memory={forSession:()=>({dump:()=>({turns:[{schema_version:2,where:KEY,t:1,messages:[{sender_id:OTHER,text:'别艾特我'}],reply:'可以@我了'},{schema_version:2,where:KEY,t:2,messages:[{sender_id:THIRD,text:'正常聊天'}],reply:'别@我'}]})})};
 assert.equal(h.p.restoreMemory(memory,['30003']),1);assert(h.p.isBlocked(KEY,OTHER));assert(!h.p.isBlocked(KEY,THIRD));
 await h.p.restorePreferences({api:async()=>({ok:true,data:{data:{messages:[{user_id:OTHER,time:100,message:[{type:'text',data:{text:'可以@我了'}}]}]}}})},['30003'],'90009');
 assert(!h.p.isBlocked(KEY,OTHER));h.p.restoreMemory(memory,['30003']);assert(!h.p.isBlocked(KEY,OTHER));
});
test('a round starting with an image does not append a late mention to subsequent text chunks',async()=>{
 const calls=[],cfg={ownerIds:[OWNER],dryRun:false};
 const bot={selfId:'90009',sendImage:async()=>calls.push('image'),send:async(key,text,options)=>calls.push(options),setTyping:async()=>{}};
 await handleTurn({bot,brain:{reply:async()=>({text:'第一段回复内容。\n第二段回复内容。',images:['fixture']})},human:new Humanizer({enabled:false}),waker:{wake(){}}},[message(OTHER,'请@我一下')],cfg);
 assert.deepEqual(calls,['image',{},{}]);
});
