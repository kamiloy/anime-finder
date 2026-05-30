// FanJi Community API wrapper — 依赖 window.fanji
(function() {
  const G = window.fanji;
  if (!G) return setTimeout(arguments.callee, 50);

  const BASE = G.apiBase || 'https://fanji-api.pages.dev';

  async function authFetch(path, opts = {}) {
    const headers = opts.headers || {};
    if (G.token) headers['Authorization'] = 'Bearer ' + G.token;
    if (opts.body) headers['Content-Type'] = 'application/json';
    const r = await fetch(BASE + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    return r.json();
  }

  G.comm = {
    // Auth
    register(body) { return authFetch('/api/auth/register', { method: 'POST', body }); },
    login(body) { return authFetch('/api/auth/login', { method: 'POST', body }); },
    logout() { return authFetch('/api/auth/logout', { method: 'POST' }); },
    me() { return authFetch('/api/auth/me'); },

    // Reviews
    reviewList(animeId, page) { return authFetch('/api/review/' + animeId + '?page=' + (page || 1)); },
    reviewMine(animeId) { return authFetch('/api/review/' + animeId + '/mine'); },
    reviewPost(animeId, body) { return authFetch('/api/review/' + animeId, { method: 'POST', body }); },
    reviewDelete(animeId) { return authFetch('/api/review/' + animeId, { method: 'DELETE' }); },

    // User
    userProfile(id) { return authFetch('/api/user/' + id + '/profile'); },
    userReviews(id, page) { return authFetch('/api/user/' + id + '/reviews?page=' + (page || 1)); },
    userSearch(q) { return authFetch('/api/user/search?q=' + encodeURIComponent(q)); },
    profileUpdate(body) { return authFetch('/api/user/me/profile', { method: 'PUT', body }); },

    // Follow
    follow(id) { return authFetch('/api/follow/' + id, { method: 'POST' }); },
    unfollow(id) { return authFetch('/api/follow/' + id, { method: 'DELETE' }); },
    followers(id) { return authFetch('/api/user/' + id + '/followers'); },
    following(id) { return authFetch('/api/user/' + id + '/following'); },

    // Feed
    feed(page, following) { return authFetch('/api/community/feed?page=' + (page || 1) + (following ? '&following=1' : '')); },
    stats() { return authFetch('/api/community/stats'); },

    // Threads
    threadList(animeId, page) { return authFetch('/api/thread/' + animeId + '?page=' + (page || 1)); },
    threadCreate(animeId, body) { return authFetch('/api/thread/' + animeId, { method: 'POST', body }); },
    threadDetail(threadId) { return authFetch('/api/thread/detail/' + threadId); },
    postCreate(threadId, body) { return authFetch('/api/thread/detail/' + threadId, { method: 'POST', body }); }
  };
})();
