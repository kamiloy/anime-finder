// FanJi Community Profile — 用户主页抽屉
(function() {
  const G = window.fanji;
  if (!G) return setTimeout(arguments.callee, 50);

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  async function showUserProfile(userId) {
    const panel = document.getElementById('profilePanel');
    if (!panel) return;
    panel.innerHTML = '<div class="profile-loading">加载中...</div>';
    panel.classList.remove('hidden');

    try {
      const r = await G.comm.userProfile(userId);
      if (!r.ok) { panel.innerHTML = '<div class="profile-error">' + esc(r.error || '加载失败') + '</div>'; return; }

      const u = r.user;
      const s = r.stats;
      const isMe = G.currentUser && G.currentUser.id === u.id;
      const isFollowing = false; // 后续可从 API 获取

      let html = '<div class="profile-header">';
      html += '<div class="profile-avatar">' + (u.nickname || u.username)[0].toUpperCase() + '</div>';
      html += '<div class="profile-info"><div class="profile-name">' + esc(u.nickname) + '</div>';
      html += '<div class="profile-username">@' + esc(u.username) + '</div>';
      if (u.bio) html += '<div class="profile-bio">' + esc(u.bio) + '</div>';
      html += '<div class="profile-joined">' + (u.created_at || '').slice(0, 10) + ' 加入</div></div>';

      if (!isMe) {
        html += '<button class="profile-follow-btn" id="profileFollowBtn" data-uid="' + u.id + '">' + (isFollowing ? '已关注' : '+ 关注') + '</button>';
      } else {
        html += '<button class="profile-edit-btn" id="profileEditBtn">编辑资料</button>';
      }
      html += '</div>';

      // 统计
      html += '<div class="profile-stats"><div class="profile-stat"><span class="profile-stat-num">' + (s.reviews || 0) + '</span><span class="profile-stat-label">评价</span></div><div class="profile-stat"><span class="profile-stat-num">' + (s.followers || 0) + '</span><span class="profile-stat-label">粉丝</span></div><div class="profile-stat"><span class="profile-stat-num">' + (s.following || 0) + '</span><span class="profile-stat-label">关注</span></div></div>';

      // 最近评价
      if (r.recent && r.recent.length) {
        html += '<div class="profile-section-title">最近评价</div><div class="profile-reviews">';
        r.recent.forEach(function(rv) {
          html += '<div class="profile-review-item" data-aid="' + rv.anime_id + '"><div class="pri-cover"><img src="' + imgSrc(rv.anime.cover_url) + '" alt="" loading="lazy" onload="imgLoaded(this)"/></div><div class="pri-info"><div class="pri-title">' + esc(rv.anime.title) + '</div><div class="pri-stars">' + '★'.repeat(rv.rating) + '☆'.repeat(10 - rv.rating) + ' ' + rv.rating + '</div>' + (rv.content ? '<div class="pri-content">' + esc(rv.content) + '</div>' : '') + '</div></div>';
        });
        html += '</div>';
      }

      // 操作按钮
      html += '<div class="profile-actions">';
      html += '<button class="profile-action-btn" id="profileReviewsBtn">全部评价</button>';
      html += '<button class="profile-action-btn" id="profileFollowersBtn">粉丝列表</button>';
      html += '<button class="profile-action-btn" id="profileFollowingBtn">关注列表</button>';
      html += '</div>';

      html += '<button class="profile-close" id="profileCloseBtn">关闭</button>';
      panel.innerHTML = html;

      // 绑定事件
      document.getElementById('profileCloseBtn').addEventListener('click', function() { panel.classList.add('hidden'); });
      panel.addEventListener('click', function(e) { if (e.target === panel) panel.classList.add('hidden'); });

      const followBtn = document.getElementById('profileFollowBtn');
      if (followBtn) {
        followBtn.addEventListener('click', async function() {
          if (!G.requireAuth()) return;
          const following = this.textContent.includes('已关注');
          try {
            const r = following ? await G.comm.unfollow(u.id) : await G.comm.follow(u.id);
            if (r.ok) this.textContent = r.following ? '已关注' : '+ 关注';
          } catch (e) {}
        });
      }

      const editBtn = document.getElementById('profileEditBtn');
      if (editBtn) {
        editBtn.addEventListener('click', function() { showProfileEditor(u); });
      }

      // 最近评价点击跳转
      panel.querySelectorAll('.profile-review-item').forEach(function(el) {
        el.addEventListener('click', function() {
          const aid = parseInt(this.dataset.aid);
          if (aid && typeof openDrawer === 'function') {
            panel.classList.add('hidden');
            // 获取 anime 基础数据打开抽屉
            G.comm.reviewList(aid).then(function() {
              // 直接通过 apiFetch 获取番剧详情打开
              if (typeof apiFetch === 'function') {
                apiFetch('/api/anime/' + aid).then(function(d) {
                  if (d && d.ok && d.data && typeof openDrawer === 'function') openDrawer(d.data, null);
                }).catch(function() {});
              }
            }).catch(function() {});
          }
        });
      });

      // 操作按钮
      document.getElementById('profileReviewsBtn').addEventListener('click', function() { showUserReviewsPanel(u.id, u.nickname); });
      document.getElementById('profileFollowersBtn').addEventListener('click', function() { showFollowListPanel(u.id, 'followers'); });
      document.getElementById('profileFollowingBtn').addEventListener('click', function() { showFollowListPanel(u.id, 'following'); });

    } catch (e) {
      panel.innerHTML = '<div class="profile-error">加载失败</div>';
    }
  }

  function showProfileEditor(u) {
    const nickname = prompt('昵称', u.nickname);
    if (nickname === null) return;
    const bio = prompt('简介（最多 140 字）', u.bio || '');
    if (bio === null) return;
    G.comm.profileUpdate({ nickname, bio }).then(function(r) {
      if (r.ok) {
        G.currentUser.nickname = r.user.nickname;
        G.currentUser.bio = r.user.bio;
        if (typeof showToast === 'function') showToast('资料已更新');
        showUserProfile(u.id);
      }
    }).catch(function() {});
  }

  async function showUserReviewsPanel(userId, name) {
    const panel = document.getElementById('profilePanel');
    panel.innerHTML = '<div class="profile-loading">加载中...</div>';
    try {
      const r = await G.comm.userReviews(userId, 1);
      if (!r.ok) { panel.innerHTML = '<div class="profile-error">加载失败</div>'; return; }
      let html = '<div class="profile-header"><h3>' + esc(name) + ' 的全部评价</h3></div>';
      html += '<div class="profile-reviews">';
      if (r.data && r.data.length) {
        r.data.forEach(function(rv) {
          html += '<div class="profile-review-item" data-aid="' + rv.anime.id + '"><div class="pri-cover"><img src="' + imgSrc(rv.anime.cover_url) + '" alt="" loading="lazy" onload="imgLoaded(this)"/></div><div class="pri-info"><div class="pri-title">' + esc(rv.anime.title) + '</div><div class="pri-stars">' + '★'.repeat(rv.rating) + '☆'.repeat(10 - rv.rating) + ' ' + rv.rating + '</div>' + (rv.content ? '<div class="pri-content">' + esc(rv.content) + '</div>' : '') + '</div></div>';
        });
      } else {
        html += '<div class="profile-empty">暂无评价</div>';
      }
      html += '</div><button class="profile-close" id="profileCloseBtn">关闭</button>';
      panel.innerHTML = html;
      document.getElementById('profileCloseBtn').addEventListener('click', function() { panel.classList.add('hidden'); });
      panel.addEventListener('click', function(e) { if (e.target === panel) panel.classList.add('hidden'); });
    } catch (e) {}
  }

  async function showFollowListPanel(userId, type) {
    const panel = document.getElementById('profilePanel');
    panel.innerHTML = '<div class="profile-loading">加载中...</div>';
    try {
      const fn = type === 'followers' ? G.comm.followers : G.comm.following;
      const r = await fn(userId);
      if (!r.ok) { panel.innerHTML = '<div class="profile-error">加载失败</div>'; return; }
      let html = '<div class="profile-header"><h3>' + (type === 'followers' ? '粉丝' : '关注') + '</h3></div><div class="follow-list">';
      if (r.data && r.data.length) {
        r.data.forEach(function(u) {
          html += '<div class="follow-item" data-uid="' + u.id + '"><span class="follow-avatar">' + (u.nickname || u.username)[0].toUpperCase() + '</span><span class="follow-name">' + esc(u.nickname) + '</span><span class="follow-username">@' + esc(u.username) + '</span></div>';
        });
      } else {
        html += '<div class="profile-empty">暂无</div>';
      }
      html += '</div><button class="profile-close" id="profileCloseBtn">关闭</button>';
      panel.innerHTML = html;
      document.getElementById('profileCloseBtn').addEventListener('click', function() { panel.classList.add('hidden'); });
      panel.addEventListener('click', function(e) { if (e.target === panel) panel.classList.add('hidden'); });
      panel.querySelectorAll('.follow-item').forEach(function(el) {
        el.addEventListener('click', function() { showUserProfile(parseInt(this.dataset.uid)); });
      });
    } catch (e) {}
  }

  G.showUserProfile = showUserProfile;
})();
