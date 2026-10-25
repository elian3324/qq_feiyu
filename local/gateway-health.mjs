// Health and login recovery are independent of incoming QQ messages and model calls.
export class GatewayHealth {
  constructor({ fetch = globalThis.fetch, now = Date.now, webui = 'http://127.0.0.1:6099', timeoutMs = 4000, loginGraceMs = 10000 } = {}) {
    this.fetch=fetch;this.now=now;this.webui=webui;this.timeoutMs=timeoutMs;this.started=now();this.loginGraceMs=loginGraceMs;
    this.auth=null;this.attempts=0;this.nextAttempt=0;this.loginBlocked=false;
  }
  async request(url, headers, body = {}) {
    try {
      const response=await this.fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(this.timeoutMs)});
      if(!response.ok)return {http:response.status};
      return await response.json();
    } catch {return null;}
  }
  async inspect(cfg) {
    this.auth=null;
    const headers={authorization:'Bearer '+cfg.onebot.accessToken};
    const [login,status]=await Promise.all(['get_login_info','get_status'].map(action=>this.request(cfg.onebot.httpUrl+'/'+action,headers)));
    if([login,status].some(reply=>[401,403].includes(reply?.http)))return {state:'auth-error',needsLogin:false};
    if(login?.status==='ok' && String(login.data?.user_id)!==String(cfg.botQQ))return {state:'wrong-account',needsLogin:false};
    if(login?.status==='ok' && status?.status==='ok' && status.data?.online===true) {
      this.attempts=0;this.nextAttempt=0;this.loginBlocked=false;
      return {state:'online',needsLogin:false};
    }
    const session=await this.request(this.webui+'/api/local-session',{'X-NapCat-Local-Login':'1'});
    if(session?.code!==0 || !session.data?.Credential)return {state:'gateway-down',needsLogin:false};
    this.auth={authorization:'Bearer '+session.data.Credential};
    const qq=await this.request(this.webui+'/api/QQLogin/CheckLoginStatus',this.auth);
    if(qq?.code!==0)return {state:'gateway-unavailable',needsLogin:false};
    const phase=typeof qq.data?.loginPhase==='string'?qq.data.loginPhase:'';
    if(qq.data?.isLogin && qq.data?.coreReady)return {state:'transport-offline',loginPhase:phase,needsLogin:false};
    if(['waiting_qrcode','offline','login_failed'].includes(phase))return {state:'login-required',loginPhase:phase,needsLogin:true};
    return {state:'reconnecting',loginPhase:phase,needsLogin:false};
  }
  async recoverLogin(cfg, health) {
    if(health.state!=='login-required' || !this.auth)return {action:'none'};
    if(this.loginBlocked)return {action:'scan-required'};
    if(this.now()-this.started<this.loginGraceMs || this.now()<this.nextAttempt)return {action:'waiting'};
    if(this.attempts>=3){this.loginBlocked=true;return {action:'scan-required'};}
    this.attempts++;this.nextAttempt=this.now()+120000;
    const reply=await this.request(this.webui+'/api/QQLogin/SetQuickLogin',this.auth,{uin:String(cfg.botQQ)});
    if(reply?.code===0)return {action:'quick-login-requested'};
    // Expired credentials and security challenges require the real account holder.
    // Never log the raw response, request another password, or loop QR/session resets.
    if(/失效|重新登录|身份|验证|设备|expired|invalid|captcha|device/i.test(String(reply?.message||''))) {
      this.loginBlocked=true;return {action:'scan-required'};
    }
    return {action:'retry-later'};
  }
}

export class ConnectionWatchdog {
  constructor({now=Date.now,graceMs=120000}={}){this.now=now;this.graceMs=graceMs;this.unreadySince=null;}
  shouldRestart({online,hasChild,ready}){
    if(!online || !hasChild || ready){this.unreadySince=null;return false;}
    if(this.unreadySince===null){this.unreadySince=this.now();return false;}
    if(this.now()-this.unreadySince<this.graceMs)return false;
    this.unreadySince=null;return true;
  }
}
