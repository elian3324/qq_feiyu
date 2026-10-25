// Observe the actual QQ-owned session. Do not create an extra native session.
const {attachAuthAudit, lifecycle} = require('./qq-auth-audit.cjs');
const factories = new Set(['create', 'get', 'getNTWrapperSession']);
function identityFromConfig(config) {
  const uin = typeof config?.selfUin === 'string' ? config.selfUin : '';
  const uid = typeof config?.selfUid === 'string' ? config.selfUid : '';
  return /^[1-9]\d{4,18}$/.test(uin) && uid.length > 0 && uid.length <= 128 && !/\s/.test(uid)
    ? {uin, uid} : null;
}
function createQQSessionBridge({onSession = () => {}, audit = attachAuthAudit, log = lifecycle} = {}) {
  const sessions = new WeakMap(), services = new WeakMap();
  let active = null, callback = null, started = false;
  function notify(state, generation) {
    if (active !== state || state.generation !== generation) return;
    state.ready = true;
    log('wrapper-session-initialized');
    if (callback) callback();
  }
  function wrapSession(session) {
    if (!session || !['object', 'function'].includes(typeof session)) return session;
    const existing = sessions.get(session);
    if (existing) return existing.proxy;
    const state = {identity:null, ready:false, generation:0, proxy:null};
    const methods = new Map();
    state.proxy = new Proxy({}, {
      get(_target, key) {
        const target = session;
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        if (methods.get(key)?.original === value) return methods.get(key).wrapped;
        const wrapped = function(...args) {
          if (key === 'init') {
            active = state;
            state.generation++;
            state.ready = false;
            state.identity = identityFromConfig(args[0]);
            const generation = state.generation;
            audit(args[1], 'onMSFSsoError', 'msf-error');
            audit(args[3], 'onRefreshTicketResult', 'ticket-refresh');
            audit(args[3], 'onSessionInitComplete', 'session-initialized');
            const listener = args[3];
            if (listener && typeof listener === 'object') {
              const origin = listener.onOpentelemetryInit;
              listener.onOpentelemetryInit = function(...events) {
                const result = typeof origin === 'function' ? Reflect.apply(origin, this, events) : undefined;
                if (events[0]?.is_init === true) notify(state, generation);
                return result;
              };
            }
          }
          return Reflect.apply(value, target, args);
        };
        methods.set(key, {original:value, wrapped});
        return wrapped;
      }
    });
    sessions.set(session, state);
    if (!active) active = state;
    if (!started) {
      started = true;
      log('wrapper-session-ready');
      onSession(state.proxy);
    }
    return state.proxy;
  }
  return {
    wrapService(service) {
      if (!service || !['object', 'function'].includes(typeof service)) return service;
      if (services.has(service)) return services.get(service);
      const proxy = new Proxy({}, {
        get(_target, key) {
          const target = service;
          const value = Reflect.get(target, key, target);
          if (typeof value !== 'function') return value;
          return function(...args) {
            const result = Reflect.apply(value, target, args);
            return factories.has(key) ? wrapSession(result) : result;
          };
        }
      });
      services.set(service, proxy);
      return proxy;
    },
    registerInitCallback(next) {
      callback = typeof next === 'function' ? next : null;
      if (active?.ready && callback) callback();
    },
    getSessionIdentity() {
      return active?.ready && active.identity ? {...active.identity} : null;
    }
  };
}
module.exports = {createQQSessionBridge, identityFromConfig};
