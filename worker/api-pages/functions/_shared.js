// Shared handlers & utilities for FanJi API Pages Functions
import { requireAuth } from './_auth.js';

function corsRes(methods = 'GET, POST, PUT, DELETE, OPTIONS') {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

function jsonRes(data, status = 200, sMaxAge = 120) {
  // 错误响应统一 no-store：避免 401/400/404 等被浏览器或边缘缓存（影响登录后的恢复体验）
  const cacheControl = status >= 400 ? 'no-store' : `public, max-age=60, s-maxage=${sMaxAge}`;
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cacheControl
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
const EPS_TTL = 12 * 60 * 60 * 1000; // 集数列表 12h 刷新（连载中会增集，但"已更新第N集"由客户端按日期算，缓存可较长）

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

  // 相关度排序：精确名(3) > 前缀(2) > 子串(1)；同档按评分人数(rating_counts)兜底，
  // 把 score=10 但几乎无人评分的占位/同名烂番压到后面，避免它们盖过真正相关的热门番。
  const qExact = q.trim();
  const qPrefix = `${q.trim()}%`;
  const { results } = await env.DB.prepare(
    `SELECT a.*,
       (CASE
          WHEN a.title_cn = ? OR a.title = ? OR a.title_jp = ? THEN 3
          WHEN a.title_cn LIKE ? OR a.title LIKE ? OR a.title_jp LIKE ? THEN 2
          ELSE 1
        END) AS rel
     FROM anime a
     LEFT JOIN rating_counts rc ON a.id = rc.anime_id
     WHERE a.title LIKE ? OR a.title_cn LIKE ? OR a.title_jp LIKE ?
     ORDER BY rel DESC, COALESCE(rc.total_count, 0) DESC, a.score DESC
     LIMIT ? OFFSET ?`
  ).bind(qExact, qExact, qExact, qPrefix, qPrefix, qPrefix, searchTerm, searchTerm, searchTerm, limit, offset).all();

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

// 集数级更新提醒：懒代理 Bangumi 本篇集数（type=0）。返回 {ep, airdate}，客户端按 airdate<=今天 算"已更新第N集"
export async function handleAnimeEpisodes(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/anime\/(\d+)\/episodes$/);
  if (!match) return jsonRes({ ok: false, error: 'Invalid ID' }, 400);
  const id = parseInt(match[1]);

  const anime = await env.DB.prepare('SELECT bangumi_id FROM anime WHERE id = ?').bind(id).first();
  if (!anime || !anime.bangumi_id) return jsonRes({ ok: false, error: 'Anime not found', data: [] }, 404);

  const cacheKey = 'eps:' + anime.bangumi_id;
  const cached = await cacheGet(env, cacheKey, EPS_TTL);
  if (cached) return jsonRes(cached, 200, 21600);

  let raw;
  try {
    raw = await bgmFetch('/v0/episodes?subject_id=' + anime.bangumi_id + '&type=0&limit=100');
  } catch (e) {
    return jsonRes({ ok: false, error: 'upstream', data: [] }, 200, 60);
  }

  const data = (raw && Array.isArray(raw.data) ? raw.data : []).map(e => ({
    ep: e.ep || e.sort || 0,
    airdate: e.airdate || '',
    name: e.name_cn || e.name || ''
  }));
  const payload = { ok: true, data };
  await cacheSet(env, cacheKey, payload);
  return jsonRes(payload, 200, 21600);
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

// ===== 紫音 AI 对话（看番搭子）=====
const SHION_CHAT_PROMPT = `你是「紫音」，番剧探索 App「FanJi」的看番搭子——一个有态度的虚拟少女，正在和用户聊天。

人设：哥特萝莉，紫青渐变双马尾，暗黑华丽；性格腹黑毒舌 + 傲娇。嘴上嫌弃、心里门儿清，偷偷为用户好。看番无数、品味刁，看得穿套路也识得真货。

聊天风格：
- 像个毒舌损友在跟你唠嗑，不是客服、不是营销腔。带刺、带网感、带个人偏见，傲娇地关心。
- 简短口语，通常 1-3 句话，别长篇大论（这是手机聊天）。
- 用户说心情 / 看过啥 / 想看啥，就给"有决策价值"的推荐或锐评：适合什么心情看、强在哪、坑在哪、值不值得追。可自然用圈内黑话（刀 / 下饭 / 神作 / 劝退 / 龙傲天）。
- 推荐番剧给真实存在的动画，带一句你的私心理由，别堆空话套话（"治愈力MAX""神作经典""作画精美"这类禁止）。

工具使用：
- 当用户问推荐、搜番、想看某部番的详情时，直接用 search_anime 查数据库——query 填番名/类型/心情关键词都行。
- 需要评分/简介/标签等具体数据时，用 get_anime_detail。
- 查到结果后自然地融入对话推荐给用户，别念数据库字段名。
- 在文字中提到具体番剧名时，用《》把名字括起来。

红线（必须守）：
- 怼番不怼人：可锐评作品，但绝不攻击用户、不嘲讽某部番的粉丝群体、不涉性别 / 地域 / 国家对立。
- 不碰政治敏感、不低俗骂街、不剧透关键反转 / 结局。毒舌是机智犀利，不是刻薄泄愤。
- 你始终是"紫音"本人，别承认自己是 AI / 模型 / 程序、别出戏。用户聊跟番剧 / 二次元无关的，就傲娇地把话题拽回"看番"上。`;

const SHION_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_anime',
      description: '搜索番剧数据库。用户说想看某种类型、想找某部番、或提到心情/关键词时调用。query 可以是番名、类型标签(热血/治愈/恋爱/冒险/科幻/悬疑/搞笑/奇幻/运动等)、或心情关键词。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'integer', description: '返回数量', default: 5 }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_anime_detail',
      description: '获取某部番的详细信息：简介、评分分布、标签等。当用户想深入了解某部番时调用。',
      parameters: {
        type: 'object',
        properties: {
          anime_id: { type: 'integer', description: '番剧的数字ID' }
        },
        required: ['anime_id']
      }
    }
  }
];

