import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from '../ai-companion-kit/node_modules/express/index.js';
import { installLocalWebUiLogin, isLocalWebUiRequest } from './webui-local-login.mjs';
import { startLocalWebUi } from './webui-local-client.mjs';
import vm from 'node:vm';

const root=fileURLToPath(new URL('../',import.meta.url));
const request=extra=>({socket:{remoteAddress:'127.0.0.1',localPort:6099},headers:{host:'127.0.0.1:6099'},...extra});
test('local session rejects remote peers, rebinding hosts and cross-origin requests',()=>{
  assert(isLocalWebUiRequest(request()));
  assert(isLocalWebUiRequest(request({headers:{host:'localhost:6099',origin:'http://localhost:6099'}})));
  for(const candidate of [request({socket:{remoteAddress:'192.168.1.10',localPort:6099}}),
    request({headers:{host:'evil.example:6099'}}),request({headers:{host:'127.0.0.1:6099',origin:'https://evil.example'}}),
    request({headers:{host:'127.0.0.1:6099','sec-fetch-site':'cross-site'}}),request({headers:{host:'127.0.0.1:9999'}})])assert.equal(isLocalWebUiRequest(candidate),false);
});

test('real HTTP middleware injects all local SPA entries and preserves API auth',async t=>{
  const app=express(),server=http.createServer(app);let available=true;
  installLocalWebUiLogin(app,{staticPath:path.join(root,'gateway/napcat/napcat/static'),getCredential:async()=>available?'mock-signed-session':null});
  app.use('/api',(_req,res)=>res.json({code:-1,message:'Unauthorized'}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const entry of ['/webui','/webui/','/webui/web_login','/webui/qq_login','/webui/network','/webui/config','/webui/index.html','/webui/web_login?token=old-token']) {
      await t.test(entry,async()=>{
        const response=await fetch(base+entry),html=await response.text();
        assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
        assert(html.includes('data-napcat-app='));assert(html.includes('/webui/local-login.mjs'));
        assert(!html.includes('mock-signed-session'));assert(!html.includes('old-token'));
      });
    }
    const script=await fetch(base+'/webui/local-login.mjs');assert.equal(script.status,200);assert.match(await script.text(),/startLocalWebUi/);
    await t.test('a link from another website still loads the local login bootstrap',async()=>{
      const html=await new Promise((resolve,reject)=>{
        const req=http.get(base+'/webui/',{headers:{'Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'cross-site',Origin:'https://example.invalid'}},res=>{
          let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve(body));
        });req.on('error',reject);
      });
      assert(html.includes('data-napcat-app='));
    });
    const session=await fetch(base+'/api/local-session',{method:'POST',headers:{'X-NapCat-Local-Login':'1'}});
    assert.equal(session.headers.get('cache-control'),'no-store');assert.equal((await session.json()).data.Credential,'mock-signed-session');
    for(const headers of [{},{'X-NapCat-Local-Login':'1',Origin:'https://evil.example'},{'X-NapCat-Local-Login':'1',Host:'evil.example'}]) {
      const status=await new Promise((resolve,reject)=>{
        const req=http.request(base+'/api/local-session',{method:'POST',headers},res=>{res.resume();resolve(res.statusCode);});
        req.on('error',reject);req.end();
      });
      assert.equal(status,403);
    }
    assert.equal((await (await fetch(base+'/api/auth/check')).json()).message,'Unauthorized');
    available=false;assert.equal((await fetch(base+'/api/local-session',{method:'POST',headers:{'X-NapCat-Local-Login':'1'}})).status,503);
  }finally {await new Promise(resolve=>server.close(resolve));}
});

for(const entry of ['/webui/','/webui/web_login','/webui/network?token=stale','/webui/qq_login']) {
  test('client signs in before app mount, no manual token: '+entry,async()=>{
    const store=new Map([['token',JSON.stringify('expired-session')]]),order=[],events={};let address='';
    const env={location:{href:'http://localhost:6099'+entry},history:{replaceState:(_s,_t,url)=>address=url},
      document:{querySelector:()=>({dataset:{napcatApp:'/webui/assets/app.js'}})},
      localStorage:{setItem:(k,v)=>{order.push('store');store.set(k,v);},getItem:k=>store.get(k)},
      fetch:async()=>{order.push('authenticate');return Response.json({code:0,data:{Credential:'new-session'}});},
      setInterval:handler=>{events.timer=handler;},setTimeout,addEventListener:(type,handler)=>{events[type]=handler;},
      dispatchEvent:()=>order.push('notify'),StorageEvent:class{}};
    await startLocalWebUi(env,async src=>{order.push('mount');assert.equal(src,'/webui/assets/app.js');assert.equal(JSON.parse(store.get('token')),'new-session');});
    assert.deepEqual(order,['authenticate','store','mount']);assert(!address.includes('token='));assert(!address.includes('web_login'));
    await events.timer();assert.equal(order.at(-1),'notify');await events.focus();assert.equal(order.at(-1),'notify');
  });
}

