import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {extractOwnerFacts,OwnerMemory} from '../ai-companion-kit/packages/companion/src/owner-memory.js';
import {createMessageContext} from '../ai-companion-kit/packages/companion/src/message-context.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {Multimedia} from './multimedia.mjs';
import {encode} from './media-runtime/node_modules/silk-wasm/lib/index.mjs';
if(!process.argv.includes('--live'))throw new Error('Pass --live to use configured models with synthetic fixtures, no QQ sends');
const ROOT=fileURLToPath(new URL('../',import.meta.url)),cfg=loadConfig(),owner='10001',group='30003';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-media-live-')),fixtures=path.join(ROOT,'local/fixtures/attachments');
const results=[],mode=process.argv.includes('--memory-only')?'memory':'all';
async function check(name,fn){try{const r=await fn();results.push({name,ok:r===true});}catch{results.push({name,ok:false,error:'接口或结果校验失败'});}console.log(JSON.stringify(results.at(-1)));}
const role=new Role({cardPath:cfg.roleCard,maxChars:cfg.roleMaxChars});
const brain=new Brain({...cfg,ownerIds:[owner],botId:'90009',memory:new Memory({dir,ownerIds:[owner]}),role,toolProvider:null,ownerMemory:false});
try{
 await check('完整Brain真实模型写入记忆，重建实例后在群聊中回答',async()=>{
  const options={...cfg,ownerIds:[owner],botId:'90009',memory:new Memory({dir,ownerIds:[owner]}),role,toolProvider:null,ownerMemory:true};
  const writer=new Brain(options);await writer.reply({key:'private:'+owner,userId:owner,text:'请记住，我的猫叫豆豆，我喜欢喝无糖乌龙茶。'});
  const loaded=new OwnerMemory({dir,ownerIds:[owner]}),shared=loaded.forContext(createMessageContext('group:'+group,owner,[owner]))[0].facts;
  const reader=new Brain({...options,memory:new Memory({dir,ownerIds:[owner]})});const recalled=await reader.reply({key:'group:'+group,userId:owner,text:'我养的猫叫什么名字？',record:false});
  return writer.ownerWorker.read().pending.length===0&&shared.some(f=>/豆豆/.test(f))&&/豆豆/.test(recalled.text);
 });
 if(mode==='all'){
  execFileSync(cfg.attachments?.python||'python',[path.join(ROOT,'local/create-media-fixtures.py'),fixtures],{windowsHide:true});
  const media=new Multimedia(cfg);
  let testVoice;
  await check('真实TTS音频经SILK编码后进行真实ASR识别',async()=>{
   const voice=await media.synthesize('小助手你好，今天测试语音识别。');const wav=fs.readFileSync(voice.file);const silk=await encode(wav,24000);
   testVoice=voice.file;
   const recognized=await media.incoming.transcribe(Buffer.from(silk.data));return /你好|语音|小助手/.test(recognized);
  });
  await check('扫描PDF真实视觉读取编号',async()=>{
   const doc=await media.incoming.prepareDocument(fs.readFileSync(path.join(fixtures,'scan.pdf')),'scan.pdf'),parts=[];
   for(const image of doc.images)parts.push(...(await media.prepareBuffer(fs.readFileSync(image.file),{kind:'document'})).parts);
   const r=await brain.reply({key:'private:'+owner,userId:owner,text:'读取PDF扫描页的验收编号，只回复编号。',media:[{messageIndex:0,parts}],record:false});return /4729/.test(r.text);
  });
  await check('普通PDF文字读取并由真实模型回答',async()=>{
   const doc=await media.incoming.prepareDocument(fs.readFileSync(path.join(fixtures,'sample.pdf')),'sample.pdf');
   const r=await brain.reply({key:'private:'+owner,userId:owner,text:'文件预算是多少？',turnMessages:[{sender_id:owner,text:'文件预算是多少？',attachment_text:doc.text}],record:false});return /128/.test(r.text);
  });
  await check('视频实际抽帧并由真实模型识别画面',async()=>{
   const file=path.join(fixtures,'blue.mp4'),ffmpeg=(process.env.FFMPEG_PATH||'ffmpeg');
   execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:d=2','-c:v','libx264','-pix_fmt','yuv420p','-y',file],{windowsHide:true});
   const video=await media.incoming.prepareVideo(fs.readFileSync(file));const r=await brain.reply({key:'private:'+owner,userId:owner,text:'视频画面主要是什么颜色？',media:[{messageIndex:0,parts:video.parts}],record:false});return /蓝|blue/i.test(r.text);
  });
  await check('视频音轨通过真实ASR识别',async()=>{
   if(!testVoice)return false;const file=path.join(fixtures,'blue-audio.mp4'),ffmpeg=(process.env.FFMPEG_PATH||'ffmpeg');
   execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=320x240:d=8','-i',testVoice,'-shortest','-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p','-y',file],{windowsHide:true});
   const video=await media.incoming.prepareVideo(fs.readFileSync(file));return /你好|语音|小助手/.test(video.text);
  });
  for(const scope of ['private','group'])await check(scope+'表情默认自然接话',async()=>{
   const image=await media.prepareBuffer(fs.readFileSync(path.join(ROOT,'data/stickers/happy.png')),{kind:'sticker'});
   const r=await brain.reply({key:scope==='private'?'private:'+owner:'group:'+group,userId:owner,text:'[表情包]',turnMessages:[{sender_id:owner,text:'[表情包]',attachments:[{type:'mface'}]}],media:[{messageIndex:0,parts:image.parts}],record:false});
   return !!r.text&&!/这张|这个表情|图里|画面|配字|表达了|传达/.test(r.text)&&r.text.length<180;
  });
 }
}finally{
 const report={at:new Date().toISOString(),mode,results,passed:results.filter(r=>r.ok).length,total:results.length,qqMessagesSent:0};fs.writeFileSync(path.join(ROOT,'logs/memory-media-live-check.json'),JSON.stringify(report,null,2));
 if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('qq-media-live-'))fs.rmSync(dir,{recursive:true,force:true});if(results.some(r=>!r.ok))process.exitCode=1;
}
