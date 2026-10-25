import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../ai-companion-kit/packages/companion/src/index.js';
import {createTools} from './features.mjs';
const cfg=loadConfig(fileURLToPath(new URL('../ai-companion-kit/packages/companion/config.json',import.meta.url)));
const settings=JSON.parse(fs.readFileSync(new URL('./features-settings.json',import.meta.url),'utf8'));
const adb=fileURLToPath(new URL('../_runtime/platform-tools/adb.exe',import.meta.url));
const command=args=>execFileSync(adb,['-s',settings.phoneSerial,...args],{encoding:'utf8',windowsHide:true,timeout:20000});
function dump() {command(['shell','uiautomator','dump','/sdcard/_dsh_input_check.xml']);return command(['shell','cat','/sdcard/_dsh_input_check.xml']);}
const tools=await createTools({...cfg,dryRun:false});
const input={key:'private:'+cfg.ownerIds[0],userId:cfg.ownerIds[0]};
const original=command(['shell','settings','get','secure','default_input_method']).trim();
const value='连接测试';
let typed=false;
try {
  let xml=dump();
  if(!xml.includes('android.widget.EditText')) {
    const open=await tools.call('phone_tap_text',{text:'搜索系统设置项'},input);
    if(open.isError) throw new Error('Cannot find Settings search: '+open.content[0].text);
    xml=dump();
  }
  const field=(xml.match(/<node\b[^>]*class="android\.widget\.EditText"[^>]*>/g)||[])[0];
  if(!field || !field.includes('focused="true"')) throw new Error('Settings search is not focused; no text was entered.');
  const result=await tools.call('phone_text',{text:value},input);
  if(result.isError) throw new Error(result.content[0].text);
  typed=true;
  xml=dump();
  if(!xml.includes('text="'+value+'"')) throw new Error('Chinese input was not found in the Settings search field.');
  const restored=command(['shell','settings','get','secure','default_input_method']).trim();
  if(restored!==original) throw new Error('Original input method was not restored');
  const receiptFile=new URL('../logs/phone-check.json',import.meta.url);
  const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  Object.assign(receipt,{chineseInputVerified:true,originalInputMethodRestored:true,checkedAt:new Date().toISOString()});
  fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
  console.log('PASS: Chinese input appears in the observed Settings search field; original keyboard restored.');
} finally {
  if(typed) {command(['shell','input','keyevent','KEYCODE_MOVE_END']);command(['shell','input','keyevent',...Array(value.length).fill('KEYCODE_DEL')]);}
  await tools.close();
}
