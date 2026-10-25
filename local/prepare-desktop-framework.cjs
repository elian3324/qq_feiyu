const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'gateway/napcat-framework');
function patch(name, change) {
  const file=path.join(dir,name),backup=file+'.official';
  if(!fs.existsSync(backup))fs.copyFileSync(file,backup);
  let source=fs.readFileSync(backup,'utf8');source=change(source);fs.writeFileSync(file,source);
}
function once(text,from,to){if(text.split(from).length!==2)throw new Error('Framework integration anchor changed');return text.replace(from,to);}
function prepareDesktopWebUi(){
  const staticDir=path.join(dir,'static'),index=path.join(staticDir,'index.html'),backup=index+'.official';
  if(!fs.existsSync(backup))fs.copyFileSync(index,backup);
  const source=fs.readFileSync(backup,'utf8');
  const html=once(source,'<head>','<head>\n        <meta name="companion-login" content="desktop-framework" />');
  fs.writeFileSync(index,html);
  fs.copyFileSync(path.join(__dirname,'desktop-login.html'),path.join(staticDir,'desktop-login.html'));
  // This Framework archive omits its SW template. Reuse the project's already
  // tested network-only navigation rules so old cached login HTML is replaced.
  const swSource=fs.readFileSync(path.join(root,'gateway/napcat/napcat/static/sw_template.js'),'utf8');
  if(swSource.split('-local-login-1').length!==3)throw new Error('Local WebUI service worker template changed');
  fs.writeFileSync(path.join(staticDir,'sw_template.js'),swSource.replaceAll('-local-login-1','-desktop-login-1'));
}
// Static-only deployment updates an already running Framework without touching QQ.
if(process.argv.includes('--webui-only')){prepareDesktopWebUi();console.log('PASS: desktop login guidance updated; QQ process unchanged');return;}
patch('napcat.cjs',text=>{
  text="const {lifecycle}=require('../../local/qq-auth-audit.cjs');\nconst {createQQNativeServices}=require('../../local/qq-native-services.cjs');\nconst companionNativeServices=createQQNativeServices({onReady({session,loginService}){wrapperSession=session;wrapperLoginService=loginService;initializeNapCat().catch(error=>lifecycle('framework-initialization-failed',error));}});\nconst companionSessionBridge=companionNativeServices.sessionBridge;\n"+text;
  const serviceStart=text.indexOf('function createServiceProxy (ServiceName) {');
  const serviceEnd=text.indexOf('function clearHook () {',serviceStart);
  if(serviceStart<0||serviceEnd<serviceStart)throw new Error('Framework service proxy anchor changed');
  text=text.slice(0,serviceStart)+`function createServiceProxy (ServiceName) {
  return companionNativeServices.wrapService(ServiceName, wrapperNodeApi[ServiceName]);
}

`+text.slice(serviceEnd);
  text=once(text,'async function initializeNapCat () {',"async function initializeNapCat () {\n  lifecycle('framework-import-start');");
  text=once(text,'    getWebUiUrlFunc = getWebUiUrl;',"    lifecycle('framework-import-complete');\n    getWebUiUrlFunc = getWebUiUrl;");
  text=once(text,"    console.log('[NapCat] [Error] 初始化NapCat', error);","    lifecycle('framework-initialization-failed',error);\n    console.log('[NapCat] [Error] 初始化NapCat', error);");
  text=once(text,'  wrapperLoginService = wrapperNodeApi.NodeIKernelLoginService.get();',"  lifecycle('wrapper-native-ready');\n  // Wait for QQ to call its real login factory; do not create a service here.");
  text=once(text,'  wrapperSession = wrapperNodeApi.NodeIQQNTWrapperSession.create();','  // QQ owns session creation; capture the session returned to its own application.');
  text=once(text,'  initializeNapCat().then().catch();','');
  text=once(text,'let ncCallback = () => { };','');
  text=once(text,'(callback) => { ncCallback = callback; }','(callback) => { companionSessionBridge.registerInitCallback(callback); }, () => companionSessionBridge.getSessionIdentity()');
  text=once(text,'  const dlopenRet = dlopenOrig(module, filename, flags);',`  if (filename.includes('wrapper.node') || filename.includes('major.node')) {
    try {if(process.env.COMPANION_AUTH_AUDIT_FILE)require('node:fs').appendFileSync(process.env.COMPANION_AUTH_AUDIT_FILE,JSON.stringify({at:new Date().toISOString(),event:filename.includes('wrapper.node')?'wrapper-load':'major-load'})+'\\n');}catch{}
  }
  const dlopenRet = dlopenOrig(module, filename, flags);`);
  return text;
});
patch('napcat.mjs',text=>{
  text="import {installLocalWebUiLogin} from '../../local/webui-local-login.mjs';\n"+text;
  text=once(text,'  app.use("/webui", express.static(pathWrapper.staticPath, {',`  installLocalWebUiLogin(app, {
    staticPath:pathWrapper.staticPath,
    getCredential:async()=>{
      const config=await WebUiConfig.GetWebUIConfig(),token=getInitialWebUiToken();
      if(config.enable2FA||!token)return null;
      return Buffer.from(JSON.stringify(AuthHelper.signCredential(AuthHelper.generatePasswordHash(token)))).toString('base64');
    }
  });
  app.use("/webui", express.static(pathWrapper.staticPath, {`);
  text=once(text,'async function NCoreInitFramework(session, loginService, registerInitCallback) {','async function NCoreInitFramework(session, loginService, registerInitCallback, getSessionIdentity) {');
  text=once(text,'    loginService.addKernelLoginListener(proxiedListenerOf(loginListener, logger));',`    // The complete QQ app may have connected before this asynchronous adapter loaded.
    // Register actions independently of a future onLoginConnected notification.
    registerWebUiLoginCallbacks(loginService, loginContext, logger);
    loginService.addKernelLoginListener(proxiedListenerOf(loginListener, logger));
    loginService.getLoginList().then(res=>{
      const list=res.LocalLoginInfoList.filter(item=>item.isQuickLogin);
      WebUiDataRuntime.setQQQuickLoginList(list.map(item=>item.uin.toString()));
      WebUiDataRuntime.setQQNewLoginList(list);
    }).catch(()=>logger.logWarn('[Framework] Login history is temporarily unavailable'));`);
  const start=text.indexOf('    loginListener.onQRCodeLoginSucceed = async (loginResult) => {');
  const end=text.indexOf('    loginListener.onQRCodeGetPicture =',start);
  if(start<0||end<0)throw new Error('Framework login integration anchor changed');
  const handler=`    let nativeReady=false,pendingLogin=null;
    const completeLogin=(loginResult)=>{
      if(!loginResult || !/^[1-9]\\d{4,18}$/.test(String(loginResult.uin)) || typeof loginResult.uid!=='string' || !loginResult.uid)return;
      if(process.env.COMPANION_EXPECTED_QQ && String(loginResult.uin)!==process.env.COMPANION_EXPECTED_QQ){
        logger.logWarn('[Framework] Other QQ account ignored; companion stays disconnected');
        const existing=WebUiDataRuntime.getOneBotContext();
        if(existing?.core){existing.core.selfInfo.online=false;process.exit(17);}
        return;
      }
      loginContext.isLogined=true;
      WebUiDataRuntime.setQQLoginStatus(true);
      WebUiDataRuntime.setQQLoginError('');
      const context=WebUiDataRuntime.getOneBotContext();
      if(context?.core?.selfInfo){context.core.selfInfo.online=true;WebUiDataRuntime.setQQLoginPhase('ready');}
      else WebUiDataRuntime.setQQLoginPhase('initializing');
      resolve({uid:loginResult.uid,uin:String(loginResult.uin),nick:'',online:true});
    };
    const currentIdentity=()=>typeof getSessionIdentity==='function'?getSessionIdentity():pendingLogin;
    registerInitCallback(()=>{nativeReady=true;completeLogin(currentIdentity());});
    loginListener.onQRCodeLoginSucceed=async(loginResult)=>{
      pendingLogin=loginResult;
      if(nativeReady)completeLogin(currentIdentity());
    };
`;
  return text.slice(0,start)+handler+text.slice(end);
});
const {prepareDesktopEntry}=require('./prepare-desktop-entry.cjs');
const deployment=prepareDesktopEntry(root);
prepareDesktopWebUi();
if(deployment.externalDesktop){
  console.log('PASS: Framework prepared for the selected installed QQ version; QQ binaries and package metadata unchanged; project loadNapCat.js '+(deployment.loaderCreated?'added':'verified'));
}else{
  console.log('PASS: Framework and project QQ entry prepared for the selected version; original package backup preserved');
}
