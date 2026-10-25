// Keep the optional standalone-tool entry without assuming an external folder.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { voiceToolDir, voiceToolPath } from './voice-tool-locator.mjs';
const mode=process.argv[2];
if(!['gui','cli'].includes(mode))throw new Error('Use gui or cli');
const entry=voiceToolPath('voice-'+mode+'.mjs');
if(!fs.existsSync(entry))throw new Error('原项目未包含独立 voice-tool 源码。请将自己已有且获得授权的工具目录配置到 QQ_BRIDGE_VOICE_TOOL_DIR。机器人内置 TTS/语音发送不需要此独立工具。');
const child=spawn(process.execPath,[entry,...process.argv.slice(3)],{cwd:voiceToolDir(),env:process.env,stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('无法启动指定的独立语音工具。');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
