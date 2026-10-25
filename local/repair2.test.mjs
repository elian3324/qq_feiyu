import test from 'node:test';
import assert from 'node:assert/strict';
import {RecentMedia} from './recent-media.mjs';
import {explicitPublish,explicitSticker} from './intents.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Stickers,selectNaturalSticker} from './stickers.mjs';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
process.env.COMPANION_AUDIT_DIR=path.resolve('logs/mock-audit/repair2');
const message=(key,userId,id,type='image')=>({key,userId,messageId:id,raw:[{type,data:type==='face'?{id:9}:{file:'image-id'}}],text:type==='face'?'[QQ表情：大哭]':'[图片]'});
test('unmentioned picture/face persists by session and author, then expires',()=>{
  let now=10000;const cache=new RecentMedia({now:()=>now,ttlMs:3000});
  const a=message('group:30003','10001','a'),b=message('group:30003','20002','b'),c=message('group:40004','10001','c');
  cache.observe(a);cache.observe(b);cache.observe(c);
  assert.deepEqual(cache.related({key:a.key,userId:a.userId,text:'这张图是什么',raw:[]}),[a]);
  assert.deepEqual(cache.related({key:a.key,userId:'30003',text:'看看图片',raw:[]}),[]);
  const face=message(a.key,a.userId,'face','face');cache.observe(face);assert(cache.related({key:a.key,userId:a.userId,text:'我发的表情是什么',raw:[]}).includes(face));
  now+=3001;assert.deepEqual(cache.related({key:a.key,userId:a.userId,text:'看看图片',raw:[]}),[]);
});
test('quoted media can belong to another real author without crossing sessions',()=>{
  const cache=new RecentMedia(),a=message('group:30003','20002','a');cache.observe(a);
  assert.deepEqual(cache.related({key:a.key,userId:'10001',replyTo:'a',text:'这张图',raw:[]}),[a]);
  assert.deepEqual(cache.related({key:'group:40004',userId:'10001',replyTo:'a',text:'这张图',raw:[]}),[]);
});
test('a new image never inherits old media; a singular follow-up only uses the latest image',()=>{
  let now=100;const cache=new RecentMedia({now:()=>++now}),old=message('private:10001','10001','old'),latest=message('private:10001','10001','latest');
  cache.observe(old);cache.observe(latest);
  assert.deepEqual(cache.related(latest),[]);
  assert.deepEqual(cache.related({key:latest.key,userId:latest.userId,text:'这张图是什么',raw:[]}),[latest]);
  assert.deepEqual(cache.related({key:latest.key,userId:latest.userId,text:'这两张图片分别是什么',raw:[]}),[old,latest]);
});
test('explicit actions are required; questions, negations and quoted content are not commands',()=>{
  for(const s of ['发空间：今天开心','请在空间发表一条说说','帮我发一条说说'])assert(explicitPublish(s));
  for(const s of ['怎么发空间','别发空间','图片里写着发空间','你会不会发空间'])assert(!explicitPublish(s));
  for(const s of ['发个表情','请给我发一张表情包','来一个动图'])assert(explicitSticker(s));
  for(const s of ['不要发表情','图片里写着发个表情','怎么发表情'])assert(!explicitSticker(s));
});
test('normal-chat decisions have no cooldown or random gate and validate local IDs',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-natural-selector-')),original=globalThis.fetch;
  const cfg={apiKey:'EXAMPLE_bc97f50395bb',model:'deepseek-v4.1-flash',baseUrl:'https://mock.invalid/v1',ownerIds:['10001'],stickers:{enabled:true,privateProbability:0.35}};
  let rolls=0,calls=0;const library=new Stickers(cfg,{stateFile:path.join(dir,'state.json'),random:()=>{rolls++;return 0.1;}}),input={key:'private:10001',userId:'10001',text:'抱抱'};
  try {
    assert(library.spec(input));assert(library.spec(input));assert.equal(rolls,0);
    globalThis.fetch=async(_url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.model,cfg.model);assert.equal(body.response_format.type,'json_object');return Response.json({choices:[{message:{content:'{"id":"hug"}'}}]});};
    const choice=await selectNaturalSticker(cfg,library,input,'给你抱抱');assert.equal(choice.id,'hug');assert.equal(rolls,0);assert.equal(calls,1);
    assert.equal(await selectNaturalSticker(cfg,library,input,'给你抱抱'),null);assert.equal(calls,1);
    const closed=new Stickers(cfg,{stateFile:path.join(dir,'closed.json'),random:()=>0.99}),ordinary={key:'private:10001',userId:'10001',text:'你好'};
    assert(closed.spec(ordinary));assert.equal((await selectNaturalSticker(cfg,closed,ordinary,'你好')).id,'hug');assert.equal(calls,2);
    const next={...input,text:'哈哈哈'};assert(library.spec(next));
    globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:'{"id":"happy"}'}}]});};
    assert.equal((await selectNaturalSticker(cfg,library,next,'哈哈哈')).id,'happy');
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:'{"id":"../../secret"}'}}]});
    assert.equal(await selectNaturalSticker(cfg,library,{...input},'继续聊天'),null);
  }finally{globalThis.fetch=original;}
});
test('optional selector failure never discards an otherwise valid text reply',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-selector-failure-')),original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:'正常文字回复'}}]});
    const brain=new Brain({apiKey:'mock',model:'mock',baseUrl:'https://mock.invalid',ownerIds:['10001'],role:{build:()=>''},memory:new Memory({dir}),toolProvider:{list:async()=>[],suggestSticker:async()=>{throw new Error('mock timeout');}}});
    const reply=await brain.reply({key:'private:10001',userId:'10001',text:'你好',record:false});assert.equal(reply.text,'正常文字回复');assert.equal(reply.stickers.length,0);
  }finally{globalThis.fetch=original;}
});
