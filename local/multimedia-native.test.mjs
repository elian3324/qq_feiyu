import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Multimedia,allowedMediaUrl,extractImages,downloadMedia} from './multimedia.mjs';
import {Stickers} from './stickers.mjs';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {handleTurn} from '../ai-companion-kit/packages/companion/src/index.js';
import {OneBot,segsToText} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const cfg={model:'deepseek-v4.1-flash',baseUrl:'https://mock.invalid/v1',apiKey:'EXAMPLE_bc97f50395bb',ownerIds:['10001'],botQQ:'90009',vision:{enabled:true,gifFrames:4},stickers:{enabled:true,privateProbability:1,groupProbability:1,privateCooldownSeconds:180,groupCooldownSeconds:600}};
function dir(){return fs.mkdtempSync(path.join(os.tmpdir(),'qq-native-'));}
test('actual NapCat .com.cn domain allowed, untrusted URLs rejected',()=>{
  assert.equal(allowedMediaUrl('https://multimedia.nt.qq.com.cn/a').hostname,'multimedia.nt.qq.com.cn');
  for(const u of ['http://127.0.0.1/x','https://multimedia.nt.qq.com.cn.evil/x','https://EXAMPLE_USER:EXAMPLE_PASSWORD@gchat.qpic.cn/x','https://gchat.qpic.cn:42/x','file:///./local-resources'])assert.throws(()=>allowedMediaUrl(u));
});
test('download bounds and expired URLs use get_image fallback, not arbitrary local reads',async()=>{
  const original=globalThis.fetch,media=new Multimedia(cfg);let calls=0;
  try {
    globalThis.fetch=async()=>new Response('x',{status:404});
    const bot={api:async(action,args)=>{calls++;assert.equal(args.file,'opaque-id');return {ok:true,data:{data:{file:path.join(root,'local/fixtures/vision-test.png')}}};}};
    const resolved=await media.resolveImage({file:'opaque-id',url:'https://multimedia.nt.qq.com.cn/expired'},bot);assert.equal(resolved.info.format,'png');assert.equal(calls,1);
    await assert.rejects(()=>media.resolveImage({file:'./local-resources'},bot));assert.equal(calls,1);
    globalThis.fetch=async()=>new Response('x',{headers:{'content-length':'99999999'}});await assert.rejects(()=>downloadMedia('https://gchat.qpic.cn/x'),/大小/);
  }finally{globalThis.fetch=original;}
});
test('native image/mface and multiple attachments retain their message indices',async()=>{
  assert.match(segsToText([{type:'face',data:{id:14}},{type:'mface',data:{}}]),/微笑.*表情包/);
  const media=new Multimedia(cfg),prepared=await media.prepareMessages([{raw:[{type:'image',data:{file:path.join(root,'local/fixtures/vision-test.png')}}]},{raw:[{type:'mface',data:{file:path.join(root,'local/fixtures/meme-test.gif')}}]}],{});
  assert.deepEqual(prepared.media.map(m=>m.messageIndex),[0,1]);assert(prepared.media[1].animated);
  for(const attachment of prepared.media)assert(attachment.parts.some(p=>/^data:image\/(png|jpeg|webp);base64,/.test(p.image_url?.url||'')));
  assert.equal(extractImages([{type:'face',data:{id:14}}]).length,0);
});
test('Brain preserves actual content arrays, per-sender ownership and history without persisting Base64',async()=>{
  const original=globalThis.fetch,requests=[],memory=new Memory({dir:dir()});
  const brain=new Brain({...cfg,memory,role:{build:()=> '原有人设仍在'}});
  const image=(await new Multimedia(cfg).prepareBuffer(fs.readFileSync(path.join(root,'local/fixtures/vision-test.png')))).parts;
  try {
    globalThis.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return Response.json({choices:[{message:{content:'mock red square'}}]});};
    await brain.reply({key:'group:30003',userId:'20002',turnMessages:[{sender_id:'10001',text:'第一张图'},{sender_id:'20002',text:'我的问题'}],media:[{messageIndex:0,parts:image}]});
    const request=requests[0],frame=JSON.parse(request.messages[1].content.split('\n')[1]),current=frame.message_contexts.filter(m=>m.phase==='current');
    assert(Array.isArray(request.messages[current[0].message_index].content));assert.equal(request.messages[current[1].message_index].content,'我的问题');assert.equal(current[0].is_owner,true);assert.equal(current[1].is_owner,false);
    assert(!JSON.stringify(memory.forSession('group:30003').dump()).includes('data:image'));
    await brain.reply({key:'private:10001',userId:'10001',text:'私聊',record:false});assert(!JSON.stringify(requests[1]).includes('第一张图'));
  }finally{globalThis.fetch=original;}
});
test('missing media yields a failure observation without crashing the turn',async()=>{
  const result=await new Multimedia(cfg).prepareMessages([{raw:[{type:'image',data:{file:'not-found'}}]}],{api:async()=>({ok:false})});
  assert.equal(result.media.length,0);assert.match(result.observations,/识别失败/);
});
test('local sticker IDs, audience, missing resources and repeat prevention without timed cooldown',()=>{
  let now=2000000000000;const stateFile=path.join(dir(),'state.json'),s=new Stickers(cfg,{stateFile,now:()=>now,random:()=>0});
  const owner={key:'private:10001',userId:'10001'},group={key:'group:30003',userId:'20002'};
  assert(s.entries(owner).some(e=>e.id==='hug'));assert(!s.entries(group).some(e=>e.id==='hug'));
  assert.throws(()=>s.choose('../../secret',owner));s.choose('hug',owner);assert(s.eligible({...owner}));
  assert.throws(()=>s.choose('hug',{...owner}),/重复/);assert(s.choose('happy',{...owner}));
  const missing=new Stickers({...cfg,stickers:{enabled:true,library:'data/does-not-exist.json'}});assert.equal(missing.spec(owner),null);
  const disabled=new Stickers({...cfg,stickers:{enabled:false}});assert.equal(disabled.spec(owner),null);
  fs.writeFileSync(stateFile,'broken');assert.throws(()=>s.eligible(group),/损坏/);
});
test('sticker send failure does not stop text reply, voice send path retained, dry run sends nothing',async()=>{
  let textCount=0,voiceCount=0;
  const input={key:'private:10001',userId:'10001',name:'test',isGroup:false,text:'test',raw:[]};
  const env={bot:{selfId:'90009',sendImage:async()=>{throw new Error('missing image');},sendVoice:async()=>voiceCount++,send:async()=>textCount++,setTyping:async()=>{}},brain:{reply:async()=>({text:'文字继续',stickers:[{file:'missing'}],voices:[]})},human:{say:async(text,io)=>{if(text)await io.send(text);return {sent:1};}},memory:{},waker:{wake(){}}};
  await handleTurn(env,[input],cfg);assert.equal(textCount,1);
  await handleTurn(env,[input],{...cfg,dryRun:true});assert.equal(textCount,1);
  env.brain.reply=async()=>({text:'不重复发',voices:[{file:'test.wav'}]});await handleTurn(env,[input],cfg);assert.equal(voiceCount,1);assert.equal(textCount,1);
  const calls=[];await OneBot.prototype.sendVoice.call({api:async(action,args)=>{calls.push(args);return {ok:true};}},input.key,path.join(root,'local/fixtures/vision-test.png'));
  assert.equal(calls[0].message[0].type,'record');
});
