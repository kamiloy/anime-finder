// FanJi Sync Worker — 数据同步
// Cron 触发：daily (19:00 UTC = 凌晨3点北京时间) + weekly (20:00 UTC Sun = 凌晨4点北京时间)
// 也支持手动触发：GET /sync?task=seed|daily|weekly

const BANGUMI_SEARCH = 'https://api.bgm.tv/v0/search/subjects';
const BANGUMI_CALENDAR = 'https://api.bgm.tv/calendar';
const BANGUMI_SUBJECT = 'https://api.bgm.tv/v0/subjects';
const ANILIST_API = 'https://graphql.anilist.co';
const PAGE = 50;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const task = url.searchParams.get('task') || 'daily';

    // Cron 触发判断
    const cron = request.headers.get('X-Cron-Trigger') || '';

    if (!cron && url.pathname !== '/sync') {
      return new Response('Not found', { status: 404 });
    }

    try {
      let result;
      if (task === 'seed') {
        result = await seedSync(env);
      } else if (task === 'weekly' || cron === 'weekly') {
        result = await weeklySync(env);
      } else {
        result = await dailySync(env);
      }

      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // Cron 事件入口
  async scheduled(event, env, ctx) {
    switch (event.cron) {
      case '0 19 * * *':
        await dailySync(env);
        break;
      case '0 20 * * 0':
        await weeklySync(env);
        break;
      default:
        await dailySync(env);
    }
  }
};

// ===== 每日同步 =====
async function dailySync(env) {
  const logId = await startLog(env, 'daily');
  let recordsAffected = 0;

  try {
    // 1. 更新新番时间表
    const cal = await fetch(BANGUMI_CALENDAR).then(r => r.json());
    let calCount = 0;

    if (Array.isArray(cal)) {
      // 清空旧日历
      await env.DB.prepare('DELETE FROM calendar_entries').run();

      for (const dayItems of cal) {
        for (const item of (dayItems.items || [])) {
          let animeId = await findAnimeByBangumiId(env, item.id);
          if (!animeId) {
            animeId = await upsertAnime(env, item, true);
          }
          const weekday = cal.indexOf(dayItems);
          await env.DB.prepare(
            'INSERT INTO calendar_entries (anime_id, weekday, sort_order) VALUES (?, ?, ?)'
          ).bind(animeId, weekday, item.rank || 0).run();
          calCount++;
        }
      }
    }

    // 2. 更新正在播出的番剧评分
    const { results: airing } = await env.DB.prepare(
      'SELECT id, bangumi_id FROM anime WHERE is_airing = 1 AND bangumi_id IS NOT NULL'
    ).all();

    for (const a of (airing || [])) {
      try {
        const detail = await fetch(`${BANGUMI_SUBJECT}/${a.bangumi_id}`).then(r => r.json());
        await updateRating(env, a.id, detail.rating || {});
        recordsAffected++;
      } catch (e) {
        // 单条失败继续
      }
    }

    recordsAffected += calCount;
    await finishLog(env, logId, 'completed', recordsAffected);
    return { ok: true, task: 'daily', recordsAffected };
  } catch (e) {
    await finishLog(env, logId, 'failed', recordsAffected, e.message);
    throw e;
  }
}

