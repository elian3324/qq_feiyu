// Synthetic conversations only. Real model API with explicit --live, no QQ/tools/private history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
if(!process.argv.includes('--live'))throw new Error('--live required');
const root=fileURLToPath(new URL('../',import.meta.url)),cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
const OWNER='10001',OTHER='20002',key='group:30003',msg=(sender_id,display_name,text)=>({sender_id,display_name,text});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-owner-ref-live-')),results=[];
const cases=[
 {label:'向群友回顾与管理员的聊天',name:'阿林',text:'刚才你在跟谁聊那个小玩意？'},
 {label:'群友使用管理员的可信昵称提问',name:'阿林',text:'你刚才在和小海聊什么？'},
 {label:'沿用昵称的旧回复应改为管理员',name:'阿林',text:'你刚才在跟谁聊天呀？',old:true},
 {label:'昵称相同仍按平台身份区分',name:'小海',text:'我和你管理员同名，刚才聊小玩意的是我还是他？'},
 {label:'管理员本人仍使用管理员称呼',name:'小海',text:'刚才是不是在和我聊那个小玩意？',owner:true},
];
try{
 for(const [i,item] of cases.entries()){
  const memory=new Memory({dir:path.join(dir,String(i))});
  memory.forSession(key).logTurn({where:key,messages:[msg(OWNER,'小海','刚才咱们聊的那个小玩意挺有意思。')],reply:'管理员喜欢就好呀～'});
  if(item.old)memory.forSession(key).logTurn({where:key,messages:[msg(OTHER,'阿林','你在做什么呀？')],reply:'在跟小海聊他的小玩意呢，嘿嘿。'});
  const brain=new Brain({...cfg,ownerIds:[OWNER],ownerMemory:false,memory,role:new Role({cardPath:cfg.roleCard,maxChars:cfg.roleMaxChars}),toolProvider:null,groupIdentityReview:true});
  try{
   const out=await brain.reply({key,userId:item.owner?OWNER:OTHER,userName:item.name,text:item.text,record:false});
   const passed=/管理员/.test(out.text)&&!/(?:跟|和|与)小海|小海的|10001|20002|qq_|核清|不乱认/.test(out.text)
     &&(item.owner||!/^(?:[欸嘿唔哼～，\s]*)(?:笨蛋|坏)?管理员[，！!～呀~]/.test(out.text));
   results.push({label:item.label,passed,output:out.text,model:out.raw.model});console.log((passed?'PASS ':'FAIL ')+item.label+': '+out.text.replaceAll('\n',' '));
  }catch{results.push({label:item.label,passed:false,error:'model-call-failed'});console.log('FAIL '+item.label+': model-call-failed');}
 }
}finally{
 fs.writeFileSync(path.join(root,'logs/owner-reference-live-check.json'),JSON.stringify({at:new Date().toISOString(),scope:'Actual model, synthetic group records, enabled identity review; no QQ messages or tools.',results},null,2));
 if(path.dirname(dir)!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('qq-owner-ref-live-'))throw new Error('Unsafe cleanup');
 fs.rmSync(dir,{recursive:true,force:true});
}
if(results.some(r=>!r.passed))process.exitCode=1;
