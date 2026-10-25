// Only run --send-once after authorization for this exact test voice.
import fs from 'node:fs';
import { OneBot } from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
const cfg=JSON.parse(fs.readFileSync(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url),'utf8'));
const prepared=JSON.parse(fs.readFileSync(new URL('../logs/voice-test-prepared.json',import.meta.url),'utf8'));
const receiptFile=new URL('../logs/voice-send-check.json',import.meta.url);
if(prepared.text!=='语音功能测试，连接正常。') throw new Error('Unexpected test content');
if(!process.argv.includes('--send-once')) {console.log('No voice sent.');process.exit(0);}
// Use a real OneBot instance for private fields, then close the process explicitly.
const transport=new OneBot({...cfg.onebot});
try {
  let receipt;
  if(fs.existsSync(receiptFile)) {
    receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
    if(!receipt.messageId) throw new Error('Previous send attempt has no receipt. Check QQ manually; do not resend automatically.');
  } else {
    receipt={attemptedAt:new Date().toISOString(),verified:false};
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
    const result=await transport.sendVoice('private:'+cfg.ownerIds[0],prepared.file);
    receipt.messageId=result.data?.data?.message_id;
    if(!receipt.messageId) throw new Error('No message id; do not resend automatically.');
    fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
  }
  const read=await transport.api('get_msg',{message_id:receipt.messageId});
  const data=read.data?.data;
  if(!read.ok || String(data?.sender?.user_id)!==String(cfg.botQQ) || !data?.message?.some(s=>s.type==='record')) throw new Error('Voice sent; readback not yet verified. Do not resend.');
  receipt.verified=true;receipt.verifiedAt=new Date().toISOString();
  fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
  console.log('PASS: authorized test voice delivered; QQ message id, record segment and sender verified.');
  process.exit(0);
} catch(error) {console.error(error.message);process.exit(1);}