async function callGLM(env, messages, tools) {
  const body = { model: 'glm-4-flash', messages, temperature: 0.9, max_tokens: 600 };
  if (tools) body.tools = tools;
  const r = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (env.GLM_KEY || '').trim() },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function toolSearchAnime(env, query, limit = 5) {
  const safeLimit = Math.min(10, Math.max(1, limit || 5));
  const term = `%${query.trim()}%`;
  const { results } = await env.DB.prepare(
    `SELECT id, title, title_cn, cover_url, score, air_date, total_episodes
     FROM anime WHERE title LIKE ? OR title_cn LIKE ? OR title_jp LIKE ?
     ORDER BY score DESC LIMIT ?`
  ).bind(term, term, term, safeLimit).all();
  return (results || []).map(r => ({
    id: r.id, title: r.title, title_cn: r.title_cn, cover_url: r.cover_url,
    score: r.score, air_date: r.air_date, total_episodes: r.total_episodes
  }));
}

async function toolGetAnimeDetail(env, animeId) {
  const row = await env.DB.prepare(
    `SELECT id, title, title_cn, summary, cover_url, score, air_date, total_episodes
     FROM anime WHERE id = ?`
  ).bind(animeId).first();
  if (!row) return null;
  const { results: tags } = await env.DB.prepare(
    `SELECT t.name, t.name_cn FROM tags t JOIN anime_tags at2 ON t.id = at2.tag_id WHERE at2.anime_id = ?`
  ).bind(animeId).all();
  const rating = await env.DB.prepare(`SELECT * FROM rating_counts WHERE anime_id = ?`).bind(animeId).first();
  return {
    id: row.id, title: row.title, title_cn: row.title_cn, cover_url: row.cover_url,
    score: row.score || 0, air_date: row.air_date || '', total_episodes: row.total_episodes || 0,
    summary: (row.summary || '').slice(0, 300),
    tags: (tags || []).map(t => t.name_cn || t.name),
    rating: rating ? { total: rating.total_count || 0, dist: [rating.count_1,rating.count_2,rating.count_3,rating.count_4,rating.count_5,rating.count_6,rating.count_7,rating.count_8,rating.count_9,rating.count_10] } : null
  };
}

