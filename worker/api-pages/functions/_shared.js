// Shared handlers & utilities for FanJi API Pages Functions

function corsRes() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function jsonRes(data, status = 200, sMaxAge = 120) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=60, s-maxage=${sMaxAge}`
    }
  });
}

const BGM_API = 'https://api.bgm.tv';
const BGM_UA = 'fanji-anime-finder/1.0 (https://github.com/kamiloy/anime-finder)';
const DAY = 86400;

async function bgmFetch(path) {
  const r = await fetch(BGM_API + path, {
    headers: { 'User-Agent': BGM_UA, 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error('bgm ' + r.status);
  return r.json();
}

function pickImg(images) {
  if (!images) return '';
  return (images.medium || images.large || images.grid || images.small || '').replace(/^http:/, 'https:');
}

// 图片代理：CF 边缘代取 Bangumi 图片 CDN（lain.bgm.tv 在国内被阻断，但 CF 边缘能连、pages.dev 国内能通）
export async function handleImageProxy(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') return corsRes();
  const reqUrl = new URL(request.url);
  const u = reqUrl.searchParams.get('u');
  if (!u) return new Response('missing u', { status: 400 });
  let target;
  try { target = new URL(u); } catch { return new Response('bad url', { status: 400 }); }
  // SSRF 防护：仅放行 Bangumi 图片 CDN，杜绝开放代理
  if (target.hostname !== 'lain.bgm.tv') return new Response('forbidden host', { status: 403 });
  target.protocol = 'https:';
  const targetStr = target.toString();

  const cache = caches.default;
  const cacheKey = new Request(targetStr, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstream;
  try {
    upstream = await fetch(targetStr, {
      headers: { 'User-Agent': BGM_UA, 'Referer': 'https://bgm.tv/' },
      cf: { cacheTtl: DAY, cacheEverything: true }
    });
  } catch (e) {
    return new Response('upstream fetch failed', { status: 502 });
  }
  if (!upstream.ok) return new Response('upstream ' + upstream.status, { status: 502 });

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=604800, s-maxage=2592000');
  headers.set('Access-Control-Allow-Origin', '*');
  const resp = new Response(upstream.body, { status: 200, headers });
  context.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

const CHAR_TTL = 30 * DAY * 1000;
const PERSON_TTL = 7 * DAY * 1000;

// D1 响应缓存：命中且未过期则跳过 Bangumi 回源。任何异常都静默忽略，不影响主流程
async function cacheGet(env, key, ttlMs) {
  try {
    const row = await env.DB.prepare('SELECT payload, updated_at FROM api_cache WHERE cache_key = ?').bind(key).first();
    if (row && (Date.now() - row.updated_at) < ttlMs) return JSON.parse(row.payload);
  } catch (e) {}
  return null;
}
async function cacheSet(env, key, data) {
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO api_cache (cache_key, payload, updated_at) VALUES (?, ?, ?)')
      .bind(key, JSON.stringify(data), Date.now()).run();
  } catch (e) {}
}

export async function handleAnimeList(request, env) {
  const params = new URL(request.url).searchParams;
  if (request.method === 'OPTIONS') return corsRes();

  const sort = params.get('sort') || 'heat';
  const tag = params.get('tag') || '';
  const year = params.get('year') || '';
  const airing = params.get('airing') || '';
  const page = Math.max(1, parseInt(params.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.get('limit')) || 20));
  const offset = (page - 1) * limit;
  const excludeIds = params.get('exclude_ids') || '';

  let where = [];
  let joins = [];
  let bindings = [];

  if (tag) {
    joins.push('JOIN anime_tags at2 ON a.id = at2.anime_id');
    joins.push('JOIN tags t ON at2.tag_id = t.id');
    where.push('(t.name = ? OR t.name_cn = ?)');
    bindings.push(tag, tag);
  }
  if (year) {
    where.push('a.air_date LIKE ?');
    bindings.push(year + '%');
  }
  if (airing === '1') {
    where.push('a.is_airing = 1');
  }
  if (excludeIds) {
    const ids = excludeIds.split(',').map(Number).filter(Boolean);
    if (ids.length) {
      where.push(`a.id NOT IN (${ids.map(() => '?').join(',')})`);
      bindings.push(...ids);
    }
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const orderBy = sort === 'rank' ? 'a.score DESC, a.rank ASC' : 'a.rank ASC, a.score DESC';

  const countSQL = `SELECT COUNT(*) as total FROM anime a ${joins.join(' ')} ${whereClause}`;
  const countResult = await env.DB.prepare(countSQL).bind(...bindings).first();
  const total = countResult ? countResult.total : 0;

  const sql = `SELECT DISTINCT a.* FROM anime a ${joins.join(' ')} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);
  const { results } = await env.DB.prepare(sql).bind(...bindings).all();

  const ids = results.map(r => r.id);
  let tagMap = {};
  if (ids.length) {
    const { results: tagResults } = await env.DB.prepare(
      `SELECT at2.anime_id, t.name, t.name_cn, t.count FROM anime_tags at2 JOIN tags t ON at2.tag_id = t.id WHERE at2.anime_id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    for (const tr of tagResults || []) {
      if (!tagMap[tr.anime_id]) tagMap[tr.anime_id] = [];
      tagMap[tr.anime_id].push({ name: tr.name, name_cn: tr.name_cn, count: tr.count });
    }
  }

  const data = results.map(r => ({ ...formatAnime(r), tags: tagMap[r.id] || [] }));
  return jsonRes({ ok: true, data, total, page, limit });
}

export async function handleAnimeSearch(request, env) {
  const params = new URL(request.url).searchParams;
  if (request.method === 'OPTIONS') return corsRes();

  const q = params.get('q') || '';
  const page = Math.max(1, parseInt(params.get('page')) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(params.get('limit')) || 20));
  const offset = (page - 1) * limit;

  if (!q.trim()) {
    return jsonRes({ ok: true, data: [], total: 0, page, limit });
  }

  const searchTerm = `%${q.trim()}%`;
  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) as total FROM anime WHERE title LIKE ? OR title_cn LIKE ? OR title_jp LIKE ?'
  ).bind(searchTerm, searchTerm, searchTerm).first();
  const total = countResult ? countResult.total : 0;

  const { results } = await env.DB.prepare(
    'SELECT * FROM anime WHERE title LIKE ? OR title_cn LIKE ? OR title_jp LIKE ? ORDER BY score DESC LIMIT ? OFFSET ?'
  ).bind(searchTerm, searchTerm, searchTerm, limit, offset).all();

  const data = results.map(formatAnime);
  return jsonRes({ ok: true, data, total, page, limit });
}

export async function handleAnimeDetail(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/anime\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: 'Invalid ID' }, 400);
  const id = parseInt(match[1]);

  const anime = await env.DB.prepare('SELECT * FROM anime WHERE id = ?').bind(id).first();
  if (!anime) return jsonRes({ ok: false, error: 'Anime not found' }, 404);

  const { results: tags } = await env.DB.prepare(
    'SELECT t.name, t.name_cn, t.count FROM tags t JOIN anime_tags at2 ON t.id = at2.tag_id WHERE at2.anime_id = ?'
  ).bind(id).all();

  const rating = await env.DB.prepare('SELECT * FROM rating_counts WHERE anime_id = ?').bind(id).first();

  return jsonRes({
    ok: true,
    data: {
      ...formatAnime(anime),
      summary: anime.summary || '',
      total_episodes: anime.total_episodes || 0,
      air_weekday: anime.air_weekday,
      is_airing: !!anime.is_airing,
      platform: anime.platform || '',
      rating: rating ? formatRating(rating, anime.rank) : null,
      tags: (tags || []).map(t => ({ name: t.name, name_cn: t.name_cn, count: t.count }))
    }
  });
}

export async function handleAnimeRelated(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/anime\/(\d+)\/related$/);
  if (!match) return jsonRes({ ok: false, error: 'Invalid ID' }, 400);
  const id = parseInt(match[1]);

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.title, a.title_cn, a.cover_url, a.score, a.air_date, r.relation_type
     FROM related_anime r JOIN anime a ON r.related_id = a.id
     WHERE r.anime_id = ? LIMIT 20`
  ).bind(id).all();

  const data = (results || []).map(r => ({ ...formatAnime(r), relation_type: r.relation_type }));
  return jsonRes({ ok: true, data });
}

