// Authorized in this chat: one owner sticker and one exact private Qzone post.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {OneBot} from '../ai-companion-kit/packages/companion/src/transport-onebot.js';
import {createTools} from './features.mjs';
import {QzoneAdapter} from './qzone-adapter.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
const content='多媒体修复验收：图片、表情与空间连接测试。';
const file=path.join(root,'logs/repair2-acceptance.json');
let receipt=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{startedAt:new Date().toISOString(),post:{},sticker:{}};
const save=()=>fs.writeFileSync(file,JSON.stringify(receipt,null,2));
const api=new QzoneAdapter(cfg),login=await api.onebot('get_login_info');assert.equal(String(login.user_id),cfg.botQQ);
const tools=await createTools(cfg);
try {
  const model=async(name,text)=>{
    const provider={auditRequest:tools.auditRequest,auditResponse:tools.auditResponse,requiredTool:tools.requiredTool,list:async input=>(await tools.list(input)).filter(t=>t.function.name===name),call:async(tool,args,input)=>{
      assert.equal(tool,name);
      if(name==='qzone_post') {
        assert.equal(args.content,content);assert.equal(args.ugc_right,64);
        if(receipt.post.attempted)throw new Error('Post already attempted; must not repeat');
        receipt.post={attempted:true,at:new Date().toISOString(),visibility:64};save();
      }
      const result=await tools.call(tool,args,input);
      if(result.isError)throw new Error('Actual tool failed: '+result.content?.map(c=>c.text||'').join(' ').slice(0,300));
      if(name==='qzone_post') {
        const data=JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join(''));
        receipt.post.tid=data.tid;save();
      }
      return result;
    }};
    const brain=new Brain({...cfg,role:new Role({cardPath:cfg.roleCard}),memory:new Memory({dir:path.join(root,'data/validation/repair2-memory')}),toolProvider:provider});
    return brain.reply({key:'private:'+cfg.ownerIds[0],userId:cfg.ownerIds[0],text,record:false});
  };
  if(!receipt.post.attempted) {
    const result=await model('qzone_post','请在自己的 QQ 空间发表一条仅自己可见的说说，正文必须逐字为：“'+content+'”。仅发布一次，不发其他内容。');
    receipt.post.modelRequestId=result.raw.id;save();
  }
  assert(receipt.post.tid,'Post attempt has no tid. Inspect QQ; never automatically resend.');
  const list=await api.call('get_qzone_msg_list',{num:10}),posted=list.msglist.find(p=>p.tid===receipt.post.tid);
  assert(posted&&posted.is_private&&posted.content===content,'Actual Qzone content or privacy readback differs');
  receipt.post.verified=true;save();console.log('PASS actual model -> MCP -> NapCat Qzone publish -> content/tid/private visibility readback.');
  if(!receipt.sticker.attempted) {
    const result=await model('send_sticker','请给我发一个开心的表情包，只发一张，作为本轮安装验收。');
    assert.equal(result.stickers.length,1);
    receipt.sticker={attempted:true,at:new Date().toISOString(),resourceId:result.stickers[0].id,modelRequestId:result.raw.id,destination:'configured-owner'};save();
    const transport={api:async(action,args)=>{try{return {ok:true,data:{data:await api.onebot(action,args)}};}catch(error){return {ok:false,error:error.message};}}};
    const sent=await OneBot.prototype.sendImage.call(transport,'private:'+cfg.ownerIds[0],result.stickers[0].file,{sticker:true});
    receipt.sticker.messageId=sent.data?.data?.message_id;save();
  }
  assert(receipt.sticker.messageId,'Sticker attempt uncertain, do not resend.');
  const back=await api.onebot('get_msg',{message_id:receipt.sticker.messageId});assert.equal(String(back.user_id),cfg.botQQ);assert(back.message.some(s=>s.type==='image'));
  receipt.sticker.verified=true;receipt.completedAt=new Date().toISOString();save();
  console.log('PASS actual model -> local sticker selection -> configured owner QQ delivery -> image segment readback.');
} finally {await tools.close();}
