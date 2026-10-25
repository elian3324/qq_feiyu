import fs from 'node:fs';
import { QzoneAdapter } from './qzone-adapter.mjs';
const cfg=JSON.parse(fs.readFileSync(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url),'utf8'));
const q=new QzoneAdapter(cfg);
const receipt=new URL('../logs/qzone-post-check.json',import.meta.url);
if(!process.argv.includes('--publish-private-once')) {console.log('Prepared private test post; no post published.');process.exit(0);}
if(fs.existsSync(receipt)) {console.log('Test post receipt already exists. No repeat publish.');process.exit(0);}
const result=await q.call('send_qzone_msg',{content:'手机与QQ空间接入测试，连接正常。',ugc_right:64});
fs.writeFileSync(receipt,JSON.stringify({tid:result.tid,visibility:64,publishedAt:new Date().toISOString(),verified:false},null,2));
const list=await q.call('get_qzone_msg_list',{num:5});
const found=list.msglist.find(p=>p.tid===result.tid);
if(!found || !found.is_private) throw new Error('Published, but privacy read-back is incomplete. Do not publish a duplicate.');
fs.writeFileSync(receipt,JSON.stringify({tid:result.tid,visibility:64,publishedAt:new Date().toISOString(),verified:true},null,2));
console.log('PASS: one private test post published; tid and private visibility verified by reading the bot space.');
