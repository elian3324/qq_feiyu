// 自测：own-life.js 的行为是否都成立（不碰 QQ、不碰真实状态文件）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createOwnLife, DEFAULT_TEXT_DAY, DEFAULT_TEXT_MIDNIGHT } from '../src/own-life.js';

const TMP = path.join(os.tmpdir(), 'own-life-test-' + process.pid + '.json');
const HOUR = 3600 * 1000;
let pass = 0, fail = 0;
const ok = (name, fn) => {
  return Promise.resolve().then(fn).then(
    () => { pass++; console.log('  PASS ' + name); },
    (e) => { fail++; console.log('  FAIL ' + name + ' → ' + (e?.message ?? e)); },
  );
};
const fresh = (over = {}) => {
  try { fs.unlinkSync(TMP); } catch { /* 第一次就没有 */ }
  const sent = [];
  const inst = createOwnLife({
    key: 'private:3776013884',
    deliver: async (t) => { sent.push(t); },
    statePath: TMP,
    log: () => {},
    ...over,
  });
  return { inst, sent };
};
const at = (h, m = 0) => new Date(2026, 9, 21, h, m, 0, 0).getTime();

// 1. 参数守卫
await ok('缺 key 报错', () => assert.throws(() => createOwnLife({ deliver: () => {} }), /缺 key/));
await ok('缺 deliver 报错', () => assert.throws(() => createOwnLife({ key: 'k' }), /缺 deliver/));

// 2. 到点投递 + 落盘
{
  const { inst, sent } = fresh();
  const r = await inst.tick(at(10));
  await ok('第一次 tick 投递成功', () => { assert.equal(r.ok, true); assert.equal(r.kind, 'day'); assert.equal(sent.length, 1); });
  await ok('投递的是白天文案', () => assert.equal(sent[0], DEFAULT_TEXT_DAY));
  await ok('状态已落盘', () => {
    const s = JSON.parse(fs.readFileSync(TMP, 'utf8'));
    assert.equal(s.firedToday, 1);
    assert.ok(s.lastFiredAt > 0);
  });
  await ok('紧接着再 tick 不重发', async () => { const r2 = await inst.tick(at(10, 1)); assert.equal(r2.skipped, 'not-yet'); assert.equal(sent.length, 1); });
  await ok('隔 2.5h 后再发一次', async () => { const r3 = await inst.tick(at(12, 31)); assert.equal(r3.ok, true); assert.equal(sent.length, 2); });
}

// 3. 安静时段
{
  const { inst, sent } = fresh();
  const r = await inst.tick(at(4));
  await ok('4 点不叫', () => { assert.equal(r.skipped, 'quiet'); assert.equal(sent.length, 0); });
  const r2 = await inst.tick(at(7, 59));
  await ok('7:59 还不叫', () => assert.equal(r2.skipped, 'quiet'));
  const r3 = await inst.tick(at(8, 1));
  await ok('8:01 可以叫', () => assert.equal(r3.ok, true));
}

// 4. 每天上限
{
  const { inst, sent } = fresh({ intervalMs: 0.5 * HOUR });
  for (const h of [9, 10, 11, 12, 13, 14]) await inst.tick(new Date(2026, 9, 21, h, 0, 0).getTime());
  await ok('六次都被接受', () => assert.equal(sent.length, 6));
  const r = await inst.tick(new Date(2026, 9, 21, 15, 0, 0).getTime());
  await ok('第七次撞日上限', () => { assert.equal(r.skipped, 'daily-cap'); assert.equal(sent.length, 6); });
  const r2 = await inst.tick(new Date(2026, 9, 22, 9, 0, 0).getTime());
  await ok('第二天重新计数', () => { assert.equal(r2.ok, true); assert.equal(sent.length, 7); });
}

// 5. 半夜那句
{
  const { inst, sent } = fresh();
  const r = await inst.tick(at(23, 35));
  await ok('23:35 发半夜文案', () => { assert.equal(r.kind, 'midnight'); assert.equal(sent[0], DEFAULT_TEXT_MIDNIGHT); });
  const r2 = await inst.tick(at(23, 40));
  await ok('半夜一天只发一次', () => { assert.notEqual(r2.kind, 'midnight'); });
}

// 6. 重启续得上（不会开机补发一堆）
{
  const { inst, sent } = fresh();
  await inst.tick(at(10));
  const inst2 = createOwnLife({ key: 'private:3776013884', deliver: async (t) => sent.push(t), statePath: TMP, log: () => {} });
  const r = await inst2.tick(at(10, 5));
  await ok('重启后不立刻重发', () => { assert.equal(r.skipped, 'not-yet'); assert.equal(sent.length, 1); });
}

// 7. 投递失败不记账
{
  const { inst } = fresh({ deliver: async () => { throw new Error('模拟失败'); } });
  const r = await inst.tick(at(10));
  await ok('失败时 ok=false', () => assert.equal(r.ok, false));
  await ok('失败不计入今日次数', () => {
    let s = { firedToday: 0 };
    try { s = JSON.parse(fs.readFileSync(TMP, 'utf8')); } catch { /* 一次都没成过，本来就没文件 */ }
    assert.equal(s.firedToday, 0);
  });
}

// 8. enabled=false 立刻停
{
  const { inst, sent } = fresh({ enabled: false });
  const r = await inst.tick(at(10));
  await ok('enabled=false 不投递', () => { assert.equal(r.skipped, 'disabled'); assert.equal(sent.length, 0); });
}

// 9. 文案里不能有会让她误会的指令
await ok('白天文案不提“回我”以外的幻觉', () => {
  assert.ok(DEFAULT_TEXT_DAY.includes('不用回我'));
  assert.ok(DEFAULT_TEXT_MIDNIGHT.includes('别给平安发消息'));
});

try { fs.unlinkSync(TMP); } catch { /* 收尾 */ }
console.log(`\n  ${fail === 0 ? 'OK' : 'FAIL'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
