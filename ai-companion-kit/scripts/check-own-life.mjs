#!/usr/bin/env node
// 一键自检：她自己的生活（own-life）装没装好、今天动没动
// 用法：node scripts/check-own-life.mjs [--bridge <bridge 目录>]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const argv = process.argv.slice(2);
const bi = argv.indexOf('--bridge');
const BRIDGE = bi >= 0 ? argv[bi + 1] : (process.env.BRIDGE_DIR || fileURLToPath(new URL('../../qq-bridge/',import.meta.url)));
const SRC = path.join(BRIDGE, 'src');
const rows = [];
const add = (name, ok, detail, fix) => rows.push({ name, ok, detail, fix });
const read = (p, d = '') => { try { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return d; } };
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// 1. 文件
add('own-life.js 在不在', exists(path.join(SRC, 'own-life.js')),
  path.join(SRC, 'own-life.js'),
  '把 packages/own-life/src/own-life.js 复制到 bridge 的 src/');

const bridge = read(path.join(SRC, 'bridge.js'));
add('bridge.js 有 import', bridge.includes("from './own-life.js'"),
  bridge.includes("from './own-life.js'") ? '已引入' : '没有',
  "顶部加：import { createOwnLife } from './own-life.js';");
add('bridge.js 有 startOwnLife()', /function\s+startOwnLife\s*\(/.test(bridge),
  /function\s+startOwnLife\s*\(/.test(bridge) ? '已定义' : '没有',
  '参考 docs/她自己的生活-定时静默唤醒.md 的“手动三步”');
add('bridge.js 有调用', /\n\s*startOwnLife\(\);/.test(bridge),
  /\n\s*startOwnLife\(\);/.test(bridge) ? '已调用' : '没有',
  '在 startSocialLoop(); 后面加一行 startOwnLife();');

// 2. 配置
let cfg = {};
try { cfg = JSON.parse(read(path.join(BRIDGE, 'config.json'), '{}')); } catch { /* 坏配置 */ }
add('ownerQQ 配了', !!cfg.ownerQQ, cfg.ownerQQ ? '已配置' : '空',
  'config.json 里填 ownerQQ，或控制台「访问与安全」页填管理员 QQ');
add('socialV2 没被关', (cfg.socialV2 || {}).enabled !== false,
  String((cfg.socialV2 || {}).enabled ?? '默认开'),
  'config.json → socialV2.enabled = true');

// 3. 运行时（看日志和状态）
const logPath = path.join(BRIDGE, 'state', 'bridge.log');
const log = read(logPath);
const armed = [...log.matchAll(/\[own-life\] 已武装 · 每 ([\d.]+)h/g)].pop();
const fired = [...log.matchAll(/\[own-life\] 已投递（(\w+)）(\d\d:\d\d) · 今天第 (\d+) 次/g)].pop();
add('启动时打过“已武装”', !!armed, armed ? `每 ${armed[1]}h` : '日志里没有',
  '重启桥接；若仍没有，看日志有没有 [own-life] 启动失败');
add('今天真投递过', !!fired, fired ? `${fired[2]} · 第 ${fired[3]} 次` : '还没有',
  '90 秒后会有第一次；被拦时日志会写“跳过”（模式不是 reserved2 / socialV2 暂停）');

let st = {};
try { st = JSON.parse(read(path.join(BRIDGE, 'state', 'own-life.json'), '{}')); } catch { /* 没跑过 */ }
add('状态文件可读', !!st.lastFiredAt, st.lastFiredAt ? new Date(st.lastFiredAt).toLocaleString('zh-CN') : '还没生成',
  '正常：第一次投递后才会写');

// 4. 真的能发动态吗
const qz = read(path.join(BRIDGE, 'src', 'mcp-phone.js')).includes('qzone');
const cookieDir = ['state', 'cookies'].map((d) => path.join(BRIDGE, d)).concat([path.join(BRIDGE, 'state')]);
const hasCookie = cookieDir.some((d) => { try { return fs.readdirSync(d).some((f) => /qzone|qq|cookie/i.test(f)); } catch { return false; } });
add('qzone 工具在', qz, qz ? 'mcp-phone.js 里有 qzone' : '没找到',
  '装 packages/phone-mcp，按文档扫码登录');
add('qzone 登录痕迹', hasCookie, hasCookie ? '找到 cookie 文件' : '没找到（可能登录态在别处）',
  '扫码登录一次 QQ 空间；登录后用 qzone_my_posts 能读到自己的说说就算通');

// 输出
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log('\n  她自己的生活 · 自检\n');
for (const r of rows) console.log(`  ${r.ok ? '✅' : '❌'} ${pad(r.name, 22)} ${r.detail}`);
const bad = rows.filter((r) => !r.ok);
if (!bad.length) {
  console.log('\n  全通。她自己会过日子了。\n');
} else {
  console.log('\n  还差这些：');
  for (const r of bad) console.log(`   · ${r.name} → ${r.fix}`);
  console.log('');
}
process.exit(bad.length ? 1 : 0);
