import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createMessageContext} from './message-context.js';
import {extractOwnerFacts} from './owner-memory.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function atomic(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';try{const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify(data,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}

// Durable owner-only source queue. Empty extraction is success; HTTP/JSON/write
// failures keep the source for retry. Never backfill guessed legacy identities.
export class OwnerMemoryWorker {
  constructor({ledger,...options}){this.ledger=ledger;this.options=options;this.file=path.join(path.dirname(ledger.file),'owner-memory-pending.json');this.archiveFile=path.join(path.dirname(ledger.file),'owner-message-archive.jsonl');this.healthFile=path.join(path.dirname(ledger.file),'owner-memory-health.json');this.busy=null;this.retryAt=0;this.ledger.initialize();this.read();}
  read(){try{const s=JSON.parse(fs.readFileSync(this.file,'utf8'));if(s.version!==1||!Array.isArray(s.pending)||!Array.isArray(s.processed))throw new Error('invalid');return s;}catch(e){if(e.code==='ENOENT')return {version:1,pending:[],processed:[]};throw new Error('管理员记忆待处理队列损坏，保留原文件');}}
  enqueue(messages,{at=Date.now()}={}){
    const state=this.read(),known=new Set([...state.processed,...state.pending.map(m=>m.id)]);let added=0;
    for(const m of messages){
      let c;try{c=createMessageContext(m.session_id,m.sender_id,this.ledger.ownerIds);}catch{continue;}
      if(!c.is_owner||typeof m.text!=='string'||!m.text.trim()||/^\[(?:图片|表情包|语音|视频|文件|拍一拍)\]$/.test(m.text.trim()))continue;
      const text=m.text.trim().slice(0,4000);
      if(/sk-[a-zA-Z0-9_-]{8,}|(?:密钥|密码|API[ _-]?key|验证码)\s*(?:是|为|[:：])\s*\S+/i.test(text))continue;
      const sourceAt=Number.isFinite(m.source_at)?m.source_at:at;
      const id=digest([c.session_id,c.sender_id,m.message_id||'',sourceAt,text]);
      const entry={id,...c,text,source_at:sourceAt,...(m.message_id?{message_id:m.message_id}:{}),source_date:new Date(sourceAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})};
      // Keep verified owner sources for recovery, never inject this raw archive
      // as established facts or share it with group members.
      this.archiveIds||=new Set(fs.existsSync(this.archiveFile)?fs.readFileSync(this.archiveFile,'utf8').split('\n').flatMap(line=>{try{return [JSON.parse(line).id];}catch{return [];}}):[]);
      if(!this.archiveIds.has(id)){const fd=fs.openSync(this.archiveFile,'a');try{fs.writeSync(fd,JSON.stringify(entry)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}this.archiveIds.add(id);}
      if(known.has(id))continue;
      state.pending.push(entry);known.add(id);added++;
    }
    if(added)atomic(this.file,state);this.health(state);return added;
  }
  backfill(){
    const dir=path.join(path.dirname(this.ledger.file),'sessions');let added=0;
    if(fs.existsSync(this.archiveFile))for(const line of fs.readFileSync(this.archiveFile,'utf8').split('\n')){let entry;try{entry=JSON.parse(line);}catch{continue;}added+=this.enqueue([entry]);}
    if(!fs.existsSync(dir))return 0;
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(!entry.isDirectory()||!/^(group|private)-[1-9]\d*$/.test(entry.name))continue;
      const session=entry.name.replace('-',':'),file=path.join(dir,entry.name,'turns.jsonl');if(!fs.existsSync(file))continue;
      for(const line of fs.readFileSync(file,'utf8').split('\n')){let row;try{row=JSON.parse(line);}catch{continue;}
        if(row.schema_version!==2||row.where!==session||!Number.isFinite(row.t)||!Array.isArray(row.messages))continue;
        added+=this.enqueue(row.messages.filter(m=>!m.session_id||m.session_id===session).map(m=>({...m,session_id:session,source_at:Number.isFinite(m.source_at)?m.source_at:row.t})),{at:row.t});
      }
    }
    return added;
  }
  health(state=this.read(),error=false){const data=this.ledger.read();atomic(this.healthFile,{at:new Date().toISOString(),ready:true,facts:Object.values(data.owners).reduce((n,p)=>n+p.facts.length,0),pending:state.pending.length,processed:state.processed.length,lastFailureAt:error?new Date().toISOString():this.lastFailureAt||null});}
  start(){this.backfill();this.timer=setInterval(()=>this.flush().catch(()=>{}),60000);this.timer.unref();void this.flush().catch(()=>{});}
  stop(){clearInterval(this.timer);}
  async flush({all=false,force=false}={}){
    if(this.busy)return this.busy;if(!force&&Date.now()<this.retryAt)return;
    this.busy=(async()=>{do{
      const batch=this.read().pending.slice(0,12);if(!batch.length){this.health();break;}
      try{
        const facts=await extractOwnerFacts({...this.options,ownerIds:this.ledger.ownerIds,messages:batch,strictErrors:true});
        for(const pair of new Set(batch.map(m=>JSON.stringify([m.sender_id,m.session_id])))){const [sender,session]=JSON.parse(pair);const selected=facts.filter(f=>f.sender_id===sender&&f.session_id===session);if(selected.length)this.ledger.remember(sender,selected,session);}
        const latest=this.read(),ids=new Set(batch.map(m=>m.id));latest.pending=latest.pending.filter(m=>!ids.has(m.id));latest.processed=[...new Set([...latest.processed,...ids])];atomic(this.file,latest);this.health(latest);
      }catch{this.lastFailureAt=new Date().toISOString();this.retryAt=Date.now()+60000;this.health(this.read(),true);console.error('[memory] 管理员记忆暂未提取，原发言已保存，后台会重试');break;}
    }while(all);})().finally(()=>{this.busy=null;});return this.busy;
  }
}
