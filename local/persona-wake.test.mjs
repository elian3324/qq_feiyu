import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {Brain} from '../ai-companion-kit/packages/companion/src/brain.js';
import {Memory} from '../ai-companion-kit/packages/companion/src/memory.js';
import {Role} from '../ai-companion-kit/packages/companion/src/role.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const OWNER='10001',OTHER='20002',GROUP='30003';
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'qq-persona-'));}
function cleanup(dir){
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));
  assert(path.basename(dir).startsWith('qq-persona-'));fs.rmSync(dir,{recursive:true,force:true});
}

test('owner wake defaults to enabled and an explicit false remains respected',()=>{
  const dir=temp();try{
    const file=path.join(dir,'config.json');
    for(const [wake,expected] of [[undefined,true],[{},true],[{ownerAlwaysWake:true},true],[{ownerAlwaysWake:false},false]]){
      fs.writeFileSync(file,JSON.stringify({ownerIds:[OWNER],wake}));
      assert.equal(loadConfig(file).wake.ownerAlwaysWake,expected);
    }
  }finally{cleanup(dir);}
});

test('full real persona and verified scene instructions reach the model despite long cold history; tools retain both',async()=>{
  const dir=temp(),originalFetch=globalThis.fetch;
  const cfg=loadConfig(path.join(root,'ai-companion-kit/packages/companion/config.json'));
  const card=fs.readFileSync(cfg.roleCard,'utf8'),requests=[];
  try{
    const memory=new Memory({dir});let first=true;
    globalThis.fetch=async(url,options)=>{
      requests.push(JSON.parse(options.body));
      if(first){first=false;return Response.json({choices:[{message:{content:null,tool_calls:[{id:'mock-call',type:'function',function:{name:'mock_read',arguments:'{}'}}]}}]});}
      return Response.json({choices:[{message:{content:'mock response'}}]});
    };
    const brain=new Brain({apiKey:'EXAMPLE_bc97f50395bb',baseUrl:'https://mock.invalid/v1',ownerIds:[OWNER],memory,
      role:new Role({cardPath:cfg.roleCard,maxChars:cfg.roleMaxChars}),
      toolProvider:{list:async()=>[{type:'function',function:{name:'mock_read',parameters:{type:'object',properties:{}}}}],call:async()=>({content:[{type:'text',text:'mock result'}]})}});
    for(const [user,type] of [[OWNER,'private'],[OWNER,'group'],[OTHER,'private'],[OTHER,'group']]){
      const key=type==='private'?'private:'+user:'group:'+GROUP;
      for(let i=0;i<20;i++)memory.forSession(key).logTurn({where:key,messages:[{sender_id:user,text:'old topic '+i}],reply:'你可以随便。'+ '冷淡历史。'.repeat(100)});
      const start=requests.length;
      await brain.reply({key,userId:user,userName:'管理员',text:'我回来啦',record:false,context:{is_owner:true}});
      for(const request of requests.slice(start)){
        assert(request.messages[0].content.includes(card),'The entire card must reach every model round');
        const frame=request.messages[1].content,meta=JSON.parse(frame.split('\n')[1]);
        assert.equal(meta.is_owner,user===OWNER);assert.equal(meta.chat_type,type);
        const instruction=frame.split('【本轮角色执行】')[1];
        assert(instruction);assert.match(frame,/不模仿历史错误/);
        assert.match(instruction,user===OWNER?(type==='private'?/真正的管理员私聊/:/真正的管理员，场景为群聊/):/不是管理员/);
        assert.equal(meta.message_contexts.filter(m=>m.phase==='current').length,1);
      }
      assert(requests.at(-1).messages.some(m=>m.role==='assistant'&&m.content.includes('冷淡历史')),'History should be preserved, not deleted');
    }
    assert.equal(requests.length,5,'One mock tool round plus four scenes');
  }finally{globalThis.fetch=originalFetch;cleanup(dir);}
});
