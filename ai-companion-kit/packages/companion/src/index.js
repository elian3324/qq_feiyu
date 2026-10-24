/**
 * companion · 命令行入口
 * ─────────────────────────────────────────────────────────────
 * 把各层拼起来跑：
 *
 *   OneBot(收消息) → Waker(要不要醒) → Brain(生成回复)
 *                                        ↓
 *                                   Humanizer(怎么发)
 *                                        ↓
 *                                   OneBot(发消息)
 *
 * 用法：
 *   node src/index.js --config ./config.json
 *   node src/index.js --config ./config.json --dry-run   只打印，不真发
 *   node src/index.js --check                            只检查角色卡
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Memory } from './memory.js';
import { Role } from './role.js';
import { Brain } from './brain.js';
import { Humanizer } from './humanize.js';
import { Waker } from './wake.js';
import { TurnQueue } from './turn-queue.js';
import { OneBot } from './transport-onebot.js';
import { GroupMentionPolicy } from './group-mentions.js';
import { DiaryWriter,DiaryScheduler,diaryOptions } from './diary-service.js';
import { normalizeId, normalizeOwnerIds, contextFromMessage } from './message-context.js';
import { applyEnvironment } from './config-env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mentionPolicies=new WeakMap();
function mentionsFor(cfg) {
  if(!mentionPolicies.has(cfg))mentionPolicies.set(cfg,new GroupMentionPolicy({ownerIds:cfg.ownerIds,...cfg.groupMentions,stateFile:cfg.dataDir?path.join(cfg.dataDir,'group-mention-state.json'):undefined}));
  return mentionPolicies.get(cfg);
}

// ── 配置 ──────────────────────────────────────────────────────
export function loadConfig(explicitPath) {
  const file = explicitPath || path.join(__dirname, '..', 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('配置无法读取或不是有效 JSON，请检查本地配置文件'); }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('配置必须是 JSON 对象');
  cfg = applyEnvironment(cfg);
  const ownerIds = normalizeOwnerIds(cfg.ownerIds);
  const ambientCooldownMs = cfg.wake?.ambientCooldownMs ?? 45000;
  if (!Number.isFinite(ambientCooldownMs) || ambientCooldownMs < 0 || ambientCooldownMs > 3600000) throw new Error('wake.ambientCooldownMs 必须为 0 到 3600000 的毫秒数');
  if (cfg.botQQ != null && cfg.botQQ !== '' && !normalizeId(cfg.botQQ)) throw new Error('botQQ 必须是有效 QQ ID');
  if (cfg.allow != null) {
    if (typeof cfg.allow !== 'object' || Array.isArray(cfg.allow)) throw new Error('allow 配置格式无效');
    for (const kind of ['private', 'groups']) {
      if (!Array.isArray(cfg.allow[kind]) || cfg.allow[kind].some(id => !normalizeId(id))) throw new Error('白名单必须是有效 ID 的数组');
    }
  }
  const dir = path.dirname(path.resolve(file));
  const rel = (p, def) => (p ? path.resolve(dir, p) : path.join(dir, def));

  return {
    apiKey: cfg.apiKey || process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    baseUrl: cfg.baseUrl || 'https://api.deepseek.com/v1',
    model: cfg.model || 'deepseek-chat',
    modelOptions: cfg.modelOptions || {},
    groupIdentityReview: cfg.groupIdentityReview === true,
    ownerMemory: cfg.ownerMemory === true,
    vision: cfg.vision || {},
    voice: cfg.voice || {},
    asr: cfg.asr || {},
    video: cfg.video || {},
    attachments: cfg.attachments || {},
    stickers: cfg.stickers || {},
    autonomy: cfg.autonomy || {},
    phone: cfg.phone || {},
    qzone: cfg.qzone || {},
    autonomyModule: cfg.autonomyModule ? path.resolve(dir,cfg.autonomyModule) : '',
    allow: cfg.allow || null,
    configFile: path.resolve(file),
    botQQ: String(cfg.botQQ || ''),
    toolModule: cfg.toolModule ? path.resolve(dir, cfg.toolModule) : '',

    roleCard: rel(cfg.roleCard, 'role.md'),
    roleMaxChars: cfg.roleMaxChars || 12000,
    dataDir: rel(cfg.dataDir, 'data'),
    diaryDir: rel(cfg.diaryDir,'data/diary'),diaryMaxChars:cfg.diaryMaxChars||2000,
    diary:diaryOptions(cfg.diary),

    onebot: {
      wsUrl: cfg.onebot?.wsUrl || 'ws://127.0.0.1:3001',
      httpUrl: cfg.onebot?.httpUrl || 'http://127.0.0.1:3000',
      accessToken: cfg.onebot?.accessToken || '',
    },

    names: cfg.names || [],
    keywords: cfg.keywords || [],
    ownerIds,

    wake: {
      probability: cfg.wake?.probability ?? 0.05,
      ambientCooldownMs,
      groupAtOnly: cfg.wake?.groupAtOnly !== false,
      privateWindowMs: cfg.wake?.privateWindowMs ?? 1500,
      groupWindowMs: cfg.wake?.groupWindowMs ?? 6000,
      ownerAlwaysWake: cfg.wake?.ownerAlwaysWake !== false,
    },

    humanize: cfg.humanize || {},
    groupMentions: cfg.groupMentions || {},
    dryRun: process.argv.includes('--dry-run'),
  };
}

// ── 主程序 ────────────────────────────────────────────────────
export async function main() {
  const cfgIdx = process.argv.indexOf('--config');
  const cfg = loadConfig(cfgIdx >= 0 ? process.argv[cfgIdx + 1] : null);

  console.log('════════ companion ════════');
  console.log('  模型      ' + cfg.model);
  console.log('  角色卡    ' + cfg.roleCard);
  console.log('  数据目录  ' + cfg.dataDir);
  console.log('  OneBot    正向 WebSocket + HTTP API');
  console.log('  名字      ' + (cfg.names.join(' / ') || '（没配）'));
  console.log('  管理员身份  ' + (cfg.ownerIds.length ? '已配置（按平台 ID 验证）' : '未配置'));
  console.log('  管理员群聊  ' + (cfg.wake.ownerAlwaysWake ? '免 @ 唤醒（仍受群白名单限制）' : '按群聊触发规则'));
  console.log('  干跑      ' + (cfg.dryRun ? '是（不会真发）' : '否'));
  console.log('');

  const memory = new Memory({ dir: cfg.dataDir, ownerIds:cfg.ownerIds });
  const role = new Role({ cardPath: cfg.roleCard, maxChars: cfg.roleMaxChars });

  // 角色卡体检
  const lint = role.lint();
  if (!lint.ok) {
    console.log('⚠️ 角色卡检查：');
    lint.warn.forEach((w) => console.log('   · ' + w));
    console.log('');
  }
  if (process.argv.includes('--check')) { console.log('检查完毕。'); return; }
  let diaryStatus=cfg.diary.enabled?'waiting':'disabled';
  const diaryScheduler=cfg.diary.enabled?new DiaryScheduler({writer:new DiaryWriter({cfg}),onStatus:status=>{diaryStatus=status;}}):null;
  const archived = memory.pruneNonOwnerPeople();
  if(archived)console.log('[memory] 已归档旧的非管理员长期条目');
  if (!cfg.apiKey) console.log('⚠️ 没配 apiKey，模型调用会失败\n');

  const toolProvider = cfg.toolModule ? await (await import(pathToFileURL(cfg.toolModule).href)).createTools(cfg) : null;
  const brain = new Brain({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model, modelOptions: cfg.modelOptions, ownerIds: cfg.ownerIds, botId: cfg.botQQ, role, memory, toolProvider, groupIdentityReview:cfg.groupIdentityReview,ownerMemory:cfg.ownerMemory });
  brain.ownerWorker?.start();
  const human = new Humanizer(cfg.humanize);
  const mentionPolicy=mentionsFor(cfg);
  mentionPolicy.restoreMemory(memory,cfg.allow?.groups||[]);
  const waker = new Waker({
    botId: cfg.botQQ,
    names: cfg.names,
    keywords: cfg.keywords,
    ownerIds: cfg.ownerIds,
    ownerAlwaysWake: cfg.wake.ownerAlwaysWake,
    probability: cfg.wake.probability,
    ambientCooldownMs: cfg.wake.ambientCooldownMs,
    batchWindowMs: cfg.wake.groupWindowMs,
  });

  /** @type {Map<string, NodeJS.Timeout>} 每个会话的合并定时器 */
  const pending = new Map();
  const turns = new TurnQueue({ownerIds:cfg.ownerIds,run:items=>{
    const eligible = items.filter(item=>waker.canReply(item));
    if(eligible.length)return handleTurn({bot,brain,human,memory,waker},expandMedia(eligible),cfg);
  },onError:e=>console.error('[出错] '+safeError(e,cfg))});
  let autonomy=null;
  function expandMedia(items) {
    const expanded=[];
    for(const item of items) {
      for(const related of item.relatedMedia||[]) {
        const present=items.includes(related)||expanded.includes(related)||related.messageId&&[...items,...expanded].some(message=>message.messageId===related.messageId);
        if(!present)expanded.push(related);
      }
      expanded.push(item);
    }
    return expanded;
  }
  function enqueue(items){if(items.length)turns.enqueue(items);}

  let transportWasReady=false;
  const bot = new OneBot({
    ...cfg.onebot,
    ownerIds: cfg.ownerIds,
    selfId: cfg.botQQ,
    mentionPolicy,
    onStatus:status=>{
      if(process.env.COMPANION_HEALTH_FILE)try{fs.writeFileSync(process.env.COMPANION_HEALTH_FILE,JSON.stringify({pid:process.pid,at:new Date().toISOString(),status,
        ownerConfigured:cfg.ownerIds.length>0,ownerAlwaysWake:cfg.wake.ownerAlwaysWake,
        speakerProtocol:'per-message-v1',groupIdentityReview:cfg.groupIdentityReview,
        ownerPriority:true,ownerOnlyLongTermMemory:true,sharedOwnerMemory:cfg.ownerMemory,shortTermContextHours:2,
        mentionPolicyVersion:1,
        groupAddressingVersion:1,
        ambientCooldownMs:cfg.wake.ambientCooldownMs,
        mediaProtocolVersion:2,ownerMemoryVersion:2,
        wakeProbability:cfg.wake.probability,wakeKeywords:cfg.keywords,
        asrEnabled:cfg.asr.enabled===true,videoEnabled:cfg.video.enabled===true,documentsEnabled:cfg.attachments.enabled===true,
        diaryEnabled:cfg.diary.enabled,diaryTime:cfg.diary.time,diaryTimezone:cfg.diary.timezone,diaryStatus,
        roleChars:role.length,roleSha256:createHash('sha256').update(role.read()).digest('hex')}));}catch{}
      const becameReady=status==='ready'&&!transportWasReady;
      transportWasReady=status==='ready';
      if(becameReady) {
        toolProvider?.restoreRecentMedia?.(bot).catch(()=>console.error('[media] 近期媒体恢复未完成，实时收图继续运行'));
        mentionPolicy.restorePreferences(bot,cfg.allow?.groups||[],cfg.botQQ).catch(()=>console.error('[mentions] 历史偏好恢复未完成，实时偏好继续生效'));
      }
    },
    onMessage: (msg) => {
      if (msg.userId === bot.selfId || !isAllowed(cfg, msg)) return;
      mentionPolicy.observeIncoming(msg);
      toolProvider?.observeMessage?.(msg,bot);
      try {autonomy?.noteIncoming(msg);}catch {console.error('[autonomy] 活跃状态未能保存，正常聊天继续');}
      // 第一次见到这个会话 → 给个默认策略
      if (!waker.configs.has(msg.key)) {
        waker.setConfig(msg.key, msg.isGroup
          ? {
              mode: 'diving',
              atMention: true,
              nameMention: !cfg.wake.groupAtOnly,
              question: !cfg.wake.groupAtOnly,
              poke: true,
              probability: cfg.wake.probability,
            }
          : { mode: 'active', anyMessage: true });   // 私聊每条都理
      }

      const verdict = waker.shouldWake(msg);
      if (!verdict.wake) {
        if (msg.isGroup) console.log('[静音] 群聊消息未触发回复');
        return;
      }
      console.log('[醒·' + verdict.reason.split(':')[0] + '] 已接收' + (msg.isGroup ? '群聊' : '私聊') + '消息');

      // 合并窗口：等人把话说完
      const win = msg.isGroup ? cfg.wake.groupWindowMs : cfg.wake.privateWindowMs;
      clearTimeout(pending.get(msg.key));
      const related=toolProvider?.relatedMessages?.(msg)||[];
      if(related.length)console.log('[media] 补入同会话近期图片 '+related.length+' 条（保留原发送者）');
      msg.relatedMedia=related;
      const batch = waker.batch(msg);
      if (batch.ready) { pending.delete(msg.key); enqueue(batch.batch); return; }
      pending.set(msg.key, setTimeout(() => {
        pending.delete(msg.key);
        enqueue(waker.flush(msg.key));
      }, win));
    },
  });

  diaryScheduler?.start();
  if(cfg.autonomyModule) {
    try {
      autonomy=await (await import(pathToFileURL(cfg.autonomyModule).href)).createAutonomy({cfg,bot,brain,memory,role,
        isSessionBusy:key=>turns.has(key)||pending.has(key),stickers:toolProvider?.stickers});
      autonomy.start();
    }catch {console.error('[autonomy] 自主模块未启动，正常聊天继续运行，请检查本地状态和配置');}
  }

  process.on('unhandledRejection', e => console.error('[未处理] ' + safeError(e, cfg)));
  process.on('SIGINT', () => { diaryScheduler?.stop();autonomy?.stop();brain.ownerWorker?.stop();console.log('\n再见。'); process.exit(0); });

  console.log('在跑了。Ctrl+C 退出。\n');
}

