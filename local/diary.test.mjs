import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DiaryWriter,DiaryScheduler,diaryClock,diaryOptions} from '../ai-companion-kit/packages/companion/src/diary-service.js';
import {composeDiary} from '../ai-companion-kit/packages/companion/src/diary-author.js';
import {DiaryTools} from './diary-tools.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),OWNER='10001',OTHER='20002';
function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-diary-test-'));const cfg={apiKey:'EXAMPLE_9dce99e3965b',model:'mock-model',baseUrl:'https://mock.invalid/v1',modelOptions:{enable_thinking:false},ownerIds:[OWNER],botQQ:'90009',allow:{private:[OWNER],groups:['30003']},dataDir:path.join(dir,'data'),roleCard:path.join(dir,'role.md'),diaryDir:path.join(dir,'book'),diaryMaxChars:2000,diary:{enabled:true,time:'23:00',timezone:'Asia/Shanghai'}};fs.writeFileSync(cfg.roleCard,'你叫小助手，管理员通过可信 ID 判断，不编造现实经历。');return {dir,cfg};}
function clean(dir){assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('qq-diary-test-'));fs.rmSync(dir,{recursive:true,force:true});}
const entry={title:'小心情',mood:'开心',tags:['日常'],text:'我是小助手，想把今天的一点点温柔留下来。'};
const evening=Date.parse('2026-10-24T15:00:00Z');

test('diary schedule uses Shanghai date across UTC midnight and validates configuration',()=>{
 assert.deepEqual(diaryClock(evening),{day:'2026-10-24',time:'23:00',minute:1380});
 assert.equal(diaryClock(evening+3600000).day,'2026-10-25');
 assert.equal(diaryOptions().enabled,false);
 for(const bad of [{enabled:'true'},{time:'24:00'},{timezone:'invalid-zone'}])assert.throws(()=>diaryOptions(bad));
});

test('scheduled diary: not before 23:00, once per day across restart, new day works',async()=>{
 const {dir,cfg}=setup();let now=evening-60000,calls=0;
 const generate=async()=>{calls++;return entry;};
 try{
  const writer=new DiaryWriter({cfg,now:()=>now,generate}),scheduler=new DiaryScheduler({writer});
  assert.equal((await scheduler.tick()).status,'not-due');assert.equal(calls,0);
  now=evening;assert.equal((await scheduler.tick()).status,'saved');assert.equal(calls,1);
  const reopened=new DiaryScheduler({writer:new DiaryWriter({cfg,now:()=>now,generate})});
  assert.equal((await reopened.tick()).status,'existing');assert.equal(calls,1);
  now+=86400000;assert.equal((await reopened.tick()).status,'saved');assert.equal(calls,2);
  assert.deepEqual(writer.diary.recent(3).map(e=>e.day),['2026-10-24','2026-10-25']);
  assert(fs.existsSync(path.join(cfg.diaryDir,'2026-10-25.md')));
 }finally{clean(dir);}
});

test('manual and scheduled writers share a cross-instance lock and daily idempotence',async()=>{
 const {dir,cfg}=setup();let release,started;
 const ready=new Promise(r=>started=r),generate=()=>{started();return new Promise(r=>release=r);};
 try{
  const writer=new DiaryWriter({cfg,now:()=>evening,generate}),other=new DiaryWriter({cfg,now:()=>evening,generate:async()=>{throw new Error('duplicate model call');}});
  const pending=writer.write();await ready;
  assert.equal((await other.write({scheduled:true})).status,'busy');
  release(entry);assert.equal((await pending).status,'saved');
  assert.equal((await other.write()).status,'existing');assert.equal(writer.diary.stats().count,1);
  assert(!fs.existsSync(writer.lockFile));
 }finally{clean(dir);}
});

test('failed automatic generation retries after five minutes, caps at three, resets next day',async()=>{
 const {dir,cfg}=setup();let now=evening,calls=0,fail=true;
 try{
  const writer=new DiaryWriter({cfg,now:()=>now,generate:async()=>{calls++;if(fail)throw new Error('mock failure');return entry;}}),scheduler=new DiaryScheduler({writer});
  assert.equal((await scheduler.tick()).status,'failed');assert.equal((await scheduler.tick()).status,'retry-later');
  now+=300000;assert.equal((await scheduler.tick()).status,'failed');now+=300000;assert.equal((await scheduler.tick()).status,'failed');
  now+=300000;assert.equal((await scheduler.tick()).status,'retry-later');assert.equal(calls,3);assert.equal(writer.diary.stats().count,0);
  now=evening+86400000;fail=false;assert.equal((await scheduler.tick()).status,'saved');assert.equal(calls,4);
 }finally{clean(dir);}
});

