// FanJi Expand Script — 分年抓取 Bangumi 番剧，扩充 D1 数据库
// 用法: node expand.js [--resume] [--dry-run]
// 需要设置 CLOUDFLARE_API_TOKEN 环境变量

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BANGUMI_SEARCH = 'https://api.bgm.tv/v0/search/subjects';
const BANGUMI_SUBJECT = 'https://api.bgm.tv/v0/subjects';
const PAGE = 50;
const MAX_PAGES = 8;           // 每年最多抓取 400 条
const BATCH_SLEEP_MS = 1500;
const DETAIL_SLEEP_MS = 300;
const START_YEAR = 2026;
const END_YEAR = 2000;

const CHECKPOINT_FILE = path.join(__dirname, 'expand-checkpoint.json');
const SQL_FILE = path.join(__dirname, 'expand-data.sql');
const TAG_SQL_FILE = path.join(__dirname, 'expand-tags.sql');
const RATING_SQL_FILE = path.join(__dirname, 'expand-ratings.sql');

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

function getExistingIds() {
  // 从 D1 查询已有 bangumi_id
  try {
    const result = execSync(
      'npx wrangler d1 execute fanji-db --remote --command "SELECT bangumi_id FROM anime WHERE bangumi_id IS NOT NULL" --json',
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    );
    const data = JSON.parse(result);
    const ids = new Set();
    for (const row of (data[0]?.results || [])) {
      if (row.bangumi_id) ids.add(row.bangumi_id);
    }
    console.log(`Found ${ids.size} existing anime in D1`);
    return ids;
  } catch (e) {
    console.log('Could not query D1, will dedupe locally only. Error:', e.message);
    return new Set();
  }
}

