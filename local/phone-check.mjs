import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {createTools} from './features.mjs';
const cfg=loadConfig(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const settings=JSON.parse(fs.readFileSync(new URL('./features-settings.json',import.meta.url),'utf8'));
const tools=await createTools({...cfg,dryRun:false});
const input={key:'private:'+cfg.ownerIds[0],userId:cfg.ownerIds[0]};
try {
  const dump=await tools.call('phone_dump',{max:10},input);
  if(dump.isError) throw new Error(dump.content[0].text);
  const shot=await tools.call('phone_screenshot',{note:'install-check'},input);
  if(shot.isError || !shot.images.length || !fs.statSync(shot.images[0]).size) throw new Error('Phone screenshot validation failed');
  console.log('PASS: selected phone UI hierarchy and screenshot read through MCP.');
  const app=await tools.call('phone_open_app',{pkg:'com.android.settings'},input);
  if(app.isError) throw new Error(app.content[0].text);
  const adb=new URL('../_runtime/platform-tools/adb.exe',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
  const activity=execFileSync(adb,['-s',settings.phoneSerial,'shell','dumpsys','activity','activities'],{encoding:'utf8',windowsHide:true,timeout:10000});
  if(!/com\.android\.settings/.test(activity)) throw new Error('Settings app launch not confirmed');
  console.log('PASS: phone control launched Android Settings.');
  const keyboard=execFileSync(adb,['-s',settings.phoneSerial,'shell','pm','path','com.android.adbkeyboard'],{encoding:'utf8',windowsHide:true,timeout:10000});
  if(!keyboard.includes('package:')) throw new Error('ADBKeyboard is not installed');
  console.log('PASS: Chinese input keyboard installed.');
  fs.writeFileSync(new URL('../logs/phone-check.json',import.meta.url),JSON.stringify({model:settings.phoneModel,androidVersion:settings.androidVersion,checkedAt:new Date().toISOString(),uiRead:true,screenshot:true,openApp:true,keyboardInstalled:true},null,2));
} finally {await tools.close();}
