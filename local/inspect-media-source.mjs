import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {QzoneAdapter} from './qzone-adapter.mjs';
const cfg=loadConfig(fileURLToPath(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url)));
const api=new QzoneAdapter(cfg),cases=[];
for(const [kind,id] of [['private',cfg.ownerIds[0]],...(cfg.allow?.groups||[]).map(id=>['group',id])]) {
  try {
    const history=await api.onebot(kind==='private'?'get_friend_msg_history':'get_group_msg_history',{[kind==='private'?'user_id':'group_id']:String(id),count:30});
    for(const message of history.messages||[]) {
      if(String(message.user_id)===cfg.botQQ||!Array.isArray(message.message)||!message.message.some(s=>['image','mface'].includes(s.type)))continue;
      cases.push({...message,post_type:'message',message_type:kind,self_id:Number(cfg.botQQ),...(kind==='group'?{group_id:Number(id)}:{}),message:message.message.filter(s=>['image','mface','face'].includes(s.type))});
    }
    console.log(JSON.stringify({scope:kind,mediaMessages:cases.filter(c=>c.message_type===kind).length}));
  }catch(error){console.log(JSON.stringify({scope:kind,historyAvailable:false}));}
}
fs.mkdirSync(new URL('../data/validation/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../data/validation/real-qq-media.json',import.meta.url),JSON.stringify(cases));
console.log('Metadata kept locally; no private text printed or forwarded.');