export async function handleCalendar(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const { results } = await env.DB.prepare(
    `SELECT a.*, ce.weekday, ce.sort_order FROM calendar_entries ce
     JOIN anime a ON ce.anime_id = a.id
     WHERE a.is_airing = 1 ORDER BY ce.weekday ASC, ce.sort_order ASC`
  ).all();

  const days = {};
  for (let i = 0; i < 7; i++) days[i] = [];
  (results || []).forEach(r => {
    if (r.weekday >= 0 && r.weekday < 7) days[r.weekday].push(formatAnime(r));
  });

  return jsonRes({ ok: true, data: days });
}

export async function handleTags(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const { results } = await env.DB.prepare(
    'SELECT name, name_cn, count FROM tags WHERE count > 0 ORDER BY count DESC LIMIT 100'
  ).all();
  return jsonRes({ ok: true, data: results || [] });
}

// 心情/场景发现：按情绪标签 / 场景时长 / 挖宝策略聚合番剧
const MOOD_KEYS = {
  m_heal: '治愈', m_cry: '致郁', m_chill: '下饭', m_blood: '燃', m_sweet: '甜',
  m_funny: '沙雕', m_emo: 'EMO后劲', m_scene: '名场面', m_brain: '烧脑'
};

export async function handleDiscover(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const params = new URL(request.url).searchParams;
  const key = params.get('key') || '';
  const limit = Math.min(60, Math.max(1, parseInt(params.get('limit')) || 30));

  let sql, bindings;
  // 假分过滤：很多未上映/占位条目挂着 score=10 但几乎无人评分，按分排序会把它们顶上来。
  // 给按分排序的维度加「评分人数下限」(JOIN rating_counts)，只露真有评分量的番。
  if (MOOD_KEYS[key]) {
    // mood_tags 存为 JSON 数组字符串，如 ["治愈","下饭"]；匹配带引号的精确标签避免子串误命中
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE a.mood_tags LIKE ? AND rc.total_count >= 100 ORDER BY a.score DESC LIMIT ?`;
    bindings = [`%"${MOOD_KEYS[key]}"%`, limit];
  } else if (key === 's_oneseason') {
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE a.total_episodes BETWEEN 1 AND 13 AND rc.total_count >= 100 ORDER BY a.score DESC LIMIT ?`;
    bindings = [limit];
  } else if (key === 's_long') {
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE a.total_episodes >= 40 AND rc.total_count >= 100 ORDER BY a.score DESC LIMIT ?`;
    bindings = [limit];
  } else if (key === 's_airing') {
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE a.is_airing = 1 AND rc.total_count >= 30 ORDER BY a.score DESC LIMIT ?`;
    bindings = [limit];
  } else if (key === 's_classic') {
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE a.air_date != '' AND a.air_date < '2016-01-01' AND rc.total_count >= 100 AND a.score >= 8.3
           ORDER BY a.score DESC LIMIT ?`;
    bindings = [limit];
  } else if (key === 't_gem') {
    // 冷门遗珠：高分 × 评分人数少（识货才点）
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE a.score >= 7.8 AND rc.total_count BETWEEN 80 AND 1800
           ORDER BY a.score DESC LIMIT ?`;
    bindings = [limit];
  } else if (key === 't_controversial') {
    // 争议之作：高分票与低分票同时占一定比例（两极分化）
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE rc.total_count >= 120
             AND (rc.score_8 + rc.score_9 + rc.score_10) * 1.0 / rc.total_count >= 0.10
             AND (rc.score_1 + rc.score_2 + rc.score_3 + rc.score_4) * 1.0 / rc.total_count >= 0.12
           ORDER BY rc.total_count DESC LIMIT ?`;
    bindings = [limit];
  } else if (key === 't_trap') {
    // 避雷·名不副实：人气高（评分人数多）但评分偏低
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE rc.total_count >= 800 AND a.score > 0 AND a.score < 6.5
           ORDER BY rc.total_count DESC LIMIT ?`;
    bindings = [limit];
  } else if (key === 'c_pick') {
    // 紫音私藏：高分 + 有锐评 + 有热度，她的私心收藏
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE a.score >= 8.3 AND a.shion_review != '' AND rc.total_count >= 300
           ORDER BY a.score DESC LIMIT ?`;
    bindings = [limit];
  } else if (key === 'c_weekly') {
    // 本周锐评：周级确定性伪随机（同一周 seed 不变→选番稳定，跨周轮换），无需后端定时任务
    const seed = parseInt(params.get('seed')) || 0;
    sql = `SELECT a.* FROM anime a JOIN rating_counts rc ON a.id = rc.anime_id
           WHERE a.score >= 7.8 AND a.shion_review != '' AND rc.total_count >= 500
           ORDER BY ((a.id + ?) * 2654435761) % 100000 LIMIT ?`;
    bindings = [seed, limit];
  } else {
    return jsonRes({ ok: false, error: 'unknown discover key', data: [] }, 400);
  }

  const { results } = await env.DB.prepare(sql).bind(...bindings).all();

  // 附标签（与 handleAnimeList 同模式，卡片显示流派 pill）
  const ids = (results || []).map(r => r.id);
  let tagMap = {};
  if (ids.length) {
    const { results: tagResults } = await env.DB.prepare(
      `SELECT at2.anime_id, t.name, t.name_cn, t.count FROM anime_tags at2 JOIN tags t ON at2.tag_id = t.id WHERE at2.anime_id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    for (const tr of tagResults || []) {
      if (!tagMap[tr.anime_id]) tagMap[tr.anime_id] = [];
      tagMap[tr.anime_id].push({ name: tr.name, name_cn: tr.name_cn, count: tr.count });
    }
  }

  const data = (results || []).map(r => ({ ...formatAnime(r), tags: tagMap[r.id] || [] }));
  return jsonRes({ ok: true, data, key }, 200, 3600);
}

