// Read-only live probe. Never prints cookies, IDs, post text or comments.
import fs from 'node:fs';
import {QzoneAdapter} from './qzone-adapter.mjs';
const cfg=JSON.parse(fs.readFileSync(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url),'utf8'));
const api=new QzoneAdapter(cfg),report={at:new Date().toISOString(),readOnly:true};
for(const [label,target] of [['self',cfg.botQQ],...cfg.ownerIds.map((id,i)=>['owner'+i,id])]) {
  try {
    const list=await api.call('get_qzone_msg_list',{target_uin:String(target),num:5});
    report[label]={list:true,count:list.msglist.length,images:list.msglist.reduce((n,p)=>n+p.images.length,0)};
    if(list.msglist.length){const d=await api.call('get_qzone_msg_detail',{target_uin:String(target),tid:list.msglist[0].tid});report[label].detail=true;report[label].comments=d.comments.length;}
  }catch{report[label]={...(report[label]||{}),error:'read-unavailable'};}
}
try{const f=await api.call('get_qzone_feeds',{count:5});report.feeds={read:true,count:f.feeds.length};}catch{report.feeds={error:'read-unavailable'};}
fs.mkdirSync(new URL('../logs/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../logs/qzone-capabilities.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
