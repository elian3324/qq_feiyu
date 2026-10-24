import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

export class QzoneAdapter {
  constructor(cfg,{stateDir=new URL('../data/',import.meta.url)}={}) {
    this.cfg=cfg;this.stateDir=stateDir instanceof URL?stateDir:pathToFileURL(path.resolve(stateDir)+path.sep);
    fs.mkdirSync(this.stateDir,{recursive:true});
    this.rateFile=new URL('qzone-rate.json',this.stateDir);
    this.auditFile=new URL('qzone-actions.jsonl',this.stateDir);
  }
  async onebot(action,body={}) {
    const space=this.cfg.qzone||{};
    if(space.enabled!==true) throw new Error('QQ 空间未启用；请配置兼容的空间网关');
    const mapped=space.actions?.[action]||action;
    if(!/^[a-zA-Z0-9_]+$/.test(mapped)) throw new Error('空间动作名称无效');
    const url=new URL((space.httpUrl||this.cfg.onebot.httpUrl).replace(/\/+$/,'')+'/'+mapped);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw new Error('空间网关地址无效');
    const headers={'content-type':'application/json'};
    const token=space.accessToken||this.cfg.onebot.accessToken;
    if(token)headers.authorization='Bearer '+token;
    const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});
    const result=await response.json();
    if(!response.ok||result.status!=='ok')throw new Error('空间网关动作失败：'+action+'；请检查网关是否支持此扩展');
    return result.data;
  }
  async auth() {
    if(this.credentials && Date.now()-this.credentialsAt<300000) return this.credentials;
    const data=await this.onebot('get_credentials',{domain:'qzone.qq.com'});
    const cookies=Object.fromEntries(String(data.cookies||'').split(';').map(item=>{const i=item.indexOf('=');return i>0?[item.slice(0,i).trim(),item.slice(i+1).trim()]:null;}).filter(Boolean));
    if(!cookies.p_skey && !cookies.skey) throw new Error('QQ 网关尚未提供有效的空间登录凭据');
    this.credentials=cookies;this.credentialsAt=Date.now();return cookies;
  }
  limit(kind) {
    const lockFile=new URL('qzone-rate.lock',this.stateDir);let lock;
    try {lock=fs.openSync(lockFile,'wx');fs.writeFileSync(lock,String(process.pid));}
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      const pid=Number(fs.readFileSync(lockFile,'utf8'));
      if(!Number.isInteger(pid)||pid<1)throw new Error('空间限流锁损坏');
      try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){fs.unlinkSync(lockFile);return this.limit(kind);}}
      throw new Error('空间操作正在执行，请稍后再试');
    }
    try {
    let state={};try{state=JSON.parse(fs.readFileSync(this.rateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('空间限流状态损坏，请保留状态并排查');}
    const now=Date.now();const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
    const hits=(state[kind]||[]).filter(h=>now-h.t<86400000);
    const recent=hits.filter(h=>now-h.t<(kind==='comment'?600000:60000));
    const daily=hits.filter(h=>h.day===day);
    const latest=this.cfg.configFile?JSON.parse(fs.readFileSync(this.cfg.configFile,'utf8')):this.cfg;
    const configured=Number(latest.autonomy?.qzone?.maxPerDay);
    const unlimitedInteractions=latest.autonomy?.qzone?.interactionDailyLimitEnabled===false;
    const dailyMax=kind==='post'?Math.max(2,Number.isInteger(configured)?Math.min(5,configured):2):unlimitedInteractions?Infinity:kind==='comment'?10:20;
    if(recent.length>=(kind==='comment'?2:3) || daily.length>=dailyMax) throw new Error('QQ 空间操作达到频率限制，请稍后再试');
    hits.push({t:now,day});state[kind]=hits;
    const temp=fileURLToPath(this.rateFile)+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,JSON.stringify(state));fs.renameSync(temp,this.rateFile);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    }finally{fs.closeSync(lock);fs.unlinkSync(lockFile);}
  }
  async call(action,args={}) {
    const self=String(this.cfg.botQQ);
    if(action==='get_qzone_msg_list') return this.onebot(action,{...args,target_uin:String(args.target_uin||self),pos:0,num:Math.min(20,args.num||5)});
    if(action==='get_qzone_feeds') return this.onebot(action,{...args,count:Math.min(20,args.count||8)});
    if(action==='get_qzone_msg_detail') return this.onebot(action,{...args,target_uin:String(args.target_uin||self),pos:Math.max(0,Number(args.pos)||0),num:Math.min(50,Number(args.num)||20)});
    let result;
    if(action==='send_qzone_msg') {
      if(!String(args.content||'').trim()) throw new Error('说说正文不能为空');
      if((args.images||[]).length>9) throw new Error('最多 9 张图');
      const dirs=[new URL('../data/shots/',import.meta.url),new URL('../data/pictures/',import.meta.url)].map(fileURLToPath);
      for(const image of args.images||[]) {
        if(/^https?:\/\//i.test(image)) throw new Error('请先把配图保存到本项目 data/pictures 目录');
        const absolute=fs.realpathSync(String(image).startsWith('file:')?fileURLToPath(image):path.resolve(image));
        if(!dirs.some(dir=>absolute.toLowerCase().startsWith(path.resolve(dir).toLowerCase()+path.sep))) throw new Error('图片不在允许目录内');
      }
      this.limit('post');
      result=await this.onebot(action,{...args,ugc_right:args.ugc_right??4});
      if(typeof result?.tid!=='string'||!result.tid||result.tid.length>256) throw new Error('空间发布未返回有效 tid，请先查看空间，勿重复发布');
    } else if(action==='like_qzone') {
      this.limit('like');result=await this.onebot(action,{...args,target_uin:String(args.target_uin||self)});
    } else if(action==='comment_qzone'||action==='reply_qzone') {
      const reply=action==='reply_qzone'?{commentId:args.comment_id,uin:args.reply_uin}:undefined;
      if(reply&&(!String(reply.commentId??'')||!/^[1-9]\d*$/.test(String(reply.uin))))throw new Error('回复缺少可信的评论或接收者');
      if(!String(args.content||'').trim()||String(args.content).length>600)throw new Error('空间评论内容无效');
      this.limit('comment');result=await this.onebot(action,{...args,target_uin:String(args.target_uin||self)});
    } else throw new Error('不支持的空间操作');
    fs.appendFileSync(this.auditFile,JSON.stringify({t:new Date().toISOString(),action,tid:result?.tid||args.tid||'',visibility:args.ugc_right??4})+'\n');
    return result;
  }
}
