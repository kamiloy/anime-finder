// FanJi Seed Script — 本地运行，从 Bangumi 拉取数据并写入 D1
// 用法: node seed.js [--resume]
// 需要先部署 API Worker 并设置 WRANGLER_TOML 路径

const fs = require('fs');
const path = require('path');

const BANGUMI_SEARCH = 'https://api.bgm.tv/v0/search/subjects';
const BANGUMI_SUBJECT = 'https://api.bgm.tv/v0/subjects';
const BANGUMI_CALENDAR = 'https://api.bgm.tv/calendar';
const PAGE = 50;
const TOTAL = 2000;
const BATCH_SLEEP_MS = 1500; // 每页之间的延迟

const CHECKPOINT_FILE = path.join(__dirname, 'seed-checkpoint.json');
const SQL_FILE = path.join(__dirname, 'seed-data.sql');
const TAG_SQL_FILE = path.join(__dirname, 'seed-tags.sql');
const CALENDAR_SQL_FILE = path.join(__dirname, 'seed-calendar.sql');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function esc(str) {
  if (!str) return "''";
  return "'" + String(str).replace(/'/g, "''").replace(/\n/g, ' ').replace(/\r/g, '') + "'";
}

async function fetchJSON(url, opts = {}) {
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

// ===== 主流程 =====
async function main() {
  const resume = process.argv.includes('--resume');
  let startOffset = 0;
  let animeList = [];

  if (resume && fs.existsSync(CHECKPOINT_FILE)) {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    startOffset = cp.offset || 0;
    animeList = cp.animeList || [];
    console.log(`Resuming from offset ${startOffset}, ${animeList.length} anime cached`);
  }

  // Phase 1: 拉取番剧列表
  console.log('=== Phase 1: Fetching anime list ===');
  for (let offset = startOffset; offset < TOTAL; offset += PAGE) {
    try {
      console.log(`Fetching offset ${offset}/${TOTAL}...`);
      const data = await fetchJSON(`${BANGUMI_SEARCH}?limit=${PAGE}&offset=${offset}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: '', sort: 'rank', filter: { type: [2] } })
      });

      for (const item of (data.data || [])) {
        // 拉取详情
        let detail = null;
        try {
          detail = await fetchJSON(`${BANGUMI_SUBJECT}/${item.id}`);
          await sleep(300);
        } catch (e) {
          console.log(`  Detail fetch failed for ${item.id}: ${e.message}`);
        }

        animeList.push({
          bangumi_id: item.id,
          title: item.name,
          title_cn: item.name_cn || '',
          cover_url: (item.images?.common || '').replace(/^http:/, 'https:'),
          cover_large_url: (detail?.images?.large || '').replace(/^http:/, 'https:'),
          summary: detail?.summary || '',
          total_episodes: detail?.eps || detail?.total_episodes || item.eps || 0,
          air_date: item.date || '',
          air_weekday: detail?.air_weekday || -1,
          is_airing: item.airing ? 1 : 0,
          platform: detail?.platform || '',
          score: item.score || 0,
          rank: item.rank || 0,
          tags: (item.tags || []).map(t => ({ name: t.name, count: t.count || 0 })),
          rating: detail?.rating || null
        });
      }

      // 保存 checkpoint
      fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ offset: offset + PAGE, animeList }));
      console.log(`  Progress: ${animeList.length} anime (checkpoint saved)`);

      await sleep(BATCH_SLEEP_MS);
    } catch (e) {
      console.error(`Error at offset ${offset}: ${e.message}`);
      console.log('Checkpoint saved. Run again with --resume to continue.');
      process.exit(1);
    }
  }

  console.log(`\nFetched ${animeList.length} anime total.`);

  // Phase 2: 生成 SQL
  console.log('\n=== Phase 2: Generating SQL ===');

  // 收集所有标签
  const tagMap = new Map();
  for (const a of animeList) {
    for (const t of a.tags) {
      if (!tagMap.has(t.name)) tagMap.set(t.name, t.count);
      else tagMap.set(t.name, Math.max(tagMap.get(t.name), t.count));
    }
  }

  // anime 表 SQL
  let sql = '-- FanJi Seed Data\n';
  sql += '-- Generated: ' + new Date().toISOString() + '\n\n';
  sql += 'BEGIN TRANSACTION;\n\n';

  for (const a of animeList) {
    sql += `INSERT OR IGNORE INTO anime (title, title_cn, summary, cover_url, cover_large_url, bangumi_id, total_episodes, air_date, air_weekday, is_airing, platform, score, rank)
VALUES (${esc(a.title)}, ${esc(a.title_cn)}, ${esc(a.summary)}, ${esc(a.cover_url)}, ${esc(a.cover_large_url)}, ${a.bangumi_id}, ${a.total_episodes}, ${esc(a.air_date)}, ${a.air_weekday}, ${a.is_airing}, ${esc(a.platform)}, ${a.score}, ${a.rank});\n`;
  }

  sql += '\nCOMMIT;\n';
  fs.writeFileSync(SQL_FILE, sql);
  console.log(`Written ${SQL_FILE} (${animeList.length} rows)`);

  // 标签 SQL（需要在 anime 数据导入后运行，因为需要 anime.bangumi_id 来关联）
  let tagSql = '-- FanJi Seed Tags\n';
  tagSql += '-- Run this AFTER seed-data.sql\n\n';
  tagSql += 'BEGIN TRANSACTION;\n\n';

  for (const [name, count] of tagMap) {
    tagSql += `INSERT OR IGNORE INTO tags (name, count) VALUES (${esc(name)}, ${count});\n`;
  }

  tagSql += '\n-- anime_tags associations\n';
  for (const a of animeList) {
    for (const t of a.tags) {
      tagSql += `INSERT OR IGNORE INTO anime_tags (anime_id, tag_id)
SELECT a.id, t.id FROM anime a, tags t
WHERE a.bangumi_id = ${a.bangumi_id} AND t.name = ${esc(t.name)};\n`;
    }
  }
  tagSql += '\nCOMMIT;\n';
  fs.writeFileSync(TAG_SQL_FILE, tagSql);
  console.log(`Written ${TAG_SQL_FILE} (${tagMap.size} tags)`);

  // 评分 SQL
  let ratingSql = '-- FanJi Seed Ratings\n';
  ratingSql += '-- Run this AFTER seed-data.sql\n\n';
  ratingSql += 'BEGIN TRANSACTION;\n\n';

  for (const a of animeList) {
    if (!a.rating || !a.rating.count) continue;
    const c = a.rating.count || {};
    const total = Object.entries(c).reduce((sum, [k, v]) => sum + (parseInt(k) * (v || 0)), 0);
    const count = Object.values(c).reduce((s, v) => s + (v || 0), 0);
    ratingSql += `INSERT OR REPLACE INTO rating_counts (anime_id, score_10, score_9, score_8, score_7, score_6, score_5, score_4, score_3, score_2, score_1, total_score, total_count)
SELECT id, ${c[10] || 0}, ${c[9] || 0}, ${c[8] || 0}, ${c[7] || 0}, ${c[6] || 0}, ${c[5] || 0}, ${c[4] || 0}, ${c[3] || 0}, ${c[2] || 0}, ${c[1] || 0}, ${total}, ${count}
FROM anime WHERE bangumi_id = ${a.bangumi_id};\n`;
  }
  ratingSql += '\nCOMMIT;\n';
  fs.writeFileSync(path.join(__dirname, 'seed-ratings.sql'), ratingSql);
  console.log(`Written seed-ratings.sql`);

  // Phase 3: 拉取新番时间表
  console.log('\n=== Phase 3: Fetching calendar ===');
  try {
    const cal = await fetchJSON(BANGUMI_CALENDAR);
    let calSql = '-- FanJi Seed Calendar\n';
    calSql += 'BEGIN TRANSACTION;\n\n';

    if (Array.isArray(cal)) {
      for (const dayItems of cal) {
        const weekday = cal.indexOf(dayItems);
        for (const item of (dayItems.items || [])) {
          calSql += `INSERT OR IGNORE INTO calendar_entries (anime_id, weekday, sort_order)
SELECT id, ${weekday}, ${item.rank || 0} FROM anime WHERE bangumi_id = ${item.id};\n`;
        }
      }
    }
    calSql += '\nCOMMIT;\n';
    fs.writeFileSync(CALENDAR_SQL_FILE, calSql);
    console.log(`Written ${CALENDAR_SQL_FILE}`);
  } catch (e) {
    console.error(`Calendar fetch failed: ${e.message}`);
  }

  console.log('\n=== Done! ===');
  console.log('Import order:');
  console.log(`  1. npx wrangler d1 execute fanji-db --remote --file=seed-data.sql`);
  console.log(`  2. npx wrangler d1 execute fanji-db --remote --file=seed-tags.sql`);
  console.log(`  3. npx wrangler d1 execute fanji-db --remote --file=seed-ratings.sql`);
  console.log(`  4. npx wrangler d1 execute fanji-db --remote --file=seed-calendar.sql`);
}

main().catch(e => { console.error(e); process.exit(1); });
