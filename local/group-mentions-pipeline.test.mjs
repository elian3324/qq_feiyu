// Actual CLI, WebSocket parser, preference storage and HTTP sender; mocked QQ/model endpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from '../ai-companion-kit/node_modules/ws/wrapper.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('full application remembers unmentioned opt-out across a process restart and applies it to all split sends',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-mentions-cli-')),sent=[],sockets=new Set();let child,logs='',requests=0;
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');res.setHeader('content-type','application/json');
  if(req.url==='/v1/chat/completions'){requests++;res.end(JSON.stringify({choices:[{message:{content:'第一段回复内容。\n第二段回复内容。\n第三段回复内容。'}}]}));}
  else {if(req.url==='/send_group_msg')sent.push(body);res.end(JSON.stringify({status:'ok',retcode:0,data:{messages:[],message_id:sent.length}}));}
 });
 const ws=new WebSocketServer({server});ws.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.send(JSON.stringify({post_type:'meta_event',meta_event_type:'lifecycle',self_id:90009}));});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async fn=>{for(let n=0;n<500;n++){if(fn())return;await pause(15);}throw new Error('mock CLI timeout: '+logs);};
 const stateFile=path.join(dir,'data/group-mention-state.json');
 const state=()=>JSON.parse(fs.readFileSync(stateFile,'utf8'));
 const send=(user,text,at=true)=>{for(const socket of sockets)socket.send(JSON.stringify({post_type:'message',message_type:'group',self_id:90009,group_id:30003,user_id:Number(user),sender:{user_id:Number(user),nickname:'群友'},message:[...(at?[{type:'at',data:{qq:'90009'}}]:[]),{type:'text',data:{text}}]}));};
 const mentions=rows=>rows.flatMap(row=>Array.isArray(row.message)?row.message.filter(segment=>segment.type==='at'):[]);
 async function start(config){logs='';child=spawn(process.execPath,[path.join(root,'ai-companion-kit/packages/companion/src/index.js'),'--config',config],{cwd:root,windowsHide:true});child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);await until(()=>logs.includes('[onebot] 已连接'));}
 async function stop(){if(child?.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;}}
 async function turn(user,text){const before=sent.length;send(user,text);await until(()=>sent.length===before+3);return sent.slice(before);}
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const port=server.address().port,config=path.join(dir,'config.json'),role=path.join(dir,'role.md');fs.writeFileSync(role,'自然聊天，保留发言人身份。');
  fs.writeFileSync(config,JSON.stringify({apiKey:'EXAMPLE_bc97f50395bb',baseUrl:`http://127.0.0.1:${port}/v1`,ownerIds:['10001'],botQQ:'90009',roleCard:role,dataDir:path.join(dir,'data'),allow:{groups:['30003'],private:['10001']},onebot:{wsUrl:`ws://127.0.0.1:${port}`,httpUrl:`http://127.0.0.1:${port}`,accessToken:'EXAMPLE_bc97f50395bb'},wake:{groupWindowMs:20,groupAtOnly:true},humanize:{enabled:false}}));
  await start(config);send('20002','别随便艾特我',false);
  await until(()=>fs.existsSync(stateFile)&&state().preferences['30003']?.['20002']?.allowed===false);
  assert.equal(requests,0,'An opt-out is stored before the wake filter, without calling the model');
  assert.equal(mentions(await turn('20002','请@我一下')).length,0);
  await stop();await start(config);
  const ownerMentions=mentions(await turn('10001','你好'));assert(ownerMentions.length<=1);assert(ownerMentions.every(s=>s.data.qq==='10001'));
  assert.equal(mentions(await turn('20002','你好')).length,0,'Banned person stays blocked after a real process restart and speaker switch');
  await turn('20002','以后可以@我了');assert.equal(state().preferences['30003']['20002'].allowed,true);
  assert.equal(mentions(await turn('20002','请@我一下')).length,1,'Only the first of three chunks mentions');
  await turn('10001','你好');assert.equal(mentions(await turn('20002','继续聊两句')).length,0,'Next round does not reset the same-person mention quota');
  assert(sent.every(row=>row.auto_escape===true));
 }finally{await stop();for(const socket of sockets)socket.terminate();await new Promise(resolve=>ws.close(resolve));await new Promise(resolve=>server.close(resolve));if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('qq-mentions-cli-'))fs.rmSync(dir,{recursive:true,force:true});}
});
