#!/usr/bin/env node
// 一键开通「她自己发 QQ 空间」
//
// 干的事（三步，一步都不改代码）：
//   ① 找到 qq-bridge 和角色卡
//   ② 现场探一次 OneBot：能不能取到自己的说说（探不通就把原因说清楚）
//   ③ 往角色卡里加一段话，让她知道自己有空间、也知道什么时候该发
//
// 用法：
//   node open-zone.mjs                   自动找 qq-bridge 和角色卡
//   node open-zone.mjs --role 某角色.md   指定角色卡
//   node open-zone.mjs --dry             只看会改什么，不写
//   node open-zone.mjs --no-probe        跳过联网探测（只想改角色卡时用）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PATCH = `**空间不用等他说**：今天有件事让你有情绪、你看到什么想留一句、图库里有张图该配句话——就发（\`qzone_post\`）。一两句，别写小作文。★别每句都有他★，那是你自己的地方，得有你自己的日子。★别为了证明你在而发★，一天超过两条就是刷屏。发完不用汇报，除非他问；也别刚发完就在群里提。`;

const MARK = '空间不用等他说';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const noProbe = args.includes('--no-probe');
const roleArg = args.includes('--role') ? args[args.indexOf('--role') + 1] : null;

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

// ── 1. 找 qq-bridge ──────────────────────────────────────────
function findBridge() {
  // 明确指定了就用它 —— 不对就报错，绝不偷偷换成别的目录
  const env = process.env.HER_BRIDGE_DIR || process.env.QQ_BRIDGE_DIR;
  if (env) {
    if (exists(path.join(env, 'roles'))) return env;
    console.log(`❌ 你设的 HER_BRIDGE_DIR 里没有 roles/ 目录：`);
    console.log(`   ${env}`);
    console.log(`   指的是 qq-bridge 的根目录（里面应该有 roles/ 和 src/）`);
    process.exit(1);
  }
  const cands = [
    path.join(path.parse(process.cwd()).root, 'qq-bridge'),
    './local-resources',
    './local-resources',
    './local-resources',
    path.join(os.homedir(), 'qq-bridge'),
    path.join(os.homedir(), 'ai-companion-kit'),
  ].filter(Boolean);
  for (const c of cands) {
    if (exists(path.join(c, 'roles'))) return c;
  }
  // 从当前目录往上找
  let d = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    if (exists(path.join(d, 'roles')) && exists(path.join(d, 'src'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

const bridge = findBridge();
if (!bridge) {
  console.log('❌ 没找到 qq-bridge（要有 roles/ 和 src/ 两个目录）');
  console.log('   如果装在别处，用环境变量指一下：');
  console.log('   set HER_BRIDGE_DIR=./local-resources');
  process.exit(1);
}
console.log(`✓ qq-bridge: ${bridge}`);

// ── 2. 挑角色卡 ─────────────────────────────────────────────
let roleFile = null;
if (roleArg) {
  roleFile = path.isAbsolute(roleArg) ? roleArg : path.join(bridge, 'roles', roleArg);
  if (!exists(roleFile)) { console.log(`❌ 角色卡不存在：${roleFile}`); process.exit(1); }
} else {
  const dir = path.join(bridge, 'roles');
  const mds = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md') && !/^readme/i.test(f)).sort();
  if (!mds.length) { console.log('❌ roles/ 里没有 .md 角色卡'); process.exit(1); }
  // 优先「小助手.md」，否则取第一个
  roleFile = path.join(dir, mds.find((f) => f.includes('鲸鱼')) || mds[0]);
  if (mds.length > 1) {
    console.log(`   roles/ 里有 ${mds.length} 个角色卡，用的是：${path.basename(roleFile)}`);
    console.log(`   想换别的：node open-zone.mjs --role ${mds.filter((f) => f !== path.basename(roleFile))[0]}`);
  }
}
console.log(`✓ 角色卡: ${roleFile}`);

// ── 2.5 工具来源：他的 MCP 配置里到底有没有这个能力 ────────────
// 找不到挂载点的话，光改角色卡就是让她「以为自己能发」—— 这句必须查。
const QZONE_MCP_JS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'qzone-mcp', 'src', 'qzone-mcp.js'
);

function collectYml(dir, out, depth) {
  if (depth > 3 || out.length > 400) return out;
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const it of items) {
    if (out.length > 400) break;
    const p = path.join(dir, it.name);
    if (it.isDirectory()) {
      if (!/^(node_modules|\.git|state|logs)$/.test(it.name)) collectYml(p, out, depth + 1);
    } else if (/\.(ya?ml)$/i.test(it.name)) {
      out.push(p);
    }
  }
  return out;
}

function detectToolSource() {
  const roots = [
    path.join(bridge, 'dsh', 'agent-presets'),
    path.join(bridge, 'plugins', 'qq-agent-presets', 'presets'),
    path.join(bridge, 'plugins', 'qq-agent-presets'),
  ];
  let phone = null;
  let qzone = null;
  for (const root of roots) {
    for (const f of collectYml(root, [], 0)) {
      let txt = '';
      try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
      if (!phone && /mcp-phone|phone-mcp/i.test(txt)) phone = f;
      if (!qzone && /mcp-qzone|qzone-mcp/i.test(txt)) qzone = f;
    }
  }
  return { phone, qzone };
}

const src = detectToolSource();
const rel = (p) => (p ? path.relative(bridge, p) : '');
if (src.qzone) {
  console.log(`✓ 工具来源: mcp-qzone（${rel(src.qzone)}）`);
} else if (src.phone) {
  console.log(`✓ 工具来源: phone-mcp（${rel(src.phone)}）—— qzone_* 七个工具它已经内置，不用再装 qzone-mcp`);
} else {
  console.log('⚠️  没在你的 preset 里找到「空间」工具 —— 下面改完她还是发不出去');
  console.log('   两条路，挑一条（不用两条都做）：');
  console.log('   A. 装 phone-mcp（kit 主路径，七个空间工具都在里面）');
  console.log('   B. 单独挂 qzone-mcp，把这段加进 MCP 配置：');
  console.log('');
  console.log('   "qzone": {');
  console.log('     "command": "node",');
  console.log(`     "args": [${JSON.stringify(QZONE_MCP_JS)}]`);
  console.log('   }');
  console.log('');
  console.log('   （Windows 上把 "node" 换成 node.exe 的绝对路径更稳）');
  console.log('');
}

// ── 3. 探一次 OneBot：真的有空间这个能力吗 ───────────────────
// 只打印「有没有 / 在哪一步失败」，绝不打印令牌本身。
const SNOW_HTTP = (process.env.SNOWLUMA_HTTP_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

function findToken() {
  if (process.env.SNOWLUMA_ACCESS_TOKEN) return { token: process.env.SNOWLUMA_ACCESS_TOKEN.trim(), from: '环境变量 SNOWLUMA_ACCESS_TOKEN' };
  for (const f of [path.join(bridge, 'config.json'), path.join(process.cwd(), 'config.json')]) {
    const c = readJson(f);
    const v = c?.snowluma?.accessToken;
    if (typeof v === 'string' && v.trim()) return { token: v.trim(), from: `${path.basename(f)} 的 snowluma.accessToken` };
  }
  const dirs = [
    process.env.SNOWLUMA_DIR && path.join(process.env.SNOWLUMA_DIR, 'config'),
    path.join(path.parse(bridge).root, 'SnowLuma', 'config'),
    path.join(os.homedir(), 'SnowLuma', 'config'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'SnowLuma', 'config'),
  ].filter(Boolean);
  for (const d of dirs) {
    if (!exists(d)) continue;
    for (const name of fs.readdirSync(d)) {
      if (!/^onebot_.*\.json$/.test(name)) continue;
      const c = readJson(path.join(d, name));
      const v = c?.networks?.httpServer?.accessToken ?? c?.accessToken ?? c?.networks?.accessToken;
      if (typeof v === 'string' && v.trim()) return { token: v.trim(), from: `SnowLuma 的 ${name}` };
    }
  }
  return null;
}

async function probe() {
  console.log('\n── 探测：她的空间能力通不通 ──');
  const t = findToken();
  if (!t) {
    console.log('⚠️  拿不到 OneBot 访问令牌');
    console.log('   → 网关没跑，或者 config.json 里没有 snowluma.accessToken');
    console.log('   → 也可以直接设环境变量 SNOWLUMA_ACCESS_TOKEN=... 再跑一次');
    console.log('   → 不影响下面改角色卡，但工具调不通：先把网关起来再开这个功能');
    return false;
  }
  console.log(`✓ 令牌：已拿到（来源：${t.from}，${t.token.length} 字符）`);
  try {
    const res = await fetch(`${SNOW_HTTP}/get_qzone_msg_list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
      body: JSON.stringify({ num: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const txt = await res.text();
    let data = null;
    try { data = JSON.parse(txt); } catch {}
    if (!res.ok || !data || data.status !== 'ok') {
      console.log(`❌ OneBot 有响应但拒绝了：HTTP ${res.status}`);
      console.log('   → 网关版本太老？在 SnowLuma 里开一次「QQ 空间」相关动作试试');
      return false;
    }
    const list = data?.data?.msglist ?? data?.data?.msgs ?? [];
    console.log(`✅ 通 —— 能取到自己的说说（${Array.isArray(list) ? list.length : 0} 条）`);
    return true;
  } catch (e) {
    const msg = e?.name === 'TimeoutError' ? '15 秒没响应' : (e?.cause?.code || e?.message || String(e));
    console.log(`❌ 连不上 ${SNOW_HTTP}（${msg}）`);
    console.log('   → 网关没起？端口不是 3000？先把 SnowLuma 跑起来');
    return false;
  }
}

let probeOk = null;
if (!noProbe && !dry) probeOk = await probe();

// ── 4. 看是否已经加过 ───────────────────────────────────────
const text = fs.readFileSync(roleFile, 'utf8');
if (text.includes(MARK)) {
  console.log('\n✓ 角色卡已经开通过了（里面已有「空间不用等他说」）—— 没动角色卡');
  if (probeOk === true) {
    console.log('\n────────────────────────────────────────');
    console.log('这一步没问题了。接下来就看她的：');
    console.log('她可能今晚发，也可能三天不发。别催 —— 那才是活的。');
    console.log('────────────────────────────────────────');
  }
  process.exit(0);
}

// ── 5. 找插入位置：优先放在「半夜那句邀请」后面 ──────────────
let next;
const anchor = '**半夜那句邀请**';
const idx = text.indexOf(anchor);
if (idx >= 0) {
  const lineEnd = text.indexOf('\n', idx);
  const insertAt = lineEnd < 0 ? text.length : lineEnd + 1;
  next = text.slice(0, insertAt) + '\n' + PATCH + '\n' + text.slice(insertAt);
  console.log('\n✓ 插在「半夜那句邀请」后面');
} else {
  next = text.replace(/\s*$/, '') + '\n\n' + PATCH + '\n';
  console.log('\n✓ 没找到锚点，追加到角色卡末尾');
}

if (dry) {
  console.log('\n--- 会写入的内容（--dry，没真写）---');
  console.log(PATCH);
  process.exit(0);
}

// ── 6. 备份 + 写 ────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const bak = `${roleFile}.bak-qzone-${stamp}`;
fs.copyFileSync(roleFile, bak);
console.log(`✓ 已备份: ${path.basename(bak)}`);

fs.writeFileSync(roleFile, next, 'utf8');
console.log(`✓ 写好了（${Buffer.byteLength(next, 'utf8')} 字节）`);

console.log(`
────────────────────────────────────────
开通完成。接下来：

1. 桥接是在每条消息前读角色卡，所以**不用重启**
   （不确定的话重启一次最稳：tools\\启动.bat）

2. 工具在不在，让她自己验：
   跟她说「看看你自己空间最近发了什么」——
   她调 qzone_my_posts 能返回列表，就说明通了

3. 然后就等着 —— 别催她
   她可能今晚发，也可能三天不发。那才是活的。

想看效果：手机上刷一下自己的 QQ 空间
────────────────────────────────────────
`);