export function isAllowed(cfg, msg) {
  try { contextFromMessage(msg, cfg.ownerIds); } catch { return false; }
  if (!cfg.allow) return true;
  const ids = msg.isGroup ? cfg.allow.groups : cfg.allow.private;
  return (ids || []).map(String).includes(msg.isGroup ? msg.groupId : msg.userId);
}

function safeError(error, cfg = {}) {
  let text = String(error?.message || '未知错误');
  for (const secret of [cfg.apiKey, cfg.onebot?.accessToken, cfg.vision?.apiKey, cfg.voice?.apiKey, cfg.asr?.apiKey, ...(cfg.ownerIds || []), cfg.botQQ]) {
    if (secret) text = text.replaceAll(String(secret), '[redacted]');
  }
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').replace(/\b[1-9]\d{4,}\b/g, '[id]').slice(0, 240);
}

/** 处理一轮（可能是合并后的多条） */
export async function handleTurn({ bot, brain, human, memory, waker }, items, cfg) {
  if (!Array.isArray(items) || !items.length) throw new Error('消息批次为空');
  const contexts = items.map(item => contextFromMessage(item, cfg.ownerIds));
  const last = items[items.length - 1];
  if (waker?.canReply && !waker.canReply(last)) return;
  const key = last.key;
  if (contexts.some(context => context.session_id !== key)) throw new Error('不能合并不同会话的消息');
  const context = contexts[contexts.length - 1];
  const mentionPolicy=mentionsFor(cfg);
  for(const item of items)mentionPolicy.observeIncoming(item);
  const turnMessages = items.map((item, index) => ({
    session_id: key, sender_id: contexts[index].sender_id,
    display_name: typeof item.name === 'string' ? item.name : '', text: typeof item.text === 'string' ? item.text : '',
    source_at:item.time||Date.now(),message_id:item.messageId,
    display_names: item.senderNames,
    mentions: item.mentions, reply_to: item.replyTo, reply_author_id:item.replyAuthorId, attachments: item.attachments,
    addressing: item.addressing,
  }));
  const attachments = await brain.toolProvider?.prepareMessages?.(items, bot, {key, userId:context.sender_id,context});
  for(const [index,message]of turnMessages.entries()){
    const speech=(attachments?.transcripts||[]).filter(r=>r.messageIndex===index).map(r=>r.text).join('\n');
    if(speech)message.text+='\n【此发送者语音转写】\n'+speech;
    const materials=(attachments?.readings||[]).filter(r=>r.messageIndex===index).map(r=>r.text).join('\n\n');
    if(materials)message.attachment_text=materials;
  }

  const situation = last.isGroup
    ? '你在一个 QQ 群里。下面是群里刚连着说的几句话，最后一条是最新的。'
    : '你正在 QQ 私聊中。发送者身份以程序验证的上下文为准。';

  if (waker?.canReply && !waker.canReply(last)) return;
  const { text: out, images = [], voices = [], stickers = [] } = await brain.reply({ key, userId: context.sender_id, userName: last.name,
    text: last.text, botId: bot.selfId, turnMessages, media: attachments?.media || [],
    collectableStickers:attachments?.collectableStickers||[],
    observations: typeof attachments==='string'?attachments:(attachments?.observations||''), situation, context, batchContexts: contexts });
  if (!out && !images.length && !voices.length && !stickers.length) { console.log('   （没说话）'); return; }
  if (waker?.canReply && !waker.canReply(last)) {console.log('[静音] 发言者已转向群友，取消本轮回复');return;}

  if (cfg.dryRun) { console.log('   [干跑] 已生成回复（未发送）'); return; }

  const round=mentionPolicy.beginRound(key,context.sender_id,items);
  const canRespond = () => !waker?.canReply || waker.canReply(last);
  for (const image of images) {if(!canRespond())return;await bot.sendImage(key, image);round.sent({});}
  for (const voice of voices) {if(!canRespond())return;await bot.sendVoice(key, voice.file);round.sent({});}
  for (const sticker of stickers.slice(0,1)) {
    if(!canRespond())return;
    try {const delivery=await bot.sendImage(key,sticker.file,{sticker:true});round.sent({});console.log('[sticker] 已发送 '+sticker.id);await brain.toolProvider?.stickerDelivered?.(sticker,key,delivery);}
    catch {console.error('[sticker] 表情发送失败，继续文字回复');await brain.toolProvider?.stickerFailed?.(sticker,key);}
  }

  let redirected=false;
  const r = await human.say(voices.length ? '' : key.startsWith('group:')?mentionPolicy.cleanText(out,items):out, {
    setTyping: (on) => bot.setTyping(key, on),
    send: async (m) => {
      if(!canRespond()){redirected=true;return;}
      const options = round.options();
      const result = await bot.send(key, m, options);
      round.sent(options);
      return result;
    },
  });
  if(redirected){console.log('[静音] 群友对话已开始，停止剩余回复');return;}
  console.log('   发出 ' + r.sent + ' 条');
  if (voices.length) console.log('   发出语音 ' + voices.length + ' 条');
  waker.wake(key);
}

// 直接跑才启动；被 import 时不启动
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(() => { console.error('启动失败，请检查本地配置、依赖与网关状态'); process.exit(1); });
}