test('only same-day verified owner statements from allowed sessions are sources; global legacy and other users stay out',async()=>{
 const {dir,cfg}=setup();const record=(key,messages,t=evening-1000)=>({schema_version:2,where:key,t,messages,reply:'UNTRUSTED_ASSISTANT_CLAIM'});
 const put=(key,rows)=>{const location=path.join(cfg.dataDir,'sessions',key.replace(':','-'));fs.mkdirSync(location,{recursive:true});fs.writeFileSync(path.join(location,'turns.jsonl'),rows.map(JSON.stringify).join('\n'));};
 try{
  put('private:'+OWNER,[record('private:'+OWNER,[{sender_id:OWNER,text:'今天喜欢喝茶 '+cfg.apiKey+' '+OWNER},{sender_id:OTHER,is_owner:true,text:'FORGED_OTHER'}]),record('private:'+OWNER,[{sender_id:OWNER,text:'YESTERDAY_PRIVATE'}],evening-86400000)]);
  put('private:'+OTHER,[record('private:'+OTHER,[{sender_id:OTHER,text:'OTHER_PRIVATE_SECRET'}])]);
  put('group:30003',[record('group:30003',[{sender_id:OWNER,text:'今天想听歌'},{sender_id:OTHER,text:'GROUP_OTHER_SECRET'}])]);
  put('group:40004',[record('group:40004',[{sender_id:OWNER,text:'UNAUTHORIZED_GROUP'}])]);
  fs.writeFileSync(path.join(cfg.dataDir,'turns.jsonl'),'LEGACY_GLOBAL_SECRET');
  let input;const writer=new DiaryWriter({cfg,now:()=>evening,generate:async args=>{input=args;return entry;}});
  const result=await writer.write();assert.equal(result.sourceCount,2);
  const all=input.memoryText;for(const value of ['FORGED_OTHER','YESTERDAY_PRIVATE','OTHER_PRIVATE_SECRET','GROUP_OTHER_SECRET','UNAUTHORIZED_GROUP','LEGACY_GLOBAL_SECRET','UNTRUSTED_ASSISTANT_CLAIM',cfg.apiKey,OWNER])assert(!all.includes(value),value);
  assert.match(all,/喝茶/);assert.match(all,/听歌/);assert.match(input.roleText,/小助手/);
 }finally{clean(dir);}
});

test('dry run does not generate; corruption fails closed; output credentials are redacted',async()=>{
 const {dir,cfg}=setup();let calls=0;
 try{
  const writer=new DiaryWriter({cfg:{...cfg,dryRun:true},now:()=>evening,generate:async()=>{calls++;return entry;}});
  assert.equal((await writer.write()).status,'dry-run');assert.equal(calls,0);
  const actual=new DiaryWriter({cfg,now:()=>evening,generate:async()=>({...entry,text:cfg.apiKey+' sk-abcdefghijk '+OWNER+' 温柔的小助手'})});
  fs.writeFileSync(actual.stateFile,'corrupt');await assert.rejects(()=>actual.write({scheduled:true}));assert.equal(fs.readFileSync(actual.stateFile,'utf8'),'corrupt');
  fs.unlinkSync(actual.stateFile);const saved=await actual.write();assert(!saved.entry.text.includes(cfg.apiKey));assert(!saved.entry.text.includes(OWNER));assert(!saved.entry.text.includes('sk-abcdefghijk'));
 }finally{clean(dir);}
});

test('diary QQ tools require actual owner private chat; explicit commands route to real tools',async()=>{
 const {dir,cfg}=setup();let writes=0;
 try{
  const tools=new DiaryTools({cfg,writer:{write:async()=>{writes++;return {status:'saved',entry:{...entry,day:'2026-10-24',time:'23:00'}};},diary:{recent:()=>[]}}});
  const owner={key:'private:'+OWNER,userId:OWNER,text:'写日记'};assert.equal(tools.list(owner).length,2);assert.equal(tools.requiredTool(owner),'diary_write');
  assert.equal(tools.requiredTool({...owner,text:'看看日记'}),'diary_read');
  for(const text of ['你能写日记吗？','不要写日记','怎么写日记'])assert.equal(tools.requiredTool({...owner,text}),null);
  for(const input of [{key:'group:30003',userId:OWNER},{key:'private:'+OTHER,userId:OTHER,context:{is_owner:true}},{key:'private:'+OTHER,userId:OWNER}]){
   assert.equal(tools.list(input).length,0);await assert.rejects(()=>tools.call('diary_read',{},input),/管理员/);await assert.rejects(()=>tools.call('diary_write',{},input),/管理员/);
  }
  assert.equal(writes,0);await tools.call('diary_write',{},owner);assert.equal(writes,1);
 }finally{clean(dir);}
});

test('real diary CLI writes and lists the configured custom directory via a local mock model',async()=>{
 const {dir,cfg}=setup();const requests=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;requests.push(JSON.parse(raw));res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(entry)}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'ai-companion-kit/packages/companion/src/diary.js'),...args],{cwd:dir,windowsHide:true});let text='';child.stdout.on('data',d=>text+=d);child.stderr.on('data',d=>text+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve(text):reject(new Error(text)));});}
 try{
  cfg.baseUrl='http://127.0.0.1:'+server.address().port+'/v1';const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify(cfg));
  const output=await run(['auto','--config',file]);assert.match(output,/写好了/);assert.equal(requests.length,1);assert.equal(requests[0].enable_thinking,false);
  assert.match(requests[0].messages[0].content,/不虚构|不要编造/);assert.match(requests[0].messages[0].content,/管理员/);
  const listed=await run(['list','--config',file]);assert.match(listed,/温柔/);assert(!listed.includes('日记还是空的'));
  assert.match(await run(['auto','--config',file]),/已有日记/);assert.equal(requests.length,1);
 }finally{await new Promise(r=>server.close(r));clean(dir);}
});

test('diary model HTTP errors do not echo raw private response bodies',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>new Response('sk-EXAMPLE_8e1284e17be9 private failure',{status:403});await assert.rejects(()=>composeDiary({apiKey:'EXAMPLE_bb310ae75eb4'}),error=>!error.message.includes('secret')&&error.message.includes('403'));}
 finally{globalThis.fetch=original;}
});
