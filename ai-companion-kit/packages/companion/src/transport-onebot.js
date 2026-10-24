/**
 * 传输层 · OneBot v11 适配
 * ─────────────────────────────────────────────────────────────
 * OneBot v11 是一个被广泛实现的机器人协议：
 *   NapCat / Lagrange / LLOneBot / go-cqhttp / SnowLuma 都实现了它。
 *
 * 这一层负责：
 *   - 连上 OneBot 的 WebSocket，收消息
 *   - 把 OneBot 的原始事件翻译成统一格式
 *   - 提供「发消息」「发图」「正在输入」等动作
 *
 * 如果你想接别的平台（微信/Telegram/自研），照着这个接口再写一个就行。
 */

import { pathToFileURL } from 'node:url';
import faces from './qq-faces.json' with { type: 'json' };
import { normalizeId, normalizeOwnerIds, normalizeOneBotIdentity, mentionContext } from './message-context.js';

const decodeCQ = (value, parameter = false) => String(value)
  .replace(/&#91;/g, '[').replace(/&#93;/g, ']')
  .replace(parameter ? /&#44;/g : /$^/, ',').replace(/&amp;/g, '&');

/** Parse only the transport's CQ string, never CQ-looking text inside a text segment. */
export function normalizeSegments(message) {
  if (Array.isArray(message)) return message.filter(s => s && typeof s === 'object' && !Array.isArray(s)
    && typeof s.type === 'string' && s.data && typeof s.data === 'object' && !Array.isArray(s.data));
  if (typeof message !== 'string') return [];
  const segments = [];
  const pattern = /\[CQ:([A-Za-z0-9_-]+)((?:,[^\]]*)?)\]/g;
  let cursor = 0;
  for (const match of message.matchAll(pattern)) {
    if (match.index > cursor) segments.push({ type: 'text', data: { text: decodeCQ(message.slice(cursor, match.index)) } });
    const data = Object.create(null);
    for (const part of match[2].split(',').slice(1)) {
      const equal = part.indexOf('=');
      if (equal > 0) data[part.slice(0, equal)] = decodeCQ(part.slice(equal + 1), true);
    }
    if (match[1] === 'at' && data.qq !== 'all' && !normalizeId(data.qq)) segments.push({ type: 'text', data: { text: decodeCQ(match[0]) } });
    else segments.push({ type: match[1], data });
    cursor = match.index + match[0].length;
  }
  if (cursor < message.length) segments.push({ type: 'text', data: { text: decodeCQ(message.slice(cursor)) } });
  return segments;
}

/** Only body text and explicit media placeholders; identities and mentions stay separate. */
function segsToText(message) {
  const segs = normalizeSegments(message);
  const out = [];
  for (const s of segs) {
    if (!s) continue;
    switch (s.type) {
      case 'text': out.push(typeof s.data?.text === 'string' ? s.data.text : ''); break;
      case 'at': break;
      case 'image': out.push(Number(s.data?.sub_type)>0 || s.data?.emoji_id ? '[表情包]' : '[图片]'); break;
      case 'mface': out.push('[表情包]'); break;
      case 'face': {
        const id = /^(0|[1-9]\d{0,5})$/.test(String(s.data?.id ?? '')) ? String(s.data.id) : '';
        out.push(id ? '[QQ表情：' + (faces[id] || ('编号' + id)) + ']' : '[QQ表情]');
        break;
      }
      case 'reply': break;   // 引用单独处理
      case 'record': out.push('[语音]'); break;
      case 'video': out.push('[视频]'); break;
      case 'file': out.push('[文件]'); break;
      case 'json': case 'xml': out.push('[卡片]'); break;
      default: break;
    }
  }
  return out.join('').trim();
}

export function parseOneBotMessage(message, selfId = '') {
  const segments = normalizeSegments(message);
  const mentions = [];
  const attachments = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.type === 'at') {
      const id = segment.data.qq === 'all' ? 'all' : normalizeId(segment.data.qq);
      if (id) mentions.push({ user_id: id, is_bot: id === normalizeId(selfId),
        ...(typeof segment.data.name === 'string' ? { display_name: segment.data.name.slice(0, 80) } : {}) });
    } else if (!['text', 'reply'].includes(segment.type)) attachments.push({ segment_index: index, type: segment.type });
  }
  return { segments, text: segsToText(segments), mentions, attachments, ...mentionContext(mentions, selfId),
    mentionedBot: mentions.some(mention => mention.is_bot), replyTo: findReply(segments) };
}

