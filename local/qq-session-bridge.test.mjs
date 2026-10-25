import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createQQSessionBridge,identityFromConfig}=createRequire(import.meta.url)('./qq-session-bridge.cjs');
const identity={selfUin:'123456789',selfUid:'u_mock_identity'};
function fixture(){
  const calls=[],captures=[],audits=[];
  const native={value:4,init(...args){assert.equal(this,native);calls.push(args);return 42;},echo(arg){assert.equal(this,native);return arg;}};
  const service={getNTWrapperSession(name){assert.equal(this,service);assert.equal(name,'nt_1');captures.push(name);return native;}};
  const starts=[];
  const bridge=createQQSessionBridge({onSession:s=>starts.push(s),audit:(...args)=>audits.push(args),log(){}});
  return {bridge,native,service,calls,captures,starts,audits};
}
test('native QQ session is captured lazily from the real factory, without an extra create or init',()=>{
  const f=fixture(),service=f.bridge.wrapService(f.service);
  assert.deepEqual(f.captures,[]);assert.deepEqual(f.calls,[]);assert.deepEqual(f.starts,[]);
  const session=service.getNTWrapperSession('nt_1');
  assert.equal(f.captures.length,1);assert.equal(f.starts.length,1);assert.equal(f.starts[0],session);
  assert.equal(f.calls.length,0);assert.equal(session.value,4);assert.equal(session.echo('sample'),'sample');
  assert.equal(service.getNTWrapperSession('nt_1'),session);assert.equal(f.starts.length,1);
  const listener={};assert.equal(session.init(identity,{},null,listener),42);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],identity);assert.equal(f.calls[0][3],listener);
  assert.deepEqual(f.audits.map(a=>a.slice(1)),[['onMSFSsoError','msf-error'],['onRefreshTicketResult','ticket-refresh'],['onSessionInitComplete','session-initialized']]);
});
test('all supported actual factory names preserve native receiver and arguments, including immutable methods',()=>{
  for(const name of ['create','get','getNTWrapperSession']){
    const f=fixture(),args=['session-name',7];
    const native=Object.freeze({init(){assert.equal(this,native);return 8;}});
    const service=Object.freeze({[name](...actual){assert.equal(this,service);assert.deepEqual(actual,args);return native;},value:2});
    const wrapped=f.bridge.wrapService(service);assert.equal(wrapped.value,2);
    assert.equal(wrapped[name](...args).init(identity,{},null,{}),8);
  }
});
test('real initialization event is delivered before or after subscription and preserves the QQ callback',()=>{
  for(const early of [true,false]){
    const f=fixture(),session=f.bridge.wrapService(f.service).getNTWrapperSession('nt_1');
    const events=[],listener={flag:1,onOpentelemetryInit(event,extra){assert.equal(this,listener);events.push({event,extra});return 17;}};
    session.init({...identity,a2:'secret',d2:'ticket',d2Key:'hidden'},null,null,listener);
    assert.equal(f.bridge.getSessionIdentity(),null);
    let callbacks=0;
    if(early)assert.equal(listener.onOpentelemetryInit({is_init:true},3),17);
    f.bridge.registerInitCallback(()=>callbacks++);
    if(!early)assert.equal(listener.onOpentelemetryInit({is_init:true},3),17);
    assert.equal(callbacks,1);assert.equal(events.length,1);
    assert.deepEqual(f.bridge.getSessionIdentity(),{uin:identity.selfUin,uid:identity.selfUid});
    const copy=f.bridge.getSessionIdentity();copy.uin='changed';assert.equal(f.bridge.getSessionIdentity().uin,identity.selfUin);
  }
});
test('new session initialization clears old readiness and stale previous callbacks cannot release it',()=>{
  const f=fixture(),session=f.bridge.wrapService(f.service).getNTWrapperSession('nt_1');
  const first={},second={};session.init(identity,null,null,first);first.onOpentelemetryInit({is_init:true});
  let notifications=0;f.bridge.registerInitCallback(()=>notifications++);assert.equal(notifications,1);
  session.init({selfUin:'987654321',selfUid:'u_other_identity'},null,null,second);
  assert.equal(f.bridge.getSessionIdentity(),null);
  first.onOpentelemetryInit({is_init:true});assert.equal(f.bridge.getSessionIdentity(),null);assert.equal(notifications,1);
  second.onOpentelemetryInit({is_init:false});assert.equal(f.bridge.getSessionIdentity(),null);
  second.onOpentelemetryInit({is_init:true});assert.equal(notifications,2);
  assert.deepEqual(f.bridge.getSessionIdentity(),{uin:'987654321',uid:'u_other_identity'});
});
test('a different actual native session also resets readiness and ignores prior session signals',()=>{
  const f=fixture();let current=f.native;
  const service={get(){return current;}};const wrapped=f.bridge.wrapService(service);
  const oldListener={};wrapped.get().init(identity,null,null,oldListener);oldListener.onOpentelemetryInit({is_init:true});
  current={init(){}};const newListener={};wrapped.get().init({selfUin:'987654321',selfUid:'u_other'},null,null,newListener);
  oldListener.onOpentelemetryInit({is_init:true});assert.equal(f.bridge.getSessionIdentity(),null);
  newListener.onOpentelemetryInit({is_init:true});assert.equal(f.bridge.getSessionIdentity().uin,'987654321');
  assert.equal(f.starts.length,1);
});
test('missing identity stays unconfirmed and native exceptions and callback exceptions retain original semantics',()=>{
  for(const config of [null,{}, {...identity,selfUin:123456789}, {...identity,selfUid:''}, {...identity,selfUin:'not-a-qq'}])assert.equal(identityFromConfig(config),null);
  const error=new Error('original failure'),f=fixture();const native={init(){throw error;}};
  const session=f.bridge.wrapService({get(){return native;}}).get();assert.throws(()=>session.init(identity,null,null,{}),e=>e===error);
  const real=f.bridge.wrapService(f.service).getNTWrapperSession('nt_1'),listener={onOpentelemetryInit(){throw error;}};
  real.init(identity,null,null,listener);assert.throws(()=>listener.onOpentelemetryInit({is_init:true}),e=>e===error);
});