export async function handleAnimeCharacters(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/anime\/(\d+)\/characters$/);
  if (!match) return jsonRes({ ok: false, error: 'Invalid ID' }, 400);
  const id = parseInt(match[1]);

  const anime = await env.DB.prepare('SELECT bangumi_id FROM anime WHERE id = ?').bind(id).first();
  if (!anime || !anime.bangumi_id) return jsonRes({ ok: false, error: 'Anime not found', data: [] }, 404);

  const cacheKey = 'chars:' + anime.bangumi_id;
  const cached = await cacheGet(env, cacheKey, CHAR_TTL);
  if (cached) return jsonRes(cached, 200, DAY);

  let raw;
  try {
    raw = await bgmFetch('/v0/subjects/' + anime.bangumi_id + '/characters');
  } catch (e) {
    return jsonRes({ ok: false, error: 'upstream', data: [] }, 200, 60);
  }

  const data = (Array.isArray(raw) ? raw : []).map(c => ({
    id: c.id,
    name: c.name || '',
    relation: c.relation || '',
    image: pickImg(c.images),
    actors: (c.actors || []).map(a => ({ id: a.id, name: a.name || '', image: pickImg(a.images) }))
  }));

  const payload = { ok: true, data };
  await cacheSet(env, cacheKey, payload);
  return jsonRes(payload, 200, DAY);
}

