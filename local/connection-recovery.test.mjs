import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from '../ai-companion-kit/node_modules/ws/wrapper.mjs';
import { GatewayHealth,ConnectionWatchdog } from './gateway-health.mjs';
import { OneBot } from '../ai-companion-kit/packages/companion/src/transport-onebot.js';

const cfg={botQQ:'90009',onebot:{httpUrl:'http://mock-onebot',accessToken:'EXAMPLE_4848eeb51465'}};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){const end=Date.now()+3000;while(Date.now()<end){if(check())return;await pause(10);}throw new Error('Timeout: '+label);}
function fixture({online=false,wrong=false,phase='waiting_qrcode',quick={code:0},down=false,auth=false,clock=20000}={}){
  const calls=[],state={online,wrong,phase,quick,down,auth,time:clock};
  const fetch=async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body||'{}')});
    if(state.down)throw new Error('offline');
    if(url.startsWith(cfg.onebot.httpUrl)){
      if(state.auth)return new Response('',{status:401});
      if(url.endsWith('/get_login_info'))return Response.json({status:'ok',data:{user_id:state.wrong?'80008':cfg.botQQ}});
      return Response.json({status:'ok',data:{online:state.online}});
    }
    if(url.endsWith('/api/local-session'))return Response.json({code:0,data:{Credential:'mock-webui-secret'}});
    if(url.endsWith('/CheckLoginStatus'))return Response.json({code:0,data:{isLogin:state.phase==='ready',coreReady:state.phase==='ready',loginPhase:state.phase,qrcodeurl:'MOCK_QR_SECRET',loginError:'MOCK_RAW_ERROR'}});
    if(url.endsWith('/SetQuickLogin'))return Response.json(state.quick);
    throw new Error('Unexpected request');
  };
  const monitor=new GatewayHealth({fetch,now:()=>state.time,loginGraceMs:0});
  return {monitor,calls,state,quickCalls:()=>calls.filter(call=>call.url.endsWith('/SetQuickLogin'))};
}

