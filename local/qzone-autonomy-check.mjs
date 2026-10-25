// Actual local persona/memory + read-only Qzone + Mock AI + enforced Dry Run.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {QzoneAdapter} from './qzone-adapter.mjs';
import {QzoneAutonomy} from './qzone-autonomy.mjs';
import {localTime} from './autonomy-utils.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
const validation={...cfg,autonomy:{...cfg.autonomy,dryRun:true,paused:false,qzone:{...cfg.autonomy.qzone,
  enabled:true,publishEnabled:true,readOwnerEnabled:true,commentEnabled:true,replyEnabled:true,likeEnabled:true}}};
const day=localTime(Date.now(),cfg.autonomy.timezone).day,clock=Date.parse(day+'T12:00:00+08:00');
const adapter=new QzoneAdapter(validation),call=adapter.call.bind(adapter);let writes=0,modelCalls=0;
adapter.call=async(action,args)=>{if(!action.startsWith('get_')){writes++;throw new Error('Dry Run blocked mutation');}return call(action,args);};
const a=new QzoneAutonomy({cfg:validation,bot:{connected:true},qzone:adapter,now:()=>clock,
  memory:new Memory({dir:cfg.dataDir,ownerIds:cfg.ownerIds}),role:new Role({cardPath:cfg.roleCard}),
  stateFile:path.join(root,'data/validation/qzone-autonomy-'+Date.now()+'.json'),request:async(system,data)=>{
    modelCalls++;
    if(system.includes('角色内心分析'))return {mood:'curious',intensity:0.4,closeness:0.8,novelty:0.5};
    if(system.includes('发布前隐私核验器'))return {safe:true,containsPrivateFact:false,containsIdentifyingInfo:false,grounded:true};
    assert(!('privateData' in data));assert(!('recentPrivateConversation' in data));
    return {action:'post',text:'想给虚拟小猫的白日梦系一个蝴蝶结。'};
  }});
const result=await a.tick();assert.equal(result.dryRun,true);assert.equal(writes,0);assert.equal(a.state.attempts.length,0);
assert.equal(a.state.lastPoll.ok,true);assert(fs.existsSync(a.file+'.preview.json'));
const report={at:new Date().toISOString(),mode:'real local persona/memory + read-only live Qzone + Mock AI + Dry Run',
  ok:true,modelCalls,realModelCalls:0,actualWrites:writes,readSources:Object.keys(a.state.sources).length,
  draftGenerated:true,rawPrivateDataInPublicDecision:false,baselineEvents:a.state.events.length};
fs.writeFileSync(path.join(root,'logs/qzone-autonomy-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
