// Capture QQ's own native factories in their original call order and context.
const fs = require('node:fs');
const {createQQSessionBridge} = require('./qq-session-bridge.cjs');
function auditLoginFactory(argumentCount, changed) {
  const file = process.env.COMPANION_AUTH_AUDIT_FILE;
  if (!file) return;
  // Never retain or stringify native arguments: they can contain QQ credentials.
  try {fs.appendFileSync(file, JSON.stringify({at:new Date().toISOString(),event:'wrapper-login-factory',argumentCount,serviceChanged:changed})+'\n');}catch{}
}
function createQQNativeServices({onReady = () => {}, auditFactory = auditLoginFactory, sessionOptions = {}} = {}) {
  let session = null, loginService = null, started = false;
  const factories = new WeakMap();
  // The adapter must follow the real service returned by subsequent QQ get()
  // calls, rather than retaining an early, possibly unconfigured singleton.
  const liveLoginService = new Proxy({}, {
    get(_target, key) {
      if (!loginService) throw new Error('QQ login service is not available');
      const value = Reflect.get(loginService, key, loginService);
      if (typeof value !== 'function') return value;
      return function(...args) {
        if (!loginService) throw new Error('QQ login service is not available');
        const method = Reflect.get(loginService, key, loginService);
        return Reflect.apply(method, loginService, args);
      };
    }
  });
  function maybeStart() {
    if (!started && session && loginService) {
      started = true;
      onReady({session, loginService:liveLoginService});
    }
  }
  const sessionBridge = createQQSessionBridge({...sessionOptions, onSession(value) {session=value;maybeStart();}});
  return {
    sessionBridge,
    wrapService(name, factory) {
      if (name === 'NodeIQQNTWrapperSession') return sessionBridge.wrapService(factory);
      if (name !== 'NodeIKernelLoginService' || !factory || !['object','function'].includes(typeof factory)) return factory;
      if (factories.has(factory)) return factories.get(factory);
      const methods = new Map();
      const proxy = new Proxy({}, {
        get(_target, key) {
          const value = Reflect.get(factory, key, factory);
          if (typeof value !== 'function') return value;
          if (methods.get(key)?.original === value) return methods.get(key).wrapped;
          const wrapped = function(...args) {
            const result = Reflect.apply(value, factory, args);
            if (key === 'get') {
              const actual = result && ['object','function'].includes(typeof result) ? result : null;
              try {auditFactory(args.length, actual !== loginService);}catch{}
              loginService = actual;
              maybeStart();
            }
            // QQ receives the exact object its native get() returned.
            return result;
          };
          methods.set(key, {original:value, wrapped});
          return wrapped;
        }
      });
      factories.set(factory, proxy);
      return proxy;
    }
  };
}
module.exports = {createQQNativeServices};
