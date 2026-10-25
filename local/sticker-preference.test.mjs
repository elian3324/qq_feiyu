import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Stickers} from './stickers.mjs';
import {QQFavorites} from './qq-favorites.mjs';
import {StickerCollector} from './sticker-collector.mjs';
const gif=fs.readFileSync(new URL('./fixtures/meme-test.gif',import.meta.url));
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'sticker-preference-'));
test('QQ preference is enforced for tool calls and validated choices, local only occasional',()=>{
 const cfg={ownerIds:['10001'],stickers:{enabled:true,preferQQ:true,localAfterQQ:5,groupMaxPerHour:50,globalMaxPerHour:100}};
 const library=new Stickers(cfg,{stateFile:path.join(dir(),'state.json')});
 library.entries=()=>[{id:'qq_a',source:'qq'},{id:'qq_b',source:'qq'},{id:'cat',source:'local'},{id:'cat2',source:'local'}];
 const turn=()=>({key:'group:30003',userId:'20002',text:'哈哈哈'});
 const first=turn();assert.deepEqual(library.spec(first).function.parameters.properties.id.enum,['qq_a','qq_b']);
 assert.throws(()=>library.choose('cat',first));
 for(let i=0;i<5;i++)library.choose(i%2?'qq_b':'qq_a',turn());
 assert(library.choices(turn()).some(e=>e.id==='cat'));
 library.choose('cat',turn());assert(library.choices(turn()).every(e=>e.source==='qq'));
 assert(library.choices({...turn(),text:'发个自己画的表情'}).some(e=>e.source==='local'));
});
test('only one QQ favorite does not force a local cat to work around repeat prevention',()=>{
 const library=new Stickers({ownerIds:[],stickers:{enabled:true,preferQQ:true}},{stateFile:path.join(dir(),'state.json')});
 library.entries=()=>[{id:'qq_a',source:'qq'},{id:'cat',source:'local'}];
 const input={key:'group:30003',userId:'20002',text:'哈哈哈'};library.choose('qq_a',input);
 assert.equal(library.spec({...input}),null);
 library.entries=()=>[{id:'cat',source:'local'}];assert.equal(library.choices({...input})[0].id,'cat');
});
function setup({decision={isMeme:true,sensitive:false,collect:true,description:'开心的表情'},dryRun=false,maxCollectPerDay=24}={}) {
 const cfg={botQQ:'90009',ownerIds:['10001'],allow:{groups:['30003'],private:['10001']},dryRun,stickers:{qqFavorites:{enabled:true,autoCollect:true,backgroundCollect:true,maxCollectPerDay,maxAssessPerDay:80}}};
 let writes=0,analyses=0;const rows=[];
 const favorites=new QQFavorites(cfg,{dir:dir(),media:{resolveImage:async()=>({buffer:gif,info:{format:'gif',animated:true}}),describe:async()=>{throw new Error('assessment must be reused');}},api:async(action,args)=>{
   if(action==='fetch_custom_face_detail')return rows;
   assert.equal(action,'add_custom_face');writes++;
   const {createHash}=await import('node:crypto');rows.push({md5:createHash('md5').update(fs.readFileSync(args.file)).digest('hex').toUpperCase(),url:'https://p.qpic.cn/test'});return {result:0};
 }});
 const collector=new StickerCollector(cfg,{favorites,audit:()=>{},analyze:async()=>{analyses++;return decision;}});
 const message={key:'group:30003',userId:'20002',text:'哈哈哈',raw:[{type:'image',data:{file:'received-id',url:'https://p.qpic.cn/one'}}]};
 return {favorites,collector,message,stats:()=>({writes,analyses})};
}
test('an ordinary unmentioned image is independently assessed and collected without chat replies',async()=>{
 const {favorites,collector,message,stats}=setup();collector.observe(message,{});
 assert.equal(collector.queue.length,1);await Promise.all([collector.drain(),collector.drain()]);
 assert.deepEqual(stats(),{writes:1,analyses:1});await favorites.sync();
 assert.equal(favorites.state().entries.length,1);assert.equal(favorites.state().entries[0].description,'开心的表情');
 collector.observe({...message,raw:[{type:'mface',data:{file:'different-id'}}]},{});await collector.drain();assert.deepEqual(stats(),{writes:1,analyses:1});
});
test('photos or sensitive screenshots are rejected and their assessments cached',async()=>{
 for(const decision of [{isMeme:false,sensitive:false,collect:true},{isMeme:true,sensitive:true,collect:true}]) {
   const {collector,message,stats}=setup({decision});collector.observe(message,{});await collector.drain();
   collector.observe({...message,raw:[{type:'image',data:{file:'different-id'}}]},{});await collector.drain();
   assert.deepEqual(stats(),{writes:0,analyses:1});
 }
});
test('self, unrelated groups and dry run cannot collect; quota persists across workers',async()=>{
 const {collector,message,favorites,stats}=setup();collector.observe({...message,userId:'90009'},{});collector.observe({...message,key:'group:40004'},{});assert.equal(collector.queue.length,0);
 const dry=setup({dryRun:true});dry.collector.observe(dry.message,{});await dry.collector.drain();assert.deepEqual(dry.stats(),{writes:0,analyses:0});
 for(let i=0;i<80;i++)assert(favorites.reserveAssessment());
 collector.observe(message,{});await collector.drain();assert.deepEqual(stats(),{writes:0,analyses:0});
 const restarted=new QQFavorites(favorites.cfg,{dir:favorites.dir,media:favorites.media,api:favorites.api});assert.equal(restarted.reserveAssessment(),false);
});
