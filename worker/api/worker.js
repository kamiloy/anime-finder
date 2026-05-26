// FanJi API Worker — Cloudflare D1 + Workers
// 提供番剧列表、搜索、详情、关联作品、日历、标签 6 个 API 端点

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const params = url.searchParams;

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return corsRes();
    }

    try {
      // 路由分发
      if (path === '/api/anime' && request.method === 'GET') {
        return handleAnimeList(params, env);
      }
      if (path === '/api/anime/search' && request.method === 'GET') {
        return handleAnimeSearch(params, env);
      }
      const detailMatch = path.match(/^\/api\/anime\/(\d+)$/);
      if (detailMatch && request.method === 'GET') {
        return handleAnimeDetail(parseInt(detailMatch[1]), env);
      }
      const relatedMatch = path.match(/^\/api\/anime\/(\d+)\/related$/);
      if (relatedMatch && request.method === 'GET') {
        return handleAnimeRelated(parseInt(relatedMatch[1]), env);
      }
      if (path === '/api/calendar' && request.method === 'GET') {
        return handleCalendar(env);
      }
      if (path === '/api/tags' && request.method === 'GET') {
        return handleTags(env);
      }

      return jsonRes({ ok: false, error: 'Not found' }, 404);
    } catch (e) {
      return jsonRes({ ok: false, error: e.message }, 500);
    }
  }
};

// ===== 响应工具 =====

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

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60, s-maxage=120'
    }
  });
}

// ===== 番剧列表 =====
// GET /api/anime?sort=heat|rank&tag=&year=&airing=0|1&page=1&limit=20&exclude_ids=1,2,3
async function handleAnimeList(params, env) {
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

  // 排序
  let orderBy;
  if (sort === 'rank') {
    orderBy = 'a.score DESC, a.rank ASC';
  } else {
    orderBy = 'a.rank ASC, a.score DESC';
  }

  // 计数
  const countSQL = `SELECT COUNT(*) as total FROM anime a ${joins.join(' ')} ${whereClause}`;
  const countResult = await env.DB.prepare(countSQL).bind(...bindings).first();
  const total = countResult ? countResult.total : 0;

  // 查询
  const sql = `
    SELECT DISTINCT a.* FROM anime a
    ${joins.join(' ')}
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  bindings.push(limit, offset);
  const { results } = await env.DB.prepare(sql).bind(...bindings).all();

  // 批量获取标签
  const ids = results.map(r => r.id);
  let tagMap = {};
  if (ids.length) {
    const { results: tagResults } = await env.DB.prepare(
      `SELECT at2.anime_id, t.name, t.name_cn, t.count
       FROM anime_tags at2 JOIN tags t ON at2.tag_id = t.id
       WHERE at2.anime_id IN (${ids.map(() => '?').join(',')})`
    ).bind(...ids).all();
    for (const tr of tagResults || []) {
      if (!tagMap[tr.anime_id]) tagMap[tr.anime_id] = [];
      tagMap[tr.anime_id].push({ name: tr.name, name_cn: tr.name_cn, count: tr.count });
    }
  }

  // 转换为 Bangumi 兼容格式
  const data = results.map(r => ({ ...formatAnime(r), tags: tagMap[r.id] || [] }));

  return jsonRes({ ok: true, data, total, page, limit });
}

// ===== 番剧搜索 =====
// GET /api/anime/search?q=&page=1&limit=20
async function handleAnimeSearch(params, env) {
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

// ===== 番剧详情 =====
// GET /api/anime/:id
async function handleAnimeDetail(id, env) {
  const anime = await env.DB.prepare('SELECT * FROM anime WHERE id = ?').bind(id).first();
  if (!anime) {
    return jsonRes({ ok: false, error: 'Anime not found' }, 404);
  }

  // 标签
  const { results: tags } = await env.DB.prepare(
    'SELECT t.name, t.name_cn, t.count FROM tags t JOIN anime_tags at2 ON t.id = at2.tag_id WHERE at2.anime_id = ?'
  ).bind(id).all();

  // 评分分布
  const rating = await env.DB.prepare('SELECT * FROM rating_counts WHERE anime_id = ?').bind(id).first();

  // 角色/声优
  const { results: characters } = await env.DB.prepare(
    `SELECT c.name, c.name_cn, c.name_jp, c.image_url, ac.role, ac.is_main,
            va.name as va_name, va.name_jp as va_name_jp, va.image_url as va_image
     FROM anime_characters ac
     JOIN characters c ON ac.character_id = c.id
     LEFT JOIN voice_actors va ON ac.va_id = va.id
     WHERE ac.anime_id = ?
     ORDER BY ac.is_main DESC LIMIT 20`
  ).bind(id).all();

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
      tags: (tags || []).map(t => ({ name: t.name, name_cn: t.name_cn, count: t.count })),
      characters: (characters || []).map(c => ({
        name: c.name,
        name_cn: c.name_cn,
        name_jp: c.name_jp,
        image_url: c.image_url,
        role: c.role,
        is_main: !!c.is_main,
        voice_actor: c.va_name ? {
          name: c.va_name,
          name_jp: c.va_name_jp,
          image_url: c.va_image
        } : null
      }))
    }
  });
}

// ===== 关联作品 =====
// GET /api/anime/:id/related
async function handleAnimeRelated(id, env) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.title, a.title_cn, a.cover_url, a.score, a.air_date, r.relation_type
     FROM related_anime r
     JOIN anime a ON r.related_id = a.id
     WHERE r.anime_id = ? LIMIT 20`
  ).bind(id).all();

  const data = (results || []).map(r => ({
    ...formatAnime(r),
    relation_type: r.relation_type
  }));

  return jsonRes({ ok: true, data });
}

// ===== 新番时间表 =====
// GET /api/calendar
async function handleCalendar(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, ce.weekday, ce.sort_order
     FROM calendar_entries ce
     JOIN anime a ON ce.anime_id = a.id
     WHERE a.is_airing = 1
     ORDER BY ce.weekday ASC, ce.sort_order ASC`
  ).all();

  // 按星期几分组（Bangumi 兼容格式）
  const days = {};
  for (let i = 0; i < 7; i++) {
    days[i] = [];
  }

  (results || []).forEach(r => {
    const wd = r.weekday;
    if (wd >= 0 && wd < 7) {
      days[wd].push(formatAnime(r));
    }
  });

  return jsonRes({ ok: true, data: days });
}

// ===== 标签列表 =====
// GET /api/tags
async function handleTags(env) {
  const { results } = await env.DB.prepare(
    'SELECT name, name_cn, count FROM tags WHERE count > 0 ORDER BY count DESC LIMIT 100'
  ).all();

  return jsonRes({ ok: true, data: results || [] });
}

// ===== 格式化工具 =====

// 将 D1 行转换为 Bangumi 兼容的番剧对象
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
    tags: [],  // 列表接口不含 tags，详情接口会覆盖
    eps: row.total_episodes || 0
  };
}

function formatRating(r, rank) {
  if (!r) return null;
  const total = r.total_count || 0;
  const score = total > 0 ? parseFloat((r.total_score / total).toFixed(1)) : 0;
  const count = {};
  for (let i = 1; i <= 10; i++) {
    count[i] = r[`score_${i}`] || 0;
  }
  return { total, score, count, rank: rank || 0 };
}
