import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyEnvironment } from '../ai-companion-kit/packages/companion/src/config-env.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=process.env.COMPANION_CONFIG || path.join(root,'ai-companion-kit/packages/companion/config.json');
const cfg=applyEnvironment(JSON.parse(fs.readFileSync(config,'utf8').replace(/^\uFEFF/,'')));
const service=process.argv[2];
if(!['phone','qzone'].includes(service)||cfg[service]?.enabled!==true)throw new Error('请先在本地配置中启用对应的 MCP 功能');
try {
  const settings=JSON.parse(fs.readFileSync(path.join(root,'local/features-settings.json'),'utf8'));
  if(settings.phoneSerial && !process.env.PHONE_SERIAL) process.env.PHONE_SERIAL=settings.phoneSerial;
} catch {}
process.env.PHONE_ADB=process.env.PHONE_ADB||'adb';
process.env.PHONE_FFMPEG=process.env.PHONE_FFMPEG||process.env.FFMPEG_PATH||'ffmpeg';
process.env.PHONE_SHOT_DIR=path.join(root,'data/shots');
process.env.PHONE_MACRO_FILE=path.join(root,'data/macros.json');
process.env.QZONE_IMAGE_DIRS=path.join(root,'data/shots')+';'+path.join(root,'data/pictures');
process.env.QZONE_CONFIG=config;
process.env.SNOWLUMA_HTTP_URL=cfg.onebot.httpUrl;
process.env.SNOWLUMA_ACCESS_TOKEN=cfg.onebot.accessToken;
for(const dir of ['data/shots','data/pictures']) fs.mkdirSync(path.join(root,dir),{recursive:true});
if(process.argv[2]==='qzone') await import('./qzone-mcp.mjs');
else await import(pathToFileURL(path.join(root,'ai-companion-kit/packages/phone-mcp/src/phone-mcp.js')).href);
