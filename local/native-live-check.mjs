import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig,handleTurn} from '../ai-companion-kit/packages/companion/src/index.js';
import {parseOneBotMessage} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {createMessageContext} from '../ai-companion-kit/packages/companion/src/message-context.js';
import {createTools} from './features.mjs';
import {QzoneAdapter} from './qzone-adapter.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
const api=new QzoneAdapter(cfg),tools=await createTools({...cfg,dryRun:true});
const memory=new Memory({dir:path.join(root,'data/validation/native-memory')}),role=new Role({cardPath:cfg.roleCard});
const brain=new Brain({...cfg,role,memory,toolProvider:tools});
const bot={selfId:cfg.botQQ,api:async(action,args)=>{try{return {ok:true,data:{data:await api.onebot(action,args)}};}catch{return {ok:false};}},send:async()=>{throw new Error('This validation must not send QQ messages');}};
const realOnly=process.argv.includes('--real-only');
const results=realOnly?JSON.parse(fs.readFileSync(path.join(root,'logs/native-vision/live-check.json'),'utf8')).results.filter(r=>r.source==='actual-api-fixture'):[];
function item(raw,text,group=false) {
  const parsed=parseOneBotMessage(raw,cfg.botQQ),userId=cfg.ownerIds[0],groupId=group?String(cfg.allow.groups[0]||'30003'):'';
  const key=group?'group:'+groupId:'private:'+userId;
  return {key,userId,groupId,isGroup:group,name:'验证',text:text==null?parsed.text:text+'\n'+parsed.text,raw:parsed.segments,mentions:parsed.mentions,attachments:parsed.attachments};
}
async function run(label,message,check,source) {
  let output;
  const capture={toolProvider:tools,reply:async input=>{output=await brain.reply({...input,record:false});return output;}};
  try {
    await handleTurn({bot,brain:capture,memory,human:{},waker:{}},[message],{...cfg,dryRun:true});
    const ok=check(output.text);results.push({label,source,passed:ok,requestId:output.raw.id,model:output.raw.model,usage:output.raw.usage,...(source==='actual-api-fixture'?{output:output.text}:{output:'[PRIVATE CONTENT NOT INCLUDED]'})});
    assert(ok,label+' actual model result mismatch');console.log('PASS actual API: '+label);
  }catch(error){results.push({label,source,passed:false,error:'media-or-model-check-failed'});console.error('FAIL actual API: '+label);}
}
try {
  if(!realOnly) {
  await run('private image + question',item([{type:'image',data:{file:path.join(root,'local/fixtures/vision-test.png')}}],'请说出编号、左右图形及颜色。'),t=>/2479/.test(t)&&/红/.test(t)&&/蓝/.test(t),'actual-api-fixture');
  await run('group cat photo',item([{type:'at',data:{qq:cfg.botQQ}},{type:'image',data:{file:path.join(root,'local/fixtures/cat.jpg')}}],'这是什么动物？',true),t=>/猫/.test(t),'actual-api-fixture');
  await run('static cat meme emotion',item([{type:'image',data:{sub_type:1,file:path.join(root,'data/stickers/sad.png')}}],'描述表情包上的文字、角色和情绪。'),t=>/猫/.test(t)&&/委屈|伤心|难过/.test(t),'actual-api-fixture');
  await run('animated meme temporal text',item([{type:'mface',data:{file:path.join(root,'local/fixtures/meme-test.gif')}}],'请按时间顺序列出动图三帧中的文字。'),t=>['看到消息','笑出声','哈哈哈'].every(s=>t.includes(s)),'actual-api-fixture');
  await run('QQ native face',item([{type:'face',data:{id:'9'}}],'这个 QQ 表情通常表达什么情绪？'),t=>/哭|难过|伤心|委屈/.test(t),'actual-api-fixture');
  if(fs.existsSync(path.join(root,'local/fixtures/error-test.png')))await run('error screenshot',item([{type:'image',data:{file:path.join(root,'local/fixtures/error-test.png')}}],'截图的主要错误和修复方向是什么？'),t=>/ECONNREFUSED|连接.*拒绝/.test(t)&&/3001/.test(t),'actual-api-fixture');
  }
  const real=JSON.parse(fs.readFileSync(path.join(root,'data/validation/real-qq-media.json'),'utf8'));
  for(const kind of ['private','group']) {
    const source=real.find(m=>m.message_type===kind);
    if(!source){results.push({label:'NapCat '+kind+' original media',source:'actual-napcat-history',passed:false,status:'not-available'});continue;}
    const parsed=parseOneBotMessage(source.message,cfg.botQQ);
    const message={...item(source.message,'请根据实际画面简洁描述主体、文字或情绪，不确定的细节请说明。',kind==='group'),userId:String(source.user_id),name:'验证',text:'请描述实际画面；不确定的内容请说明。'};
    if(kind==='private')message.key='private:'+message.userId;
    const prepared=await tools.prepareMessages([message],bot,{key:message.key,userId:message.userId});
    assert(prepared.media.length>0,'Actual NapCat media could not be downloaded: '+kind);
    await run('NapCat '+kind+' original media',message,t=>t.length>3&&!/无法.*(?:读取|看到)|没有.*(?:图片|图像)|识别失败/.test(t),'actual-napcat-history');
  }
} finally {
  fs.writeFileSync(path.join(root,'logs/native-vision/live-check.json'),JSON.stringify({at:new Date().toISOString(),results,scope:'Actual model API; real NapCat history/download for indicated rows. Replies captured in dry run. Fresh user upload and real group outgoing were not exercised.'},null,2));
  await tools.close();
}
if(results.some(r=>!r.passed))process.exitCode=1;