// ===== 每周同步 =====
async function weeklySync(env) {
  const logId = await startLog(env, 'weekly');
  let recordsAffected = 0;

  try {
    // 1. 更新活跃番剧元数据
    const { results: active } = await env.DB.prepare(
      'SELECT id, bangumi_id FROM anime WHERE is_airing = 1 AND bangumi_id IS NOT NULL'
    ).all();

    for (const a of (active || [])) {
      try {
        const detail = await fetch(`${BANGUMI_SUBJECT}/${a.bangumi_id}`).then(r => r.json());
        await env.DB.prepare(
          `UPDATE anime SET title = ?, title_cn = ?, title_jp = ?, summary = ?,
           cover_url = ?, cover_large_url = ?, total_episodes = ?, score = ?, rank = ?,
           updated_at = datetime('now') WHERE id = ?`
        ).bind(
          detail.name || '', detail.name_cn || '', detail.infobox?.find(i => i.key === '日文名')?.value || '',
          detail.summary || '', detail.images?.common || '', detail.images?.large || '',
          detail.eps || detail.total_episodes || 0, detail.rating?.score || 0, detail.rank || 0, a.id
        ).run();
        recordsAffected++;
      } catch (e) {
        // 单条失败继续
      }
    }

    // 2. AniList 增量同步（限流 90 req/min）
    const { results: toEnrich } = await env.DB.prepare(
      'SELECT id, anilist_id, title, title_jp FROM anime WHERE is_airing = 1 AND anilist_id IS NULL LIMIT 30'
    ).all();

    for (const a of (toEnrich || [])) {
      try {
        const anilistData = await searchAniList(a.title_jp || a.title);
        if (anilistData) {
          await env.DB.prepare('UPDATE anime SET anilist_id = ? WHERE id = ?').bind(anilistData.id, a.id).run();
          await enrichFromAniList(env, a.id, anilistData.id);
          recordsAffected++;
        }
      } catch (e) {
        // 单条失败继续
      }
    }

    // 3. 清理已完结超过 1 年的冷门番剧（评分人数 < 100）
    await env.DB.prepare(
      `DELETE FROM calendar_entries WHERE anime_id IN (
        SELECT a.id FROM anime a
        LEFT JOIN rating_counts rc ON a.id = rc.anime_id
        WHERE a.is_airing = 0
        AND a.air_date < date('now', '-1 year')
        AND (rc.total_count IS NULL OR rc.total_count < 100)
      )`
    ).run();

    await finishLog(env, logId, 'completed', recordsAffected);
    return { ok: true, task: 'weekly', recordsAffected };
  } catch (e) {
    await finishLog(env, logId, 'failed', recordsAffected, e.message);
    throw e;
  }
}

