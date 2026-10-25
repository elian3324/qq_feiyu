import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {saveJson} from './autonomy.mjs';
import {GatewayHealth,ConnectionWatchdog} from './gateway-health.mjs';
import {applyEnvironment} from '../ai-companion-kit/packages/companion/src/config-env.js';
const root=fileURLToPath(new URL('../',import.meta.url)),configAt=process.argv.indexOf('--config');
const configFile=configAt>=0?process.argv[configAt+1]:path.join(root,'ai-companion-kit/packages/companion/config.json');
const pidFile=path.join(root,'logs/service.pid'),healthFile=path.join(root,'logs/service-health.json'),wsFile=path.join(root,'logs/onebot-health.json');
fs.mkdirSync(path.join(root,'logs'),{recursive:true});
const markerFile=path.join(root,'logs/supervisor-instance.json');
fs.writeFileSync(markerFile,JSON.stringify({pid:process.pid,root:path.resolve(root),entry:fileURLToPath(import.meta.url),startedAtMs:Math.round(Date.now()-process.uptime()*1000)}));
process.on('exit',()=>{try{if(JSON.parse(fs.readFileSync(markerFile,'utf8')).pid===process.pid)fs.unlinkSync(markerFile);}catch{}});
fs.writeFileSync(pidFile,String(process.pid));
let child=null,stopping=false,busy=false,lastRecovery=0,nextStart=0,failures=0,lastState='';
const gatewayHealth=new GatewayHealth();
const connectionWatchdog=new ConnectionWatchdog();
let powerGuard=null,powerGuardReady=false,lastGatewayState='';
function startPowerGuard(){
  if(process.platform!=='win32')return;
  powerGuard=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'local/keep-awake.ps1')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','ignore']});
  powerGuard.stdout.on('data',chunk=>{if(String(chunk).includes('ready')){powerGuardReady=true;console.log('[power] 已防止运行期间自动睡眠，屏幕仍可关闭');}});
  powerGuard.on('error',()=>{powerGuardReady=false;console.error('[power] 防自动睡眠未启用');});
  powerGuard.on('exit',()=>{powerGuardReady=false;if(!stopping)console.error('[power] 防自动睡眠进程已退出');});
}
function logState(state) {if(state!==lastState){console.log('[service] '+state);lastState=state;}}
function terminateCompanion(){
  if(child?.exitCode!==null)return;
  try{if(process.platform==='win32')execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}catch{}
}
function launchCompanion() {
  child=spawn(process.execPath,[path.join(root,'local/run.mjs'),'--release-root='+path.resolve(root),'--config',configFile,...(process.argv.includes('--dry-run')?['--dry-run']:[])],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,COMPANION_HEALTH_FILE:wsFile}});
  const current=child;current.stdout.on('data',chunk=>process.stdout.write(chunk));current.stderr.on('data',chunk=>process.stderr.write(chunk));
  current.on('exit',code=>{if(child===current)child=null;if(!stopping){failures++;nextStart=Date.now()+Math.min(60000,3000*2**Math.min(failures,4));console.error('[service] 聊天进程退出，将在冷却后重新启动，退出码 '+code);}});
  current.on('error',()=>console.error('[service] 聊天进程无法启动，请检查专用 Node 和文件路径'));
}
async function recoverGateway() {
  lastRecovery=Date.now();
  await new Promise(resolve=>{
    const helper=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'local/gateway.ps1'),'-EnsureRunningOnly'],{cwd:root,windowsHide:true,stdio:'ignore'});
    const timer=setTimeout(()=>{helper.kill();resolve();},20000);
    const done=()=>{clearTimeout(timer);resolve();};helper.on('error',done);helper.on('exit',done);
  });
}
async function tick() {
  if(busy||stopping)return;busy=true;
  try {
    const cfg=applyEnvironment(JSON.parse(fs.readFileSync(configFile,'utf8')));
    const snapshot=await gatewayHealth.inspect(cfg),gateway=snapshot.state;
    if(gateway!==lastGatewayState){
      try{fs.appendFileSync(path.join(root,'logs/connection-events.jsonl'),JSON.stringify({at:new Date().toISOString(),event:'gateway-state',from:lastGatewayState,to:gateway,phase:snapshot.loginPhase||''})+'\n');}catch{}
      lastGatewayState=gateway;
    }
    if(gateway==='online') {
      if(!child&&Date.now()>=nextStart)launchCompanion();
      let ws;try{ws=JSON.parse(fs.readFileSync(wsFile,'utf8'));}catch{}
      const ready=child&&ws?.pid===child.pid&&ws.status==='ready'&&Date.now()-Date.parse(ws.at)<90000;
      if(connectionWatchdog.shouldRestart({online:true,hasChild:!!child,ready:!!ready})){
        console.error('[service] 聊天连接持续未恢复，仅重启聊天进程，保留 QQ 登录');
        try{fs.appendFileSync(path.join(root,'logs/connection-events.jsonl'),JSON.stringify({at:new Date().toISOString(),event:'companion-watchdog-restart'})+'\n');}catch{}
        terminateCompanion();
      }
      if(ready)failures=0;
      logState(ready?'QQ 与聊天服务在线': 'QQ 已登录，等待聊天进程连接');
      saveJson(healthFile,{at:new Date().toISOString(),servicePid:process.pid,companionPid:child?.pid||null,gateway,onebot:ready?'ready':'connecting',ready:!!ready,powerGuard:powerGuardReady});
    }else {
      connectionWatchdog.shouldRestart({online:false,hasChild:!!child,ready:false});
      const recovery=await gatewayHealth.recoverLogin(cfg,snapshot);
      logState(gateway==='wrong-account'?'QQ 登录账号不匹配，已停止自动登录':gateway==='auth-error'?'OneBot 鉴权失败，请检查配置':recovery.action==='scan-required'?'QQ 登录凭证失效，需要机器人账号扫码；已暂停重复登录':recovery.action==='quick-login-requested'?'已请求现有机器人账号快速登录，等待 QQ 恢复':'QQ 正在恢复连接，聊天暂未就绪');
      saveJson(healthFile,{at:new Date().toISOString(),servicePid:process.pid,companionPid:child?.pid||null,gateway,onebot:'offline',ready:false,loginRequired:snapshot.needsLogin,recovery:recovery.action,powerGuard:powerGuardReady});
      // A running QQ process awaiting login is not a dead gateway. Do not restart it.
      if(gateway==='gateway-down'&&Date.now()-lastRecovery>60000)await recoverGateway();
    }
  }catch {logState('配置或健康检查异常，服务未标记为就绪');}
  finally {busy=false;}
}
function stop() {
  if(stopping)return;stopping=true;clearInterval(timer);
  powerGuard?.stdin?.end();
  terminateCompanion();
  try{saveJson(healthFile,{at:new Date().toISOString(),ready:false,status:'stopped'});}catch{}
  try{if(fs.readFileSync(pidFile,'utf8').trim()===String(process.pid))fs.unlinkSync(pidFile);}catch{}
  process.exit(0);
}
const timer=setInterval(()=>tick(),10000);process.on('SIGINT',stop);process.on('SIGTERM',stop);
process.on('exit',()=>{try{if(fs.readFileSync(pidFile,'utf8').trim()===String(process.pid))fs.unlinkSync(pidFile);}catch{}});
startPowerGuard();await tick();
