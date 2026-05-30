// FanJi Community Auth — 登录/注册 UI + 令牌管理
// Capacitor 标准 API：window.Capacitor.Plugins.Preferences（由 @capacitor/preferences 注册）
// localStorage 兜底：浏览器环境 / Capacitor 桥未就绪 / 插件未注入
(function() {
  var G = window.fanji;
  if (!G) return setTimeout(function(){ /* fanji 未就绪 */ }, 50);

  var SK = 'fanji_session';

  function prefs() {
    var C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.Preferences) || null;
  }

  function prefSet(key, value) {
    var P = prefs();
    if (!P) return Promise.resolve(false);
    return P.set({ key: key, value: value }).then(function(){ return true; }).catch(function(){ return false; });
  }
  function prefGet(key) {
    var P = prefs();
    if (!P) return Promise.resolve(null);
    return P.get({ key: key }).then(function(r){ return r && r.value != null ? r.value : null; }).catch(function(){ return null; });
  }
  function prefRemove(key) {
    var P = prefs();
    if (!P) return Promise.resolve(false);
    return P.remove({ key: key }).then(function(){ return true; }).catch(function(){ return false; });
  }

  function save(token, user) {
    G.token = token;
    G.currentUser = user;
    var raw = JSON.stringify({ token: token, user: user });
    prefSet(SK, raw);
    try { localStorage.setItem(SK, raw); } catch(e) {}
  }

  function restore(done) {
    prefGet(SK).then(function(raw) {
      if (!raw) {
        try { raw = localStorage.getItem(SK); } catch(e) {}
      }
      if (raw) {
        try {
          var s = JSON.parse(raw);
          if (s && s.token) { G.token = s.token; G.currentUser = s.user; return done(true); }
        } catch(e) {}
      }
      done(false);
    });
  }

  function clear() {
    G.token = null;
    G.currentUser = null;
    prefRemove(SK);
    try { localStorage.removeItem(SK); } catch(e) {}
  }

  // 轮询恢复（Capacitor 桥可能还没就绪：插件注入有几十~几百毫秒延迟）
  function tryRestore(n) {
    restore(function(ok) {
      if (ok) {
        if (G.currentUser && typeof G.onAuthChange === 'function')
          setTimeout(function() { G.onAuthChange(G.currentUser); }, 50);
        return;
      }
      if (n < 30) setTimeout(function() { tryRestore(n + 1); }, 200);
    });
  }
  tryRestore(0);

  // ---- UI ----
  function showAuthModal(mode) {
    var m = document.getElementById('authModal');
    if (!m) return;
    m.classList.remove('hidden');
    m.querySelector('.auth-panel').className = 'auth-panel ' + (mode === 'login' ? 'mode-login' : 'mode-register');
    document.getElementById('authError').textContent = '';
    document.getElementById('authUsername').value = '';
    document.getElementById('authPassword').value = '';
    document.getElementById('authNickname').value = '';
    document.getElementById('authTitle').textContent = mode === 'login' ? '登录' : '注册';
    document.getElementById('authSubmitBtn').textContent = mode === 'login' ? '登录' : '注册';
    document.getElementById('authSwitchBtn').textContent = mode === 'login' ? '没有账号？去注册' : '已有账号？去登录';
    document.getElementById('authSwitchBtn').dataset.mode = mode === 'login' ? 'register' : 'login';
    document.getElementById('authNickRow').style.display = mode === 'register' ? '' : 'none';
  }
  function hideAuthModal() { var m = document.getElementById('authModal'); if (m) m.classList.add('hidden'); }

  G.requireAuth = function() { if (G.currentUser) return true; showAuthModal('login'); return false; };
  G.logout = async function() {
    try { await G.comm.logout(); } catch(e) {}
    clear();
    if (typeof G.onAuthChange === 'function') G.onAuthChange(null);
    if (typeof showToast === 'function') showToast('已退出登录');
  };

  async function handleAuthSubmit(mode) {
    var errEl = document.getElementById('authError');
    var un = document.getElementById('authUsername').value.trim();
    var pw = document.getElementById('authPassword').value;
    if (!un || !pw) { errEl.textContent = '请填写用户名和密码'; return; }
    if (un.length < 3) { errEl.textContent = '用户名至少 3 个字符'; return; }
    if (pw.length < 6) { errEl.textContent = '密码至少 6 个字符'; return; }
    var body = { username: un, password: pw, turnstile: '' };
    if (mode === 'register') body.nickname = document.getElementById('authNickname').value.trim() || un;
    try {
      var fn = mode === 'login' ? G.comm.login : G.comm.register;
      var r = await fn(body);
      if (r.ok) {
        save(r.token, r.user); hideAuthModal();
        if (typeof showToast === 'function') showToast(mode === 'login' ? '欢迎回来，' + r.user.nickname : '注册成功！');
        if (typeof G.onAuthChange === 'function') G.onAuthChange(r.user);
      } else { errEl.textContent = r.error || '操作失败，请重试'; }
    } catch(e) { errEl.textContent = '网络错误，请稍后重试'; }
  }

  function init() {
    var m = document.getElementById('authModal'); if (!m) return;
    m.addEventListener('click', function(e) { if (e.target === m) hideAuthModal(); });
    document.getElementById('authSwitchBtn').addEventListener('click', function() { showAuthModal(this.dataset.mode); });
    document.getElementById('authSubmitBtn').addEventListener('click', function() {
      handleAuthSubmit(document.getElementById('authTitle').textContent === '登录' ? 'login' : 'register');
    });
    document.getElementById('authPassword').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('authSubmitBtn').click(); });
  }
  G.showAuthModal = showAuthModal;
  G.hideAuthModal = hideAuthModal;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
