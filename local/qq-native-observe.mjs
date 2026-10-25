// Finite read-only observation. No QQ sends, model requests, logins or restarts.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {GatewayHealth} from './gateway-health.mjs';
const {safeResult}=createRequire(import.meta.url)('./qq-auth-audit.cjs');
const root=fileURLToPath(new URL('../',import.meta.url));
const profiles=new Set(['bundled','qq-9.9.35-52892','desktop-framework']);
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

export function summarizeAuthEvents(file,started) {
  const summary={available:false,ticketRefreshEvents:0,msfErrorEvents:0,results:[]};
  let text;
  try{text=fs.readFileSync(file,'utf8');summary.available=true;}catch{return summary;}
  for(const line of text.split(/\r?\n/)) {
    let row;try{row=JSON.parse(line);}catch{continue;}
    if(!row||typeof row!=='object')continue;
    const at=Date.parse(row.at);
    if(!Number.isFinite(at)||at<started||!['ticket-refresh','msf-error'].includes(row.event))continue;
    if(row.event==='ticket-refresh')summary.ticketRefreshEvents++;else summary.msfErrorEvents++;
    // Native ticket objects, text descriptions and identities never enter the report.
    summary.results.push({at:new Date(at).toISOString(),event:row.event,...safeResult(row)});
    if(summary.results.length>8)summary.results.shift();
  }
  return summary;
}

export function observationPassed(report) {
  return report.elapsedSeconds>=report.plannedMinutes*60&&!report.loginRequiredObserved&&report.samples.length>1&&
    report.samples.every(sample=>sample.gateway==='online'&&sample.ready&&sample.nativeProfile===report.expectedProfile&&
      sample.gatewayProcessUnchanged===true&&Number.isFinite(sample.heartbeatAgeSeconds)&&sample.heartbeatAgeSeconds>=-5&&sample.heartbeatAgeSeconds<90)&&
    report.maxSamplingGapSeconds<=45;
}

export async function runObservation({directory=root,minutes=130,now=Date.now,delay=wait,intervalMs=15000,inspect,cfg,output=console.log}={}) {
  if(!Number.isFinite(minutes)||minutes<1||minutes>240)throw new Error('Observation duration must be 1 to 240 minutes');
  const read=relative=>JSON.parse(fs.readFileSync(path.join(directory,relative),'utf8'));
  const selectedProfile=()=>{
    const selector=path.join(directory,'gateway/napcat/runtime-profile.json');
    const value=fs.existsSync(selector)?read('gateway/napcat/runtime-profile.json').profile:'bundled';
    if(!profiles.has(value))throw new Error('Observation runtime profile is invalid');
    return value;
  };
  const expectedProfile=selectedProfile(),started=now(),duration=minutes*60000;
  const file=path.join(directory,'logs/qq-native-long-observation.json');
  const pidFile=path.join(directory,'logs/qq-native-observation.pid');
  const gatewayPid=()=>fs.readFileSync(path.join(directory,'logs/gateway.pid'),'utf8').trim();
  const initialGateway=gatewayPid();
  if(fs.existsSync(pidFile)) {
    const pid=Number(fs.readFileSync(pidFile,'utf8').trim());
    if(Number.isInteger(pid)&&pid>0) {
      try{process.kill(pid,0);throw new Error('An observation is already running');}
      catch(error){if(error.code!=='ESRCH')throw error;}
    }
    fs.unlinkSync(pidFile);
  }
  const config=cfg??read('ai-companion-kit/packages/companion/config.json'),health=new GatewayHealth();
  const probe=inspect??(value=>health.inspect(value));
  const report={startedAt:new Date(started).toISOString(),plannedMinutes:minutes,expectedProfile,status:'observing',pass:null,
    // This observes the selected launch profile, not proof of the server's reason for rejecting a ticket.
    testMessagesSent:0,testModelRequests:0,loginRequiredObserved:false,maxSamplingGapSeconds:0,samples:[]};
  const save=()=>{const temp=file+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify(report,null,2)+'\n');fs.renameSync(temp,file);};
  const cleanup=()=>{try{if(fs.readFileSync(pidFile,'utf8').trim()===String(process.pid))fs.unlinkSync(pidFile);}catch{}};
  fs.writeFileSync(pidFile,String(process.pid),{flag:'wx'});process.once('exit',cleanup);
  try {
    if(fs.existsSync(file)) {
      const name='qq-native-long-observation.before-'+new Date(started).toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.json';
      fs.copyFileSync(file,path.join(directory,'logs',name),fs.constants.COPYFILE_EXCL);
      report.previousReportBackup=name;
    }
    for(;;) {
      const time=now(),previous=report.samples.at(-1);
      if(previous)report.maxSamplingGapSeconds=Math.max(report.maxSamplingGapSeconds,Math.round((time-Date.parse(previous.at))/1000));
      let sample;
      try {
        const real=await probe(config);
        if(real.needsLogin)report.loginRequiredObserved=true;
        const service=read('logs/service-health.json'),ws=read('logs/onebot-health.json');
        sample={at:new Date(time).toISOString(),gateway:real.state,ready:service.ready===true&&ws.status==='ready'&&ws.pid===service.companionPid,
          nativeProfile:selectedProfile(),heartbeatAgeSeconds:Math.round((now()-Date.parse(ws.at))/1000),
          gatewayProcessUnchanged:gatewayPid()===initialGateway,powerGuard:service.powerGuard===true};
      }catch{sample={at:new Date(time).toISOString(),gateway:'observation-error',ready:false};}
      report.samples.push(sample);report.lastCheckedAt=new Date(now()).toISOString();report.elapsedSeconds=Math.floor((now()-started)/1000);
      report.auth=summarizeAuthEvents(path.join(directory,'logs/qq-auth-events.jsonl'),started);
      const changed=sample.nativeProfile&&sample.nativeProfile!==expectedProfile;
      const ended=now()-started>=duration||report.loginRequiredObserved||changed;
      if(ended) {
        report.finishedAt=new Date(now()).toISOString();
        report.status=report.loginRequiredObserved?'login-required':changed?'runtime-changed':'complete';
        report.pass=observationPassed(report);
      }
      save();
      if(ended) {
        output(JSON.stringify({status:report.status,pass:report.pass,elapsedSeconds:report.elapsedSeconds,expectedProfile,
          ticketRefreshEvents:report.auth.ticketRefreshEvents,msfErrorEvents:report.auth.msfErrorEvents}));
        return report;
      }
      await delay(intervalMs);
    }
  }finally{cleanup();process.removeListener('exit',cleanup);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runObservation({minutes:Number(process.argv[2]||130)});
