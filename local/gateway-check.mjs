import fs from 'node:fs';
import { WebSocket } from '../ai-companion-kit/node_modules/ws/wrapper.mjs';
const file = new URL('../ai-companion-kit/packages/companion/config.json', import.meta.url);
const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const headers = {authorization:'Bearer '+cfg.onebot.accessToken,'content-type':'application/json'};
async function api(action) {
  const response=await fetch(cfg.onebot.httpUrl+'/'+action,{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(5000)});
  const body=await response.json();
  if(!response.ok || body.status!=='ok') throw new Error('OneBot '+action+' failed');
  return body.data;
}
const login=await api('get_login_info');
if(String(login.user_id)!==String(cfg.botQQ)) throw new Error('Bot account mismatch');
console.log('PASS: authenticated HTTP and configured bot account match.');
const status=await api('get_status');
if(!status.online) throw new Error('QQ is not online');
console.log('PASS: QQ is online.');
const bad=await fetch(cfg.onebot.httpUrl+'/get_status',{method:'POST',headers:{...headers,authorization:'Bearer EXAMPLE_08df2d1312a6'},body:'{}',signal:AbortSignal.timeout(5000)});
if(bad.ok) throw new Error('Invalid HTTP token was accepted');
console.log('PASS: invalid HTTP token rejected.');
async function socketCheck(valid) {
  await new Promise((resolve,reject)=>{
    const socket=new WebSocket(cfg.onebot.wsUrl,{headers:{authorization:'Bearer '+(valid?cfg.onebot.accessToken:'EXAMPLE_08df2d1312a6')}});
    let done=false;
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);socket.terminate();error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(new Error('WebSocket authentication timeout')),5000);
    socket.on('message',data=>{
      let frame;try{frame=JSON.parse(String(data));}catch{return;}
      if(frame.post_type==='meta_event' && frame.meta_event_type==='lifecycle') {
        finish(valid ? null : new Error('Invalid token received QQ lifecycle events'));
      }
    });
    socket.on('unexpected-response',(request,response)=>{
      response.resume();finish(valid?new Error('Valid WebSocket token rejected'):null);
    });
    // NapCat upgrades the socket before validating its token; a rejected
    // connection gets an error frame and closes without lifecycle events.
    socket.on('close',()=>finish(valid?new Error('Valid WebSocket closed before lifecycle'):null));
    socket.on('error',error=>{if(!done)finish(error);});
  });
}
await socketCheck(true);console.log('PASS: authenticated WebSocket lifecycle event received.');
await socketCheck(false);console.log('PASS: invalid WebSocket token rejected before event delivery.');