/** 从消息段里找引用 */
function findReply(segs) {
  if (!Array.isArray(segs)) return null;
  for (const s of segs) if (s?.type === 'reply' && /^-?\d{1,20}$/.test(String(s.data?.id ?? ''))) return String(s.data.id);
  return null;
}

export class OneBot {
  /**
   * @param {object} opts
   * @param {string} opts.wsUrl       例如 ws://127.0.0.1:3001
   * @param {string} [opts.httpUrl]   例如 http://127.0.0.1:3000（发消息用）
   * @param {string} [opts.accessToken]
   * @param {(msg:object)=>void} [opts.onMessage]
   */
  constructor({ wsUrl, httpUrl, accessToken = '', onMessage, ownerIds = [], selfId = '', onStatus, mentionPolicy,
    heartbeatIntervalMs = 15000, heartbeatTimeoutMs = 15000, handshakeTimeoutMs = 15000, reconnectDelayMs = 5000 }) {
    this.wsUrl = wsUrl;
    this.httpUrl = (httpUrl || '').replace(/\/+$/, '');
    this.accessToken = accessToken;
    this.onMessage = onMessage;
    this.selfId = normalizeId(selfId) || '';
    this.ownerIds = normalizeOwnerIds(ownerIds);
    this.mentionPolicy=mentionPolicy;
    this.messageQueues=new Map();
    this.ws = null;
    this.connected = false;
    this.onStatus=onStatus;this.stopped=false;this.reconnectTimer=null;
    Object.assign(this,{heartbeatIntervalMs,heartbeatTimeoutMs,handshakeTimeoutMs,reconnectDelayMs});
    this.#connect();
  }