test('health needs actual QQ online status, not just cached account information',async()=>{
  const {monitor,state}=fixture({online:true});assert.equal((await monitor.inspect(cfg)).state,'online');
  state.online=false;assert.equal((await monitor.inspect(cfg)).state,'login-required');
});
test('wrong account and bad OneBot credentials never initiate another login',async()=>{
  for(const settings of [{wrong:true},{auth:true}]){
    const f=fixture(settings),health=await f.monitor.inspect(cfg);
    assert.equal(health.state,settings.wrong?'wrong-account':'auth-error');
    assert.equal((await f.monitor.recoverLogin(cfg,health)).action,'none');assert.equal(f.calls.length,2);
  }
});
test('a running gateway awaiting QR is classified separately from a dead gateway',async()=>{
  const f=fixture(),health=await f.monitor.inspect(cfg);assert.equal(health.state,'login-required');assert.equal(health.needsLogin,true);
  const dead=fixture({down:true});assert.equal((await dead.monitor.inspect(cfg)).state,'gateway-down');
});
test('QQ online but transport unavailable does not trigger QQ login or process restart',async()=>{
  const f=fixture({phase:'ready'}),health=await f.monitor.inspect(cfg);
  assert.equal(health.state,'transport-offline');assert.equal((await f.monitor.recoverLogin(cfg,health)).action,'none');assert.equal(f.quickCalls().length,0);
});
test('initial grace period avoids racing NapCat automatic login',async()=>{
  const f=fixture();f.monitor.loginGraceMs=10000;
  assert.equal((await f.monitor.recoverLogin(cfg,await f.monitor.inspect(cfg))).action,'waiting');assert.equal(f.quickCalls().length,0);
  f.state.time+=10001;assert.equal((await f.monitor.recoverLogin(cfg,await f.monitor.inspect(cfg))).action,'quick-login-requested');
});
test('quick login targets only configured bot, throttles repeats and never claims online early',async()=>{
  const f=fixture(),health=await f.monitor.inspect(cfg);
  assert.equal((await f.monitor.recoverLogin(cfg,health)).action,'quick-login-requested');
  assert.deepEqual(f.quickCalls()[0].body,{uin:cfg.botQQ});assert.equal((await f.monitor.inspect(cfg)).state,'login-required');
  for(let i=0;i<10;i++)await f.monitor.recoverLogin(cfg,health);
  assert.equal(f.quickCalls().length,1);
});
test('expired identity and security verification stop repeated login attempts',async()=>{
  for(const message of ['你的用户身份已失效，请重新登录','captcha required','需要验证设备']){
    const f=fixture({quick:{code:-1,message}}),health=await f.monitor.inspect(cfg);
    assert.equal((await f.monitor.recoverLogin(cfg,health)).action,'scan-required');
    f.state.time+=999999;assert.equal((await f.monitor.recoverLogin(cfg,health)).action,'scan-required');assert.equal(f.quickCalls().length,1);
  }
});
test('transient failures have a cooldown and an attempt limit',async()=>{
  const f=fixture({quick:{code:-1,message:'temporarily unavailable'}}),health=await f.monitor.inspect(cfg);
  for(let i=0;i<3;i++){assert.equal((await f.monitor.recoverLogin(cfg,health)).action,'retry-later');f.state.time+=120001;}
  assert.equal((await f.monitor.recoverLogin(cfg,health)).action,'scan-required');assert.equal(f.quickCalls().length,3);
});
test('successful user sign-in resets blocked recovery for a future outage',async()=>{
  const f=fixture({quick:{code:-1,message:'登录态已失效'}});
  await f.monitor.recoverLogin(cfg,await f.monitor.inspect(cfg));assert(f.monitor.loginBlocked);
  f.state.online=true;assert.equal((await f.monitor.inspect(cfg)).state,'online');assert.equal(f.monitor.loginBlocked,false);
  f.state.online=false;f.state.quick={code:0};assert.equal((await f.monitor.recoverLogin(cfg,await f.monitor.inspect(cfg))).action,'quick-login-requested');
});
test('health records contain no QR, raw error, credential or QQ identity',async()=>{
  const f=fixture(),serialized=JSON.stringify(await f.monitor.inspect(cfg));
  for(const value of ['MOCK_QR_SECRET','MOCK_RAW_ERROR','mock-webui-secret','EXAMPLE_4848eeb51465',cfg.botQQ])assert(!serialized.includes(value));
});

test('healthy idle companion never triggers watchdog regardless of elapsed time',()=>{
  let time=0;const watchdog=new ConnectionWatchdog({now:()=>time,graceMs:100});
  for(let i=0;i<5;i++){time+=100000;assert.equal(watchdog.shouldRestart({online:true,hasChild:true,ready:true}),false);}
});
test('persistent connection failure restarts only after its grace period',()=>{
  let time=0;const watchdog=new ConnectionWatchdog({now:()=>time,graceMs:100});
  assert.equal(watchdog.shouldRestart({online:true,hasChild:true,ready:false}),false);
  time=99;assert.equal(watchdog.shouldRestart({online:true,hasChild:true,ready:false}),false);
  time=100;assert.equal(watchdog.shouldRestart({online:true,hasChild:true,ready:false}),true);
  assert.equal(watchdog.shouldRestart({online:true,hasChild:true,ready:false}),false);
});
test('QQ login outage and stopped children reset watchdog rather than restarting QQ',()=>{
  let time=0;const watchdog=new ConnectionWatchdog({now:()=>time,graceMs:100});
  watchdog.shouldRestart({online:true,hasChild:true,ready:false});time=500;
  assert.equal(watchdog.shouldRestart({online:false,hasChild:true,ready:false}),false);
  assert.equal(watchdog.shouldRestart({online:true,hasChild:true,ready:false}),false);
  time=1000;assert.equal(watchdog.shouldRestart({online:true,hasChild:false,ready:false}),false);
});

