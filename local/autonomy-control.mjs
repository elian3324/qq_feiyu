import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {saveJson} from './autonomy.mjs';
const file=fileURLToPath(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url));
const cfg=JSON.parse(fs.readFileSync(file,'utf8')),action=process.argv[2]||'status';
const o=cfg.autonomy;
if(!o)throw new Error('Autonomy configuration missing');
if(action==='pause')o.paused=true;
else if(action==='resume')o.paused=false;
else if(action==='off'){o.chat.enabled=false;o.qzone.enabled=false;}
else if(action==='dry-run')o.dryRun=true;
else if(action==='live')o.dryRun=false;
else if(action!=='status')throw new Error('Use status / pause / resume / off / dry-run / live');
if(action!=='status')saveJson(file,cfg);
console.log(JSON.stringify({timezone:o.timezone,paused:o.paused,dryRun:o.dryRun,chat:o.chat,qzone:o.qzone},null,2));
console.log('Running scheduler reloads these switches within 60 seconds. Resume does not enable disabled channels.');
