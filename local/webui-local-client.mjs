// The raw WebUI token is never sent to or embedded in this script.
export async function startLocalWebUi(env, loadApp) {
  const { location, history, document, localStorage, fetch } = env;
  const script = document.querySelector('script[data-napcat-app]');
  if (!script) throw new Error('Missing WebUI application entry');
  const entry = script.dataset.napcatApp;
  const desktopLogin = document.querySelector('meta[name="companion-login"]')?.content === 'desktop-framework';
  const isLoginPath = pathname => /^\/webui\/(?:qq_login|web_login)\/?$/.test(pathname);
  const url = new URL(location.href);
  if (desktopLogin && isLoginPath(url.pathname)) {
    location.replace('/webui/desktop-login.html');
    return;
  }
  url.searchParams.delete('token');
  if (/^\/webui\/web_login\/?$/.test(url.pathname)) url.pathname = '/webui/qq_login';
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  // Also cover SPA logout/back navigation, which does not load a fresh HTML page.
  const redirectFromLogin = () => {
    if (desktopLogin && isLoginPath(location.pathname)) {
      location.replace('/webui/desktop-login.html');
      return;
    }
    if (/^\/webui\/web_login\/?$/.test(location.pathname)) location.replace('/webui/qq_login');
  };
  for (const method of ['pushState', 'replaceState']) {
    if (typeof history[method] !== 'function') continue;
    const original = history[method].bind(history);
    history[method] = (...args) => {
      const result = original(...args);
      if (desktopLogin) redirectFromLogin();
      else queueMicrotask(redirectFromLogin);
      return result;
    };
  }
  env.addEventListener('popstate', redirectFromLogin);
  env.addEventListener('pageshow', redirectFromLogin);
  const authenticate = async () => {
    const response = await fetch('/api/local-session', {
      method: 'POST', headers: { 'X-NapCat-Local-Login': '1' }, credentials: 'same-origin', cache: 'no-store',
    });
    if (!response.ok) throw new Error('Local session unavailable');
    const result = await response.json();
    if (result.code !== 0 || typeof result.data?.Credential !== 'string' || !result.data.Credential) throw new Error('Local session unavailable');
    // NapCat's useLocalStorage stores a JSON string, not a raw credential.
    localStorage.setItem('token', JSON.stringify(result.data.Credential));
  };
  const wait = ms => new Promise(resolve => env.setTimeout(resolve, ms));
  for (;;) {
    try { await authenticate(); break; }
    catch {
      const root = document.getElementById('root');
      if (root) root.textContent = '管理服务尚未就绪，正在自动重试登录…';
      await wait(3000);
    }
  }
  await loadApp(entry);
  redirectFromLogin();
  // Dynamic import may finish after window.load, so register explicitly as well.
  env.navigator?.serviceWorker?.register('/webui/sw.js', { scope: '/webui/', updateViaCache: 'none' }).catch(() => {});
  let renewing = false;
  const renew = async () => {
    if (renewing) return;
    renewing = true;
    try {
      await authenticate();
      // Notify NapCat's useSyncExternalStore subscriber in the same tab.
      env.dispatchEvent(new env.StorageEvent('storage', { key: 'token', newValue: localStorage.getItem('token'), storageArea: localStorage }));
    } catch { /* On expired API credentials NapCat reloads, then bootstrap retries. */ }
    finally { renewing = false; }
  };
  env.setInterval(renew, 40 * 60 * 1000);
  env.addEventListener('focus', renew);
}

if (typeof window !== 'undefined') startLocalWebUi(window, entry => import(entry)).catch(() => {
  const root = document.getElementById('root');
  if (root) root.textContent = '管理页面加载失败，请刷新页面重试。';
});
