import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runObservation,observationPassed,summarizeAuthEvents} from './qq-native-observe.mjs';

function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'qq-observer-'));
  t.after(()=>{assert.equal(path.dirname(directory),os.tmpdir());assert(path.basename(directory).startsWith('qq-observer-'));fs.rmSync(directory,{recursive:true,force:true});});
  const write=(relative,value)=>{const file=path.join(directory,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
  let time=Date.parse('2026-10-24T15:00:00Z');
  const heartbeat=()=>write('logs/onebot-health.json',{at:new Date(time).toISOString(),status:'ready',pid:9,private:'do-not-copy'});
  write('gateway/napcat/runtime-profile.json',{profile:'desktop-framework'});
  write('logs/gateway.pid','8');write('logs/service-health.json',{ready:true,companionPid:9,powerGuard:true});heartbeat();
  const output=[];
  const options={directory,minutes:1,now:()=>time,delay:async ms=>{time+=ms;heartbeat();},intervalMs:30000,
    inspect:async()=>({state:'online',needsLogin:false}),cfg:{apiKey:'EXAMPLE_a6bc050b3b68'},output:value=>output.push(JSON.parse(value))};
  return {directory,write,options,output,advance:ms=>{time+=ms;heartbeat();},now:()=>time};
}

test('a complete run follows the selected desktop profile and preserves the failed prior report verbatim',async t=>{
  const f=fixture(t),failed='{"status":"login-required","pass":false,"evidence":"previous-run"}\n';
  f.write('logs/qq-native-long-observation.json',failed);
  const report=await runObservation(f.options);
  assert.equal(report.expectedProfile,'desktop-framework');assert.equal(report.status,'complete');assert.equal(report.pass,true);
  assert.equal(report.elapsedSeconds,60);assert.equal(report.samples.length,3);
  assert.equal(fs.readFileSync(path.join(f.directory,'logs',report.previousReportBackup),'utf8'),failed);
  assert.equal(fs.existsSync(path.join(f.directory,'logs/qq-native-observation.pid')),false);
  const saved=fs.readFileSync(path.join(f.directory,'logs/qq-native-long-observation.json'),'utf8');
  assert(!saved.includes('test-secret'));assert(!saved.includes('do-not-copy'));
  assert.deepEqual(f.output,[{status:'complete',pass:true,elapsedSeconds:60,expectedProfile:'desktop-framework',ticketRefreshEvents:0,msfErrorEvents:0}]);
});

test('a change to the selected runtime ends the run as failed rather than mixing profiles',async t=>{
  const f=fixture(t),delay=f.options.delay;
  const report=await runObservation({...f.options,delay:async ms=>{await delay(ms);f.write('gateway/napcat/runtime-profile.json',{profile:'bundled'});}});
  assert.equal(report.status,'runtime-changed');assert.equal(report.pass,false);assert.equal(report.elapsedSeconds,30);
  assert.equal(report.expectedProfile,'desktop-framework');
});

test('confirmed login loss is preserved even if the local heartbeat file is missing',async t=>{
  const f=fixture(t);fs.unlinkSync(path.join(f.directory,'logs/onebot-health.json'));
  const report=await runObservation({...f.options,inspect:async()=>({state:'login-required',needsLogin:true})});
  assert.equal(report.status,'login-required');assert.equal(report.pass,false);assert.equal(report.loginRequiredObserved,true);
  assert.equal(report.elapsedSeconds,0);
});

test('gateway restarts and paused sampling invalidate a run even when QQ is online afterward',async t=>{
  const f=fixture(t),delay=f.options.delay;
  const restarted=await runObservation({...f.options,delay:async ms=>{await delay(ms);f.write('logs/gateway.pid','10');}});
  assert.equal(restarted.pass,false);assert.equal(restarted.samples.at(-1).gatewayProcessUnchanged,false);
  const paused=await runObservation({...f.options,delay:async()=>f.advance(61000)});
  assert.equal(paused.maxSamplingGapSeconds,61);assert.equal(paused.pass,false);
  assert.equal(fs.readFileSync(path.join(f.directory,'logs',paused.previousReportBackup),'utf8'),JSON.stringify(restarted,null,2)+'\n');
});

test('another active observer is rejected without overwriting its report',async t=>{
  const f=fixture(t),original='{"pass":false,"status":"observing"}';
  f.write('logs/qq-native-long-observation.json',original);f.write('logs/qq-native-observation.pid',String(process.pid));
  await assert.rejects(runObservation(f.options),/already running/);
  assert.equal(fs.readFileSync(path.join(f.directory,'logs/qq-native-long-observation.json'),'utf8'),original);
  assert.deepEqual(fs.readdirSync(path.join(f.directory,'logs')).filter(name=>name.includes('.before-')),[]);
});

test('auth summaries keep only this run, known events and result codes, never credential or identity fields',t=>{
  const f=fixture(t),file=path.join(f.directory,'logs/qq-auth-events.jsonl');
  assert.equal(summarizeAuthEvents(file,f.now()).available,false);
  f.write('logs/qq-auth-events.jsonl',[
    JSON.stringify({at:new Date(f.now()-1).toISOString(),event:'ticket-refresh',code:0}),
    'null','malformed partial line',
    JSON.stringify({at:new Date(f.now()).toISOString(),event:'unknown',code:0}),
    JSON.stringify({at:new Date(f.now()).toISOString(),event:'ticket-refresh',result:{errCode:140022008,a2:'secret-ticket'},uin:'private-id',d2:'another-ticket'}),
    JSON.stringify({at:new Date(f.now()).toISOString(),event:'msf-error',code:-1001,description:'private-text'})
  ].join('\n'));
  const summary=summarizeAuthEvents(file,f.now());
  assert.equal(summary.available,true);assert.equal(summary.ticketRefreshEvents,1);assert.equal(summary.msfErrorEvents,1);
  assert.deepEqual(summary.results.map(row=>({event:row.event,...(row.result?{result:row.result}:{code:row.code})})),[
    {event:'ticket-refresh',result:{errCode:140022008}},{event:'msf-error',code:-1001}]);
  assert(!JSON.stringify(summary).match(/secret-ticket|private-|another-ticket|description|uin|d2/));
});

test('a 130 minute report cannot pass based on a short successful restoration',()=>{
  const sample={gateway:'online',ready:true,nativeProfile:'desktop-framework',gatewayProcessUnchanged:true,heartbeatAgeSeconds:0};
  const report={plannedMinutes:130,elapsedSeconds:120,loginRequiredObserved:false,expectedProfile:'desktop-framework',samples:[sample,sample],maxSamplingGapSeconds:15};
  assert.equal(observationPassed(report),false);report.elapsedSeconds=7800;assert.equal(observationPassed(report),true);
  report.samples[1]={...sample,heartbeatAgeSeconds:NaN};assert.equal(observationPassed(report),false);
});
