import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
fs.mkdirSync(path.join(root,'logs'),{recursive:true});
const marker=path.join(root,'logs/bridge-instance.json');
if(fs.existsSync(marker)){
  const old=JSON.parse(fs.readFileSync(marker,'utf8'));
  if(!Number.isInteger(old.pid)||old.pid<1)throw new Error('Invalid bridge instance marker');
  try{process.kill(old.pid,0);throw new Error('Bridge instance already exists');}catch(error){if(error.code!=='ESRCH')throw error;}
}
fs.writeFileSync(marker,JSON.stringify({pid:process.pid,root,entry:fileURLToPath(import.meta.url),startedAtMs:Math.round(Date.now()-process.uptime()*1000)}));
process.on('exit',()=>{try{if(JSON.parse(fs.readFileSync(marker,'utf8')).pid===process.pid)fs.unlinkSync(marker);}catch{}});
await import('./bridge.js');