async function socketFixture(options={},onConnection=()=>{}){
  const server=new WebSocketServer({host:'127.0.0.1',port:0,autoPong:options.autoPong!==false}),sockets=new Set();
  const status=[],messages=[];let count=0;
  server.on('connection',socket=>{count++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));onConnection(socket,count);});
  await new Promise(resolve=>server.once('listening',resolve));
  const bot=new OneBot({wsUrl:`ws://127.0.0.1:${server.address().port}`,selfId:cfg.botQQ,heartbeatIntervalMs:35,heartbeatTimeoutMs:110,handshakeTimeoutMs:150,reconnectDelayMs:25,
    onStatus:value=>status.push(value),onMessage:value=>messages.push(value)});
  return {bot,status,messages,sockets,count:()=>count,async close(){bot.stop();for(const socket of sockets)socket.terminate();await new Promise(resolve=>server.close(resolve));}};
}
const lifecycle=socket=>socket.send(JSON.stringify({post_type:'meta_event',meta_event_type:'lifecycle',self_id:Number(cfg.botQQ)}));

test('no chats or mentions: ping/pong maintains connection and fresh health',async()=>{
  let pings=0;const f=await socketFixture({},socket=>{lifecycle(socket);socket.on('ping',()=>pings++);});
  try {
    await until(()=>f.bot.connected,'initial lifecycle');await pause(430);
    assert.equal(f.count(),1);assert(f.bot.connected);assert(pings>=5);assert(f.status.filter(status=>status==='ready').length>=5);assert.equal(f.messages.length,0);
    f.bot.stop();await pause(180);assert.equal(f.count(),1);assert.equal(f.status.at(-1),'stopped');
  }finally {await f.close();}
});
test('half-open socket without pong is discarded and reconnects without a QQ message',async()=>{
  const f=await socketFixture({autoPong:false},(socket,count)=>{lifecycle(socket);if(count>1)socket.on('ping',data=>socket.pong(data));});
  try {
    await until(()=>f.count()>=2&&f.bot.connected,'recovery from lost pong');await pause(180);
    assert.equal(f.count(),2);assert(f.status.includes('stalled'));assert(f.status.includes('disconnected'));assert.equal(f.messages.length,0);
  }finally {await f.close();}
});
test('TCP/WebSocket open without verified OneBot lifecycle cannot remain falsely ready',async()=>{
  const f=await socketFixture({},(socket,count)=>{if(count>1)lifecycle(socket);});
  try {await until(()=>f.count()>=2&&f.bot.connected,'lifecycle timeout recovery');assert(f.status.includes('stalled'));assert.equal(f.messages.length,0);}
  finally {await f.close();}
});
test('QQ offline heartbeat stays offline even while pong replies; online heartbeat recovers',async()=>{
  const f=await socketFixture({},lifecycle);
  try {
    await until(()=>f.bot.connected,'initial lifecycle');const socket=[...f.sockets][0];
    socket.send(JSON.stringify({post_type:'meta_event',meta_event_type:'heartbeat',self_id:80008,status:{online:false}}));
    await pause(20);assert(f.bot.connected);
    socket.send(JSON.stringify({post_type:'meta_event',meta_event_type:'heartbeat',self_id:Number(cfg.botQQ),status:{online:false}}));
    await until(()=>!f.bot.connected,'offline heartbeat');await pause(90);assert.equal(f.bot.connected,false);
    socket.send(JSON.stringify({post_type:'meta_event',meta_event_type:'heartbeat',self_id:Number(cfg.botQQ),status:{online:true}}));
    await until(()=>f.bot.connected,'online heartbeat');assert.equal(f.count(),1);assert.equal(f.messages.length,0);
  }finally {await f.close();}
});
