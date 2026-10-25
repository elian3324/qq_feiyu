import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url));
const cfgFile = path.join(root, 'ai-companion-kit/packages/companion/config.json');
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8').replace(/^\uFEFF/, ''));
const key = cfg.apiKey || process.env.DASHSCOPE_API_KEY || '';
const modelOnly = process.argv.includes('--model-only');
const offline = process.argv.includes('--offline');
let fail = 0, pending = 0;
const pass = s => console.log('[PASS] ' + s);
const wait = s => { pending++; console.log('[PENDING] ' + s); };
const bad = s => { fail++; console.log('[FAIL] ' + s); };
const redact = s => String(s).replaceAll(key || '__NO_KEY__', '[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
async function checkModel() {
  if (!key) { wait('Fill in your Bailian API Key with Configure.cmd.'); return; }
  try {
    const response = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ ...cfg.modelOptions, model: cfg.model, messages: [{ role: 'user', content: '请只回答：连接成功' }], max_tokens: 32, stream: false }),
      signal: AbortSignal.timeout(45000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + (data.error?.code || data.code || '') + ' ' + (data.error?.message || data.message || ''));
    if (!data.choices?.[0]?.message?.content?.trim()) throw new Error('Empty model response');
    pass('Bailian authenticated chat completion: ' + cfg.model);
  } catch(e) { bad('Bailian: ' + redact(e.message)); }
}
if (!modelOnly) {
  pass('Node ' + process.version);
  try {
    const require = createRequire(path.join(root,'ai-companion-kit/package.json'));
    for(const dependency of ['ws','zod','@modelcontextprotocol/sdk/client/index.js']) require.resolve(dependency);
    pass('All companion and MCP dependencies are installed.');
  } catch(e) { bad('Dependency: ' + e.message); }
  try {
    const { Role } = await import('../ai-companion-kit/packages/companion/src/role.js');
    const role = new Role({cardPath:path.resolve(path.dirname(cfgFile),cfg.roleCard),maxChars:cfg.roleMaxChars});
    const result=role.lint();
    result.ok ? pass('Role card validation') : bad('Role card: '+result.warn.join('; '));
  } catch(e) { bad('Role: '+e.message); }
  cfg.ownerIds.length && cfg.botQQ ? pass('Owner and bot QQ configured.') : wait('Owner and bot QQ not configured.');
  try {
    const out=execFileSync((process.env.PHONE_ADB||'adb'),['version'],{windowsHide:true,encoding:'utf8',timeout:5000});
    pass(out.split(/\r?\n/)[0]);
    const devices=execFileSync((process.env.PHONE_ADB||'adb'),['devices'],{windowsHide:true,encoding:'utf8',timeout:5000});
    if(/\tdevice\b/.test(devices)) pass('Android device connected.');
    else if(cfg.toolModule) wait('Phone tools are installed; unlock the connected Android phone and allow USB debugging.');
    else console.log('[OPTIONAL] Phone control requires a connected and authorized Android device.');
  } catch(e) { bad('ADB: '+e.message); }
  try {
    const out=execFileSync((process.env.FFMPEG_PATH||'ffmpeg'),['-version'],{windowsHide:true,encoding:'utf8',timeout:5000});
    pass(out.split(/\r?\n/)[0]);
  } catch(e) { bad('FFmpeg: '+e.message); }
  if(cfg.toolModule) {
    try {
      await import('./multimedia.mjs');
      const {segsToText}=await import('../ai-companion-kit/packages/companion/src/transport-onebot.js');
      if(!segsToText([{type:'face',data:{id:14}}]).includes('微笑')) throw new Error('QQ face dictionary unavailable');
      if(!cfg.vision?.enabled || !cfg.vision.model || !cfg.voice?.enabled || !cfg.voice.model) throw new Error('Multimedia configuration incomplete');
      if(cfg.vision.model!==cfg.model||cfg.vision.mode!=='native')throw new Error('Vision must use the current native chat model');
      const {Stickers}=await import('./stickers.mjs');
      const library=new Stickers(cfg).entries({key:'private:'+cfg.ownerIds[0],userId:cfg.ownerIds[0]});
      if(cfg.stickers?.enabled&&!library.length)throw new Error('Sticker catalog is empty');
      pass('Native image/meme input: '+cfg.model+'; voice: '+cfg.voice.model+'; local stickers: '+library.length);
      await import('./autonomy.mjs');
      pass('Autonomy scheduler installed; chat='+Boolean(cfg.autonomy?.chat?.enabled)+', qzone='+Boolean(cfg.autonomy?.qzone?.enabled));
      if(cfg.asr?.enabled){await import('./media-runtime/node_modules/silk-wasm/lib/index.mjs');pass('SILK decoding and Bailian ASR adapter installed.');}
      if(cfg.attachments?.enabled){
        const python=cfg.attachments.python||'python';
        execFileSync(python,['-c',"import sys;sys.path.insert(0,sys.argv[1]);import pymupdf,docx,openpyxl,pptx;print('ok')",path.join(root,'_runtime/documents')],{windowsHide:true,encoding:'utf8',timeout:10000});
        pass('PDF, scanned PDF and Office document parsers installed.');
      }
    } catch(e) { bad('Multimedia: '+redact(e.message)); }
  }
  if(!offline) {
    try {
      const result=await fetch(cfg.onebot.httpUrl+'/get_login_info',{method:'POST',headers:{authorization:'Bearer '+cfg.onebot.accessToken,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});
      const data=await result.json();
      if(!result.ok || data.status!=='ok') throw new Error('Gateway is not logged in.');
      if(String(data.data?.user_id)!==String(cfg.botQQ)) throw new Error('Logged-in QQ does not match the configured bot account.');
      pass('OneBot QQ login and HTTP authentication');
    } catch(e) { wait('QQ gateway: '+e.message+' Use Start.cmd and scan the QR code.'); }
    if(cfg.toolModule) {
      try {
        const {QzoneAdapter}=await import('./qzone-adapter.mjs');
        await new QzoneAdapter(cfg).call('get_qzone_msg_list',{num:1});
        pass('QQ space authenticated read.');
      } catch(e) { bad('QQ space: '+redact(e.message).slice(0,180)); }
    }
  }
}
if(!offline) await checkModel();
console.log(`Result: ${fail} failed, ${pending} pending.`);
process.exitCode=fail ? 1 : (pending ? 2 : 0);
