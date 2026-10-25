import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {OneBot} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
import {createTools} from './features.mjs';
import {QzoneAdapter} from './qzone-adapter.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
const receiptFile=path.join(root,'logs/native-vision/voice-regression-self.json');
if(fs.existsSync(receiptFile)){const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));assert(receipt.verified,'Prior attempt uncertain; do not resend');console.log('PASS: existing verified regression receipt, no duplicate voice sent.');process.exit(0);}
const tools=await createTools(cfg);
try {
  const provider={list:async input=>(await tools.list(input)).filter(t=>t.function.name==='voice_reply'),call:tools.call};
  const brain=new Brain({...cfg,role:new Role({cardPath:cfg.roleCard}),memory:new Memory({dir:path.join(root,'data/validation/voice-memory')}),toolProvider:provider});
  const result=await brain.reply({key:'private:'+cfg.ownerIds[0],userId:cfg.ownerIds[0],text:'请用真正的语音说“语音回归测试，连接正常。”，不要用文字冒充。',record:false});
  assert.equal(result.voices.length,1);
  const api=new QzoneAdapter(cfg),transport={api:async(action,args)=>{try{return {ok:true,data:{data:await api.onebot(action,args)}};}catch(error){return {ok:false,error:error.message};}}};
  fs.writeFileSync(receiptFile,JSON.stringify({attemptedAt:new Date().toISOString(),verified:false,destination:'bot-self'}));
  const sent=await OneBot.prototype.sendVoice.call(transport,'private:'+cfg.botQQ,result.voices[0].file);
  const messageId=sent.data?.data?.message_id;fs.writeFileSync(receiptFile,JSON.stringify({messageId,verified:false,destination:'bot-self'}));
  const back=await api.onebot('get_msg',{message_id:messageId});assert(back.message.some(s=>s.type==='record'));assert.equal(String(back.user_id),cfg.botQQ);
  fs.writeFileSync(receiptFile,JSON.stringify({at:new Date().toISOString(),requestId:result.raw.id,model:cfg.model,ttsModel:cfg.voice.model,messageId,verified:true,destination:'bot-self'},null,2));
  console.log('PASS: real DeepSeek voice tool, existing TTS synthesis/decoding and real NapCat record delivery to bot-self verified.');
}finally{await tools.close();}
