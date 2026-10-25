import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocketServer } from '../ai-companion-kit/node_modules/ws/wrapper.mjs';
import { Diary } from '../ai-companion-kit/packages/companion/src/diary.js';
import { composeDiary } from '../ai-companion-kit/packages/companion/src/diary-author.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const work = fs.mkdtempSync(path.join(root, 'local', 'integration-'));
const requests = [], sent = [], sockets = new Set();
let child, logs='', failSend=false;
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(check, label) {
  const end=Date.now()+8000;
  while(Date.now()<end) { if(check()) return; await pause(25); }
  throw new Error('Timeout: '+label+'\n'+logs);
}
const server=http.createServer(async(req,res)=>{
  let raw=''; for await(const chunk of req) raw+=chunk;
  assert.equal(req.headers.authorization,'Bearer EXAMPLE_224c85586a96');
  const data=JSON.parse(raw || '{}');
  res.setHeader('content-type','application/json');
  if(req.url==='/v1/chat/completions') {
    requests.push(data);
    assert.equal(data.model,'qwen-plus');
    assert.equal(data.enable_thinking,false);
    const isDiary=data.messages[0].content.includes('只输出一个 JSON');
    res.end(JSON.stringify({choices:[{message:{content:isDiary ? JSON.stringify({text:'今天把花移到了窗边。',title:'窗边',mood:'开心',tags:['日常']}) : '我记住了，猫叫豆豆'}}]}));
  } else if(req.url==='/send_private_msg') {
    sent.push(data);
    res.end(JSON.stringify(failSend ? {status:'failed',retcode:1200,message:'mock delivery rejected'} : {status:'ok',retcode:0,data:{message_id:123}}));
  } else res.end(JSON.stringify({status:'ok',retcode:0,data:{}}));
});
const ws=new WebSocketServer({server});
ws.on('connection',(socket,req)=>{
  assert.equal(req.headers.authorization,'Bearer EXAMPLE_224c85586a96');
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
  socket.send(JSON.stringify({post_type:'meta_event',meta_event_type:'lifecycle',self_id:99999}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const roleFile=path.join(work,'role.md');
fs.writeFileSync(roleFile,'你叫小助手，说话简短，不编造。');
const cfg={apiKey:'EXAMPLE_224c85586a96',baseUrl:`http://127.0.0.1:${port}/v1`,model:'qwen-plus',modelOptions:{enable_thinking:false},roleCard:roleFile,dataDir:path.join(work,'data'),names:['小助手'],ownerIds:['10001'],allow:{private:['10001'],groups:[]},onebot:{wsUrl:`ws://127.0.0.1:${port}`,httpUrl:`http://127.0.0.1:${port}`,accessToken:'EXAMPLE_224c85586a96'},wake:{privateWindowMs:25,groupWindowMs:25,probability:0},humanize:{enabled:false}};
const configFile=path.join(work,'config.json');
fs.writeFileSync(configFile,JSON.stringify(cfg));
async function start(dry=false) {
  logs='';
  child=spawn(process.execPath,[path.join(root,'ai-companion-kit/packages/companion/src/index.js'),'--config',configFile,...(dry ? ['--dry-run'] : [])],{cwd:root,windowsHide:true});
  child.stdout.on('data',chunk=>logs+=chunk.toString());
  child.stderr.on('data',chunk=>logs+=chunk.toString());
  await until(()=>logs.includes('[onebot] 已连接'),'authenticated WebSocket connection');
}
async function stop(){if(child && child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}child=null;await until(()=>sockets.size===0,'WebSocket cleanup');}
function message(user,text,extra={}) {
  for(const socket of sockets) socket.send(JSON.stringify({post_type:'message',message_type:'private',self_id:99999,user_id:user,message_id:1,sender:{nickname:'本地测试'},message:[{type:'text',data:{text}}],...extra}));
}
try {
  await start();
  message(20002,'未授权消息');message(10001,'群聊未开启',{message_type:'group',group_id:555});message(99999,'自己的消息');
  await pause(250);assert.equal(requests.length,0);assert.equal(sent.length,0);
  console.log('PASS: unauthorized private, group and self messages are ignored.');
  message(10001,'我养了一只猫，名字叫豆豆');
  await until(()=>sent.length===1 && logs.includes('发出 1 条'),'owner reply');
  assert.equal(sent[0].user_id,'10001');assert.match(sent[0].message,/豆豆/);
  message(10001,'我的猫叫什么？');
  await until(()=>sent.length===2,'second turn');
  assert(requests[1].messages.some(message=>message.role==='user' && message.content==='我养了一只猫，名字叫豆豆'));
  assert(requests[1].messages.some(message=>message.role==='assistant' && message.content==='我记住了，猫叫豆豆'));
  assert(!requests[1].messages[0].content.includes('豆豆'));
  console.log('PASS: actual CLI -> authenticated OneBot WS -> model -> HTTP reply, with persistent same-chat context.');
  failSend=true;message(10001,'触发发送失败');
  await until(()=>logs.includes('mock delivery rejected'),'send failure surfaced');
  assert.equal((logs.match(/发出 1 条/g)||[]).length,2);
  console.log('PASS: failed deliveries are surfaced and are not counted as successful.');
  await stop();failSend=false;
  const before=sent.length;
  await start(true);message(10001,'只生成不发送');
  await until(()=>logs.includes('[干跑] 已生成回复'),'dry run generated');
  assert.equal(sent.length,before);
  await stop();console.log('PASS: dry run generates without sending QQ messages.');
  const row=await composeDiary({...cfg,roleText:'你叫小助手，说话简短，不编造。'});
  const diary=new Diary({dir:path.join(work,'diary')});diary.add(row);
  assert.match(diary.context(3),/花移到了窗边/);
  assert.equal(diary.stats().count,1);
  console.log('PASS: Bailian options, diary generation, persistence and context.');
  console.log('Integration checks passed. All model and QQ traffic stayed on 127.0.0.1.');
} finally {
  await stop();
  for(const socket of sockets) socket.terminate();
  await new Promise(resolve=>ws.close(resolve));
  await new Promise(resolve=>server.close(resolve));
  if(!path.resolve(work).startsWith(path.resolve(root,'local')+path.sep)) throw new Error('Unsafe cleanup path');
  fs.rmSync(work,{recursive:true,force:true});
}
