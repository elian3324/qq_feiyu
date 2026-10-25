// The real application/OneBot parser/Brain run against local mock QQ and model servers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from '../ai-companion-kit/node_modules/ws/wrapper.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const OWNER='10001',PEER='20002',THIRD='20003',BOT='90009',GROUP='30003',GROUP2='40004',GROUP3='50005';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('real CLI routes group addressees before the model, preserves identity/context and cancels delayed implicit replies',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-addressing-')),sockets=new Set(),requests=[],sent=[];
  let child,logs='',sequence=0,holdNext=false,release;
  const until=async fn=>{for(let n=0;n<400;n++){if(fn())return;await sleep(15);}throw new Error('Mock application timed out: '+logs.slice(-1600));};
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw||'{}');res.setHeader('content-type','application/json');
    if(req.url==='/v1/chat/completions'){
      requests.push(body);if(holdNext){holdNext=false;await new Promise(resolve=>{release=resolve;});release=null;}
      res.end(JSON.stringify({choices:[{message:{content:'收到这条明确发给我的消息。'}}]}));
    }else if(req.url==='/get_msg'){
      await sleep(120);res.end(JSON.stringify({status:'ok',data:{user_id:Number(PEER),group_id:Number(GROUP),message_type:'group'}}));
    }else{
      if(['/send_group_msg','/send_private_msg'].includes(req.url))sent.push({action:req.url,...body});
      res.end(JSON.stringify({status:'ok',retcode:0,data:{messages:[],message_id:sent.length}}));
    }
  });
  const ws=new WebSocketServer({server});
  ws.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.send(JSON.stringify({post_type:'meta_event',meta_event_type:'lifecycle',self_id:Number(BOT)}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,config=path.join(dir,'config.json'),role=path.join(dir,'role.md');
  const send=(user,body,ids=[],group=GROUP,reply=null)=>{
    const event={post_type:'message',message_type:group?'group':'private',self_id:Number(BOT),user_id:Number(user),
      ...(group?{group_id:Number(group)}:{}),sender:{user_id:Number(user),nickname:'管理员'},message_id:++sequence,
      message:[...(reply?[{type:'reply',data:{id:reply}}]:[]),...ids.map(id=>({type:'at',data:{qq:id,name:'小助手'}})),{type:'text',data:{text:body}}]};
    for(const socket of sockets)socket.send(JSON.stringify(event));
  };
  const frame=request=>JSON.parse(request.messages.find(m=>m.role==='system'&&m.content.startsWith('【程序验证的当前 QQ 消息上下文】')).content.split('\n')[1]);
  async function silent(action){const before=requests.length,deliveries=sent.length;action();await sleep(330);assert.equal(requests.length,before,'No model request for a peer-directed message');assert.equal(sent.length,deliveries,'No QQ send for a peer-directed message');}
  async function reply(user,body,ids=[],group=GROUP){const before=sent.length;send(user,body,ids,group);await until(()=>sent.length>before);return frame(requests.at(-1));}
  try{
    fs.writeFileSync(role,'你是小助手，保持自然群聊，按真实身份分别回应。');
    fs.writeFileSync(config,JSON.stringify({apiKey:'EXAMPLE_e223bd6805b0',baseUrl:`http://127.0.0.1:${port}/v1`,botQQ:BOT,ownerIds:[OWNER],
      names:['小助手'],keywords:['小助手'],roleCard:role,dataDir:path.join(dir,'data'),
      allow:{groups:[GROUP,GROUP2,GROUP3],private:[OWNER,PEER]},
      onebot:{wsUrl:`ws://127.0.0.1:${port}`,httpUrl:`http://127.0.0.1:${port}`,accessToken:'EXAMPLE_bc97f50395bb'},
      wake:{groupWindowMs:100,privateWindowMs:30,ownerAlwaysWake:true,groupAtOnly:true,probability:0},humanize:{enabled:false}}));
    child=spawn(process.execPath,[path.join(ROOT,'ai-companion-kit/packages/companion/src/index.js'),'--config',config],{cwd:ROOT,windowsHide:true});
    child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
    await until(()=>logs.includes('[onebot] 已连接'));

    await t.test('owner @ peer is silent, even if text names the bot or asks a question',()=>silent(()=>send(OWNER,'小助手，你能不能解释这个？',[PEER])));
    await t.test('both sides continue without @ and cause no model call',()=>silent(()=>{send(OWNER,'我周六过去');send(PEER,'好的，一起去');send(OWNER,'怎么过去？');}));
    await t.test('ordinary user @ peer is also silent despite nickname 管理员',()=>silent(()=>send(THIRD,'在吗？',[PEER])));
    await t.test('real @bot resumes and passes separate verified sender/mention/target fields',async()=>{
      const meta=await reply(OWNER,'回答我这个问题',[BOT]),current=meta.message_contexts.filter(m=>m.phase==='current');
      assert.equal(meta.sender_id,OWNER);assert(meta.is_owner);assert.equal(meta.chat_type,'group');assert.equal(meta.session_id,'group:'+GROUP);
      assert.equal(current.length,1);assert.deepEqual(current[0].mentioned_user_ids,[BOT]);assert(current[0].is_mentioned_bot);assert.equal(current[0].addressing.target,'bot');
      const body=requests.at(-1).messages[current[0].message_index].content;assert.equal(body,'回答我这个问题');
    });
    await t.test('simultaneous bot/peer @ is allowed and does not transfer ownership',async()=>{
      const meta=await reply(PEER,'你们都怎么看？',[BOT,OWNER]);assert.equal(meta.sender_id,PEER);assert(!meta.is_owner);
      assert.deepEqual(meta.message_contexts.filter(m=>m.phase==='current')[0].mentioned_user_ids,[BOT,OWNER]);
    });
    await t.test('group isolation and owner private chat remain intact',async()=>{
      await silent(()=>send(OWNER,'群友回答一下',[PEER],GROUP2));
      const group=await reply(OWNER,'这个群的事情',[],GROUP3);assert.equal(group.session_id,'group:'+GROUP3);
      const personal=await reply(OWNER,'我的私聊',[],null);assert.equal(personal.chat_type,'private');assert.equal(personal.group_id,null);
      assert(!requests.at(-1).messages.some(m=>typeof m.content==='string'&&m.content.includes('这个群的事情')));
    });
    await t.test('unmentioned owner messages buffered before a peer @ are discarded before the model',()=>silent(()=>{send(OWNER,'你有空吗？',[],GROUP3);send(OWNER,'刚才是问你',[PEER],GROUP3);}));
    await t.test('clear name question can turn a peer conversation back toward the bot',async()=>{
      const meta=await reply(OWNER,'小助手，你怎么看？',[],GROUP3);assert.equal(meta.message_contexts.filter(m=>m.phase==='current')[0].addressing.reason,'bot-name');
    });
    await t.test('quote resolution cannot reorder a following unmentioned peer message',()=>silent(()=>{
      send(OWNER,'我问的是你',[PEER],GROUP,'12345');send(OWNER,'明天下午可以吗？',[],GROUP);
    }));
    await t.test('implicit work waiting behind a real bot request is cancelled on a peer redirect',async()=>{
      const initialRequests=requests.length,initialSends=sent.length;holdNext=true;send(OWNER,'明确问小助手',[BOT],GROUP3);
      await until(()=>requests.length===initialRequests+1&&release);
      send(OWNER,'顺便说另一件事',[],GROUP3);await sleep(180);send(OWNER,'这句是问群友',[PEER],GROUP3);await sleep(100);
      release();await until(()=>sent.length===initialSends+1);await sleep(250);
      assert.equal(requests.length,initialRequests+1,'The queued implicit turn never reached the model');
      assert.equal(sent.length,initialSends+1,'The explicit bot request still receives its answer');
    });
    await t.test('implicit generation already in flight is not sent after the owner turns to a peer',async()=>{
      await reply(OWNER,'小助手先回来',[BOT],GROUP3);
      const before=requests.length,deliveries=sent.length;holdNext=true;send(OWNER,'未指明对象的问题',[],GROUP3);
      await until(()=>requests.length===before+1&&release);send(OWNER,'在问群友',[PEER],GROUP3);await sleep(100);release();await sleep(250);
      assert.equal(sent.length,deliveries);assert.equal(requests.length,before+1);
    });
    assert(!logs.includes('EXAMPLE_e223bd6805b0'));assert(!logs.includes('未指明对象的问题'));
  }finally{
    release?.();if(child?.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
    for(const socket of sockets)socket.terminate();await new Promise(resolve=>ws.close(resolve));await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(dir),os.tmpdir());assert(path.basename(dir).startsWith('qq-addressing-'));fs.rmSync(dir,{recursive:true,force:true});
  }
});