test('client retries a temporarily unavailable backend instead of showing a Token form',async()=>{
  let calls=0,mounted=false,message='';
  const env={location:{href:'http://127.0.0.1:6099/webui/'},history:{replaceState(){}},
    document:{querySelector:()=>({dataset:{napcatApp:'/app.js'}}),getElementById:()=>({set textContent(value){message=value;}})},
    localStorage:{setItem(){}},fetch:async()=>++calls===1?new Response('',{status:503}):Response.json({code:0,data:{Credential:'new-session'}}),
    setTimeout:handler=>handler(),setInterval(){},addEventListener(){}};
  await startLocalWebUi(env,async()=>{mounted=true;});assert.equal(calls,2);assert(mounted);assert.match(message,/自动重试/);
});

test('SPA logout and browser back to the login route automatically re-enter',async()=>{
  const events={},redirects=[],location={href:'http://localhost:6099/webui/',pathname:'/webui/',replace:url=>redirects.push(url)};
  const env={location,history:{replaceState(){},pushState:(_s,_t,url)=>location.pathname=url},
    document:{querySelector:()=>({dataset:{napcatApp:'/app.js'}})},localStorage:{setItem(){}},
    fetch:async()=>Response.json({code:0,data:{Credential:'new-session'}}),setInterval(){},setTimeout,
    addEventListener:(type,handler)=>events[type]=handler};
  await startLocalWebUi(env,async()=>{});
  env.history.pushState(null,'','/webui/web_login');await Promise.resolve();assert.equal(redirects.at(-1),'/webui/qq_login');
  events.popstate();assert.equal(redirects.length,2);events.pageshow();assert.equal(redirects.length,3);
});

for(const entry of ['/webui/qq_login','/webui/qq_login/','/webui/web_login?token=stale']){
  test('desktop QQ login routes open guidance before loading the QR app: '+entry,async()=>{
    const redirects=[];
    const env={location:{href:'http://localhost:6099'+entry,replace:url=>redirects.push(url)},
      document:{querySelector:selector=>selector.startsWith('meta')?{content:'desktop-framework'}:{dataset:{napcatApp:'/app.js'}}},
      fetch(){throw new Error('No authentication or QR request should be made');}};
    await startLocalWebUi(env,async()=>{throw new Error('QR app must not mount');});
    assert.deepEqual(redirects,['/webui/desktop-login.html']);
  });
}

test('desktop SPA navigation redirects synchronously before mounting the QQ QR route',async()=>{
  const redirects=[],events={},location={href:'http://localhost:6099/webui/',pathname:'/webui/',replace:url=>redirects.push(url)};
  const env={location,history:{replaceState(){},pushState:(_s,_t,url)=>location.pathname=url},
    document:{querySelector:selector=>selector.startsWith('meta')?{content:'desktop-framework'}:{dataset:{napcatApp:'/app.js'}}},
    localStorage:{setItem(){}},fetch:async()=>Response.json({code:0,data:{Credential:'mock-session'}}),
    setInterval(){},setTimeout,addEventListener:(type,handler)=>events[type]=handler};
  await startLocalWebUi(env,async()=>{});
  env.history.pushState(null,'','/webui/qq_login');assert.equal(redirects.at(-1),'/webui/desktop-login.html');
  env.history.pushState(null,'','/webui/web_login');assert.equal(redirects.length,2);
  events.popstate();assert.equal(redirects.length,3);
});

