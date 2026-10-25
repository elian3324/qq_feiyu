// Runtime launcher. Uses an absolute entry and a unique project-root argument
// so Windows stop/restart can verify identity before terminating a process tree.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2);
const supervise=args.includes('--supervise');
const child=spawn(process.execPath,[path.join(root,supervise?'local/service.mjs':'local/run.mjs'),'--release-root='+root,...args.filter(arg=>arg!=='--supervise')],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('无法创建本副本机器人进程。');process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code??1;});
process.on('SIGINT',()=>{if(process.platform!=='win32')child.kill('SIGINT');});
process.on('SIGTERM',()=>child.kill('SIGTERM'));