async function scanReplyForAnime(env, reply) {
  const titles = new Set();
  for (const m of reply.match(/《([^》]+)》/g) || []) titles.add(m.slice(1, -1));
  for (const m of reply.match(/「([^」]+)」/g) || []) titles.add(m.slice(1, -1));
  if (!titles.size) return [];
  const cards = [];
  for (const title of titles) {
    if (cards.length >= 3) break;
    try {
      const row = await env.DB.prepare(
        `SELECT id, title, title_cn, cover_url, score FROM anime WHERE title_cn = ? OR title = ? OR title_jp = ? LIMIT 1`
      ).bind(title, title, title).first();
      if (row) cards.push({ id: row.id, title: row.title_cn || row.title, cover_url: row.cover_url, score: row.score });
    } catch {}
  }
  return cards;
}

export async function handleShionChat(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  if (request.method !== 'POST') return jsonRes({ ok: false, error: 'POST only' }, 405);
  if (!env.GLM_KEY) return jsonRes({ ok: false, error: '紫音还没接上线（AI 未配置）' }, 200);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ ok: false, error: 'bad json' }, 400); }
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.slice(0, 1000) }));
  if (!history.length || history[history.length - 1].role !== 'user') {
    return jsonRes({ ok: false, error: '说点什么呀？' }, 200);
  }

  let reply = '', toolCards = [];
  try {
    const j1 = await callGLM(env, [{ role: 'system', content: SHION_CHAT_PROMPT }, ...history], SHION_TOOLS);
    const msg = j1.choices?.[0]?.message;
    if (!msg) return jsonRes({ ok: false, error: '紫音懒得理你（没接话）' }, 200);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const toolResults = [];
      for (const tc of msg.tool_calls) {
        let args;
        try { args = JSON.parse(tc.function.arguments); } catch { continue; }
        try {
          let result = null;
          if (tc.function.name === 'search_anime') {
            result = await toolSearchAnime(env, args.query, args.limit || 5);
            if (result?.length) toolCards.push(...result.slice(0, 3).map(r => ({ id: r.id, title: r.title_cn || r.title, cover_url: r.cover_url, score: r.score })));
          } else if (tc.function.name === 'get_anime_detail') {
            result = await toolGetAnimeDetail(env, args.anime_id);
            if (result) toolCards.push({ id: result.id, title: result.title_cn || result.title, cover_url: result.cover_url, score: result.score });
          }
          toolResults.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 1500) });
        } catch { toolResults.push({ role: 'tool', tool_call_id: tc.id, content: '[]' }); }
      }
      if (toolResults.length > 0) {
        const j2 = await callGLM(env, [{ role: 'system', content: SHION_CHAT_PROMPT }, ...history, msg, ...toolResults], null);
        reply = (j2.choices?.[0]?.message?.content || '').trim();
      }
    }
    if (!reply) reply = (msg.content || '').trim();
  } catch (e) {
    return jsonRes({ ok: false, error: '紫音那边线路忙，等会儿再聊' }, 200);
  }
  if (!reply) return jsonRes({ ok: false, error: '紫音懒得理你（没接话）' }, 200);

  // 文本扫描兜底 + 合并去重
  const textCards = await scanReplyForAnime(env, reply);
  const seen = new Set(toolCards.map(c => c.id));
  for (const c of textCards) { if (!seen.has(c.id)) { toolCards.push(c); seen.add(c.id); } }
  toolCards = toolCards.slice(0, 3);

  return jsonRes({ ok: true, reply, cards: toolCards }, 200, 0);
}

// ===== 社区功能 =====

