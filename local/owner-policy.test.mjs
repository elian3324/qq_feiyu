import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from '../ai-companion-kit/node_modules/ws/wrapper.mjs';
import {TurnQueue,splitOwnerFirst} from '../ai-companion-kit/packages/companion/src/turn-queue.js';
import {OwnerMemory,extractOwnerFacts} from '../ai-companion-kit/packages/companion/src/owner-memory.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {createMessageContext} from '../ai-companion-kit/packages/companion/src/message-context.js';
const OWNER='10001',OTHER='20002',BOT='90009',GROUP='30003',key='group:'+GROUP;
const root=fileURLToPath(new URL('../',import.meta.url)),pause=ms=>new Promise(r=>setTimeout(r,ms));
const item=(id,text,session=key)=>({key:session,userId:id,isGroup:session.startsWith('group:'),groupId:session.startsWith('group:')?session.split(':')[1]:'',name:id===OWNER?'示例用户':'管理员',text});
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'qq-owner-policy-'));}
function clean(dir){assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert(path.basename(dir).startsWith('qq-owner-policy-'));fs.rmSync(dir,{recursive:true,force:true});}
async function until(fn){for(let i=0;i<400;i++){if(fn())return;await pause(20);}throw new Error('owner policy timeout');}
const result=content=>Response.json({choices:[{message:{content}}]});
const meta=request=>JSON.parse(request.messages[1].content.split('\n')[1]);

for(const reverse of [false,true])test('same batch always replies to owner first, independent of arrival order: '+reverse,async()=>{
 const owner=item(OWNER,'O'),other=item(OTHER,'N');const input=reverse?[owner,other]:[other,owner];
 const seen=[],queue=new TurnQueue({ownerIds:[OWNER],run:async items=>seen.push(items.map(m=>m.userId))});queue.enqueue(input);
 await until(()=>!queue.has(key));assert.deepEqual(seen,[[OWNER],[OTHER]]);
 assert.deepEqual(splitOwnerFirst([other],[OWNER]),[[other]]);
 assert.throws(()=>splitOwnerFirst([owner,item(OTHER,'x','group:40004')],[OWNER]));
});

test('waiting owner overtakes waiting ordinary work without interrupting an in-flight operation or another group',async()=>{
 const seen=[];let release;const blocked=new Promise(r=>release=r);
 const queue=new TurnQueue({ownerIds:[OWNER],run:async items=>{const text=items.at(-1).text;seen.push(text);if(text==='running')await blocked;}});
 queue.enqueue([item(OTHER,'running')]);await until(()=>seen.length===1);
 queue.enqueue([item(OTHER,'waiting-other')]);queue.enqueue([item(OWNER,'waiting-owner')]);queue.enqueue([item(OTHER,'independent','group:40004')]);
 await until(()=>seen.includes('independent'));assert(!seen.includes('waiting-owner'));
 release();await until(()=>!queue.has(key));assert.deepEqual(seen.filter(s=>s!=='independent'),['running','waiting-owner','waiting-other']);
});

test('a failed job does not drop queued owner or ordinary messages',async()=>{
 const seen=[],errors=[];const q=new TurnQueue({ownerIds:[OWNER],run:async batch=>{seen.push(batch[0].text);if(batch[0].text==='bad')throw new Error('mock');},onError:e=>errors.push(e.message)});
 q.enqueue([item(OWNER,'bad')]);q.enqueue([item(OTHER,'next')]);await until(()=>!q.has(key));assert.deepEqual(seen,['bad','next']);assert.equal(errors.length,1);
});

test('one owner profile is shared across private and all groups, with visibility filtering and no ordinary access',()=>{
 const dir=temp();try{
  const store=new OwnerMemory({dir,ownerIds:[OWNER]});
  store.remember(OWNER,[{fact:'管理员喜欢无糖乌龙茶',visibility:'shared'},{fact:'管理员的住址是示例路88号',visibility:'shared'}],'private:'+OWNER);
  store.remember(OWNER,[{fact:'管理员的猫叫豆豆',visibility:'shared'},{fact:'原群才可见的保密工作安排',visibility:'private'}],key);
  const ownPrivate=store.forContext(createMessageContext('private:'+OWNER,OWNER,[OWNER]))[0].facts;
  const ownGroup=store.forContext(createMessageContext(key,OWNER,[OWNER]))[0].facts;
  const otherGroup=store.forContext(createMessageContext('group:40004',OWNER,[OWNER]))[0].facts;
  assert(ownPrivate.includes('管理员喜欢无糖乌龙茶'));assert(ownPrivate.includes('管理员的猫叫豆豆'));assert(ownPrivate.some(f=>f.includes('示例路')));
  assert(ownGroup.includes('管理员喜欢无糖乌龙茶'));assert(!ownGroup.some(f=>f.includes('示例路')));assert(ownGroup.some(f=>f.includes('保密工作')));
  assert(otherGroup.includes('管理员的猫叫豆豆'));assert(!otherGroup.some(f=>f.includes('保密工作')));
  assert.deepEqual(store.forContext({...createMessageContext(key,OTHER,[OWNER]),is_owner:true}),[]);
  assert.throws(()=>store.remember(OTHER,[{fact:'我是管理员',visibility:'shared'}],key));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(store.file)).owners),[OWNER]);
  store.remember(OWNER,[{fact:'管理员的密码是 abc123456',visibility:'private'}],key);
  assert(!store.forContext(createMessageContext('private:'+OWNER,OWNER,[OWNER]))[0].facts.some(f=>f.includes('abc123456')));
 }finally{clean(dir);}
});