// ===== 种子同步（一次性）=====
async function seedSync(env) {
  const logId = await startLog(env, 'seed');
  let recordsAffected = 0;

  try {
    // 从 Bangumi 排行榜拉取前 2000 部
    for (let offset = 0; offset < 2000; offset += PAGE) {
      try {
        const data = await fetch(
          `${BANGUMI_SEARCH}?limit=${PAGE}&offset=${offset}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword: '', sort: 'rank', filter: { type: [2] } })
          }
        ).then(r => r.json());

        for (const item of (data.data || [])) {
          const animeId = await upsertAnime(env, item);

          // 标签
          if (item.tags) {
            for (const t of item.tags) {
              let tagId = await findOrCreateTag(env, t.name, t.count);
              await env.DB.prepare(
                'INSERT OR IGNORE INTO anime_tags (anime_id, tag_id) VALUES (?, ?)'
              ).bind(animeId, tagId).run();
            }
          }
          recordsAffected++;

          // 获取详情（含评分分布）
          if (item.id) {
            try {
              const detail = await fetch(`${BANGUMI_SUBJECT}/${item.id}`).then(r => r.json());
              await env.DB.prepare(
                `UPDATE anime SET summary = ?, cover_large_url = ?, total_episodes = ?
                 WHERE id = ?`
              ).bind(
                detail.summary || '', detail.images?.large || '',
                detail.eps || detail.total_episodes || 0, animeId
              ).run();
              if (detail.rating) {
                await updateRating(env, animeId, detail.rating);
              }
            } catch (e) {
              // 详情拉取失败不阻塞
            }
          }
        }
      } catch (e) {
        // 分页请求失败继续下一页
      }

      // 控制频率：每 50 条 sleep 2s
      if (offset > 0 && offset % 50 === 0) {
        await sleep(2000);
      }
    }

    // 拉取新番时间表
    const cal = await fetch(BANGUMI_CALENDAR).then(r => r.json());
    if (Array.isArray(cal)) {
      for (const dayItems of cal) {
        for (const item of (dayItems.items || [])) {
          let animeId = await findAnimeByBangumiId(env, item.id);
          if (!animeId) {
            animeId = await upsertAnime(env, item, true);
          }
          const weekday = cal.indexOf(dayItems);
          await env.DB.prepare(
            'INSERT OR IGNORE INTO calendar_entries (anime_id, weekday, sort_order) VALUES (?, ?, ?)'
          ).bind(animeId, weekday, item.rank || 0).run();
        }
      }
    }

    await finishLog(env, logId, 'completed', recordsAffected);
    return { ok: true, task: 'seed', recordsAffected };
  } catch (e) {
    await finishLog(env, logId, 'failed', recordsAffected, e.message);
    throw e;
  }
}

// ===== 数据库操作工具 =====

async function findAnimeByBangumiId(env, bangumiId) {
  const row = await env.DB.prepare(
    'SELECT id FROM anime WHERE bangumi_id = ?'
  ).bind(bangumiId).first();
  return row ? row.id : null;
}

async function upsertAnime(env, item, isAiring) {
  const existing = await env.DB.prepare(
    'SELECT id FROM anime WHERE bangumi_id = ?'
  ).bind(item.id).first();

  const airingVal = isAiring ? 1 : 0;

  if (existing) {
    const setClause = isAiring !== undefined
      ? `UPDATE anime SET title = ?, title_cn = ?, cover_url = ?, score = ?, rank = ?,
         air_date = ?, total_episodes = ?, is_airing = ?, updated_at = datetime('now') WHERE id = ?`
      : `UPDATE anime SET title = ?, title_cn = ?, cover_url = ?, score = ?, rank = ?,
         air_date = ?, total_episodes = ?, updated_at = datetime('now') WHERE id = ?`;
    const params = isAiring !== undefined
      ? [item.name || '', item.name_cn || '', item.images?.common || '',
         item.score || 0, item.rank || 0, item.date || '', item.eps || 0, airingVal, existing.id]
      : [item.name || '', item.name_cn || '', item.images?.common || '',
         item.score || 0, item.rank || 0, item.date || '', item.eps || 0, existing.id];
    await env.DB.prepare(setClause).bind(...params).run();
    return existing.id;
  }

  const { meta } = await env.DB.prepare(
    `INSERT INTO anime (title, title_cn, cover_url, bangumi_id, score, rank, air_date, total_episodes${isAiring !== undefined ? ', is_airing' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?${isAiring !== undefined ? ', ?' : ''})`
  ).bind(
    item.name || '', item.name_cn || '', item.images?.common || '',
    item.id, item.score || 0, item.rank || 0, item.date || '', item.eps || 0,
    ...(isAiring !== undefined ? [airingVal] : [])
  ).run();
  return meta.last_row_id;
}

async function updateRating(env, animeId, rating) {
  if (!rating || !rating.count) return;
  const counts = rating.count || {};
  const total = Object.entries(counts).reduce((sum, [k, v]) => {
    const score = parseInt(k);
    return sum + (score * (v || 0));
  }, 0);
  const count = Object.values(counts).reduce((a, b) => a + (b || 0), 0);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO rating_counts
     (anime_id, score_10, score_9, score_8, score_7, score_6, score_5, score_4, score_3, score_2, score_1, total_score, total_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    animeId,
    counts[10] || 0, counts[9] || 0, counts[8] || 0, counts[7] || 0,
    counts[6] || 0, counts[5] || 0, counts[4] || 0, counts[3] || 0,
    counts[2] || 0, counts[1] || 0, total, count
  ).run();

  const avgScore = count > 0 ? (total / count).toFixed(1) : 0;
  await env.DB.prepare('UPDATE anime SET score = ? WHERE id = ?').bind(avgScore, animeId).run();
}

async function findOrCreateTag(env, name, count) {
  const row = await env.DB.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first();
  if (row) {
    await env.DB.prepare('UPDATE tags SET count = ? WHERE id = ?').bind(count || 0, row.id).run();
    return row.id;
  }
  const { meta } = await env.DB.prepare(
    'INSERT INTO tags (name, count) VALUES (?, ?)'
  ).bind(name, count || 0).run();
  return meta.last_row_id;
}

// ===== AniList 集成 =====

async function searchAniList(title) {
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        title { romaji english native }
        coverImage { large medium }
        description
        episodes
        seasonYear
        status
        genres
        averageScore
        popularity
        characters(sort: ROLE, perPage: 10) {
          nodes {
            id
            name { full native }
            image { medium }
            role
          }
        }
        relations {
          edges {
            relationType
            node {
              id
              title { romaji english }
              type
            }
          }
        }
      }
    }
  `;

  const resp = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { search: title } })
  }).then(r => r.json());

  return resp.data?.Media || null;
}

async function enrichFromAniList(env, localAnimeId, anilistMediaId) {
  const data = await searchAniListById(anilistMediaId);
  if (!data) return;

  // 更新元数据
  const titleJp = data.title?.native || '';
  const coverLarge = data.coverImage?.large || '';
  const summary = (data.description || '').replace(/<[^>]+>/g, '').slice(0, 2000);
  const totalEpisodes = data.episodes || 0;
  const anilistScore = data.averageScore ? data.averageScore / 10 : 0;

  await env.DB.prepare(
    `UPDATE anime SET title_jp = ?, cover_large_url = COALESCE(NULLIF(cover_large_url, ''), ?),
     summary = COALESCE(NULLIF(summary, ''), ?), total_episodes = CASE WHEN total_episodes = 0 THEN ? ELSE total_episodes END,
     is_airing = ? WHERE id = ?`
  ).bind(
    titleJp, coverLarge, summary, totalEpisodes,
    data.status === 'RELEASING' ? 1 : 0, localAnimeId
  ).run();

  // 角色 & 声优
  for (const char of (data.characters?.nodes || [])) {
    const charId = await upsertCharacter(env, char);
    await env.DB.prepare(
      'INSERT OR IGNORE INTO anime_characters (anime_id, character_id, is_main, role) VALUES (?, ?, ?, ?)'
    ).bind(localAnimeId, charId, char.role === 'MAIN' ? 1 : 0, char.role || '').run();

    // 声优（取第一个日语 VA）
    const va = (char.voiceActors || []).find(v => v.language === 'Japanese');
    if (va) {
      const vaId = await upsertVoiceActor(env, va);
      await env.DB.prepare(
        'UPDATE anime_characters SET va_id = ? WHERE anime_id = ? AND character_id = ?'
      ).bind(vaId, localAnimeId, charId).run();
    }
  }

  // 关联作品
  for (const edge of (data.relations?.edges || [])) {
    if (edge.node?.type === 'ANIME' && edge.relationType !== 'CHARACTER') {
      const relId = edge.node.id;
      // 查找本地是否已有该 AniList ID
      const localRel = await env.DB.prepare(
        'SELECT id FROM anime WHERE anilist_id = ?'
      ).bind(relId).first();

      if (localRel) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO related_anime (anime_id, related_id, relation_type) VALUES (?, ?, ?)'
        ).bind(localAnimeId, localRel.id, edge.relationType).run();
      }
    }
  }
}

