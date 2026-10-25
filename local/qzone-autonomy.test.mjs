import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {QzoneAutonomy,spaceOptions,validateSpaceOptions,readSpaceImage} from './qzone-autonomy.mjs';
import {QzoneAdapter} from './qzone-adapter.mjs';
import {pathToFileURL} from 'node:url';
const licensedProtocol=process.env.QZONE_PROTOCOL_MODULE?await import(pathToFileURL(path.resolve(process.env.QZONE_PROTOCOL_MODULE)).href):null;
const {commentQzoneMsg,setQzoneLike,getQzoneMsgDetail}=licensedProtocol||{};

const OWNER='10001',BOT='90009',OTHER='20002',DAY=86400000,MIN=60000;
function harness(options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-space-test-'));
  let now=Date.parse('2026-10-23T12:00:00+08:00'),calls=0;
  const sent=[],observed=[],lists={[OWNER]:[],[BOT]:[]},details={};
  const cfg={apiKey:'EXAMPLE_dc3c3f309d85',baseUrl:'https://example.invalid/v1',model:'mock-model',botQQ:BOT,ownerIds:[OWNER],
    onebot:{accessToken:'EXAMPLE_aa6ab55f20ee'},autonomy:{timezone:'Asia/Shanghai',qzone:{enabled:true,publishEnabled:true,readOwnerEnabled:true,
      commentEnabled:true,replyEnabled:true,likeEnabled:true,wakeMinutes:[10,10],...options}}};
  const memory={forSession:()=>({recentTurns:()=>[{schema_version:2,messages:[{sender_id:OWNER,text:'我住在绝不能公开的小巷里PRIVATE_MARKER'}],reply:'私密回答'}]})};
  const api={onebot:async action=>action==='get_login_info'?{user_id:BOT}:{online:true},auth:async()=>({skey:'not-printed'}),call:async(action,args)=>{
    if(action==='get_qzone_msg_list')return {msglist:structuredClone(lists[args.target_uin]||[])};
    if(action==='get_qzone_msg_detail')return structuredClone(details[args.target_uin+':'+args.tid]||{tid:args.tid,comment_num:0,comments:[]});
    sent.push({action,args});
    if(action==='reply_qzone'){
      const root=details[args.target_uin+':'+args.tid]?.comments.find(c=>String(c.comment_id)===args.comment_id);
      root?.replies.push({comment_id:'sent-'+sent.length,uin:BOT,name:'bot',time:now/1000,content:args.content,reply_to_uin:args.reply_uin});
    }
    return {tid:'new-post',comment_id:'new-comment'};
  }};
  const args={cfg,bot:{connected:true},memory,role:{build:ctx=>'EXISTING_PERSONA\n'+ctx.platform},qzone:api,now:()=>now,random:()=>0,
    stateFile:path.join(dir,'state.json'),affect:async()=>({mood:'pouty',intensity:0.8,closeness:0.9,novelty:0.4,leak:'PRIVATE_MARKER'}),
    review:async()=>true,decision:async ctx=>{calls++;observed.push(ctx);return {action:'skip'};}};
  const a=new QzoneAutonomy(args);
  function post(host,tid='post-1',time=now){const p={tid,time:Math.floor(time/1000),content:'一朵小花开啦',images:[],is_private:false};lists[host].unshift(p);return p;}
  function root(host,tid,id='c1',uin=OWNER,reply=[]){const c={comment_id:id,uin,name:'不可信的昵称',time:Math.floor(now/1000),content:'你还在呀',replies:reply};details[host+':'+tid]={tid,comment_num:1,comments:[c]};return c;}
  function choose(action,text='想把一朵虚拟小花藏进兜里。'){a.decide=async ctx=>{calls++;observed.push(ctx);return {action,eventKey:ctx.candidates.find(e=>e.action===action)?.key,text};};}
  function advance(ms=5*MIN){now+=ms;}
  async function baseline(){await a.tick();a.state.nextWakeAt=now+DAY;a.save();}
  return {a,args,cfg,dir,sent,observed,lists,details,api,post,root,choose,advance,baseline,get calls(){return calls;},get now(){return now;},set now(v){now=v;}};
}
test('external autonomy defaults OFF and configuration fails closed',async()=>{
  const o=spaceOptions();assert.equal(o.enabled,false);for(const f of ['publishEnabled','commentEnabled','replyEnabled','likeEnabled'])assert.equal(o[f],false);
  assert.equal(o.maxPerDay,1);assert.equal(o.maxPerWeek,3);
  for(const bad of [{maxPerWeek:NaN},{wakeMinutes:[0,1]},{visibility:1},{maxPerDay:99}])assert.throws(()=>validateSpaceOptions(spaceOptions({qzone:bad})));
  const h=harness();h.cfg.autonomy.qzone.enabled=false;h.choose('post');await h.a.tick();assert.equal(h.sent.length,0);assert.equal(h.calls,0);
});
test('unlimited interactions work at night past daily and per-thread totals, while cooldown and post quota remain',()=>{
  const h=harness({interactionDailyLimitEnabled:false,activeHoursEnabled:false});
  h.now=Date.parse('2026-10-24T02:00:00+08:00');h.a.o=spaceOptions(h.cfg.autonomy);
  for(const action of ['comment','reply','like']){
    const event={action,host:action==='reply'?BOT:OWNER,owner:OWNER,speaker:OWNER,tid:'p',thread:'thread'};
    h.a.state.attempts=Array.from({length:30},(_,i)=>({action,thread:'thread',at:h.now-(120+i)*MIN,day:'2026-10-24',week:'2026-10-19'}));
    assert.equal(h.a.allowed(action,event),true,action);
    h.a.o.activeHoursEnabled=true;assert.equal(h.a.allowed(action,event),false);h.a.o.activeHoursEnabled=false;
    h.a.o.interactionDailyLimitEnabled=true;assert.equal(h.a.allowed(action,event),false);h.a.o.interactionDailyLimitEnabled=false;
    h.a.state.attempts.at(-1).at=h.now-MIN;assert.equal(h.a.allowed(action,event),false,'cooldown retained');
  }
  h.a.state.attempts=[{action:'post',at:h.now-60*MIN,day:'2026-10-24',week:'2026-10-19'}];
  assert.equal(h.a.allowed('post'),false,'daily posting quota retained');
  assert.throws(()=>validateSpaceOptions(spaceOptions({qzone:{activeHoursEnabled:'false'}})));
});
test('shared adapter drops interaction daily caps but retains short-term throttling and posting limits',()=>{
  const h=harness({interactionDailyLimitEnabled:false}),adapter=new QzoneAdapter(h.cfg,{stateDir:h.dir});
  const now=Date.now(),day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
  fs.writeFileSync(adapter.rateFile,JSON.stringify({comment:Array.from({length:15},(_,i)=>({t:now-(60+i)*MIN,day})),
    like:Array.from({length:25},(_,i)=>({t:now-(60+i)*MIN,day})),post:[{t:now-60*MIN,day},{t:now-90*MIN,day}]}));
  adapter.limit('comment');adapter.limit('like');assert.throws(()=>adapter.limit('post'),/频率/);
  adapter.limit('comment');assert.throws(()=>adapter.limit('comment'),/频率/);
});
test('independent thought publishes without incoming chat; can also skip',async()=>{
  const h=harness();h.choose('post');const r=await h.a.tick();assert.equal(r.accepted,true);assert.equal(h.sent[0].action,'send_qzone_msg');assert.equal(h.sent[0].args.ugc_right,4);
  assert.equal(h.observed[0].trigger,'independent-thought');assert(!JSON.stringify(h.observed).includes('PRIVATE_MARKER'));
  assert(!JSON.stringify(h.a.state.affect).includes('leak'));assert.equal(h.a.state.affect.mood,'pouty');
  const skip=harness();await skip.a.tick();assert.equal(skip.sent.length,0);assert(skip.a.state.nextWakeAt>skip.now);
});
test('first read is a baseline, not a backlog of unsolicited interactions',async()=>{
  const h=harness({publishEnabled:false});h.post(OWNER);h.post(BOT,'own');h.root(BOT,'own');await h.a.tick();assert.equal(h.a.state.events.length,0);assert.equal(h.calls,0);
});
test('wake jitter continues through quiet hours instead of publishing at a fixed opening time',async()=>{
  const h=harness({activeStart:'13:00',wakeMinutes:[30,90]});h.choose('post');await h.a.tick();assert(h.a.state.nextWakeAt>h.now);
  h.advance(31*MIN);await h.a.tick();h.advance(29*MIN);await h.a.tick();assert.equal(h.sent.length,0);
  h.advance(2*MIN);await h.a.tick();assert.equal(h.sent.length,1);
});
test('new owner post detected with no QQ messages and comments reuse shared adapter',async()=>{
  const h=harness({publishEnabled:false});await h.baseline();h.advance();h.post(OWNER);h.choose('comment');await h.a.tick();
  assert.equal(h.sent[0].action,'comment_qzone');assert.equal(h.sent[0].args.target_uin,OWNER);assert.equal(h.observed[0].trigger,'new-space-events');
  assert(!JSON.stringify(h.observed).includes('PRIVATE_MARKER'));
});
test('new owner comment on bot space is a targeted reply, never a new top-level comment',async()=>{
  const h=harness({publishEnabled:false});h.post(BOT,'own');await h.baseline();h.advance();h.root(BOT,'own','root-7');h.choose('reply');await h.a.tick();
  assert.equal(h.sent[0].action,'reply_qzone');assert.equal(h.sent[0].args.comment_id,'root-7');assert.equal(h.sent[0].args.reply_uin,OWNER);
  assert.equal(h.observed[0].candidates[0].dialogue[0].is_owner,true);
});
test('multi-round replies retain root, verified speaker and reply context across restart',async()=>{
  const h=harness({publishEnabled:false});h.post(BOT,'own');await h.baseline();h.advance();const root=h.root(BOT,'own','root-7');h.choose('reply');await h.a.tick();
  h.advance(31*MIN);root.replies=[{comment_id:'b1',uin:BOT,name:'bot',time:h.now/1000-60,content:'我在呢'},
    {comment_id:'o2',uin:OWNER,name:'owner',time:h.now/1000,content:'再给你一朵花',reply_to_uin:BOT}];
  const restarted=new QzoneAutonomy({...h.args,decision:async ctx=>{const e=ctx.candidates.find(x=>x.commentId==='o2');assert(e.dialogue.some(d=>d.is_bot));assert.equal(e.dialogue.at(-1).reply_to_id,'root-7');return {action:'reply',eventKey:e.key,text:'那我悄悄收好这朵小花啦。'};}});
  await restarted.tick();assert.equal(h.sent.length,2);assert.equal(h.sent[1].args.comment_id,'root-7');assert.equal(h.sent[1].args.reply_uin,OWNER);
  h.advance();await new QzoneAutonomy(h.args).tick();assert.equal(h.sent.length,2);
});
test('ordinary user named owner and owner replying to a third party do not trigger replies',async()=>{
  const h=harness({publishEnabled:false});h.post(BOT,'own');await h.baseline();h.advance();h.root(BOT,'own','c1',OTHER,[{comment_id:'o2',uin:OWNER,time:h.now/1000,content:'给其他人回复',reply_to_uin:OTHER}]);
  h.choose('reply');await h.a.tick();assert.equal(h.sent.length,0);assert.equal(h.calls,0);
});
test('new owner post can independently receive an AI-chosen like',async()=>{
  const h=harness({publishEnabled:false});await h.baseline();h.advance();h.post(OWNER);h.choose('like');await h.a.tick();assert.equal(h.sent[0].action,'like_qzone');assert.equal(h.sent[0].args.abstime,h.now/1000);
});
test('a falsely successful top-level reply is detected by readback and disables autonomous replies',async()=>{
  const h=harness({publishEnabled:false});h.post(BOT,'own');await h.baseline();h.advance();h.root(BOT,'own','root-7');h.choose('reply');
  const call=h.api.call;h.api.call=async(action,args)=>{
    if(action==='reply_qzone'){
      h.details[BOT+':own'].comments.push({comment_id:'wrong-top-level',uin:BOT,time:h.now/1000,content:args.content,replies:[]});
      h.details[BOT+':own'].comment_num++;return {comment_id:'wrong-top-level'};
    }return call(action,args);
  };
  const result=await h.a.tick();assert.equal(result.unknownOrFailed,true);assert.equal(h.a.state.replyBlocked,true);assert.equal(h.a.state.attempts[0].status,'unknown-or-failed');
});
test('individual switches, global pause, time window and live reload prevent delivery',async()=>{
  for(const opt of [{publishEnabled:false},{activeStart:'13:00'}]){const h=harness(opt);h.choose('post');await h.a.tick();assert.equal(h.sent.length,0);}
  const h=harness();h.choose('post');h.a.reloadOptions=()=>({...h.cfg.autonomy,paused:true});await h.a.tick();assert.equal(h.sent.length,0);
  const stopped=harness();stopped.a.decide=async()=>{stopped.a.stop();return {action:'post',text:'一朵小花呀。'};};await stopped.a.tick();assert.equal(stopped.sent.length,0);
  const dry=harness();dry.choose('post');let reloads=0;
  dry.a.reloadOptions=()=>({...dry.cfg.autonomy,dryRun:++reloads>=2});await dry.a.tick();assert.equal(dry.sent.length,0);assert.equal(dry.a.state.attempts.length,0);
});
test('daily and weekly limits survive restart, weekly maximum is a cap, not a target',async()=>{
  const h=harness();h.now=Date.parse('2026-10-19T12:00:00+08:00');let n=0;h.a.decide=async()=>({action:'post',text:['月亮像一枚藏在口袋里的糖。','今天想给虚拟小猫梳梳毛。','漂浮的云朵会不会觉得痒呀。','薄荷味的小宇宙正在偷偷发芽。'][n++]});
  for(let i=0;i<4;i++){await h.a.tick();h.now+=DAY;}
  assert.equal(h.sent.length,3);
  const restarted=new QzoneAutonomy(h.args);restarted.decide=async()=>({action:'post',text:'另一段不同的文字。'});await restarted.tick();assert.equal(h.sent.length,3);
});
test('custom post limits supported without hardcoded one per day',async()=>{
  const h=harness({maxPerDay:2,minPostIntervalHours:1});let n=0;h.a.decide=async()=>({action:'post',text:n++?'给虚拟小猫扎个蝴蝶结。':'月亮像藏在口袋里的糖果。'});
  await h.a.tick();h.advance(61*MIN);await h.a.tick();assert.equal(h.sent.length,2);
});
test('interaction cooldown, per-thread cap, and repeat text prevent flooding',async()=>{
  const h=harness({publishEnabled:false,maxPerThreadPerDay:1});await h.baseline();h.advance();h.post(OWNER);h.choose('comment');await h.a.tick();
  h.advance(60*MIN);h.choose('like');await h.a.tick();assert.equal(h.sent.length,1);
  const d=harness();d.choose('post');await d.a.tick();d.now+=DAY;await d.a.tick();assert.equal(d.sent.length,1);
});
test('unknown delivery persists before network I/O, consumes quota and is never retried',async()=>{
  const h=harness();h.choose('post');const call=h.api.call;
  h.api.call=async(action,args)=>{if(action==='send_qzone_msg'){const saved=JSON.parse(fs.readFileSync(h.a.file));assert.equal(saved.attempts[0].status,'sending');throw new Error('timeout');}return call(action,args);};
  assert.equal((await h.a.tick()).unknownOrFailed,true);assert.equal(h.a.state.attempts[0].status,'unknown-or-failed');
  h.advance(61*MIN);const next=new QzoneAutonomy(h.args);next.decide=async()=>({action:'post',text:'不要再重复投递这条呀。'});await next.tick();assert.equal(next.state.attempts.length,1);
});
test('dry run produces only a local draft, no mutations or send quota',async()=>{
  const h=harness();h.cfg.autonomy.dryRun=true;h.choose('post');const r=await h.a.tick();assert.equal(r.dryRun,true);assert.equal(h.sent.length,0);assert.equal(h.a.state.attempts.length,0);
  assert.equal(JSON.parse(fs.readFileSync(h.a.file+'.preview.json')).visibility,4);
});
test('privacy rejects keys, QQ, raw private quotes, real-world fiction, and semantic leaks',async()=>{
  for(const text of ['管理员是10001呀','联系我 hello@example.com','我住在绝不能公开的小巷里','我今天去了花园散步','API key EXAMPLE_dc3c3f309d85']){
    const h=harness();h.choose('post',text);await h.a.tick();assert.equal(h.sent.length,0,text);
  }
  const h=harness();h.choose('post');h.a.review=async()=>false;await h.a.tick();assert.equal(h.sent.length,0);
});
test('forged targets, unsupported decisions and changed gateway identity fail closed',async()=>{
  const h=harness();h.a.decide=async()=>({action:'reply',eventKey:'forged',host:OTHER,text:'假的'});await h.a.tick();assert.equal(h.sent.length,0);
  const x=harness();x.choose('post');x.api.onebot=async()=>({user_id:OTHER});await x.a.tick();assert.equal(x.sent.length,0);
});
test('model request preserves persona; raw private data only goes to inner affect and privacy review',async()=>{
  const h=harness(),requests=[];
  h.a.affect=h.a.analyzeAffect.bind(h.a);h.a.review=h.a.reviewPrivacy.bind(h.a);h.a.decide=h.a.generate.bind(h.a);
  h.a.request=async(system,data,opts)=>{requests.push({system,data,opts});
    if(system.includes('角色内心分析'))return {mood:'happy',intensity:0.9,closeness:1,novelty:0.7};
    if(system.includes('发布前隐私核验器'))return {safe:true,containsPrivateFact:false,containsIdentifyingInfo:false,grounded:true};
    return {action:'post',text:'小猫把开心团成了一颗毛线球。'};
  };
  await h.a.tick();assert.equal(h.sent.length,1);assert.equal(requests.length,3);
  assert(JSON.stringify(requests[0]).includes('PRIVATE_MARKER'));assert(!JSON.stringify(requests[1]).includes('PRIVATE_MARKER'));
  assert(requests[1].system.includes('EXISTING_PERSONA'));assert(JSON.stringify(requests[2]).includes('PRIVATE_MARKER'));
});
test('actual compatible DeepSeek messages are inspected through Mock fetch, no real billable call',async()=>{
  const h=harness(),original=globalThis.fetch;
  try{globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://example.invalid/v1/chat/completions');const body=JSON.parse(init.body);
    assert.equal(body.model,'mock-model');assert.deepEqual(body.messages.map(m=>m.role),['system','user']);assert.equal(body.stream,false);
    const data=JSON.parse(body.messages[1].content);assert(!JSON.stringify(data).includes('PRIVATE_MARKER'));
    assert(body.messages[0].content.includes('EXISTING_PERSONA'));return Response.json({choices:[{message:{content:'{"action":"skip"}'}}]});};
    h.a.decide=h.a.generate.bind(h.a);await h.a.tick();assert.equal(h.sent.length,0);
  }finally{globalThis.fetch=original;}
});
test('images use allowlisted hosts and inline data, disallow redirects and arbitrary origins',async()=>{
  const h=harness();let fetched=0;
  const fetcher=async(url,init)=>{fetched++;assert.equal(init.redirect,'error');assert(!init.headers.authorization);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});};
  assert((await readSpaceImage('https://a1.qpic.cn/test',h.api,{fetcher})).startsWith('data:image/png;base64,'));
  for(const u of ['http://a1.qpic.cn/a','https://evil.test/a','https://qpic.cn.evil.test/a','https://EXAMPLE_USER:EXAMPLE_PASSWORD@qpic.cn/a'])await assert.rejects(()=>readSpaceImage(u,h.api,{fetcher}));
  assert.equal(fetched,1);
});
test('owner post pixels reach the actual multimodal model request with an explicit event association',async()=>{
  const h=harness({publishEnabled:false}),original=globalThis.fetch;let imageRequests=0,modelRequests=0;
  await h.baseline();h.advance();h.post(OWNER).images=['https://a1.qpic.cn/mock.png'];
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
  try{globalThis.fetch=async(url,init)=>{
    if(String(url).includes('qpic.cn')){imageRequests++;return new Response(png,{headers:{'content-type':'image/png'}});}
    modelRequests++;const body=JSON.parse(init.body),parts=body.messages[1].content;
    assert(Array.isArray(parts));assert.equal(parts[1].image_url.url,'data:image/png;base64,'+png.toString('base64'));
    const ctx=JSON.parse(parts[0].text),candidate=ctx.candidates.find(c=>c.action==='comment');
    assert.equal(candidate.host,OWNER);assert.equal(candidate.imageStatus,'attached');assert.deepEqual(candidate.imageIndices,[0]);
    return Response.json({choices:[{message:{content:'{"action":"skip"}'}}]});
  };
    h.a.decide=h.a.generate.bind(h.a);await h.a.tick();assert.equal(imageRequests,1);assert.equal(modelRequests,1);assert.equal(h.sent.length,0);
  }finally{globalThis.fetch=original;}
});
test('old autonomous post attempts migrate once and still consume the same day quota',async()=>{
  const h=harness(),legacy=path.join(h.dir,'legacy.json');h.choose('post');
  fs.writeFileSync(legacy,JSON.stringify({version:1,attempts:[{at:h.now,day:'2026-10-23',week:'2026-10-19',kind:'qzone',status:'sent'}],recentPosts:[]}));
  h.a.legacyFile=legacy;await h.a.tick();assert.equal(h.sent.length,0);assert.equal(h.a.state.attempts.length,1);
  const restarted=new QzoneAutonomy(h.args);restarted.legacyFile=legacy;await restarted.tick();assert.equal(restarted.state.attempts.length,1);
});
test('unreadable API and malformed state never fake successful empty reads; backoff',async()=>{
  const h=harness({publishEnabled:false});h.api.call=async()=>{throw new Error('forbidden');};await h.a.tick();assert.equal(h.a.state.lastPoll.ok,false);assert(h.a.state.nextPollAt>h.now+5*MIN);assert.equal(h.sent.length,0);
  fs.writeFileSync(h.a.file,'broken');assert.throws(()=>new QzoneAutonomy(h.args),/损坏/);
  h.choose('post');await h.a.tick();assert.equal(fs.readFileSync(h.a.file,'utf8'),'broken');assert.equal(h.sent.length,0);
});
test('lock and concurrent tick prevent two processes deciding the same operation',async()=>{
  const h=harness();let release;h.a.decide=async()=>{await new Promise(r=>release=r);return {action:'post',text:'只有一朵小花在这里呀。'};};
  const p=h.a.tick();while(!release)await new Promise(r=>setTimeout(r,1));assert.equal((await new QzoneAutonomy(h.args).tick()).skipped,'locked');
  release();await p;assert.equal(h.sent.length,1);
});
test('real reply wire format and failed acknowledgements never masquerade as success',{skip:!licensedProtocol},async()=>{
  const original=globalThis.fetch;let mode='reply';
  try{globalThis.fetch=async(url,init)=>{
    if(mode==='reply'){const body=new URLSearchParams(init.body);assert.equal(body.get('paramstr'),'2');assert.equal(body.get('commentId'),'root-7');assert.equal(body.get('commentUin'),OWNER);assert.equal(body.get('topicId'),BOT+'_post-1__1');return Response.json({code:0,commentid:'r1'});}
    if(mode==='plain'){assert.equal(new URLSearchParams(init.body).get('paramstr'),'1');return Response.json({code:0,commentid:'c1'});}
    return Response.json(mode==='missing'?{}:{code:-3000,message:'unsupported'});
  };
    assert.equal((await commentQzoneMsg({skey:'mock'},BOT,BOT,'post-1','测试回复',undefined,undefined,{commentId:'root-7',uin:OWNER})).comment_id,'r1');
    mode='plain';await commentQzoneMsg({skey:'mock'},BOT,OWNER,'post-1','测试评论');
    for(mode of ['missing','unsupported']){
      await assert.rejects(()=>commentQzoneMsg({skey:'mock'},BOT,BOT,'post-1','测试回复',undefined,undefined,{commentId:'root-7',uin:OWNER}));
      await assert.rejects(()=>setQzoneLike({skey:'mock'},BOT,OWNER,'post-1',true));
    }
  }finally{globalThis.fetch=original;}
});
test('existing adapter routes real replies and details preserve explicit reply recipient',{skip:!licensedProtocol},async()=>{
  const h=harness(),adapter=new QzoneAdapter(h.cfg,{stateDir:h.dir}),original=globalThis.fetch;
  adapter.auth=async()=>({skey:'mock'});
  try{globalThis.fetch=async(url,init)=>{
    if(String(url).includes('msgdetail'))return Response.json({code:0,tid:'p',content:'正文',cmtnum:1,commentlist:[{tid:'c',uin:Number(OWNER),name:'昵称',create_time:h.now/1000,content:'评论',list_3:[{tid:'r',uin:Number(BOT),name:'机器人',create_time:h.now/1000,content:'回复',reply_uin:Number(OWNER)}]}]});
    const body=new URLSearchParams(init.body);assert.equal(body.get('paramstr'),'2');return Response.json({code:0,commentid:'ok'});
  };
    const d=await getQzoneMsgDetail({skey:'mock'},BOT,'p');assert.equal(d.comments[0].replies[0].reply_to_uin,OWNER);
    assert.equal((await adapter.call('reply_qzone',{target_uin:BOT,tid:'p',comment_id:'c',reply_uin:OWNER,content:'你好呀'})).comment_id,'ok');
    await assert.rejects(()=>adapter.call('reply_qzone',{tid:'p',content:'缺对象'}),/可信/);
  }finally{globalThis.fetch=original;}
});
