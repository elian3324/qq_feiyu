import {normalizeId, mentionContext} from './message-context.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// This is a routing decision, independent of ownership, wake probability and the LLM.
export class GroupAddressing {
  constructor({botId = '', names = [], now = Date.now, quietMs = 120000, maxConversationMs = 300000} = {}) {
    Object.assign(this, {botId: normalizeId(botId), now, quietMs, maxConversationMs});
    this.names = names.filter(n => typeof n === 'string' && n.trim()).map(escapeRegex);
    this.groups = new Map();
    this.epochs = new Map();
  }

  group(key) {
    let group = this.groups.get(key);
    if (!group) {group = new Map(); this.groups.set(key, group);}
    for (const [id, thread] of group) if (thread.until <= this.now()) group.delete(id);
    return group;
  }

  callsBot(text) {
    // A vocative/name question can change the topic, but merely discussing her cannot.
    return this.names.some(name => new RegExp('(?:^|[\\s，,。！？!?；;])(?:请问|问问|问下|问一下)?' + name +
      '(?:$|[\\s，,：:！!？?～~]|你|在吗|在不在|帮|来|出来|回答|说说|觉得|怎么看|能不能|可以|会不会)', 'i').test(text));
  }

  peerThread(msg, targets, reason) {
    const group = this.group(msg.key), sender = normalizeId(msg.userId);
    const participants = [...new Set([sender, ...targets].filter(Boolean))];
    const thread = {participants, until: this.now() + this.quietMs, hardUntil: this.now() + this.maxConversationMs};
    for (const id of participants) {
      group.set(id, thread);
      const key = msg.key + '|' + id;
      this.epochs.set(key, (this.epochs.get(key) || 0) + 1);
    }
    return Object.freeze({target: 'others', reason, addressee_ids: targets, explicit_bot_request: false});
  }

  evaluate(msg) {
    return Object.freeze({...this.route(msg), epoch: this.epochs.get(msg.key + '|' + normalizeId(msg.userId)) || 0});
  }

  route(msg) {
    if (!msg.key?.startsWith('group:')) return Object.freeze({target: 'private', reason: 'private', addressee_ids: [], explicit_bot_request: false});
    const group = this.group(msg.key), sender = normalizeId(msg.userId);
    const botId = this.botId || normalizeId(msg.botId);
    const mentions = mentionContext(msg.mentions, botId);
    const atBot = botId ? mentions.is_mentioned_bot : msg.isAtMe === true;
    const others = mentions.mentioned_user_ids.filter(id => id !== botId);
    if (atBot) {
      group.delete(sender);
      return Object.freeze({target: 'bot', reason: 'bot-mention', addressee_ids: mentions.mentioned_user_ids, explicit_bot_request: true});
    }
    // An explicit @ to another person wins even over names/keywords/quoted bot text.
    if (others.length || mentions.mentions_all) return this.peerThread(msg, others, 'other-mention');
    if (msg.isPoke || msg.isQuoteMe || this.callsBot(String(msg.text || ''))) {
      group.delete(sender);
      return Object.freeze({target: 'bot', reason: msg.isPoke ? 'bot-poke' : msg.isQuoteMe ? 'bot-reply' : 'bot-name', addressee_ids: botId ? [botId] : [], explicit_bot_request: true});
    }
    const replyAuthor = normalizeId(msg.replyAuthorId);
    if (replyAuthor && replyAuthor !== botId && replyAuthor !== sender) return this.peerThread(msg, [replyAuthor], 'other-reply');
    const thread = group.get(sender);
    if (thread) {
      thread.until = Math.min(this.now() + this.quietMs, thread.hardUntil);
      return Object.freeze({target: 'others', reason: 'peer-continuation', addressee_ids: thread.participants.filter(id => id !== sender), explicit_bot_request: false});
    }
    return Object.freeze({target: 'ambient', reason: 'ambient', addressee_ids: [], explicit_bot_request: false});
  }

  canReply(msg) {
    if (!msg.key?.startsWith('group:')) return true;
    if (msg.addressing?.target === 'others') return false;
    if (msg.addressing?.explicit_bot_request) return true;
    if (Number.isSafeInteger(msg.addressing?.epoch) && msg.addressing.epoch !== (this.epochs.get(msg.key + '|' + normalizeId(msg.userId)) || 0)) return false;
    return !this.group(msg.key).has(normalizeId(msg.userId));
  }
}
