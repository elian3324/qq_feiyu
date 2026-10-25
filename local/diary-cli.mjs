import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../ai-companion-kit/packages/companion/src/index.js';
import { DiaryWriter } from '../ai-companion-kit/packages/companion/src/diary-service.js';
const cfg=loadConfig();
const action=process.argv[2]||'list';
if(action==='list'){
  const file=path.join(cfg.diaryDir,'index.jsonl');
  if(!fs.existsSync(file))console.log('尚无本地日记。');
  else for(const line of fs.readFileSync(file,'utf8').trim().split('\n').slice(-7)){
    try{const row=JSON.parse(line);console.log([row.day,row.time,row.title,row.mood].filter(Boolean).join(' ')+'\n'+row.text+'\n');}catch{}
  }
}else if(action==='write'){
  if(!cfg.apiKey)throw new Error('请先配置自己的模型凭据。');
  const result=await new DiaryWriter({cfg}).write();
  console.log(result.status);
  if(result.entry)console.log(result.entry.text);
}else throw new Error('Use list or write');