test('desktop guidance polls only read endpoints and waits for both real login and core readiness',async()=>{
  const html=await fs.readFile(new URL('./desktop-login.html',import.meta.url),'utf8');
  const source=/<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];assert(source);
  for(const state of [
    {isLogin:false,coreReady:false,loginPhase:'offline'},
    {isLogin:false,coreReady:false,loginPhase:'initializing',qrLoginAccepted:true},
    {isLogin:true,coreReady:false},
    {isLogin:true,coreReady:true},
  ]){
    const calls=[],redirects=[],elements={status:{textContent:''},recheck:{addEventListener(){}}};
    const context={document:{getElementById:id=>elements[id]},location:{replace:url=>redirects.push(url)},setInterval(){},AbortSignal,
      fetch:async(url,options)=>{
        calls.push({url,options});
        return url==='/api/local-session'?Response.json({code:0,data:{Credential:'mock-session'}}):Response.json({code:0,data:state});
      }};
    await vm.runInNewContext('(async()=>{'+source+'})()',context);
    assert.deepEqual(calls.map(c=>c.url),['/api/local-session','/api/QQLogin/CheckLoginStatus']);
    assert.equal(calls[1].options.headers.authorization,'Bearer mock-session');
    assert.equal(redirects.length,state.isLogin&&state.coreReady?1:0);
    assert.equal(elements.recheck.disabled,false);
    if(state.loginPhase==='initializing')assert.match(elements.status.textContent,/已收到登录确认/);
    if(state.loginPhase==='offline')assert.match(elements.status.textContent,/等待 QQ 登录并完成连接/);
  }
  assert(!source.includes('RefreshQRcode'));assert(!source.includes('SetQuickLogin'));
  assert(!source.includes('localStorage'));assert(!source.includes('qrcodeurl'));
});

test('desktop guidance is a real static HTML route and retains the Framework marker on SPA entry',async()=>{
  const app=express(),server=http.createServer(app);
  const staticPath=path.join(root,'gateway/napcat-framework/static');
  installLocalWebUiLogin(app,{staticPath,getCredential:async()=> 'mock-session'});
  app.use('/webui',express.static(staticPath));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(base+'/webui/desktop-login.html');
    assert.equal(response.status,200);const html=await response.text();
    assert.match(html,/请在电脑 QQ 窗口中登录/);assert(!html.includes('data-napcat-app='));
    const entry=await (await fetch(base+'/webui/qq_login')).text();
    assert.match(entry,/<meta name="companion-login" content="desktop-framework"/);
    assert.match(entry,/data-napcat-app=/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('original static entry still exists and contains no embedded local credential',async()=>{
  const html=await fs.readFile(path.join(root,'gateway/napcat/napcat/static/index.html'),'utf8');
  assert.match(html,/<script\s+type="module"\s+crossorigin\s+src="/);assert(!html.includes('mock-signed-session'));
});

for(const runtime of ['napcat/napcat','napcat-framework']){
test('service worker navigation bypasses old HTTP HTML cache: '+runtime,async()=>{
  const source=await fs.readFile(path.join(root,'gateway',runtime,'static/sw_template.js'),'utf8');
  const handlers={},calls=[];
  const context={self:{location:{origin:'http://localhost:6099'},addEventListener:(name,handler)=>handlers[name]=handler},
    URL,Response,console,fetch:async(request,options)=>{calls.push(options);return new Response('fresh bootstrap');}};
  vm.runInNewContext(source,context);
  let result;handlers.fetch({request:{url:'http://localhost:6099/webui/',mode:'navigate',headers:new Headers()},respondWith:promise=>result=promise});
  assert.equal(await (await result).text(),'fresh bootstrap');assert.equal(calls[0].cache,'no-store');
});

test('service worker upgrade refreshes legacy open pages without waiting on navigation: '+runtime,{timeout:1000},async()=>{
  const source=await fs.readFile(path.join(root,'gateway',runtime,'static/sw_template.js'),'utf8');
  const handlers={},navigated=[],deleted=[];
  const context={URL,console,self:{location:{origin:'http://localhost:6099'},addEventListener:(name,handler)=>handlers[name]=handler,
    clients:{claim:async()=>{},matchAll:async()=>[{url:'http://localhost:6099/webui/web_login',navigate:url=>{navigated.push(url);return new Promise(()=>{});}}]}},
    caches:{keys:async()=>['napcat-webui-vold','unrelated-cache'],delete:async name=>deleted.push(name)}};
  vm.runInNewContext(source,context);let work;handlers.activate({waitUntil:promise=>work=promise});await work;
  assert.deepEqual(deleted,['napcat-webui-vold']);assert.deepEqual(navigated,['http://localhost:6099/webui/web_login']);
});
}
