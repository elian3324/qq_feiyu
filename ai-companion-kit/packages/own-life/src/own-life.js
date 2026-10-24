// own-life.js · 「她自己的生活」定时唤醒
//
// 干什么：隔一段时间给她一条**静默**提示（不会出现在聊天里），让她想起来
//         自己还有「说说 / 日记 / 画画 / 玩手机 / 什么都不干」这些事。
//
// 为什么需要它：桥接的自动唤醒只有三种 —— 有人说话、replyCheck、群聊 proactive。
//              私聊没有任何「你自己的时间到了」，所以角色卡里写了「你自己发说说」，
//              她也不会主动去做，只能等人手动叫。
//
// 用法（在 bridge.js 里）：
//
//   import { createOwnLife } from './own-life.js';
//
//   const ownLife = createOwnLife({
//     key: ownerKey,                                   // 'private:3776013884'
//     deliver: (text) => deliverPrompt(key, text, { silent: true, wakeReason: 'own-life' }),
//     statePath: path.join(STATE_DIR, 'own-life.json'),
//     log,
//   });
//   ownLife.start();
//
// 设计约束：
// - **静默**：提示只进 AI 的上下文，不往 QQ 发东西。
// - **不打扰**：凌晨 3–8 点不叫；一天最多 6 次。
// - **可关**：enabled=false 或 stop() 立刻停。
// - **断电续得上**：最后一次触发时间存在 statePath 里，重启不会一次补发一堆。

import fs from 'node:fs';
import path from 'node:path';

const HOUR = 3600 * 1000;

export const DEFAULT_TEXT_DAY = [
  '现在是你的时间，没人找你。',
  '想干嘛干嘛：发条说说（先 qzone_my_posts 看一眼今天发过没）、写日记、画一张、玩会儿手机，',
  '也可以什么都不干。',
  '不用回我，也不用汇报。',
].join('');

export const DEFAULT_TEXT_MIDNIGHT = [
  '半夜了，没人打扰。',
  '想干点什么吗——发说说、写日记、画一张，也可以就坐着什么都不干。',
  '这段时间里别给平安发消息，他睡着呢。',
].join('');

function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function createOwnLife(opts) {
  const {
    key,
    deliver,
    statePath,
    intervalMs = 2.5 * HOUR,
    quiet = [3, 8],              // 3:00 ~ 8:00 不叫
    midnightAt = '23:30',
    maxPerDay = 6,
    enabled = true,
    textDay = DEFAULT_TEXT_DAY,
    textMidnight = DEFAULT_TEXT_MIDNIGHT,
    log = (...a) => console.log('[own-life]', ...a),
  } = opts || {};

  if (!key) throw new Error('own-life: 缺 key');
  if (typeof deliver !== 'function') throw new Error('own-life: 缺 deliver');

  let state = { lastFiredAt: 0, lastDay: '', firedToday: 0, lastMidnightDay: '' };

  if (statePath) {
    try {
      const raw = JSON.parse(fs.readFileSync(statePath, 'utf8').replace(/^\uFEFF/, ''));
      if (raw && typeof raw === 'object') state = { ...state, ...raw };
    } catch { /* 第一次跑，没文件是正常的 */ }
  }

  function save() {
    if (!statePath) return;
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
      log('状态写不进去（忽略）:', e?.message ?? e);
    }
  }

  function inQuiet(now) {
    const h = new Date(now).getHours();
    const [from, to] = quiet;
    return from <= to ? (h >= from && h < to) : (h >= from || h < to);
  }

  function pastMidnightSlot(now) {
    const [mh, mm] = String(midnightAt).split(':').map(Number);
    const d = new Date(now);
    const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), mh || 23, mm || 30, 0, 0).getTime();
    return now >= slot;
  }

  let timer = null;
  let busy = false;

  async function fire(kind, nowTs = Date.now()) {
    if (busy) return { ok: false, skipped: 'busy' };
    busy = true;
    const now = Number(nowTs) || Date.now();
    const text = kind === 'midnight' ? textMidnight : textDay;
    try {
      await deliver(text);
      state.lastFiredAt = now;
      state.firedToday += 1;
      state.lastDay = dayKey(now);
      if (kind === 'midnight') state.lastMidnightDay = dayKey(now);
      save();
      log(`已投递（${kind}）${hhmm(now)} · 今天第 ${state.firedToday} 次`);
      return { ok: true, kind, at: now };
    } catch (e) {
      log('投递失败:', e?.message ?? e);
      return { ok: false, error: String(e?.message ?? e) };
    } finally {
      busy = false;
    }
  }

  async function tick(nowTs = Date.now()) {
    if (!enabled) return { ok: false, skipped: 'disabled' };
    if (inQuiet(nowTs)) return { ok: false, skipped: 'quiet' };

    // 跨天：计数归零
    const today = dayKey(nowTs);
    if (state.lastDay !== today) {
      state.lastDay = today;
      state.firedToday = 0;
    }
    if (state.firedToday >= maxPerDay) return { ok: false, skipped: 'daily-cap' };

    // 半夜那次：一天一次，优先于普通间隔
    if (pastMidnightSlot(nowTs) && state.lastMidnightDay !== today) {
      return fire('midnight', nowTs);
    }

    if (nowTs - Number(state.lastFiredAt || 0) >= intervalMs) {
      return fire('day', nowTs);
    }
    return { ok: false, skipped: 'not-yet' };
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => { tick().catch(() => {}); }, 60 * 1000).unref?.() ?? setInterval(() => { tick().catch(() => {}); }, 60 * 1000);
    log(`已武装 · 每 ${(intervalMs / HOUR).toFixed(1)}h 一次 · 安静时段 ${quiet[0]}:00–${quiet[1]}:00 · 半夜 ${midnightAt} · 每天最多 ${maxPerDay} 次`);
    // 启动后 90 秒先看一眼（别和开机时的会话创建抢）
    setTimeout(() => { tick().catch(() => {}); }, 90 * 1000).unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    log('已停止');
  }

  return {
    start, stop, tick,
    fireNow: () => fire('day'),
    fireMidnightNow: () => fire('midnight'),
    snapshot: () => ({ ...state, enabled, intervalMs, quiet, midnightAt }),
  };
}

export default createOwnLife;
