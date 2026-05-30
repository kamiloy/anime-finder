// @ts-nocheck
// FanJi Community Auth — 登录/注册 UI + 令牌管理
// Capacitor Preferences 原生侧已注册；localStorage 兜底（浏览器环境 / 桥未就绪）
(function init() {
  const G = window.fanji;
  if (!G) { setTimeout(init, 50); return; }

  const SK = 'fanji_session';

  function prefs() {
    const C = (window as any).Capacitor;
    return (C && C.Plugins && C.Plugins.Preferences) || null;
  }

  function prefSet(key, value) {
    const P = prefs();
    if (!P) return Promise.resolve(false);
    return P.set({ key, value }).then(() => true).catch(() => false);
  }
  function prefGet(key) {
    const P = prefs();
    if (!P) return Promise.resolve(null);
    return P.get({ key }).then((r: any) => (r && r.value != null ? r.value : null)).catch(() => null);
  }
  function prefRemove(key) {
    const P = prefs();
    if (!P) return Promise.resolve(false);
    return P.remove({ key }).then(() => true).catch(() => false);
  }

  function save(token, user) {
    G.token = token;
    G.currentUser = user;
    const raw = JSON.stringify({ token, user });
    prefSet(SK, raw);
    try { localStorage.setItem(SK, raw); } catch (e) {}
  }

  function restore(done) {
    prefGet(SK).then(function (raw) {
      if (!raw) {
        try { raw = localStorage.getItem(SK); } catch (e) {}
      }
      if (raw) {
        try {
          const s = JSON.parse(raw);
          if (s && s.token) { G.token = s.token; G.currentUser = s.user; return done(true); }
        } catch (e) {}
      }
      done(false);
    });
  }

  function clear() {
    G.token = null;
    G.currentUser = null;
    prefRemove(SK);
    try { localStorage.removeItem(SK); } catch (e) {}
  }

  function tryRestore(n) {
    restore(function (ok) {
      if (ok) {
        if (G.currentUser && typeof G.onAuthChange === 'function')
          setTimeout(() => G.onAuthChange(G.currentUser), 50);
        return;
      }
      if (n < 30) setTimeout(() => tryRestore(n + 1), 200);
    });
  }
  tryRestore(0);

  function showAuthModal(mode) {
    const m = document.getElementById('authModal');
    if (!m) return;
    m.classList.remove('hidden');
    m.querySelector('.auth-panel').className = 'auth-panel ' + (mode === 'login' ? 'mode-login' : 'mode-register');
    document.getElementById('authError').textContent = '';
    (document.getElementById('authUsername') as HTMLInputElement).value = '';
    (document.getElementById('authPassword') as HTMLInputElement).value = '';
    (document.getElementById('authNickname') as HTMLInputElement).value = '';
    document.getElementById('authTitle').textContent = mode === 'login' ? '登录' : '注册';
    document.getElementById('authSubmitBtn').textContent = mode === 'login' ? '登录' : '注册';
    document.getElementById('authSwitchBtn').textContent = mode === 'login' ? '没有账号？去注册' : '已有账号？去登录';
    document.getElementById('authSwitchBtn').dataset.mode = mode === 'login' ? 'register' : 'login';
    document.getElementById('authNickRow').style.display = mode === 'register' ? '' : 'none';
  }
  function hideAuthModal() { const m = document.getElementById('authModal'); if (m) m.classList.add('hidden'); }

  G.requireAuth = function () { if (G.currentUser) return true; showAuthModal('login'); return false; };
  G.logout = async function () {
    try { await G.comm.logout(); } catch (e) {}
    clear();
    if (typeof G.onAuthChange === 'function') G.onAuthChange(null);
    if (typeof (window as any).showToast === 'function') (window as any).showToast('已退出登录');
  };

  async function handleAuthSubmit(mode) {
    const errEl = document.getElementById('authError');
    const un = (document.getElementById('authUsername') as HTMLInputElement).value.trim();
    const pw = (document.getElementById('authPassword') as HTMLInputElement).value;
    if (!un || !pw) { errEl.textContent = '请填写用户名和密码'; return; }
    if (un.length < 3) { errEl.textContent = '用户名至少 3 个字符'; return; }
    if (pw.length < 6) { errEl.textContent = '密码至少 6 个字符'; return; }
    const body: any = { username: un, password: pw, turnstile: '' };
    if (mode === 'register') body.nickname = (document.getElementById('authNickname') as HTMLInputElement).value.trim() || un;
    try {
      const fn = mode === 'login' ? G.comm.login : G.comm.register;
      const r = await fn(body);
      if (r.ok) {
        save(r.token, r.user); hideAuthModal();
        if (typeof (window as any).showToast === 'function') (window as any).showToast(mode === 'login' ? '欢迎回来，' + r.user.nickname : '注册成功！');
        if (typeof G.onAuthChange === 'function') G.onAuthChange(r.user);
      } else { errEl.textContent = r.error || '操作失败，请重试'; }
    } catch (e) { errEl.textContent = '网络错误，请稍后重试'; }
  }

  function init2() {
    const m = document.getElementById('authModal'); if (!m) return;
    m.addEventListener('click', function (e) { if (e.target === m) hideAuthModal(); });
    document.getElementById('authSwitchBtn').addEventListener('click', function (this: HTMLElement) { showAuthModal(this.dataset.mode); });
    document.getElementById('authSubmitBtn').addEventListener('click', function () {
      handleAuthSubmit(document.getElementById('authTitle').textContent === '登录' ? 'login' : 'register');
    });
    document.getElementById('authPassword').addEventListener('keydown', function (e: KeyboardEvent) { if (e.key === 'Enter') document.getElementById('authSubmitBtn').click(); });
  }
  G.showAuthModal = showAuthModal;
  G.hideAuthModal = hideAuthModal;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init2); else init2();
})();
export {};