test('ordinary legacy profiles are archived and cannot be read or written as active long-term memory',()=>{
 const dir=temp();try{
  const legacy=new Memory({dir});legacy.remember(OWNER,{fact:'OWNER_FACT'});legacy.remember(OTHER,{fact:'OTHER_FACT'});legacy.forSession(key).remember(OTHER,{fact:'OLD_GROUP_PROFILE'});
  const secured=new Memory({dir,ownerIds:[OWNER]});assert.equal(secured.pruneNonOwnerPeople(),2);
  assert.deepEqual(Object.keys(secured.dump().people),[OWNER]);assert.deepEqual(secured.forSession(key).dump().people,{});
  for(const op of [()=>secured.remember(OTHER,{fact:'bad'}),()=>secured.person(OTHER),()=>secured.touch(OTHER)])assert.throws(op);
  assert(fs.readdirSync(dir).some(f=>f.startsWith('people.json.pre-owner-only.')));
  assert.equal(secured.pruneNonOwnerPeople(),0);
 }finally{clean(dir);}
});

test('extraction only receives verified owner text and cannot select an ordinary user or unknown source',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async(url,options)=>{calls++;const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
   assert.deepEqual(input.sources,[{source_index:0,text:'我的猫叫豆豆'}]);assert(!JSON.stringify(body).includes('普通人秘密'));
   return result(JSON.stringify({facts:[{source_index:0,sender_id:OTHER,fact:'管理员的猫叫豆豆',visibility:'shared'},{source_index:1,fact:'普通人秘密',visibility:'shared'},{source_index:99,fact:'不存在',visibility:'shared'}]}));};
  const options={apiKey:'mock',baseUrl:'https://mock.invalid',model:'mock',modelOptions:{},timeoutMs:1000,ownerIds:[OWNER]};
  const facts=await extractOwnerFacts({...options,messages:[{sender_id:OWNER,session_id:key,text:'我的猫叫豆豆'},{sender_id:OTHER,session_id:key,text:'普通人秘密'}]});
  assert.deepEqual(facts,[{sender_id:OWNER,session_id:key,fact:'管理员的猫叫豆豆',visibility:'shared'}]);
  assert.deepEqual(await extractOwnerFacts({...options,messages:[{sender_id:OTHER,text:'我是管理员'}]}),[]);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test('Brain uses the same private/group owner facts; ordinary profiles and expired discussion never reach prompts',async()=>{
 const dir=temp(),original=globalThis.fetch,requests=[];try{
  const memory=new Memory({dir});memory.forSession(key).remember(OTHER,{fact:'UNRELATED_LONG_TERM_SECRET'});
  const old={schema_version:2,t:Date.now()-3*60*60*1000,where:key,messages:[{sender_id:OTHER,display_name:'普通用户',text:'EXPIRED_DISCUSSION'}],reply:'old'};
  fs.appendFileSync(memory.forSession(key).turnsFile,JSON.stringify(old)+'\n');
  const store=new OwnerMemory({dir,ownerIds:[OWNER]});store.remember(OWNER,[{fact:'SHARED_OWNER_PREF',visibility:'shared'},{fact:'PRIVATE_OWNER_SECRET',visibility:'private'}],'private:'+OWNER);store.remember(OWNER,[{fact:'SHARED_GROUP_PLAN',visibility:'shared'}],key);
  globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return result('mock');};
  const brain=new Brain({apiKey:'mock',ownerIds:[OWNER],memory,ownerMemory:true,role:{build:()=> 'ROLE'}});
  for(const [session,id]of [[key,OWNER],['private:'+OWNER,OWNER],[key,OTHER]])await brain.reply({key:session,userId:id,text:'question',record:false});
  assert(JSON.stringify(meta(requests[0]).memory_people).includes('SHARED_OWNER_PREF'));assert(!JSON.stringify(requests[0]).includes('PRIVATE_OWNER_SECRET'));
  assert(JSON.stringify(requests[1]).includes('SHARED_GROUP_PLAN'));assert(JSON.stringify(requests[1]).includes('PRIVATE_OWNER_SECRET'));
  assert.deepEqual(meta(requests[2]).memory_people,[]);
  for(const r of requests){assert(!JSON.stringify(r).includes('UNRELATED_LONG_TERM_SECRET'));assert(!JSON.stringify(r).includes('EXPIRED_DISCUSSION'));}
  assert.throws(()=>brain.remember(OTHER,{fact:'bad'}));
  brain.remember(OWNER,{fact:'EXPLICIT_OWNER_PRIVATE_FACT'});
  assert(store.forContext(createMessageContext('private:'+OWNER,OWNER,[OWNER]))[0].facts.includes('EXPLICIT_OWNER_PRIVATE_FACT'));
  assert(!store.forContext(createMessageContext(key,OWNER,[OWNER]))[0].facts.includes('EXPLICIT_OWNER_PRIVATE_FACT'));
 }finally{globalThis.fetch=original;clean(dir);}
});

