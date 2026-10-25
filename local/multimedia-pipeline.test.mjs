// Actual application + actual feature/MCP adapters, mock OneBot and model HTTP. Not a real QQ/API acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from '../ai-companion-kit/node_modules/ws/wrapper.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('full WS -> actual media adapter -> multimodal model body -> same QQ target',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-media-pipeline-')),sockets=new Set(),requests=[],sent=[];let child,logs='';
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');res.setHeader('content-type','application/json');
    if(req.url==='/v1/chat/completions') {assert.equal(req.headers.authorization,'Bearer EXAMPLE_c1a38d2c4f08');requests.push(body);res.end(JSON.stringify({choices:[{message:{content:'mock reply'}}]}));}
    else {
      assert.equal(req.headers.authorization,'Bearer EXAMPLE_b6e3a73079bc');
      if(req.url==='/get_image')res.end(JSON.stringify({status:'ok',data:{file:path.join(root,body.file==='cat-id'?'local/fixtures/cat.jpg':body.file==='gif-id'?'local/fixtures/meme-test.gif':'local/fixtures/vision-test.png')}}));
      else {if(req.url==='/send_private_msg'||req.url==='/send_group_msg')sent.push({action:req.url,...body});res.end(JSON.stringify({status:'ok',data:{message_id:1}}));}
    }
  });
  const ws=new WebSocketServer({server});ws.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.send(JSON.stringify({post_type:'meta_event',meta_event_type:'lifecycle',self_id:90009}));});
  const until=async condition=>{const end=Date.now()+15000;while(Date.now()<end){if(condition())return;await pause(15);}throw new Error('Pipeline timed out: '+logs);};
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  try {
    const configFile=path.join(dir,'config.json'),roleFile=path.join(dir,'role.md');fs.writeFileSync(roleFile,'你叫小助手，说话简短，不编造看不清的内容。');
    fs.writeFileSync(configFile,JSON.stringify({apiKey:'EXAMPLE_c1a38d2c4f08',model:'deepseek-v4.1-flash',baseUrl:`http://127.0.0.1:${port}/v1`,ownerIds:['10001'],botQQ:'90009',allow:{private:['10001'],groups:['30003','40004']},roleCard:roleFile,dataDir:path.join(dir,'data'),toolModule:path.join(root,'local/features.mjs'),vision:{enabled:true},voice:{enabled:false},stickers:{enabled:false},onebot:{wsUrl:`ws://127.0.0.1:${port}`,httpUrl:`http://127.0.0.1:${port}`,accessToken:'EXAMPLE_b6e3a73079bc'},wake:{privateWindowMs:30,groupWindowMs:30,groupAtOnly:true},humanize:{enabled:false}}));
    child=spawn(process.execPath,[path.join(root,'ai-companion-kit/packages/companion/src/index.js'),'--config',configFile],{cwd:root,windowsHide:true,env:{...process.env,COMPANION_AUDIT_DIR:path.join(dir,'audit')}});child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
    await until(()=>logs.includes('[onebot] 已连接'));
    async function turn(kind,user,group,segments) {
      const before=sent.length;
      for(const socket of sockets)socket.send(JSON.stringify({post_type:'message',self_id:90009,user_id:user,message_type:kind,...(kind==='group'?{group_id:group}:{}),sender:{user_id:user,nickname:'nickname should stay metadata'},message:segments}));
      await until(()=>sent.length===before+1);return requests.at(-1);
    }
    function current(request){const ctx=JSON.parse(request.messages[1].content.split('\n')[1]);return {ctx,content:request.messages[ctx.message_contexts.filter(m=>m.phase==='current')[0].message_index].content};}
    await t.test('owner pure image contains actual image_url bytes',async()=>{
      const request=await turn('private',10001,null,[{type:'image',data:{file:'red-id'}}]);const {ctx,content}=current(request);
      assert(Array.isArray(content));assert(content.some(p=>p.type==='image_url'&&p.image_url.url.startsWith('data:image/png;base64,')));assert.equal(ctx.is_owner,true);assert.equal(sent.at(-1).user_id,'10001');
    });
    await t.test('ordinary group user can use native vision, bot mention stays metadata',async()=>{
      const request=await turn('group',20002,30003,[{type:'at',data:{qq:'90009'}},{type:'text',data:{text:'这是什么？'}},{type:'image',data:{file:'cat-id'}}]);const {ctx,content}=current(request);
      assert.equal(ctx.is_owner,false);assert(content.some(p=>p.type==='image_url'));assert.equal(content[0].text,'这是什么？[图片]');assert.equal(sent.at(-1).group_id,'30003');
    });
    await t.test('GIF is flattened and another group does not inherit previous image',async()=>{
      const request=await turn('group',20003,40004,[{type:'at',data:{qq:'90009'}},{type:'mface',data:{file:'gif-id'}}]);const {ctx,content}=current(request);
      assert.equal(ctx.group_id,'40004');assert.equal(request.messages.filter(m=>Array.isArray(m.content)).length,1);assert(content.some(p=>p.type==='image_url'&&!p.image_url.url.startsWith('data:image/gif')));
    });
    await t.test('group image without mention is retained for a later separate mention/question',async()=>{
      const before=requests.length;
      for(const socket of sockets)socket.send(JSON.stringify({post_type:'message',self_id:90009,user_id:20004,message_type:'group',group_id:30003,sender:{user_id:20004,nickname:'test'},message:[{type:'image',data:{file:'cat-id'}}]}));
      await pause(100);assert.equal(requests.length,before);
      const request=await turn('group',20004,30003,[{type:'at',data:{qq:'90009'}},{type:'text',data:{text:'这张图是什么？'}}]);
      const ctx=JSON.parse(request.messages[1].content.split('\n')[1]),current=ctx.message_contexts.filter(m=>m.phase==='current');
      assert.equal(current.length,2);assert(current.every(m=>m.sender_id==='20004'));
      assert(request.messages[current[0].message_index].content.some(p=>p.type==='image_url'));
      assert.equal(request.messages[current[1].message_index].content,'这张图是什么？');
    });
    assert(!logs.includes('[出错]'));
  }finally {
    if(child?.exitCode===null) {const stopped=new Promise(r=>child.once('exit',r));if(process.platform==='win32')execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();await stopped;}
    for(const socket of sockets)socket.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>server.close(r));
    if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('qq-media-pipeline-'))fs.rmSync(dir,{recursive:true,force:true});
  }
});
