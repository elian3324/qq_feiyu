import {contextFromMessage,normalizeOwnerIds} from './message-context.js';

export function splitOwnerFirst(items,ownerIds) {
  if(!Array.isArray(items)||!items.length)throw new Error('消息批次为空');
  const contexts=items.map(m=>contextFromMessage(m,ownerIds));
  if(contexts.some(c=>c.session_id!==contexts[0].session_id))throw new Error('不能合并不同会话的消息');
  if(contexts[0].chat_type!=='group')return [items];
  const owner=[],others=[];
  items.forEach((m,i)=>(contexts[i].is_owner?owner:others).push(m));
  return [owner,others].filter(batch=>batch.length);
}

// Priority applies to waiting work. Never interrupt an operation already running.
export class TurnQueue {
  constructor({ownerIds,run,onError=()=>{}}){this.ownerIds=normalizeOwnerIds(ownerIds);this.run=run;this.onError=onError;this.states=new Map();}
  has(key){return this.states.has(key);}
  enqueue(items){
    for(const batch of splitOwnerFirst(items,this.ownerIds)){
      const context=contextFromMessage(batch.at(-1),this.ownerIds),key=context.session_id;
      let state=this.states.get(key);
      if(!state){state={jobs:[],running:false};this.states.set(key,state);}
      const job={items:batch,priority:context.is_owner?0:1};
      const at=state.jobs.findIndex(other=>other.priority>job.priority);
      if(at<0)state.jobs.push(job);else state.jobs.splice(at,0,job);
      if(!state.running){state.running=true;queueMicrotask(()=>this.drain(key,state));}
    }
  }
  async drain(key,state){
    try{while(state.jobs.length){const job=state.jobs.shift();try{await this.run(job.items);}catch(error){this.onError(error);}}}
    finally{if(this.states.get(key)===state)this.states.delete(key);}
  }
}