  #headers() {
    const h = {};
    if (this.accessToken) h.authorization = 'Bearer ' + this.accessToken;
    return h;
  }

  async #connect() {
    if(this.stopped)return;
    const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
    if(this.stopped)return;
    const sock = new WebSocket(this.wsUrl, { headers: this.#headers(), handshakeTimeout: this.handshakeTimeoutMs });
    this.ws = sock;
    let heartbeatTimer,lifecycleTimer,pongTimer,awaitingPong=false;
    const cleanup=()=>{clearInterval(heartbeatTimer);clearTimeout(lifecycleTimer);clearTimeout(pongTimer);};
    this.cleanupConnection=cleanup;
    const stalled=()=>{
      if(this.stopped || this.ws!==sock)return;
      this.connected=false;this.onStatus?.('stalled');sock.terminate();
    };
    sock.on?.('open', () => {
      if(this.stopped || this.ws!==sock){sock.terminate();return;}
      this.onStatus?.('transport-open');
      lifecycleTimer=setTimeout(stalled,this.handshakeTimeoutMs);
      heartbeatTimer=setInterval(()=>{
        if(this.stopped || this.ws!==sock || sock.readyState!==1 || awaitingPong || typeof sock.ping!=='function')return;
        awaitingPong=true;pongTimer=setTimeout(stalled,this.heartbeatTimeoutMs);
        try{sock.ping();}catch{stalled();}
      },this.heartbeatIntervalMs);
    });
    sock.on?.('pong',()=>{
      if(this.stopped || this.ws!==sock)return;
      awaitingPong=false;clearTimeout(pongTimer);
      if(this.connected)this.onStatus?.('ready');
    });
    sock.on?.('close', () => {
      cleanup();
      if(this.ws!==sock || this.stopped)return;
      this.connected = false;
      this.onStatus?.('disconnected');
      console.log('[onebot] 断开，将自动重连');
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer=setTimeout(() => this.#connect(), this.reconnectDelayMs);
    });
    sock.on?.('error', () => console.log('[onebot] 连接出错，请检查网关与鉴权配置'));
    sock.on?.('message', (data) => {
      if(this.ws!==sock || this.stopped)return;
      let ev;
      try { ev = JSON.parse(String(data)); } catch { return; }
      this.#handle(ev).catch(()=>console.error('[onebot] 消息事件处理失败'));
      if(this.connected)clearTimeout(lifecycleTimer);
    });
  }

  async #handle(ev) {
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return;
    if(ev.post_type==='meta_event' && ev.meta_event_type==='heartbeat'){
      const id=normalizeId(ev.self_id);
      if(!id || this.selfId && this.selfId!==id)return;
      if(ev.status?.online===false){this.connected=false;this.onStatus?.('qq-offline');return;}
      if(ev.status?.online===true){this.selfId=id;this.connected=true;this.onStatus?.('ready');}
      return;
    }
    if (ev.post_type === 'meta_event' && ev.meta_event_type === 'lifecycle') {
      const id = normalizeId(ev.self_id);
      if (id && (!this.selfId || this.selfId === id)) {this.selfId = id;this.connected=true;this.onStatus?.('ready');console.log('[onebot] 已连接');}
      return;
    }
    // Notifications are converted using authenticated platform fields only.
    // Pokes of other people and unrelated notices must never wake the bot.
    let notification=null;
    if(ev.post_type==='notice'){
      if(ev.notice_type==='notify'&&ev.sub_type==='poke'){
        if(normalizeId(ev.target_id)!==normalizeId(this.selfId||ev.self_id))return;
        notification='poke';
      }else if(ev.notice_type==='group_upload'&&ev.file&&typeof ev.file==='object')notification='file';
      else return;
      ev={...ev,post_type:'message',message_type:ev.group_id!=null?'group':'private',message:notification==='file'?[{type:'file',data:{file_id:ev.file.id,name:ev.file.name,file_size:ev.file.size,busid:ev.file.busid}}]:[{type:'text',data:{text:'[拍一拍]'}}]};
    }
    const identity = normalizeOneBotIdentity(ev, { selfId: this.selfId, ownerIds: this.ownerIds });
    if (!identity) return;
    this.selfId = identity.botId;

    const isGroup = identity.isGroup;
    const parsed = parseOneBotMessage(ev.message, this.selfId);

    const msg = {
      key: identity.key,
      isGroup,
      groupId: identity.groupId,
      userId: identity.userId,
      context: identity.context,
      botId: identity.botId,
      name: [ev.sender?.card, ev.sender?.nickname].find(n => typeof n === 'string' && n.trim())?.slice(0, 80) || '发言者',
      senderNames: [...new Set([ev.sender?.card, ev.sender?.nickname].filter(n=>typeof n==='string'&&n.trim()).map(n=>n.slice(0,80)))],
      text: parsed.text,
      raw: parsed.segments,
      mentions: parsed.mentions,
      mentioned_user_ids: parsed.mentioned_user_ids,
      is_mentioned_bot: parsed.is_mentioned_bot,
      attachments: parsed.attachments,
      isAtMe: parsed.mentionedBot,
      isQuoteMe: false,
      isPoke:notification==='poke',
      replyTo: parsed.replyTo,
      messageId: String(ev.message_id || ''),
      time: (ev.time || Math.floor(Date.now() / 1000)) * 1000,
    };
    // Resolve quoted authors in receive order within each session. A slower get_msg
    // must not let the following unmentioned peer reply overtake its opening @.
    const previous=this.messageQueues.get(msg.key)||Promise.resolve();
    const delivery=previous.catch(()=>{}).then(()=>this.#deliverMessage(msg));
    this.messageQueues.set(msg.key,delivery);
    try{await delivery;}finally{if(this.messageQueues.get(msg.key)===delivery)this.messageQueues.delete(msg.key);}
  }

  async #deliverMessage(msg) {
    if(this.stopped)return;
    if(msg.replyTo){
      const quoted=await this.api('get_msg',{message_id:msg.replyTo});
      const original=quoted.ok?quoted.data?.data:null;
      const author=normalizeId(original?.user_id??original?.sender?.user_id);
      let same=!!original&&msg.isGroup&&normalizeId(original.group_id)===msg.groupId;
      if(original&&!msg.isGroup&&original.message_type==='private'&&!original.group_id){
        const peer=normalizeId(original.target_id??original.peer_id);
        if(author===msg.userId)same=true;
        else if(author===msg.botId){
          if(peer)same=peer===msg.userId;
          else{const history=await this.api('get_friend_msg_history',{user_id:msg.userId,count:50});same=history.ok&&(history.data?.data?.messages||[]).some(row=>String(row.message_id)===msg.replyTo&&normalizeId(row.user_id??row.sender?.user_id)===msg.botId);}
        }
      }
      msg.isQuoteMe=!!same&&author===this.selfId;
      // Preserve only verified reply metadata, never trust embedded quoted text.
      if(same)msg.replyAuthorId=author;
    }
    const fileSegment=msg.raw.find(s=>s.type==='file');
    if(fileSegment&&msg.text==='[文件]'){
      this.fileNotices||=new Map();const token=msg.key+':'+String(fileSegment.data.file_id||fileSegment.data.file||'');
      const now=Date.now();if(this.fileNotices.has(token)&&now-this.fileNotices.get(token)<10000)return;
      this.fileNotices.set(token,now);for(const [id,at]of this.fileNotices)if(now-at>10000)this.fileNotices.delete(id);
    }
    this.onMessage?.(msg);
  }

  stop() {this.stopped=true;this.connected=false;clearTimeout(this.reconnectTimer);this.cleanupConnection?.();this.ws?.terminate?.();this.onStatus?.('stopped');}

  /** 调 OneBot 的 HTTP API */
  async api(action, params = {}) {
    if (!this.httpUrl) return { ok: false, error: '没配 httpUrl' };
    try {
      const r = await fetch(this.httpUrl + '/' + action, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.#headers() },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(30000),
      });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { ok: r.ok && j.status !== 'failed' && (j.retcode == null || j.retcode === 0), data: j, error: j.message || j.wording || ('HTTP ' + r.status) };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  /** 发一条纯文本 */
  async send(key, text, { atUserId } = {}) {
    const isGroup = key.startsWith('group:');
    const id = key.split(':')[1];
    let message = String(text);
    if (isGroup && atUserId != null) {
      const target = normalizeId(atUserId);
      if (!target) throw new Error('群聊回复对象 ID 无效');
      if(!this.mentionPolicy?.isBlocked(key,target))message = [{type:'at',data:{qq:target}},{type:'text',data:{text:' '+String(text)}}];
    }
    const result = await (isGroup
      ? this.api('send_group_msg', { group_id: id, message, auto_escape: true })
      : this.api('send_private_msg', { user_id: id, message, auto_escape: true }));
    if (!result.ok) throw new Error('OneBot 发送失败：' + result.error);
    return result;
  }

  /** 发一张图（本地文件或 URL） */
  async sendImage(key, file, {sticker=false} = {}) {
    const isGroup = key.startsWith('group:');
    const id = key.split(':')[1];
    const message = [{type:'image',data:{file:/^https?:|^file:/i.test(file)?file:pathToFileURL(file).href,...(sticker?{sub_type:1}:{})}}];
    const result = await (isGroup
      ? this.api('send_group_msg', { group_id: id, message })
      : this.api('send_private_msg', { user_id: id, message }));
    if (!result.ok) throw new Error('OneBot 图片发送失败：' + result.error);
    return result;
  }

  /** 发送本地音频，由 NapCat 转换为 QQ 语音 */
  async sendVoice(key, file) {
    const isGroup = key.startsWith('group:');
    const id = key.split(':')[1];
    const message = [{ type: 'record', data: { file: pathToFileURL(file).href } }];
    const result = await this.api(isGroup ? 'send_group_msg' : 'send_private_msg', { [isGroup ? 'group_id' : 'user_id']: id, message });
    if (!result.ok) throw new Error('OneBot 语音发送失败：' + result.error);
    return result;
  }

  /**
   * 「正在输入…」
   * OneBot 扩展接口，部分实现支持（SnowLuma 是 set_input_status）
   */
  async setTyping(key, on) {
    const isGroup = key.startsWith('group:');
    const id = key.split(':')[1];
    return this.api('set_input_status', isGroup
      ? { group_id: id, event_type: on ? 1 : 0 }
      : { user_id: id, event_type: on ? 1 : 0 });
  }

  /** 查一条消息是谁发的（用来判断引用的是不是我） */
  async whoSent(messageId) {
    const r = await this.api('get_msg', { message_id: messageId });
    return r.ok ? String(r.data?.data?.user_id || '') : '';
  }
}

export { segsToText };
export default OneBot;