const CAREER_CN = { seiyu: '声优', mangaka: '漫画家', artist: '艺术家', writer: '作家', illustrator: '插画家', actor: '演员', producer: '制作人', director: '导演', musician: '音乐人' };
function translateCareer(career) {
  if (!Array.isArray(career)) return '';
  return career.map(c => CAREER_CN[c] || c).join(' / ');
}

export async function handlePersonDetail(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/person\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: 'Invalid ID' }, 400);
  const id = parseInt(match[1]);

  const cacheKey = 'person:' + id;
  const cached = await cacheGet(env, cacheKey, PERSON_TTL);
  if (cached) return jsonRes(cached, 200, DAY);

  let person, chars;
  try {
    [person, chars] = await Promise.all([
      bgmFetch('/v0/persons/' + id),
      bgmFetch('/v0/persons/' + id + '/characters')
    ]);
  } catch (e) {
    return jsonRes({ ok: false, error: 'upstream' }, 200, 60);
  }

  // 仅动画(type=2)，按番剧去重，保留所配角色
  const bySubject = new Map();
  for (const c of (Array.isArray(chars) ? chars : [])) {
    if (c.subject_type !== 2 || !c.subject_id || bySubject.has(c.subject_id)) continue;
    bySubject.set(c.subject_id, {
      bangumi_id: c.subject_id,
      name: c.subject_name || '',
      name_cn: c.subject_name_cn || '',
      char_name: c.name || '',
      char_image: pickImg(c.images),
      relation: c.staff || ''
    });
  }
  const works = [...bySubject.values()];

  const bgmIds = works.map(w => w.bangumi_id);
  const idMap = {};
  for (let i = 0; i < bgmIds.length; i += 100) {
    const chunk = bgmIds.slice(i, i + 100);
    if (!chunk.length) continue;
    const { results } = await env.DB.prepare(
      `SELECT id, bangumi_id, score, cover_url FROM anime WHERE bangumi_id IN (${chunk.map(() => '?').join(',')})`
    ).bind(...chunk).all();
    for (const r of results || []) idMap[r.bangumi_id] = r;
  }

  const mapped = works.map(w => {
    const m = idMap[w.bangumi_id];
    return {
      bangumi_id: w.bangumi_id,
      name: w.name,
      name_cn: w.name_cn,
      char_name: w.char_name,
      relation: w.relation,
      app_id: m ? m.id : null,
      score: m ? m.score : 0,
      image: ((m && m.cover_url) || w.char_image || '').replace(/^http:/, 'https:')
    };
  });
  mapped.sort((a, b) => (b.app_id ? 1 : 0) - (a.app_id ? 1 : 0) || (b.score || 0) - (a.score || 0));

  const payload = {
    ok: true,
    data: {
      id: person.id,
      name: person.name || '',
      image: pickImg(person.images),
      career: translateCareer(person.career),
      works: mapped.slice(0, 48)
    }
  };
  await cacheSet(env, cacheKey, payload);
  return jsonRes(payload, 200, DAY);
}

function formatAnime(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.title || '',
    name_cn: row.title_cn || '',
    images: {
      large: row.cover_large_url || row.cover_url || '',
      common: row.cover_url || '',
      medium: row.cover_url || '',
      small: row.cover_url || ''
    },
    score: row.score || 0,
    date: row.air_date || '',
    tags: [],
    eps: row.total_episodes || 0,
    shion_review: row.shion_review || '',
    mood_tags: parseMoods(row.mood_tags)
  };
}

function parseMoods(s) {
  if (!s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; }
}

function formatRating(r, rank) {
  if (!r) return null;
  const total = r.total_count || 0;
  const score = total > 0 ? parseFloat((r.total_score / total).toFixed(1)) : 0;
  const count = {};
  for (let i = 1; i <= 10; i++) count[i] = r[`score_${i}`] || 0;
  return { total, score, count, rank: rank || 0 };
}
