// @ts-nocheck
// FanJi Community Feed — 社区动态 Tab
(function init() {
  const G = window.fanji;
  if (!G) { setTimeout(init, 50); return; }

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  let feedPage = 1;
  let feedFollowing = false;

  async function loadFeed(container) {
    container.innerHTML = '<div class="feed-loading">加载中...</div>';
    try {
      const r = await G.comm.feed(feedPage, feedFollowing);
      if (!r.ok) { container.innerHTML = '<div class="feed-error">加载失败</div>'; return; }

      if (!r.data || !r.data.length) {
        container.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">🌊</div><div class="feed-empty-text">社区还没什么动静<br>去给喜欢的番写个评价吧！</div></div>';
        return;
      }

      let html = '';
      r.data.forEach(function (item) {
        html += '<div class="feed-item" data-aid="' + item.anime.id + '">';
        html += '<div class="feed-item-header"><span class="feed-user" data-uid="' + item.user.id + '">' + esc(item.user.nickname) + '</span><span class="feed-action">评价了</span><span class="feed-anime">' + esc(item.anime.title) + '</span></div>';
        html += '<div class="feed-item-body"><span class="feed-stars">' + '★'.repeat(item.rating) + '☆'.repeat(10 - item.rating) + ' ' + item.rating + '</span>';
        if (item.content) html += '<span class="feed-content">' + esc(item.content) + '</span>';
        html += '</div><div class="feed-item-time">' + (item.created_at || '').slice(0, 10) + '</div></div>';
      });

      feedPage++;
      container.innerHTML = html;
      if (r.data.length >= 10) {
        container.innerHTML += '<button class="feed-more-btn" id="feedMoreBtn">加载更多</button>';
      }

      bindFeedEvents(container);
    } catch (e) {
      container.innerHTML = '<div class="feed-error">加载失败</div>';
    }
  }

  function bindFeedEvents(container) {
    container.querySelectorAll('.feed-user').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        const uid = parseInt(this.dataset.uid);
        if (uid && G.showUserProfile) G.showUserProfile(uid);
      });
    });
    container.querySelectorAll('.feed-item').forEach(function (el) {
      el.addEventListener('click', function () {
        const aid = parseInt(this.dataset.aid);
        if (aid && typeof (window as any).apiFetch === 'function' && typeof (window as any).openDrawer === 'function') {
          (window as any).apiFetch('/api/anime/' + aid).then(function (d) {
            if (d && d.ok && d.data) (window as any).openDrawer(d.data, null);
          }).catch(function () {});
        }
      });
    });
    const moreBtn = document.getElementById('feedMoreBtn');
    if (moreBtn) moreBtn.addEventListener('click', function () {
      this.remove();
      loadMoreFeed(container);
    });
  }

  async function loadMoreFeed(container) {
    try {
      const r = await G.comm.feed(feedPage, feedFollowing);
      if (r.ok && r.data && r.data.length) {
        let html = '';
        r.data.forEach(function (item) {
          html += '<div class="feed-item" data-aid="' + item.anime.id + '">';
          html += '<div class="feed-item-header"><span class="feed-user" data-uid="' + item.user.id + '">' + esc(item.user.nickname) + '</span><span class="feed-action">评价了</span><span class="feed-anime">' + esc(item.anime.title) + '</span></div>';
          html += '<div class="feed-item-body"><span class="feed-stars">' + '★'.repeat(item.rating) + '☆'.repeat(10 - item.rating) + ' ' + item.rating + '</span>';
          if (item.content) html += '<span class="feed-content">' + esc(item.content) + '</span>';
          html += '</div><div class="feed-item-time">' + (item.created_at || '').slice(0, 10) + '</div></div>';
        });
        const moreBtn = document.getElementById('feedMoreBtn');
        if (moreBtn) {
          const temp = document.createElement('div');
          temp.innerHTML = html;
          while (temp.firstChild) {
            container.insertBefore(temp.firstChild, moreBtn);
          }
          bindFeedEvents(container);
        } else {
          container.innerHTML += html;
          bindFeedEvents(container);
        }
        feedPage++;
        if (r.data.length < 10) {
          const btn = document.getElementById('feedMoreBtn');
          if (btn) btn.remove();
        } else {
          if (!document.getElementById('feedMoreBtn')) {
            container.innerHTML += '<button class="feed-more-btn" id="feedMoreBtn">加载更多</button>';
            document.getElementById('feedMoreBtn').addEventListener('click', function () {
              this.remove();
              loadMoreFeed(container);
            });
          }
        }
      }
    } catch (e) {}
  }

  function initCommunityTab() {
    const view = document.getElementById('view-community');
    if (!view) return;
    if (view.classList.contains('active')) {
      const container = view.querySelector('.feed-container');
      if (container) loadFeed(container);
    }
  }

  G.refreshFeed = function () {
    const view = document.getElementById('view-community');
    if (view) {
      feedPage = 1;
      const container = view.querySelector('.feed-container');
      if (container) loadFeed(container);
    }
  };

  G.onAuthChange = function (user) {
    const authBtns = document.querySelectorAll('.auth-btn-area');
    authBtns.forEach(function (el: any) {
      if (user) {
        el.innerHTML = '<span class="auth-user-badge" data-uid="' + user.id + '">' + esc(user.nickname) + '</span><button class="auth-logout-btn">退出</button>';
        el.querySelector('.auth-user-badge').addEventListener('click', function () { G.showUserProfile(user.id); });
        el.querySelector('.auth-logout-btn').addEventListener('click', function () { G.logout(); });
      } else {
        el.innerHTML = '<button class="auth-login-btn">登录</button><button class="auth-register-btn">注册</button>';
        el.querySelector('.auth-login-btn').addEventListener('click', function () { G.showAuthModal('login'); });
        el.querySelector('.auth-register-btn').addEventListener('click', function () { G.showAuthModal('register'); });
      }
    });
    G.refreshFeed();
  };

  // 硬兜底：保证调 onAuthChange 时 currentUser 真的就位（不依赖 inline preheat 的浏览器时序）
  function ensureUser() {
    if (G.currentUser) return G.currentUser;
    try {
      const raw = localStorage.getItem('fanji_session');
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.token && s.user) { G.token = s.token; G.currentUser = s.user; return s.user; }
      }
    } catch (e) {}
    return null;
  }

  function bootAuth() {
    initCommunityTab();
    if (G.onAuthChange) G.onAuthChange(ensureUser());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAuth);
  } else {
    bootAuth();
  }
})();
export {};