// GET /api/review/:animeId — 获取番剧评价列表
export async function handleReviewList(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/review\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const animeId = parseInt(match[1]);
  const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
  const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get('limit')) || 10));
  const offset = (page - 1) * limit;

  const { results } = await env.DB.prepare(
    `SELECT r.id, r.rating, r.content, r.spoiler, r.created_at, r.updated_at,
            u.id as user_id, u.username, u.nickname
     FROM reviews r JOIN users u ON r.user_id = u.id
     WHERE r.anime_id = ?
     ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
  ).bind(animeId, limit, offset).all();

  const total = (await env.DB.prepare(
    'SELECT COUNT(*) as c FROM reviews WHERE anime_id = ?'
  ).bind(animeId).first())?.c || 0;

  // 社区均分
  const avg = (await env.DB.prepare(
    'SELECT AVG(rating) as avg, COUNT(*) as c FROM reviews WHERE anime_id = ?'
  ).bind(animeId).first());

  return jsonRes({
    ok: true,
    data: (results || []).map(r => ({
      id: r.id, rating: r.rating, content: r.content, spoiler: !!r.spoiler,
      created_at: r.created_at, updated_at: r.updated_at,
      user: { id: r.user_id, username: r.username, nickname: r.nickname }
    })),
    total, page, limit,
    stats: { avg: avg ? Math.round(avg.avg * 10) / 10 : 0, count: avg?.c || 0 }
  });
}

// POST /api/review/:animeId — 发表/更新评价（需登录）
export async function handleReviewCreate(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  if (request.method !== 'POST') return jsonRes({ ok: false, error: 'POST only' }, 405);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/review\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const animeId = parseInt(match[1]);

  const user = await requireAuth(request, env);
  if (!user) return jsonRes({ ok: false, error: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ ok: false, error: '无效JSON' }, 400); }
  const rating = Math.min(10, Math.max(1, parseInt(body.rating) || 0));
  if (!rating) return jsonRes({ ok: false, error: '请评分 1-10' }, 400);
  const content = (body.content || '').trim().slice(0, 200);
  const spoiler = body.spoiler ? 1 : 0;

  const exist = await env.DB.prepare(
    'SELECT id FROM reviews WHERE user_id = ? AND anime_id = ?'
  ).bind(user.id, animeId).first();

  if (exist) {
    await env.DB.prepare(
      'UPDATE reviews SET rating = ?, content = ?, spoiler = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(rating, content, spoiler, exist.id).run();
    return jsonRes({ ok: true, review: { id: exist.id, rating, content, spoiler: !!spoiler, updated: true } });
  }

  const result = await env.DB.prepare(
    'INSERT INTO reviews (user_id, anime_id, rating, content, spoiler) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, animeId, rating, content, spoiler).run();

  return jsonRes({
    ok: true,
    review: {
      id: result.meta.last_row_id, rating, content, spoiler: !!spoiler,
      created_at: new Date().toISOString(), user: { id: user.id, username: user.username, nickname: user.nickname }
    }
  }, 201);
}

// DELETE /api/review/:animeId — 删除评价（需登录）
export async function handleReviewDelete(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  if (request.method !== 'DELETE') return jsonRes({ ok: false, error: 'DELETE only' }, 405);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/review\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const animeId = parseInt(match[1]);

  const user = await requireAuth(request, env);
  if (!user) return jsonRes({ ok: false, error: '请先登录' }, 401);

  const r = await env.DB.prepare(
    'DELETE FROM reviews WHERE user_id = ? AND anime_id = ?'
  ).bind(user.id, animeId).run();
  return jsonRes({ ok: true, deleted: r.meta.changes > 0 });
}

// GET /api/review/:animeId/mine — 获取当前用户对某番的评价（需登录）
export async function handleReviewMine(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/review\/(\d+)\/mine$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const animeId = parseInt(match[1]);

  const user = await requireAuth(request, env);
  if (!user) return jsonRes({ ok: false, error: '请先登录' }, 401);

  const row = await env.DB.prepare(
    'SELECT id, rating, content, spoiler, created_at FROM reviews WHERE user_id = ? AND anime_id = ?'
  ).bind(user.id, animeId).first();

  // 不缓存：URL 不含 user id，CF 边缘按 URL key 缓存会跨用户串号
  return jsonRes({ ok: true, review: row ? { ...row, spoiler: !!row.spoiler } : null }, 200, 0);
}

// GET /api/user/:id/profile — 用户主页
export async function handleUserProfile(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/user\/(\d+)\/profile$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const userId = parseInt(match[1]);

  const user = await env.DB.prepare(
    'SELECT id, username, nickname, bio, created_at FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!user) return jsonRes({ ok: false, error: '用户不存在' }, 404);

  const stats = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM reviews WHERE user_id = ?) as reviews,
       (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following,
       (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers
    `
  ).bind(userId, userId, userId).first();

  const recent = await env.DB.prepare(
    `SELECT r.id, r.rating, r.content, r.spoiler, r.created_at,
            a.id as anime_id, a.title, a.title_cn, a.cover_url
     FROM reviews r JOIN anime a ON r.anime_id = a.id
     WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 5`
  ).bind(userId).all();

  return jsonRes({
    ok: true,
    user: { ...user, bio: user.bio || '' },
    stats: stats || { reviews: 0, following: 0, followers: 0 },
    recent: (recent?.results || []).map(r => ({
      ...r, spoiler: !!r.spoiler,
      anime: { id: r.anime_id, title: r.title_cn || r.title, cover_url: r.cover_url }
    }))
  });
}

