// Explicit maintenance: recover only owner-authenticated structured history.
// No QQ sends, no raw facts or owner IDs in the console/report.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {OwnerMemory} from '../ai-companion-kit/packages/companion/src/owner-memory.js';
import {OwnerMemoryWorker} from '../ai-companion-kit/packages/companion/src/owner-memory-worker.js';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
if(!process.argv.includes('--live'))throw new Error('Pass --live: calls configured model to recover real owner history; no QQ sends');
const cfg=loadConfig(),ledger=new OwnerMemory({dir:cfg.dataDir,ownerIds:cfg.ownerIds});
const worker=new OwnerMemoryWorker({ledger,apiKey:cfg.apiKey,baseUrl:cfg.baseUrl,model:cfg.model,modelOptions:cfg.modelOptions,timeoutMs:30000});
const added=worker.backfill();console.log(JSON.stringify({stage:'queued',added,pending:worker.read().pending.length}));
let rounds=0;
while(worker.read().pending.length&&rounds++<500){const before=worker.read().pending.length;await worker.flush({force:true});const after=worker.read().pending.length;console.log(JSON.stringify({stage:'progress',rounds,pending:after}));if(after>=before)break;}
const health=JSON.parse(fs.readFileSync(worker.healthFile,'utf8')),result={at:new Date().toISOString(),ok:health.pending===0,facts:health.facts,pending:health.pending,processed:health.processed,rounds,qqMessagesSent:0};
fs.writeFileSync(path.join(ROOT,'logs/owner-memory-recovery.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
