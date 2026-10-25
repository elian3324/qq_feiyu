// Explicit display-off acceptance test: never sends QQ messages or changes power settings.
import fs from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
if(!process.argv.includes('--live-display'))throw new Error('--live-display required: the display turns off for 90 seconds');
const root=fileURLToPath(new URL('../',import.meta.url));
const cfg=loadConfig(root+'ai-companion-kit/packages/companion/config.json');
const button=()=>execFileSync('powercfg.exe',['/qh','SCHEME_CURRENT','SUB_BUTTONS','PBUTTONACTION'],{encoding:'utf8',windowsHide:true});
const baseline=button(),sleepBaseline=execFileSync('powercfg.exe',['/query','SCHEME_CURRENT','SUB_SLEEP','STANDBYIDLE'],{encoding:'utf8',windowsHide:true}),displayBaseline=execFileSync('powercfg.exe',['/query','SCHEME_CURRENT','SUB_VIDEO','VIDEOIDLE'],{encoding:'utf8',windowsHide:true}),samples=[];let output='',finished=false,exitCode=null;
const started=Date.now();
const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',root+'local/screen-off.ps1','-TestSeconds','90','-Quiet'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('exit',code=>{exitCode=code;finished=true;});
let last=Date.now(),gapMax=0;
while(!finished&&Date.now()-started<180000){
 await new Promise(r=>setTimeout(r,5000));const now=Date.now();gapMax=Math.max(gapMax,now-last);last=now;
 let screen,service,ws;
 try{screen=JSON.parse(fs.readFileSync(root+'logs/screen-off-health.json'));service=JSON.parse(fs.readFileSync(root+'logs/service-health.json'));ws=JSON.parse(fs.readFileSync(root+'logs/onebot-health.json'));}catch{}
 let online=false;
 try{const r=await fetch(cfg.onebot.httpUrl+'/get_status',{method:'POST',headers:{authorization:'Bearer '+cfg.onebot.accessToken,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(4000)});const j=await r.json();online=r.ok&&j.status==='ok'&&j.data?.online===true;}catch{}
 const item={second:Math.round((now-started)/1000),displayState:screen?.displayState,screenOffSeen:screen?.displayOffEvents>0,helperActive:screen?.active,qqOnline:online,serviceReady:service?.ready,wsReady:ws?.status==='ready',wsAgeSeconds:Math.round((now-Date.parse(ws?.at))/1000)};
 samples.push(item);console.log(JSON.stringify(item));
}
let final;try{final=JSON.parse(fs.readFileSync(root+'logs/screen-off-health.json'));}catch{}
const offSamples=samples.filter(s=>s.helperActive&&s.screenOffSeen&&s.displayState===0);
const result={at:new Date().toISOString(),scope:'Actual physical display off; live OneBot HTTP status and main-process WS heartbeat, no outgoing QQ messages.',exitCode,durationSeconds:Math.round((Date.now()-started)/1000),maxProbeGapSeconds:gapMax/1000,offSamples:offSamples.length,samples,powerButtonUnchanged:button()===baseline,sleepTimerUnchanged:execFileSync('powercfg.exe',['/query','SCHEME_CURRENT','SUB_SLEEP','STANDBYIDLE'],{encoding:'utf8',windowsHide:true})===sleepBaseline,displayTimerRestored:execFileSync('powercfg.exe',['/query','SCHEME_CURRENT','SUB_VIDEO','VIDEOIDLE'],{encoding:'utf8',windowsHide:true})===displayBaseline,final,errors:output.trim()};
result.passed=exitCode===0&&final?.reason==='test-complete'&&final?.displayOffEvents>0&&offSamples.length>=15&&offSamples.every(s=>s.qqOnline&&s.serviceReady&&s.wsReady&&s.wsAgeSeconds<35)&&gapMax<15000&&result.powerButtonUnchanged&&result.sleepTimerUnchanged&&result.displayTimerRestored;
fs.writeFileSync(root+'logs/screen-off-live-check.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:result.passed,exitCode,offSamples:result.offSamples,durationSeconds:result.durationSeconds,powerButtonUnchanged:result.powerButtonUnchanged,finalReason:final?.reason,errors:result.errors}));
if(!finished)child.kill();if(!result.passed)process.exitCode=1;