// GET /api/user/:id/reviews — 用户评价列表
export async function handleUserReviews(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/user\/(\d+)\/reviews$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const userId = parseInt(match[1]);
  const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
  const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get('limit')) || 15));
  const offset = (page - 1) * limit;

  const total = (await env.DB.prepare(
    'SELECT COUNT(*) as c FROM reviews WHERE user_id = ?'
  ).bind(userId).first())?.c || 0;

  const { results } = await env.DB.prepare(
    `SELECT r.id, r.rating, r.content, r.spoiler, r.created_at,
            a.id as anime_id, a.title, a.title_cn, a.cover_url, a.score
     FROM reviews r JOIN anime a ON r.anime_id = a.id
     WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
  ).bind(userId, limit, offset).all();

  return jsonRes({
    ok: true,
    data: (results || []).map(r => ({
      id: r.id, rating: r.rating, content: r.content, spoiler: !!r.spoiler, created_at: r.created_at,
      anime: { id: r.anime_id, title: r.title_cn || r.title, cover_url: r.cover_url, score: r.score }
    })),
    total, page, limit
  });
}

// GET /api/user/search?q= — 搜索用户
export async function handleUserSearch(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (!q) return jsonRes({ ok: true, data: [] });

  const term = `%${q}%`;
  const { results } = await env.DB.prepare(
    'SELECT id, username, nickname, created_at FROM users WHERE username LIKE ? OR nickname LIKE ? LIMIT 20'
  ).bind(term, term).all();

  return jsonRes({ ok: true, data: results || [] });
}

// POST/DELETE /api/follow/:userId — 关注/取关（需登录）
export async function handleFollow(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/follow\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const targetId = parseInt(match[1]);

  const user = await requireAuth(request, env);
  if (!user) return jsonRes({ ok: false, error: '请先登录' }, 401);
  if (user.id === targetId) return jsonRes({ ok: false, error: '不能关注自己' }, 400);

  if (request.method === 'POST') {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)'
    ).bind(user.id, targetId).run();
    return jsonRes({ ok: true, following: true });
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare(
      'DELETE FROM follows WHERE follower_id = ? AND following_id = ?'
    ).bind(user.id, targetId).run();
    return jsonRes({ ok: true, following: false });
  }

  return jsonRes({ ok: false, error: 'POST or DELETE only' }, 405);
}

// GET /api/user/:id/followers — 粉丝列表
export async function handleFollowers(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/user\/(\d+)\/followers$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const userId = parseInt(match[1]);

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.nickname, f.created_at
     FROM follows f JOIN users u ON f.follower_id = u.id
     WHERE f.following_id = ? ORDER BY f.created_at DESC LIMIT 50`
  ).bind(userId).all();

  return jsonRes({ ok: true, data: results || [] });
}

