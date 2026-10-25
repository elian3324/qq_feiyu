// Run only after explicit user authorization to send this exact message.
import fs from 'node:fs';
const cfg=JSON.parse(fs.readFileSync(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url),'utf8'));
const receiptFile=new URL('../logs/send-check-receipt.json',import.meta.url);
const text='安装验收测试：百炼与 QQ 连接正常';
if(!process.argv.includes('--send-once')) {
  console.log('Prepared one test message for the configured owner QQ. No message sent.');
  process.exit(0);
}
if(fs.existsSync(receiptFile)) {
  const previous=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  if(previous.owner===String(cfg.ownerIds[0]) && previous.bot===String(cfg.botQQ)) {
    console.log('A receipt already exists. Test message will not be sent again.');
    process.exit(0);
  }
}
async function api(action,body) {
  const response=await fetch(cfg.onebot.httpUrl+'/'+action,{
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+cfg.onebot.accessToken},
    body:JSON.stringify(body),signal:AbortSignal.timeout(30000),
  });
  const result=await response.json();
  if(!response.ok || result.status!=='ok' || (result.retcode!=null && result.retcode!==0)) throw new Error(action+' failed: '+(result.message || result.wording || response.status));
  return result.data;
}
const sent=await api('send_private_msg',{user_id:String(cfg.ownerIds[0]),message:text});
if(!sent?.message_id) throw new Error('Send returned no message id. Do not automatically retry; check the owner QQ.');
const receipt={owner:String(cfg.ownerIds[0]),bot:String(cfg.botQQ),messageId:sent.message_id,sentAt:new Date().toISOString(),verified:false};
fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
const readBack=await api('get_msg',{message_id:sent.message_id});
const content=readBack.raw_message || (Array.isArray(readBack.message)?readBack.message.filter(s=>s.type==='text').map(s=>s.data?.text||'').join(''):'');
if(String(readBack.sender?.user_id)!==String(cfg.botQQ) || content!==text) throw new Error('Message sent, but read-back differs. Check the owner QQ; do not resend.');
receipt.verified=true;fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
console.log('PASS: one authorized private test message sent to the configured owner; message id and sender verified by read-back.');
