import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const child=spawn(process.execPath,[path.join(root,'qq-bridge/src/bridge-entry.mjs'),'--release-root='+root],{cwd:path.join(root,'qq-bridge'),env:process.env,stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('无法创建桥接进程。');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
process.on('SIGINT',()=>{if(process.platform!=='win32')child.kill('SIGINT');});
process.on('SIGTERM',()=>child.kill('SIGTERM'));
