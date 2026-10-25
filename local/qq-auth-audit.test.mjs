import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {safeResult,attachAuthAudit}=createRequire(import.meta.url)('./qq-auth-audit.cjs');
test('native auth audit retains result codes and drops ticket strings, QQ identities, descriptions and unknown fields',()=>{
 const result=safeResult({code:0,result:{errCode:'-7',a2:'secret'},uin:1234567890,uid:'private',d2:'ticket',desc:'private details',status:'success'});
 assert.deepEqual(result,{code:0,result:{errCode:-7}});
 assert.deepEqual(safeResult({result:4294967296,code:'sk-secret',status:()=>{}}),{});
 assert.deepEqual(safeResult({errCode:140022010,retCode:'140022011',uin:1234567890}),{retCode:140022011,errCode:140022010});
});
test('audit preserves original native callback, arguments, context, return value and exceptions',()=>{
 const arg={code:0,a2:'hidden'},events=[],target={flag:1,onRefreshTicketResult(value){assert.equal(this,target);assert.equal(value,arg);return 17;}};
 attachAuthAudit(target,'onRefreshTicketResult','ticket-refresh',(event,args)=>events.push({event,result:safeResult(args[0])}));
 assert.equal(target.onRefreshTicketResult(arg),17);assert.deepEqual(events,[{event:'ticket-refresh',result:{code:0}}]);
 const failure=new Error('original failure'),other={onMSFSsoError(){throw failure;}};
 attachAuthAudit(other,'onMSFSsoError','msf-error',()=>{throw new Error('disk failure');});assert.throws(()=>other.onMSFSsoError(7),e=>e===failure);
});
test('missing and immutable native callbacks cannot break QQ initialization',()=>{
 assert.doesNotThrow(()=>attachAuthAudit(null,'event','event'));
 const target=Object.freeze({onRefreshTicketResult(){return 1;}});assert.doesNotThrow(()=>attachAuthAudit(target,'onRefreshTicketResult','ticket-refresh'));assert.equal(target.onRefreshTicketResult(),1);
});