async function main() {
  const resume = process.argv.includes('--resume');
  const dryRun = process.argv.includes('--dry-run');

  let startYear = START_YEAR;
  let startOffset = 0;
  let existingIds = new Set();
  let newAnime = [];
  let totalFetched = 0;

  if (resume && fs.existsSync(CHECKPOINT_FILE)) {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    startYear = cp.nextYear ?? START_YEAR;
    startOffset = cp.nextOffset ?? 0;
    existingIds = new Set(cp.existingIds || []);
    newAnime = cp.newAnime || [];
    totalFetched = cp.totalFetched || 0;
    console.log(`Resuming from year ${startYear}, offset ${startOffset}, ${newAnime.length} new anime cached`);
  } else {
    existingIds = getExistingIds();
  }

  if (dryRun) {
    console.log('\n=== DRY RUN: counting only, no SQL generation ===\n');
  }

  // Phase 1: 分年抓取
  console.log('=== Phase 1: Year-by-year fetch ===');

  for (let year = startYear; year >= END_YEAR; year--) {
    const yearStart = year === startYear ? startOffset : 0;
    let yearCount = 0;

    console.log(`\n--- Year ${year} ---`);

    for (let offset = yearStart; offset < MAX_PAGES * PAGE; offset += PAGE) {
      let data;
      try {
        console.log(`  offset ${offset}...`);
        data = await fetchJSON(`${BANGUMI_SEARCH}?limit=${PAGE}&offset=${offset}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword: '',
            sort: 'rank',
            filter: {
              type: [2],
              air_date: [`>=${year}-01-01`, `<=${year}-12-31`]
            }
          })
        });
      } catch (e) {
        console.log(`  Search error: ${e.message}`);
        break;
      }

      if (!data.data || !data.data.length) {
        console.log(`  No more results for ${year}`);
        break;
      }

      for (const item of data.data) {
        totalFetched++;

        if (existingIds.has(item.id)) {
          // 跳过已存在但输出进度
          if (totalFetched % 100 === 0) console.log(`  ... scanned ${totalFetched} (${newAnime.length} new)`);
          continue;
        }

        existingIds.add(item.id);

        if (dryRun) {
          yearCount++;
          continue;
        }

        // 拉取详情
        let detail = null;
        try {
          detail = await fetchJSON(`${BANGUMI_SUBJECT}/${item.id}`);
          await sleep(DETAIL_SLEEP_MS);
        } catch (e) {
          console.log(`  Detail fetch failed for ${item.id}: ${e.message}`);
        }

        const anime = {
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
        };

        newAnime.push(anime);
        yearCount++;
      }

      // 每页保存 checkpoint
      const nextOffset = offset + PAGE;
      const nextYear = nextOffset >= MAX_PAGES * PAGE ? year - 1 : year;
      fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({
        nextYear,
        nextOffset: nextOffset >= MAX_PAGES * PAGE ? 0 : nextOffset,
        existingIds: [...existingIds],
        newAnime,
        totalFetched
      }));
      console.log(`  Year ${year}: ${yearCount} new (checkpoint @ ${path.basename(CHECKPOINT_FILE)})`);

      await sleep(BATCH_SLEEP_MS);
    }

    console.log(`  Year ${year} done: ${yearCount} new anime`);
  }

  console.log(`\nScanned ${totalFetched} total, found ${newAnime.length} new anime.`);

  if (dryRun) {
    console.log('[DRY RUN] No files written. Run without --dry-run to generate SQL.');
    return;
  }

  if (!newAnime.length) {
    console.log('No new anime to add. Done!');
    return;
  }

  // Phase 2: 生成 SQL
  console.log('\n=== Phase 2: Generating SQL ===');

  // 收集标签
  const tagMap = new Map();
  for (const a of newAnime) {
    for (const t of a.tags) {
      if (!tagMap.has(t.name)) tagMap.set(t.name, t.count);
      else tagMap.set(t.name, Math.max(tagMap.get(t.name), t.count));
    }
  }

  // anime 表 SQL (无 BEGIN/COMMIT，wrangler 不支持)
  let sql = '-- FanJi Expand Data\n';
  sql += `-- Generated: ${new Date().toISOString()}\n`;
  sql += `-- ${newAnime.length} new anime rows\n\n`;

  for (const a of newAnime) {
    sql += `INSERT OR IGNORE INTO anime (title, title_cn, summary, cover_url, cover_large_url, bangumi_id, total_episodes, air_date, air_weekday, is_airing, platform, score, rank)
VALUES (${esc(a.title)}, ${esc(a.title_cn)}, ${esc(a.summary)}, ${esc(a.cover_url)}, ${esc(a.cover_large_url)}, ${a.bangumi_id}, ${a.total_episodes}, ${esc(a.air_date)}, ${a.air_weekday}, ${a.is_airing}, ${esc(a.platform)}, ${a.score}, ${a.rank});\n`;
  }

  fs.writeFileSync(SQL_FILE, sql);
  console.log(`Written ${SQL_FILE} (${newAnime.length} rows)`);

  // 标签 SQL
  let tagSql = '-- FanJi Expand Tags\n';
  tagSql += '-- Run this AFTER expand-data.sql\n\n';

  for (const [name, count] of tagMap) {
    tagSql += `INSERT OR IGNORE INTO tags (name, count) VALUES (${esc(name)}, ${count});\n`;
  }

  tagSql += '\n-- anime_tags associations\n';
  for (const a of newAnime) {
    for (const t of a.tags) {
      tagSql += `INSERT OR IGNORE INTO anime_tags (anime_id, tag_id)
SELECT a.id, t.id FROM anime a, tags t
WHERE a.bangumi_id = ${a.bangumi_id} AND t.name = ${esc(t.name)};\n`;
    }
  }
  fs.writeFileSync(TAG_SQL_FILE, tagSql);
  console.log(`Written ${TAG_SQL_FILE} (${tagMap.size} tags)`);

  // 评分 SQL
  let ratingSql = '-- FanJi Expand Ratings\n';
  ratingSql += '-- Run this AFTER expand-data.sql\n\n';
  let ratingCount = 0;

  for (const a of newAnime) {
    if (!a.rating || !a.rating.count) continue;
    const c = a.rating.count || {};
    const total = Object.entries(c).reduce((sum, [k, v]) => sum + (parseInt(k) * (v || 0)), 0);
    const count = Object.values(c).reduce((s, v) => s + (v || 0), 0);
    ratingSql += `INSERT OR REPLACE INTO rating_counts (anime_id, score_10, score_9, score_8, score_7, score_6, score_5, score_4, score_3, score_2, score_1, total_score, total_count)
SELECT id, ${c[10] || 0}, ${c[9] || 0}, ${c[8] || 0}, ${c[7] || 0}, ${c[6] || 0}, ${c[5] || 0}, ${c[4] || 0}, ${c[3] || 0}, ${c[2] || 0}, ${c[1] || 0}, ${total}, ${count}
FROM anime WHERE bangumi_id = ${a.bangumi_id};\n`;
    ratingCount++;
  }
  fs.writeFileSync(RATING_SQL_FILE, ratingSql);
  console.log(`Written ${RATING_SQL_FILE} (${ratingCount} ratings)`);

  console.log('\n=== Done! ===');
  console.log('Import commands:');
  console.log(`  1. npx wrangler d1 execute fanji-db --remote --file=expand-data.sql`);
  console.log(`  2. npx wrangler d1 execute fanji-db --remote --file=expand-tags.sql`);
  console.log(`  3. npx wrangler d1 execute fanji-db --remote --file=expand-ratings.sql`);
  console.log('\nAfter import, refresh scores and ranks:');
  console.log(`  4. npx wrangler d1 execute fanji-db --remote --command="UPDATE anime SET score = (SELECT CAST(total_score AS REAL) / total_count FROM rating_counts WHERE rating_counts.anime_id = anime.id AND total_count > 0) WHERE EXISTS (SELECT 1 FROM rating_counts WHERE rating_counts.anime_id = anime.id AND total_count > 0)"`);
  console.log(`  5. npx wrangler d1 execute fanji-db --remote --command="UPDATE anime SET rank = (SELECT COUNT(*)+1 FROM anime a2 WHERE a2.score > anime.score OR (a2.score = anime.score AND a2.id < anime.id))"`);
}

main().catch(e => { console.error(e); process.exit(1); });
