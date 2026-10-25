import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
const cfg=loadConfig(fileURLToPath(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url)));
const bytes=fs.readFileSync(new URL('./fixtures/meme-test.gif',import.meta.url));
const response=await fetch(cfg.baseUrl+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+cfg.apiKey},body:JSON.stringify({...cfg.modelOptions,model:cfg.model,stream:false,max_tokens:250,messages:[{role:'user',content:[{type:'text',text:'请按时间顺序说出这个动图每一帧的文字。只能报告你实际看见的，若只看见一帧请明确说明。'},{type:'image_url',image_url:{url:'data:image/gif;base64,'+bytes.toString('base64')}}]}]}),signal:AbortSignal.timeout(90000)});
const result=await response.json(),text=result.choices?.[0]?.message?.content||'';
const receipt={at:new Date().toISOString(),status:response.status,model:result.model,requestId:result.id,usage:result.usage,output:text,errorCode:result.error?.code,allFramesObserved:['看到消息','笑出声','哈哈哈'].every(t=>text.includes(t))};
fs.writeFileSync(new URL('../logs/native-vision/raw-gif-probe.json',import.meta.url),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
