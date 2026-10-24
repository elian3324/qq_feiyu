// Explicit runtime entry point. Static release checks never execute this file.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main, loadConfig } from '../ai-companion-kit/packages/companion/src/index.js';
const root = new URL('../', import.meta.url);
const configAt = process.argv.indexOf('--config');
try {
  const cfg = loadConfig(configAt >= 0 ? process.argv[configAt + 1] : undefined);
  if (!cfg.apiKey || /REPLACE|YOUR_/i.test(cfg.apiKey)) throw new Error('Missing API key');
  if (!cfg.botQQ || !cfg.ownerIds.length) throw new Error('Missing account IDs');
  if (!(cfg.allow?.private?.length || cfg.allow?.groups?.length)) throw new Error('Missing allowlist');
  if (!cfg.onebot.accessToken) throw new Error('Missing OneBot token');
  for (const endpoint of [cfg.onebot.wsUrl, cfg.onebot.httpUrl]) {
    const url = new URL(endpoint);
    if (!['http:','https:','ws:','wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid endpoint');
  }
  for (const dir of ['logs/', 'data/']) fs.mkdirSync(new URL(dir, root), { recursive: true });
  const pidFile = fileURLToPath(new URL('logs/companion.pid', root));
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid PID file');
    try { process.kill(pid, 0); throw new Error('This copy is already running'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  fs.writeFileSync(pidFile, String(process.pid));
  process.on('exit', () => {
    try { if (fs.readFileSync(pidFile, 'utf8') === String(process.pid)) fs.unlinkSync(pidFile); } catch {}
  });
  await main();
} catch {
  console.error('启动失败：请检查 .env、配置、账号白名单、依赖和本副本的 PID 文件。详见 README.md。');
  process.exitCode = 1;
}