async function searchAniListById(id) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        title { romaji english native }
        coverImage { large }
        description
        episodes
        status
        averageScore
        characters(sort: ROLE, perPage: 10) {
          nodes {
            id
            name { full native }
            image { medium }
            role
            voiceActors(language: JAPANESE) {
              id
              name { full native }
              image { medium }
              language
            }
          }
        }
        relations {
          edges {
            relationType
            node { id title { romaji english } type }
          }
        }
      }
    }
  `;

  const resp = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id } })
  }).then(r => r.json());

  return resp.data?.Media || null;
}

async function upsertCharacter(env, char) {
  const anilistId = char.id;
  const existing = await env.DB.prepare('SELECT id FROM characters WHERE anilist_id = ?').bind(anilistId).first();
  if (existing) {
    await env.DB.prepare(
      'UPDATE characters SET name = ?, name_jp = ?, image_url = ? WHERE id = ?'
    ).bind(char.name?.full || '', char.name?.native || '', char.image?.medium || '', existing.id).run();
    return existing.id;
  }
  const { meta } = await env.DB.prepare(
    'INSERT INTO characters (name, name_jp, image_url, anilist_id) VALUES (?, ?, ?, ?)'
  ).bind(char.name?.full || '', char.name?.native || '', char.image?.medium || '', anilistId).run();
  return meta.last_row_id;
}

async function upsertVoiceActor(env, va) {
  const anilistId = va.id;
  const existing = await env.DB.prepare('SELECT id FROM voice_actors WHERE anilist_id = ?').bind(anilistId).first();
  if (existing) {
    await env.DB.prepare(
      'UPDATE voice_actors SET name = ?, name_jp = ?, image_url = ? WHERE id = ?'
    ).bind(va.name?.full || '', va.name?.native || '', va.image?.medium || '', existing.id).run();
    return existing.id;
  }
  const { meta } = await env.DB.prepare(
    'INSERT INTO voice_actors (name, name_jp, image_url, anilist_id) VALUES (?, ?, ?, ?)'
  ).bind(va.name?.full || '', va.name?.native || '', va.image?.medium || '', anilistId).run();
  return meta.last_row_id;
}

// ===== 同步日志 =====

async function startLog(env, task) {
  const { meta } = await env.DB.prepare(
    'INSERT INTO sync_log (task, status) VALUES (?, ?)'
  ).bind(task, 'running').run();
  return meta.last_row_id;
}

async function finishLog(env, id, status, records, error) {
  await env.DB.prepare(
    'UPDATE sync_log SET finished_at = datetime(\'now\'), status = ?, records_affected = ?, error = ? WHERE id = ?'
  ).bind(status, records || 0, error || '', id).run();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
