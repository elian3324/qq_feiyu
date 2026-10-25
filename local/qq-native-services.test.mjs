import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {createQQNativeServices}=createRequire(import.meta.url)('./qq-native-services.cjs');
function fixture(){
  const started=[],audits=[];
  const capture=createQQNativeServices({onReady:value=>started.push(value),auditFactory:(...value)=>audits.push(value),sessionOptions:{log(){},audit(){}}});
  const nativeSession={init(){}};
  const sessionFactory={getNTWrapperSession(){return nativeSession;}};
  return {capture,started,audits,nativeSession,sessionFactory};
}
for(const sessionFirst of [true,false]){
  test('adapter starts only after QQ itself obtains both services, call order '+sessionFirst,()=>{
    const f=fixture(),native={getLoginList(){assert.equal(this,native);return 'fresh';}},nativeCalls=[];
    const factory=Object.freeze({get(...args){assert.equal(this,factory);nativeCalls.push(args);return native;}});
    const login=f.capture.wrapService('NodeIKernelLoginService',factory);
    const sessions=f.capture.wrapService('NodeIQQNTWrapperSession',f.sessionFactory);
    assert.equal(nativeCalls.length,0);assert.equal(f.started.length,0);
    if(sessionFirst)sessions.getNTWrapperSession('nt_1');else assert.equal(login.get('real-name',{opaque:true}),native);
    assert.equal(f.started.length,0);
    if(sessionFirst)assert.equal(login.get('real-name',{opaque:true}),native);else sessions.getNTWrapperSession('nt_1');
    assert.equal(f.started.length,1);assert.equal(nativeCalls.length,1);
    assert.deepEqual(nativeCalls[0],['real-name',{opaque:true}]);assert.deepEqual(f.audits,[[2,true]]);
    assert.equal(f.started[0].loginService.getLoginList(),'fresh');assert.equal(nativeCalls.length,1);
  });
}
test('later QQ get calls stay native and adapter methods follow the current service instead of stale singleton',()=>{
  const f=fixture();let current;
  const make=value=>({label:value,getLoginList(){assert.equal(this,current);return this.label;}});
  current=make('first');const factory={get(){return current;}};
  const login=f.capture.wrapService('NodeIKernelLoginService',factory);
  assert.equal(login.get(),current);
  f.capture.wrapService('NodeIQQNTWrapperSession',f.sessionFactory).getNTWrapperSession('nt_1');
  const adapter=f.started[0].loginService,retainedMethod=adapter.getLoginList;
  assert.equal(retainedMethod(),'first');
  current=make('second');assert.equal(login.get('changed-context'),current);
  assert.equal(retainedMethod(),'second');assert.equal(adapter.label,'second');
  assert.equal(f.started.length,1);assert.deepEqual(f.audits,[[0,true],[1,true]]);
});
test('null factory results cannot start the adapter and native factory exceptions pass through',()=>{
  const f=fixture(),error=new Error('native failure');let fail=false;
  const factory={get(){if(fail)throw error;return null;}};
  const login=f.capture.wrapService('NodeIKernelLoginService',factory);
  f.capture.wrapService('NodeIQQNTWrapperSession',f.sessionFactory).getNTWrapperSession('nt_1');
  assert.equal(login.get(),null);assert.equal(f.started.length,0);
  fail=true;assert.throws(()=>login.get('opaque'),e=>e===error);
});
test('unrelated native factory members remain intact and audit records contain counts only',()=>{
  const f=fixture(),payload={d2:'secret',uin:'private',context:'opaque'},instance={};
  const factory={version:3,get(value){assert.equal(value,payload);return instance;},other(value){assert.equal(this,factory);return value;}};
  const wrapped=f.capture.wrapService('NodeIKernelLoginService',factory);
  assert.equal(wrapped.version,3);assert.equal(wrapped.other(payload),payload);assert.equal(wrapped.get(payload),instance);
  assert.deepEqual(f.audits,[[1,true]]);assert(!JSON.stringify(f.audits).includes('secret'));
  assert.equal(f.capture.wrapService('OtherService',factory),factory);
});

test('generated Framework loader never opens the native login service before QQ calls its actual factory',async()=>{
  const prepare=fs.readFileSync(new URL('./prepare-desktop-framework.cjs',import.meta.url),'utf8');
  const official=fs.readFileSync(new URL('../gateway/napcat-framework/napcat.cjs.official',import.meta.url),'utf8');
  const start=prepare.indexOf("patch('napcat.cjs',text=>{"),end=prepare.indexOf("\npatch('napcat.mjs'",start);
  assert(start>=0&&end>start);let generated;
  vm.runInNewContext(prepare.slice(start,end),{
    patch:(name,change)=>{assert.equal(name,'napcat.cjs');generated=change(official);},
    once:(text,from,to)=>{assert.equal(text.split(from).length,2);return text.replace(from,to);},
  });
  let nativeGets=0;const events=[],actualService={},actualSession={init(){}};
  const loginFactory={get(...args){assert.equal(this,loginFactory);assert.deepEqual(args,['real-qq-context']);nativeGets++;return actualService;}};
  const sessionFactory={getNTWrapperSession(){return actualSession;}};
  const fakeProcess={env:{},dlopen(module){module.exports={NodeIKernelLoginService:loginFactory,NodeIQQNTWrapperSession:sessionFactory};return 42;}};
  const filename=fileURLToPath(new URL('../gateway/napcat-framework/napcat.cjs',import.meta.url));
  const context={process:fakeProcess,__filename:filename,__dirname:path.dirname(filename),console:{log(){}},module:{exports:{}},
    require:name=>{
      if(name==='process')return fakeProcess;
      if(name==='os')return {constants:{dlopen:{RTLD_LAZY:1}}};
      if(name==='path')return path;
      if(name==='url')return {pathToFileURL};
      if(name.endsWith('/qq-auth-audit.cjs'))return {lifecycle:event=>events.push(event)};
      if(name.endsWith('/qq-native-services.cjs'))return {createQQNativeServices:options=>createQQNativeServices({...options,auditFactory(){},sessionOptions:{log(){},audit(){}}})};
      throw new Error('Unexpected loader dependency');
    }};
  vm.runInNewContext(generated,context,{importModuleDynamically:()=>Promise.reject(new Error('Mock import stopped'))});
  const nativeModule={};assert.equal(fakeProcess.dlopen(nativeModule,'./local-resources'),42);
  assert.equal(nativeGets,0);assert(!events.includes('framework-import-start'));
  nativeModule.exports.NodeIQQNTWrapperSession.getNTWrapperSession('nt_1');
  assert.equal(nativeGets,0);assert(!events.includes('framework-import-start'));
  assert.equal(nativeModule.exports.NodeIKernelLoginService.get('real-qq-context'),actualService);
  assert.equal(nativeGets,1);assert(events.includes('framework-import-start'));
  await new Promise(resolve=>setImmediate(resolve));
});
