import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {QQFavorites} from './qq-favorites.mjs';
const cfg={ownerIds:['10001'],botQQ:'90009',stickers:{qqFavorites:{enabled:true,autoCollect:true,maxCollectPerDay:1}}};
const gif=fs.readFileSync(new URL('./fixtures/meme-test.gif',import.meta.url));
const checksum=createHash('md5').update(gif).digest('hex').toUpperCase();
const makeDir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'qq-favorites-test-'));
const media={resolveImage:async()=>({buffer:gif,info:{format:'gif',animated:true}}),describe:async()=>({text:'开心大笑的动态表情'})};
const message={key:'group:30003',userId:'20002',text:'哈哈哈',raw:[{type:'mface',data:{file:'actual-message-opaque-id'}}]};
test('sync learns actual pixels, keeps original GIF, and a failed fetch preserves the index',async()=>{
  let fail=false,rows=[{md5:checksum,url:'https://p.qpic.cn/one'}],descriptions=0;
  const store=new QQFavorites(cfg,{dir:makeDir(),api:async()=>{if(fail)throw new Error('offline');return rows;},media:{...media,describe:async()=>{descriptions++;return {text:'开心大笑'};}}});
  assert.equal((await store.sync()).indexed,1);assert.equal(descriptions,1);
  const entry=store.state().entries[0];assert.deepEqual(fs.readFileSync(entry.file),gif);assert.equal(entry.animated,true);
  await store.sync();assert.equal(descriptions,1);
  fail=true;await assert.rejects(store.sync());assert.equal(store.state().entries[0].id,entry.id);
  fail=false;rows=[];await store.sync();assert.equal(store.state().entries.length,0);
});
test('collect is bound to current session and preserves raw GIF; duplicate and quota checked',async()=>{
  let rows=[],writes=0;
  const store=new QQFavorites(cfg,{dir:makeDir(),media,api:async(action,args)=>{
    if(action==='fetch_custom_face_detail')return rows;
    assert.equal(action,'add_custom_face');writes++;assert.deepEqual(fs.readFileSync(args.file),gif);rows=[{md5:checksum,url:'https://p.qpic.cn/one'}];return {result:0};
  }});
  const input={key:message.key,userId:message.userId};input.collectableStickers=store.register([message],input,{});
  assert(store.spec(input));const id=input.collectableStickers[0].id;
  await assert.rejects(store.collect(id,{...input,key:'group:40004'}),/当前会话/);
  assert.equal((await store.collect(id,input)).verified,true);assert.equal(writes,1);assert.equal(store.spec(input),null);
  await store.sync();
  const next={...input};assert.equal((await store.collect(id,next)).alreadySaved,true);assert.equal(writes,1);
  rows=[];await assert.rejects(store.collect(id,{...input}),/上限/);assert.equal(writes,1);
});
test('plain private images are not auto-collect candidates; explicit owner collection is allowed',()=>{
  const store=new QQFavorites(cfg,{dir:makeDir(),media,api:async()=>[]});
  const photo={...message,raw:[{type:'image',data:{file:'photo'}}]};
  assert.deepEqual(store.register([photo],{key:message.key,userId:message.userId},{}),[]);
  const owner={...photo,userId:'10001',text:'收藏这张图片'};
  assert.equal(store.register([owner],{key:message.key,userId:'10001'},{}).length,1);
  assert.deepEqual(store.register([{...message,key:'group:40004'}],{key:message.key,userId:'10001'},{}),[]);
  assert.deepEqual(store.register([message],{key:message.key,userId:'10001'},{},[]),[]);
});
test('dry run, expired candidate, unknown ID and corrupt index never write a QQ favorite',async()=>{
  let now=1000,writes=0;
  const store=new QQFavorites(cfg,{dir:makeDir(),media,now:()=>now,api:async()=>{writes++;return [];}});
  const input={key:message.key,userId:message.userId};input.collectableStickers=store.register([message],input,{});
  await assert.rejects(store.collect('invented',input));now+=180001;
  await assert.rejects(store.collect(input.collectableStickers[0].id,input));assert.equal(writes,0);
  fs.writeFileSync(store.file,'broken');assert.throws(()=>store.state(),/损坏/);
  const dry=new QQFavorites({...cfg,dryRun:true},{dir:makeDir(),media,api:async()=>{writes++;return [];}});
  input.collectableStickers=dry.register([message],input,{});await assert.rejects(dry.collect(input.collectableStickers[0].id,input),/干跑/);assert.equal(writes,0);
});
test('an uncertain native add is not repeated in a later turn',async()=>{
  let writes=0;
  const store=new QQFavorites({...cfg,stickers:{qqFavorites:{...cfg.stickers.qqFavorites,maxCollectPerDay:8}}},{dir:makeDir(),media,api:async action=>{if(action==='fetch_custom_face_detail')return [];writes++;throw new Error('network timeout after submission');}});
  const input={key:message.key,userId:message.userId};input.collectableStickers=store.register([message],input,{});
  await assert.rejects(store.collect(input.collectableStickers[0].id,input),/timeout/);
  assert(store.state().originals[checksum]);
  await assert.rejects(store.collect(input.collectableStickers[0].id,{...input}),/未知/);assert.equal(writes,1);
});
