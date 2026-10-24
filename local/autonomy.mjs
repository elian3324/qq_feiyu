import {ChatAutonomy} from './chat-autonomy.mjs';
import {QzoneAutonomy} from './qzone-autonomy.mjs';
import {QzoneAdapter} from './qzone-adapter.mjs';
export {saveJson,localTime,validPublicText,validContextFacts} from './autonomy-utils.mjs';
export class Autonomy extends ChatAutonomy {
  constructor(args){
    const gateway=args.qzone||new QzoneAdapter(args.cfg);
    super({...args,qzone:gateway});
    this.space=args.space||new QzoneAutonomy({...args,qzone:gateway,
      ...(args.stateFile?{stateFile:args.stateFile+'.qzone.json'}:{})});
    this.space.legacyFile=this.stateFile;
    this.space.reloadOptions=()=>{this.refresh();return this.options;};
  }
  async tick(){
    if(!this.active)return {skipped:'busy-or-stopped'};
    try{this.refresh();}catch{ return {skipped:'error'}; }
    if(this.options.paused)return {skipped:'disabled'};
    // Separate locks/states allow private thought to progress during slow space requests.
    const [chat,space]=await Promise.allSettled([this.tickChat(),this.space.tick(this.options)]);
    const result=this.options.chat.enabled?chat:space;
    return result.status==='fulfilled'?result.value:{skipped:'error'};
  }
  start(){
    if(this.timer)return;this.active=true;this.space.active=true;
    this.timer=setInterval(()=>this.tick(),Math.max(10,this.options.checkIntervalSeconds||60)*1000);this.timer.unref();
    this.initial=setTimeout(()=>this.tick(),1500);this.initial.unref();
    console.log('[autonomy] 私聊与空间独立后台思考就绪，各自受开关控制');
  }
  stop(){this.active=false;this.space.stop();clearInterval(this.timer);clearTimeout(this.initial);this.timer=null;}
}
export async function createAutonomy(args){return new Autonomy(args);}