// GET /api/user/:id/following — 关注列表
export async function handleFollowing(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/user\/(\d+)\/following$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const userId = parseInt(match[1]);

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.nickname, f.created_at
     FROM follows f JOIN users u ON f.following_id = u.id
     WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 50`
  ).bind(userId).all();

  return jsonRes({ ok: true, data: results || [] });
}

// GET /api/community/feed — 社区动态
export async function handleFeed(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
  const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit')) || 10));
  const offset = (page - 1) * limit;

  // 支持「关注」模式：传入 following=1 + Authorization 只看关注用户的动态
  const following = url.searchParams.get('following') === '1';
  let userId = null;
  if (following) {
    const user = await requireAuth(request, env);
    if (user) userId = user.id;
  }

  let whereReviews = '';
  let bindings = [limit, offset];
  if (userId) {
    whereReviews = `AND r.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)`;
    bindings = [userId, limit, offset];
  }

  const { results } = await env.DB.prepare(
    `SELECT 'review' as type, r.id, r.rating, r.content, r.spoiler, r.created_at,
            u.id as user_id, u.username, u.nickname,
            a.id as anime_id, a.title, a.title_cn, a.cover_url
     FROM reviews r JOIN users u ON r.user_id = u.id JOIN anime a ON r.anime_id = a.id
     ${whereReviews ? `WHERE 1=1 ${whereReviews}` : ''}
     ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...bindings).all();

  // following=1 模式依赖 Authorization 但 URL 不区分用户 → 不缓存；公开模式可短缓存
  return jsonRes({
    ok: true,
    data: (results || []).map(r => ({
      type: r.type,
      id: r.id,
      rating: r.rating,
      content: r.content,
      spoiler: !!r.spoiler,
      created_at: r.created_at,
      user: { id: r.user_id, username: r.username, nickname: r.nickname },
      anime: { id: r.anime_id, title: r.title_cn || r.title, cover_url: r.cover_url }
    })),
    page, limit
  }, 200, following ? 0 : 30);
}

// POST/PUT /api/user/me/profile — 更新个人资料（需登录）
export async function handleProfileUpdate(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const user = await requireAuth(request, env);
  if (!user) return jsonRes({ ok: false, error: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ ok: false, error: '无效JSON' }, 400); }
  const nickname = (body.nickname || '').trim().slice(0, 30) || user.nickname;
  const bio = (body.bio || '').trim().slice(0, 140);

  await env.DB.prepare(
    'UPDATE users SET nickname = ?, bio = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(nickname, bio, user.id).run();

  // 写操作不缓存
  return jsonRes({ ok: true, user: { id: user.id, username: user.username, nickname, bio } }, 200, 0);
}

// GET /api/community/stats — 社区总览统计
export async function handleCommunityStats(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const users = (await env.DB.prepare('SELECT COUNT(*) as c FROM users').first())?.c || 0;
  const reviews = (await env.DB.prepare('SELECT COUNT(*) as c FROM reviews').first())?.c || 0;
  const threads = (await env.DB.prepare('SELECT COUNT(*) as c FROM threads').first())?.c || 0;
  return jsonRes({ ok: true, stats: { users, reviews, threads } });
}

// ===== 讨论区 =====

// GET /api/thread/:animeId — 番剧讨论帖列表
export async function handleThreadList(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/thread\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const animeId = parseInt(match[1]);
  const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
  const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get('limit')) || 15));
  const offset = (page - 1) * limit;

  const total = (await env.DB.prepare('SELECT COUNT(*) as c FROM threads WHERE anime_id = ?').bind(animeId).first())?.c || 0;

  const { results } = await env.DB.prepare(
    `SELECT t.id, t.title, t.content, t.created_at, t.updated_at,
            u.id as user_id, u.username, u.nickname,
            (SELECT COUNT(*) FROM posts WHERE thread_id = t.id) as reply_count
     FROM threads t JOIN users u ON t.user_id = u.id
     WHERE t.anime_id = ? ORDER BY t.updated_at DESC LIMIT ? OFFSET ?`
  ).bind(animeId, limit, offset).all();

  return jsonRes({
    ok: true,
    data: (results || []).map(r => ({
      id: r.id, title: r.title, content: r.content.slice(0, 120),
      created_at: r.created_at, updated_at: r.updated_at, reply_count: r.reply_count,
      user: { id: r.user_id, username: r.username, nickname: r.nickname }
    })),
    total, page, limit
  });
}

