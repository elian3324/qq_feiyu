import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Diary} from './diary.js';
import {composeDiary} from './diary-author.js';
import {normalizeId,normalizeOwnerIds} from './message-context.js';

export function diaryClock(now=Date.now(),timeZone='Asia/Shanghai') {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  return {day:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute,minute:Number(p.hour)*60+Number(p.minute)};
}
export function diaryOptions(value={}) {
  const out={enabled:false,time:'23:00',timezone:'Asia/Shanghai',...value};
  if(typeof out.enabled!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(out.time))throw new Error('日记配置无效，请使用 enabled 布尔值及 HH:mm 时间');
  diaryClock(Date.now(),out.timezone);return out;
}
function save(file,data){const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(data,null,2),'utf8');fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}

export class DiaryWriter {
  constructor({cfg,generate=composeDiary,now=Date.now}) {
    this.cfg=cfg;this.generate=generate;this.now=now;this.options=diaryOptions(cfg.diary);
    this.owners=normalizeOwnerIds(cfg.ownerIds||[]);
    this.dataDir=path.resolve(cfg.dataDir);this.diary=new Diary({dir:cfg.diaryDir||path.join(this.dataDir,'diary'),maxChars:cfg.diaryMaxChars||2000});
    this.lockFile=path.join(this.diary.dir,'.write.lock');this.stateFile=path.join(this.diary.dir,'schedule-state.json');
  }
  redact(value){
    let text=String(value||'');
    for(const secret of [this.cfg.apiKey,this.cfg.onebot?.accessToken,...this.owners,this.cfg.botQQ])if(secret)text=text.replaceAll(String(secret),'[已隐去]');
    return text.replace(/sk-[A-Za-z0-9_-]+|Bearer\s+\S+/gi,'[已隐去]').replace(/(?:密码|密钥|验证码|api.?key)\s*(?:是|为|[:：])\s*\S+/gi,'[凭据已隐去]').replace(/\b\d{5,}\b/g,'[编号已隐去]');
  }
  sources(now=this.now()) {
    const day=diaryClock(now,this.options.timezone).day,dir=path.join(this.dataDir,'sessions'),rows=[];
    if(!fs.existsSync(dir))return [];
    for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      if(!item.isDirectory()||item.isSymbolicLink())continue;
      const match=/^(private|group)-([1-9]\d*)$/.exec(item.name);if(!match||!normalizeId(match[2]))continue;
      if(match[1]==='private'&&!this.owners.includes(match[2]))continue;
      if(match[1]==='group'&&!(this.cfg.allow?.groups||[]).map(String).includes(match[2]))continue;
      const key=match[1]+':'+match[2],file=path.join(dir,item.name,'turns.jsonl');if(!fs.existsSync(file))continue;
      for(const line of fs.readFileSync(file,'utf8').split('\n')){
        let turn;try{turn=JSON.parse(line);}catch{continue;}
        if(turn.schema_version!==2||turn.where!==key||!Number.isFinite(turn.t)||turn.t>now||diaryClock(turn.t,this.options.timezone).day!==day||!Array.isArray(turn.messages))continue;
        for(const m of turn.messages){
          if(!this.owners.includes(normalizeId(m.sender_id))||typeof m.text!=='string'||!m.text.trim()||(m.session_id!=null&&m.session_id!==key))continue;
          if(match[1]==='private'&&String(m.sender_id)!==match[2])continue;
          rows.push({at:turn.t,chat_type:match[1],speaker:'管理员',text:this.redact(m.text).slice(0,800)});
        }
      }
    }
    return rows.sort((a,b)=>a.at-b.at).slice(-40).map(({at,...row})=>({...row,time:diaryClock(at,this.options.timezone).time}));
  }
  acquire(){
    const token=randomUUID();
    for(let i=0;i<2;i++)try{
      const fd=fs.openSync(this.lockFile,'wx');try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,token}));}finally{fs.closeSync(fd);}return token;
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      const held=JSON.parse(fs.readFileSync(this.lockFile,'utf8'));
      if(!Number.isSafeInteger(held.pid)||held.pid<1)throw new Error('日记锁异常，请保留文件排查');
      try{process.kill(held.pid,0);return null;}catch(e){if(e.code!=='ESRCH')return null;fs.unlinkSync(this.lockFile);}
    }
    return null;
  }
  release(token){try{if(JSON.parse(fs.readFileSync(this.lockFile,'utf8')).token===token)fs.unlinkSync(this.lockFile);}catch{}}
  state(){try{const s=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));if(!Number.isInteger(s.attempts)||s.attempts<0||!Number.isFinite(s.lastAttemptAt))throw new Error();return s;}catch(e){if(e.code==='ENOENT')return {attempts:0,lastAttemptAt:0};throw new Error('日记状态无法读取，保留原文件，停止自动重试');}}
  async write({scheduled=false,hint=''}={}) {
    if(this.cfg.dryRun)return {status:'dry-run'};
    const token=this.acquire();if(!token)return {status:'busy'};
    try{
      const now=this.now(),stamp=diaryClock(now,this.options.timezone),options=this.options;
      const existing=this.diary.day(stamp.day).at(-1);if(existing)return {status:'existing',entry:existing};
      if(scheduled){
        const due=Number(options.time.slice(0,2))*60+Number(options.time.slice(3));
        if(!options.enabled||stamp.minute<due)return {status:'not-due'};
        const previous=this.state(),state=previous.day===stamp.day?previous:{day:stamp.day,attempts:0,lastAttemptAt:0};
        if(state.attempts>=3||state.lastAttemptAt&&now-state.lastAttemptAt<300000)return {status:'retry-later'};
        save(this.stateFile,{...state,attempts:state.attempts+1,lastAttemptAt:now,status:'attempting'});
      }
      const roleText=fs.readFileSync(this.cfg.roleCard,'utf8'),sources=this.sources(now);
      const row=await this.generate({...this.cfg,roleText,memoryText:JSON.stringify({day:stamp.day,verified_owner_messages:sources}),diaryText:this.redact(this.diary.context(3,3)),avoidText:this.redact(this.diary.recent(4).map(r=>r.title+'｜'+r.text.slice(0,80)).join('\n')),maxChars:this.diary.maxChars,hint:this.redact(hint),now:new Date(now),timeZone:options.timezone,angle:'今天真实交流带来的小心情；没有交流就写此刻的想法，不虚构事件'});
      // Do not persist credentials or platform identifiers echoed by a model.
      const entry=this.diary.add({...row,text:this.redact(row.text),title:this.redact(row.title),mood:this.redact(row.mood),tags:(row.tags||[]).map(t=>this.redact(t)),day:stamp.day,time:stamp.time,t:now});
      if(scheduled){const state=this.state();save(this.stateFile,{...state,status:'saved',savedDay:stamp.day});}
      return {status:'saved',entry,sourceCount:sources.length};
    }finally{this.release(token);}
  }
}

export class DiaryScheduler {
  constructor({writer,onStatus=()=>{}}){this.writer=writer;this.onStatus=onStatus;this.busy=false;}
  async tick(){
    if(this.busy)return {status:'busy'};this.busy=true;
    try{const result=await this.writer.write({scheduled:true});this.onStatus(result.status);return result;}
    catch{this.onStatus('failed');console.error('[diary] 本次日记未保存，将按重试规则处理');return {status:'failed'};}
    finally{this.busy=false;}
  }
  start(){if(this.timer||!this.writer.options.enabled)return;this.timer=setInterval(()=>this.tick(),60000);this.timer.unref();this.initial=setTimeout(()=>this.tick(),2000);this.initial.unref();console.log('[diary] 自动日记已启用，每天 '+this.writer.options.time+'（'+this.writer.options.timezone+'），仅本地保存');}
  stop(){clearInterval(this.timer);clearTimeout(this.initial);this.timer=null;}
}
