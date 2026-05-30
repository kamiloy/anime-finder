// @ts-nocheck
// FanJi Community Reviews — 番剧评价区块（详情抽屉内嵌）
(function init() {
  const G = window.fanji;
  if (!G) { setTimeout(init, 50); return; }

  let _curAnimeId = null;

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function starPicker(label, value, onChange) {
    const stars = [];
    for (let i = 1; i <= 10; i++) {
      stars.push('<span class="cs' + (i <= value ? ' active' : '') + '" data-v="' + i + '">' + (i <= value ? '★' : '☆') + '</span>');
    }
    return '<div class="star-picker"><div class="star-picker-label">' + esc(label) + '</div><div class="star-picker-row">' + stars.join('') + '</div></div>';
  }

  function reviewHTML(r, showAnime?) {
    const stars = '★'.repeat(r.rating) + '☆'.repeat(10 - r.rating);
    const userLink = '<span class="rv-user" data-uid="' + r.user.id + '">' + esc(r.user.nickname) + '</span>';
    const spoilerTag = r.spoiler ? '<span class="rv-spoiler">含剧透</span>' : '';
    const content = r.content ? '<div class="rv-content' + (r.spoiler ? ' spoiler-blur' : '') + '">' + esc(r.content) + '</div>' : '';
    const animePart = showAnime && r.anime ? '<div class="rv-anime">📺 ' + esc(r.anime.title) + '</div>' : '';
    const mineTag = G.currentUser && r.user.id === G.currentUser.id ? '<span class="rv-mine">我的</span>' : '';
    return '<div class="review-item">' +
      '<div class="rv-header">' + userLink + mineTag + spoilerTag + '<span class="rv-date">' + (r.created_at || '').slice(0, 10) + '</span></div>' +
      '<div class="rv-stars">' + stars + ' <span class="rv-score">' + r.rating + '</span></div>' +
      animePart + content + '</div>';
  }

  async function loadReviewSection(animeId, container) {
    _curAnimeId = animeId;
    container.innerHTML = '<div class="review-section-loading">加载评价中...</div>';

    try {
      const [listR, mineR] = await Promise.all([
        G.comm.reviewList(animeId),
        G.currentUser ? G.comm.reviewMine(animeId).catch(() => ({ ok: false })) : Promise.resolve({ ok: false })
      ]);

      let html = '<div class="review-section">';

      if (listR.ok && listR.stats && listR.stats.count > 0) {
        html += '<div class="review-stats"><span class="review-stats-avg">社区均分 ' + listR.stats.avg.toFixed(1) + '</span><span class="review-stats-count">' + listR.stats.count + ' 人评价</span></div>';
      }

      const myReview = mineR.ok && mineR.review ? mineR.review : null;
      html += '<div class="review-mine" id="reviewMine">';
      if (myReview) {
        html += '<div class="review-mine-info"><span>你的评价：</span><span class="rv-stars-sm">' + '★'.repeat(myReview.rating) + '☆'.repeat(10 - myReview.rating) + ' ' + myReview.rating + '</span>';
        if (myReview.content) html += '<span class="rv-mine-content">' + esc(myReview.content) + '</span>';
        html += '<div class="review-mine-actions"><button class="rv-btn edit" id="rvEditBtn">修改</button><button class="rv-btn delete" id="rvDelBtn">删除</button></div></div>';
      } else {
        html += '<button class="rv-btn write" id="rvWriteBtn">✏️ 写评价</button>';
      }
      html += '</div>';

      html += '<div class="review-form" id="reviewForm" style="display:none">';
      html += starPicker('评分', myReview ? myReview.rating : 8, null);
      html += '<textarea class="review-textarea" id="reviewTextarea" placeholder="写点什么吧...（最多 200 字）" maxlength="200">' + (myReview ? esc(myReview.content) : '') + '</textarea>';
      html += '<div class="review-form-row"><label class="review-spoiler-lbl"><input type="checkbox" id="reviewSpoiler"' + (myReview && myReview.spoiler ? ' checked' : '') + '> 包含剧透</label>';
      html += '<button class="rv-btn submit" id="rvSubmitBtn">发表</button></div></div>';

      html += '<div class="review-list" id="reviewList">';
      if (listR.ok && listR.data && listR.data.length) {
        listR.data.forEach(function (r) { html += reviewHTML(r); });
        if (listR.total > listR.data.length) {
          html += '<button class="rv-btn more" id="rvMoreBtn" data-page="1">查看更多评价 (' + (listR.total - listR.data.length) + ')</button>';
        }
      } else {
        html += '<div class="review-empty">还没有人评价，来写第一条吧 💬</div>';
      }
      html += '</div></div>';

      container.innerHTML = html;

      bindReviewEvents(animeId, myReview);
    } catch (e) {
      container.innerHTML = '<div class="review-section-loading">加载失败，请重试</div>';
    }
  }

  function bindReviewEvents(animeId, myReview) {
    const writeBtn = document.getElementById('rvWriteBtn');
    if (writeBtn) writeBtn.addEventListener('click', function () {
      if (!G.requireAuth()) return;
      document.getElementById('reviewForm').style.display = '';
      this.style.display = 'none';
    });

    const editBtn = document.getElementById('rvEditBtn');
    if (editBtn) editBtn.addEventListener('click', function () {
      document.getElementById('reviewForm').style.display = '';
    });

    const delBtn = document.getElementById('rvDelBtn');
    if (delBtn) delBtn.addEventListener('click', async function () {
      if (!confirm('确定删除你的评价吗？')) return;
      try {
        const r = await G.comm.reviewDelete(animeId);
        if (r.ok) {
          if (typeof (window as any).showToast === 'function') (window as any).showToast('评价已删除');
          refreshReviewSection();
        }
      } catch (e) {}
    });

    const picker = document.querySelector('.star-picker-row');
    if (picker) {
      picker.addEventListener('click', function (e: any) {
        const span = e.target.closest('span[data-v]');
        if (!span) return;
        const v = parseInt(span.dataset.v);
        const stars = picker.querySelectorAll('span[data-v]');
        stars.forEach(function (s: any) {
          const iv = parseInt(s.dataset.v);
          s.classList.toggle('active', iv <= v);
          s.textContent = iv <= v ? '★' : '☆';
        });
      });
    }

    const submitBtn = document.getElementById('rvSubmitBtn');
    if (submitBtn) submitBtn.addEventListener('click', async function () {
      const rating = document.querySelectorAll('.star-picker-row .active').length || 8;
      const content = (document.getElementById('reviewTextarea') as HTMLTextAreaElement).value.trim();
      const spoiler = (document.getElementById('reviewSpoiler') as HTMLInputElement).checked;

      try {
        const r = await G.comm.reviewPost(animeId, { rating, content, spoiler });
        if (r.ok) {
          if (typeof (window as any).showToast === 'function') (window as any).showToast(content ? '评价已发表！' : '评分已记录');
          if (typeof (window as any).shionReact === 'function') {
            (window as any).shionReact(rating >= 9 ? 'rate_god' : rating >= 7 ? 'rate_good' : rating >= 5 ? 'rate_mid' : 'rate_bad');
          }
          const mineEl = document.getElementById('reviewMine');
          if (mineEl && r.review) {
            const rv = r.review;
            let stars = '';
            for (let si = 1; si <= 10; si++) stars += si <= rv.rating ? '★' : '☆';
            mineEl.innerHTML = '<div class="review-mine-info"><span>你的评价：</span><span class="rv-stars-sm">' + stars + ' ' + rv.rating + '</span>' +
              (rv.content ? '<span class="rv-mine-content">' + esc(rv.content) + '</span>' : '') +
              '<div class="review-mine-actions"><button class="rv-btn edit" id="rvEditBtn">修改</button><button class="rv-btn delete" id="rvDelBtn">删除</button></div></div>';
            document.getElementById('reviewForm').style.display = 'none';
            bindReviewEvents(animeId, rv);
          }
          let retries = 0;
          function retryRefresh() {
            refreshReviewSection().then(function () {
              setTimeout(function () {
                if (!document.querySelector('.rv-mine-content') && retries < 4) {
                  retries++;
                  retryRefresh();
                }
              }, 2000);
            });
          }
          setTimeout(retryRefresh, 2000);
        }
      } catch (e) { if (typeof (window as any).showToast === 'function') (window as any).showToast('发表失败，请重试'); }
    });

    const moreBtn = document.getElementById('rvMoreBtn');
    if (moreBtn) moreBtn.addEventListener('click', async function () {
      const page = parseInt(this.dataset.page) + 1;
      try {
        const r = await G.comm.reviewList(animeId, page);
        if (r.ok && r.data && r.data.length) {
          const list = document.getElementById('reviewList');
          const btn = document.getElementById('rvMoreBtn');
          r.data.forEach(function (rv) { list.insertBefore(createReviewEl(rv), btn); });
          const remaining = r.total - (page * 10);
          if (remaining > 0) {
            this.dataset.page = page;
            this.textContent = '查看更多评价 (' + remaining + ')';
          } else {
            this.remove();
          }
        }
      } catch (e) {}
    });

    document.querySelectorAll('.rv-user').forEach(function (el: any) {
      el.addEventListener('click', function () {
        const uid = parseInt(this.dataset.uid);
        if (uid) G.showUserProfile(uid);
      });
    });
  }

  function createReviewEl(r) {
    const div = document.createElement('div');
    div.innerHTML = reviewHTML(r);
    return div.firstElementChild;
  }

  async function refreshReviewSection() {
    const container = document.getElementById('reviewSection');
    if (container && _curAnimeId) await loadReviewSection(_curAnimeId, container);
  }

  G.loadReviewSection = loadReviewSection;
  G.refreshReviewSection = refreshReviewSection;
})();
export {};