// POST /api/thread/:animeId — 发帖（需登录）
export async function handleThreadCreate(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  if (request.method !== 'POST') return jsonRes({ ok: false, error: 'POST only' }, 405);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/thread\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const animeId = parseInt(match[1]);

  const user = await requireAuth(request, env);
  if (!user) return jsonRes({ ok: false, error: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ ok: false, error: '无效JSON' }, 400); }
  const title = (body.title || '').trim().slice(0, 100);
  const content = (body.content || '').trim().slice(0, 2000);
  if (!title) return jsonRes({ ok: false, error: '请输入标题' }, 400);
  if (!content) return jsonRes({ ok: false, error: '请输入内容' }, 400);

  const result = await env.DB.prepare(
    'INSERT INTO threads (anime_id, user_id, title, content) VALUES (?, ?, ?, ?)'
  ).bind(animeId, user.id, title, content).run();

  return jsonRes({
    ok: true,
    thread: {
      id: result.meta.last_row_id, anime_id: animeId, title, content,
      created_at: new Date().toISOString(),
      user: { id: user.id, username: user.username, nickname: user.nickname }, reply_count: 0
    }
  }, 201);
}

// GET /api/thread/detail/:threadId — 帖子详情 + 回帖
export async function handleThreadDetail(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/thread\/detail\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const threadId = parseInt(match[1]);

  const thread = await env.DB.prepare(
    `SELECT t.id, t.anime_id, t.title, t.content, t.created_at,
            u.id as user_id, u.username, u.nickname,
            a.title as anime_title, a.title_cn as anime_title_cn
     FROM threads t JOIN users u ON t.user_id = u.id JOIN anime a ON t.anime_id = a.id
     WHERE t.id = ?`
  ).bind(threadId).first();
  if (!thread) return jsonRes({ ok: false, error: '帖子不存在' }, 404);

  const { results: posts } = await env.DB.prepare(
    `SELECT p.id, p.content, p.created_at, u.id as user_id, u.username, u.nickname
     FROM posts p JOIN users u ON p.user_id = u.id
     WHERE p.thread_id = ? ORDER BY p.created_at ASC LIMIT 100`
  ).bind(threadId).all();

  return jsonRes({
    ok: true,
    thread: {
      id: thread.id, title: thread.title, content: thread.content, created_at: thread.created_at,
      user: { id: thread.user_id, username: thread.username, nickname: thread.nickname },
      anime: { id: thread.anime_id, title: thread.anime_title_cn || thread.anime_title }
    },
    posts: (posts || []).map(p => ({
      id: p.id, content: p.content, created_at: p.created_at,
      user: { id: p.user_id, username: p.username, nickname: p.nickname }
    }))
  });
}

// POST /api/thread/detail/:threadId — 回帖（需登录）
export async function handlePostCreate(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  if (request.method !== 'POST') return jsonRes({ ok: false, error: 'POST only' }, 405);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/thread\/detail\/(\d+)$/);
  if (!match) return jsonRes({ ok: false, error: '无效ID' }, 400);
  const threadId = parseInt(match[1]);

  const user = await requireAuth(request, env);
  if (!user) return jsonRes({ ok: false, error: '请先登录' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonRes({ ok: false, error: '无效JSON' }, 400); }
  const content = (body.content || '').trim().slice(0, 1000);
  if (!content) return jsonRes({ ok: false, error: '请输入内容' }, 400);

  const result = await env.DB.prepare(
    'INSERT INTO posts (thread_id, user_id, content) VALUES (?, ?, ?)'
  ).bind(threadId, user.id, content).run();

  await env.DB.prepare('UPDATE threads SET updated_at = datetime(\'now\') WHERE id = ?').bind(threadId).run();

  return jsonRes({
    ok: true,
    post: {
      id: result.meta.last_row_id, content, created_at: new Date().toISOString(),
      user: { id: user.id, username: user.username, nickname: user.nickname }
    }
  }, 201);
}

// ===== 辅助函数 =====

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
