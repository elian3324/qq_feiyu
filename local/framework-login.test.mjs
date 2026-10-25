import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture({identity=null,ready=false,existing=false}={}) {
  const text=fs.readFileSync(new URL('../gateway/napcat-framework/napcat.mjs',import.meta.url),'utf8');
  const start=text.indexOf('    let nativeReady=false,pendingLogin=null;');
  const end=text.indexOf('    loginListener.onQRCodeGetPicture =',start);
  assert(start>=0&&end>start,'Run prepare-desktop-framework before testing the deployed adapter');
  const values={identity,callback:null,result:null,status:false,phase:'',exit:null},listener={},context=existing?{core:{selfInfo:{online:true}}}:null;
  vm.runInNewContext(text.slice(start,end),{
    loginContext:{isLogined:false},loginListener:listener,
    logger:{logWarn(){}},process:{env:{COMPANION_EXPECTED_QQ:'90009'},exit:code=>{values.exit=code;}},
    resolve:value=>{values.result=value;},getSessionIdentity:()=>values.identity,
    registerInitCallback:callback=>{values.callback=callback;if(ready)callback();},
    WebUiDataRuntime:{setQQLoginStatus:value=>{values.status=value;},setQQLoginError(){},setQQLoginPhase:value=>{values.phase=value;},getOneBotContext:()=>context}
  });
  return {values,listener,context};
}
test('an already initialized real QQ session reaches the adapter even if its QR event happened before subscription',()=>{
  const f=fixture({identity:{uin:'90009',uid:'mock-bot'},ready:true});
  assert.equal(f.values.result.uin,'90009');assert.equal(f.values.status,true);assert.equal(f.values.phase,'initializing');
});
test('QR success alone cannot mark a native QQ session ready, and a later native event completes it',async()=>{
  const f=fixture();await f.listener.onQRCodeLoginSucceed({uin:'90009',uid:'mock-bot'});
  assert.equal(f.values.result,null);assert.equal(f.values.status,false);
  f.values.identity={uin:'90009',uid:'mock-bot'};f.values.callback();assert.equal(f.values.result.uid,'mock-bot');
});
test('a previous native ready event cannot release a QR login while the current native session is uninitialized',async()=>{
  const f=fixture({identity:{uin:'90009',uid:'mock-bot'},ready:true});
  f.values.identity=null;f.values.result=null;f.values.status=false;
  await f.listener.onQRCodeLoginSucceed({uin:'90009',uid:'mock-bot'});
  assert.equal(f.values.result,null);assert.equal(f.values.status,false);
});
test('the verified native account wins over a conflicting pending login event',async()=>{
  const f=fixture({identity:{uin:'80008',uid:'mock-other'}});
  await f.listener.onQRCodeLoginSucceed({uin:'90009',uid:'mock-bot'});f.values.callback();
  assert.equal(f.values.result,null);assert.equal(f.values.status,false);
});
test('switching an active adapter to another real account disconnects rather than reusing bot identity',()=>{
  const f=fixture({identity:{uin:'80008',uid:'mock-other'},ready:true,existing:true});
  assert.equal(f.values.exit,17);assert.equal(f.context.core.selfInfo.online,false);assert.equal(f.values.result,null);
});
test('login actions and account history are available when QQ connected before the adapter subscribed',async()=>{
  const source=fs.readFileSync(new URL('../gateway/napcat-framework/napcat.mjs',import.meta.url),'utf8');
  const start=source.indexOf('    // The complete QQ app may have connected before');
  const finish="    }).catch(()=>logger.logWarn('[Framework] Login history is temporarily unavailable'));";
  const end=source.indexOf(finish,start);
  assert(start>=0&&end>start);
  let registered=0,subscribed=0,quick=null;
  const listener={},context={},service={addKernelLoginListener(value){assert.equal(value,listener);subscribed++;},getLoginList:async()=>({LocalLoginInfoList:[{uin:'90009',isQuickLogin:true},{uin:'80008',isQuickLogin:false}]})};
  vm.runInNewContext(source.slice(start,end+finish.length),{
    loginService:service,loginListener:listener,loginContext:context,logger:{logWarn(){}},
    proxiedListenerOf:value=>value,registerWebUiLoginCallbacks:(actual,state)=>{assert.equal(actual,service);assert.equal(state,context);registered++;},
    WebUiDataRuntime:{setQQQuickLoginList:value=>{quick=value;},setQQNewLoginList(){}}
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(registered,1);assert.equal(subscribed,1);assert.equal(quick.join(','),'90009');
});
