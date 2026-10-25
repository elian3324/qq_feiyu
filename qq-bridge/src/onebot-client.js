// MIT. Independent OneBot v11 transport, using only the public protocol shape.
// No SnowLuma SDK implementation or catalog is included.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
export const text=value=>[{type:'text',data:{text:String(value)}}];
export class SnowLumaWebSocketClient extends EventEmitter {
  constructor({url,accessToken='',reconnect=true,timeoutMs=30000,actions={}}={}){
    super();Object.assign(this,{url,accessToken,reconnect,timeoutMs,actions});
    this.pending=new Map();this.socket=null;this.connecting=null;this.closed=false;
  }
  connect(){
    if(this.socket?.readyState===WebSocket.OPEN)return Promise.resolve();
    if(this.socket?.readyState===WebSocket.CLOSING)return new Promise(resolve=>this.socket.once('close',resolve)).then(()=>this.connect());
    if(this.connecting)return this.connecting;
    this.closed=false;
    this.connecting=new Promise((resolve,reject)=>{
      const address=new URL(this.url);
      if(!['ws:','wss:'].includes(address.protocol)||address.username||address.password)throw new Error('Invalid OneBot WebSocket URL');
      const socket=new WebSocket(address,{headers:this.accessToken?{Authorization:'Bearer '+this.accessToken}:{}});
      this.socket=socket;let opened=false;
      socket.on('open',()=>{opened=true;this.connecting=null;this.emit('open');resolve();});
      socket.on('message',buffer=>{
        let event;try{event=JSON.parse(String(buffer));}catch{return;}
        const pending=this.pending.get(String(event.echo));
        if(pending){this.pending.delete(String(event.echo));clearTimeout(pending.timer);pending.resolve(event);return;}
        this.emit('event',event);
      });
      socket.on('error',()=>{const error=new Error('OneBot WebSocket connection failed');if(this.listenerCount('error'))this.emit('error',error);if(!opened)reject(error);});
      socket.on('close',(code)=>{
        this.connecting=null;
        for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('OneBot disconnected'));}this.pending.clear();
        this.emit('close',{code});
        if(!opened)reject(new Error('OneBot connection closed before ready'));
        if(this.reconnect&&!this.closed){clearTimeout(this.retry);this.retry=setTimeout(()=>this.connect().catch(()=>{}),3000);}
      });
    });
    return this.connecting;
  }
  request(action,params={}){
    if(this.socket?.readyState!==WebSocket.OPEN)return Promise.reject(new Error('OneBot is not connected'));
    const echo=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(echo);reject(new Error('OneBot action timed out'));},this.timeoutMs);
      this.pending.set(echo,{resolve,reject,timer});
      this.socket.send(JSON.stringify({action:this.actions[action]||action,params,echo}),error=>{if(error){clearTimeout(timer);this.pending.delete(echo);reject(new Error('OneBot send failed'));}});
    });
  }
  async raw(action,params={}){const result=await this.request(action,params);if(result.status!=='ok'||Number(result.retcode)!==0)throw new Error('OneBot action failed: '+action);return result.data;}
  close(code=1000,reason='client-close'){this.closed=true;clearTimeout(this.retry);this.socket?.close(code,reason);}
  onEvent(handler){this.on('event',handler);return this;}
  onPrivateMessage(handler){return this.onEvent(event=>{if(event.post_type==='message'&&event.message_type==='private')handler(event);});}
  onGroupMessage(handler){return this.onEvent(event=>{if(event.post_type==='message'&&event.message_type==='group')handler(event);});}
  onNotice(type,handler){return this.onEvent(event=>{if(event.post_type==='notice'&&event.notice_type===type)handler(event);});}
  onBotStatus(handler){return this.onNotice('bot_status',handler);}
  getLoginInfo(){return this.raw('get_login_info');}
  getStatus(){return this.raw('get_status');}
  getGroupMemberList(group_id){return this.raw('get_group_member_list',{group_id});}
  getGroupMemberInfo(group_id,user_id){return this.raw('get_group_member_info',{group_id,user_id});}
  getMessage(message_id){return this.raw('get_msg',{message_id});}
  getImage(params){return this.raw('get_image',typeof params==='string'?{file:params}:params);}
  fetchFaceEntity(face_id){return this.raw('fetch_face_entity',{face_id});}
  sendPrivateMessage(user_id,message){return this.raw('send_private_msg',{user_id,message});}
  sendGroupMessage(group_id,message){return this.raw('send_group_msg',{group_id,message});}
}