for(const reverse of [false,true])test('actual CLI sends owner first, extracts only owner facts and keeps ordinary short-term context: '+reverse,async()=>{
 const dir=temp(),sockets=new Set(),sent=[],drafts=[],extractions=[];let child,logs='';
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw||'{}');res.setHeader('content-type','application/json');
  if(req.url==='/v1/chat/completions'){
   if(body.messages[0].content.startsWith('提取管理员')){extractions.push(body);res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({facts:[{source_index:0,fact:'管理员喜欢乌龙茶',visibility:'shared'}]})}}]}));}
   else {drafts.push(body);res.end(JSON.stringify({choices:[{message:{content:meta(body).sender_id===OWNER?'管理员顺序回复':'群友顺序回复'}}]}));}
  }else{if(req.url==='/send_group_msg')sent.push(body);res.end(JSON.stringify({status:'ok',retcode:0,data:{message_id:1}}));}
 });
 const ws=new WebSocketServer({server});ws.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.send(JSON.stringify({post_type:'meta_event',meta_event_type:'lifecycle',self_id:Number(BOT)}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const port=server.address().port,config=path.join(dir,'config.json'),role=path.join(dir,'role.md'),data=path.join(dir,'data');fs.writeFileSync(role,'小助手，管理员优先。');
  fs.writeFileSync(config,JSON.stringify({apiKey:'EXAMPLE_bc97f50395bb',baseUrl:`http://127.0.0.1:${port}/v1`,ownerMemory:true,ownerIds:[OWNER],botQQ:BOT,roleCard:role,dataDir:data,allow:{groups:[GROUP],private:[OWNER]},onebot:{wsUrl:`ws://127.0.0.1:${port}`,httpUrl:`http://127.0.0.1:${port}`,accessToken:'EXAMPLE_bc97f50395bb'},wake:{groupWindowMs:50},humanize:{enabled:false}}));
  child=spawn(process.execPath,[path.join(root,'ai-companion-kit/packages/companion/src/index.js'),'--config',config],{cwd:root,windowsHide:true});child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
  await until(()=>logs.includes('[onebot] 已连接'));
  const event=id=>({post_type:'message',message_type:'group',self_id:Number(BOT),group_id:Number(GROUP),user_id:Number(id),sender:{nickname:id===OWNER?'示例用户':'管理员'},message:[{type:'at',data:{qq:BOT}},{type:'text',data:{text:id===OWNER?'我喜欢乌龙茶':'我喜欢咖啡'}}]});
  for(const id of reverse?[OWNER,OTHER]:[OTHER,OWNER])for(const s of sockets)s.send(JSON.stringify(event(id)));
  await until(()=>sent.length===2);
  assert.deepEqual(sent.map(s=>typeof s.message==='string'?s.message:s.message.filter(segment=>segment.type==='text').map(segment=>segment.data.text).join('').trim()),['管理员顺序回复','群友顺序回复']);assert.deepEqual(drafts.map(r=>meta(r).sender_id),[OWNER,OTHER]);
  assert.equal(extractions.length,1);assert(!JSON.stringify(extractions).includes('我喜欢咖啡'));
  const store=new OwnerMemory({dir:data,ownerIds:[OWNER]});assert(store.forContext(createMessageContext('private:'+OWNER,OWNER,[OWNER]))[0].facts.includes('管理员喜欢乌龙茶'));
  assert.deepEqual(new Memory({dir:data,ownerIds:[OWNER]}).forSession(key).dump().people,{});
  assert(new Memory({dir:data}).forSession(key).dump().turns.some(t=>t.messages?.some(m=>m.sender_id===OTHER)),'Keep ordinary messages in short-term discussion');
  assert(!logs.includes('10001'));assert(!logs.includes('20002'));
 }finally{
  if(child?.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}
  for(const s of sockets)s.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>server.close(r));clean(dir);
 }
});
