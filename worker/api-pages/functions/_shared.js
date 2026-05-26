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

export async function handleAnimeCharacters(request, env) {
  if (request.method === 'OPTIONS') return corsRes();
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/anime\/(\d+)\/characters$/);
  if (!match) return jsonRes({ ok: false, error: 'Invalid ID' }, 400);
  const id = parseInt(match[1]);

  const anime = await env.DB.prepare('SELECT bangumi_id FROM anime WHERE id = ?').bind(id).first();
  if (!anime || !anime.bangumi_id) return jsonRes({ ok: false, error: 'Anime not found', data: [] }, 404);

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

  return jsonRes({ ok: true, data }, 200, DAY);
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

  return jsonRes({
    ok: true,
    data: {
      id: person.id,
      name: person.name || '',
      image: pickImg(person.images),
      career: translateCareer(person.career),
      works: mapped.slice(0, 48)
    }
  }, 200, DAY);
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
    eps: row.total_episodes || 0
  };
}

function formatRating(r, rank) {
  if (!r) return null;
  const total = r.total_count || 0;
  const score = total > 0 ? parseFloat((r.total_score / total).toFixed(1)) : 0;
  const count = {};
  for (let i = 1; i <= 10; i++) count[i] = r[`score_${i}`] || 0;
  return { total, score, count, rank: rank || 0 };
}
