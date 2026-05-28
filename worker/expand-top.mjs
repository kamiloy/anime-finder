// FanJi Expand-Top — 按全局 rank 抓 Bangumi 顶级番，补齐缺失热门番
// 用法: node expand-top.mjs   (需 CLOUDFLARE_API_TOKEN 用于去重查询)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA = 'fanji-finder/1.0 (https://github.com/kamiloy/anime-finder)';
const SEARCH = 'https://api.bgm.tv/v0/search/subjects';
const SUBJECT = 'https://api.bgm.tv/v0/subjects';
const PAGE = 50;
const MAX_OFFSET = 1500;     // 全局 rank 前 ~1500
const PAGE_SLEEP = 400;
const DETAIL_SLEEP = 200;    // 每个 worker 内的请求间隔
const CONC = 5;              // 详情抓取并发数（连接池）
const EXPLICIT_IDS = [183878, 329906, 328609]; // 紫罗兰永恒花园 / 间谍过家家 / 孤独摇滚 保险

const sleep = ms => new Promise(r => setTimeout(r, ms));
function esc(s) { if (!s) return "''"; return "'" + String(s).replace(/'/g, "''").replace(/\n/g, ' ').replace(/\r/g, '') + "'"; }
async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, 'Accept': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
function getExistingIds() {
  try {
    const out = execSync('npx wrangler d1 execute fanji-db --remote --command "SELECT bangumi_id FROM anime WHERE bangumi_id IS NOT NULL" --json', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    const data = JSON.parse(out); const ids = new Set();
    for (const row of (data[0]?.results || [])) if (row.bangumi_id) ids.add(row.bangumi_id);
    console.log(`Existing in D1: ${ids.size}`); return ids;
  } catch (e) { console.log('getExistingIds FAILED (abort to avoid huge refetch):', e.message); process.exit(1); }
}

async function main() {
  const existing = getExistingIds();
  const candidateIds = new Set(EXPLICIT_IDS);
  // Bangumi v0 search 每页实际只回 ~20 条（无视 limit），必须按实际返回数递进 offset，否则跳页漏番
  let offset = 0;
  while (offset <= MAX_OFFSET) {
    let d;
    try {
      d = await fetchJSON(`${SEARCH}?limit=${PAGE}&offset=${offset}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort: 'rank', filter: { type: [2], rank: ['>0'] } })
      });
    } catch (e) { console.log(`search offset ${offset} err: ${e.message}`); break; }
    if (!d.data || !d.data.length) { console.log(`no more at offset ${offset}`); break; }
    for (const it of d.data) candidateIds.add(it.id);
    offset += d.data.length;
    console.log(`offset->${offset}: +${d.data.length} (candidates ${candidateIds.size})`);
    await sleep(PAGE_SLEEP);
  }
  const newIds = [...candidateIds].filter(id => !existing.has(id));
  console.log(`Candidates ${candidateIds.size}, NEW (not in D1): ${newIds.length}`);

  const newAnime = [];
  let done = 0;
  const queue = [...newIds];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      let det;
      try { det = await fetchJSON(`${SUBJECT}/${id}`); }
      catch (e) { done++; console.log(`  detail ${id} err: ${e.message}`); await sleep(DETAIL_SLEEP); continue; }
      const rating = det.rating || null;
      newAnime.push({
        bangumi_id: id,
        title: det.name || '',
        title_cn: det.name_cn || '',
        cover_url: (det.images?.common || '').replace(/^http:/, 'https:'),
        cover_large_url: (det.images?.large || '').replace(/^http:/, 'https:'),
        summary: det.summary || '',
        total_episodes: det.total_episodes || det.eps || 0,
        air_date: det.date || '',
        air_weekday: -1,
        is_airing: 0,
        platform: det.platform || '',
        score: rating?.score || 0,
        rank: rating?.rank || det.rank || 0,
        tags: (det.tags || []).map(t => ({ name: t.name, count: t.count || 0 })),
        rating
      });
      done++;
      if (done % 50 === 0) console.log(`  [${done}/${newIds.length}] + ${det.name_cn || det.name} (rank ${rating?.rank || 0})`);
      await sleep(DETAIL_SLEEP);
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  console.log(`\nFetched detail for ${newAnime.length} new anime.`);
  if (!newAnime.length) { console.log('Nothing new. Done.'); return; }

  // anime SQL
  let sql = `-- FanJi Expand-Top Data\n-- ${new Date().toISOString()}\n-- ${newAnime.length} new anime rows\n\n`;
  for (const a of newAnime) {
    sql += `INSERT OR IGNORE INTO anime (title, title_cn, summary, cover_url, cover_large_url, bangumi_id, total_episodes, air_date, air_weekday, is_airing, platform, score, rank)
VALUES (${esc(a.title)}, ${esc(a.title_cn)}, ${esc(a.summary)}, ${esc(a.cover_url)}, ${esc(a.cover_large_url)}, ${a.bangumi_id}, ${a.total_episodes}, ${esc(a.air_date)}, ${a.air_weekday}, ${a.is_airing}, ${esc(a.platform)}, ${a.score}, ${a.rank});\n`;
  }
  fs.writeFileSync(path.join(__dirname, 'expand-top-data.sql'), sql);

  // tags SQL
  const tagMap = new Map();
  for (const a of newAnime) for (const t of a.tags) tagMap.set(t.name, Math.max(tagMap.get(t.name) || 0, t.count));
  let tagSql = '-- FanJi Expand-Top Tags (run AFTER data)\n\n';
  for (const [name, count] of tagMap) tagSql += `INSERT OR IGNORE INTO tags (name, count) VALUES (${esc(name)}, ${count});\n`;
  tagSql += '\n-- anime_tags\n';
  for (const a of newAnime) for (const t of a.tags) tagSql += `INSERT OR IGNORE INTO anime_tags (anime_id, tag_id) SELECT a.id, t.id FROM anime a, tags t WHERE a.bangumi_id = ${a.bangumi_id} AND t.name = ${esc(t.name)};\n`;
  fs.writeFileSync(path.join(__dirname, 'expand-top-tags.sql'), tagSql);

  // ratings SQL
  let ratingSql = '-- FanJi Expand-Top Ratings (run AFTER data)\n\n';
  let rc = 0;
  for (const a of newAnime) {
    if (!a.rating || !a.rating.count) continue;
    const c = a.rating.count || {};
    const total = Object.entries(c).reduce((s, [k, v]) => s + (parseInt(k) * (v || 0)), 0);
    const count = Object.values(c).reduce((s, v) => s + (v || 0), 0);
    ratingSql += `INSERT OR REPLACE INTO rating_counts (anime_id, score_10, score_9, score_8, score_7, score_6, score_5, score_4, score_3, score_2, score_1, total_score, total_count) SELECT id, ${c[10] || 0}, ${c[9] || 0}, ${c[8] || 0}, ${c[7] || 0}, ${c[6] || 0}, ${c[5] || 0}, ${c[4] || 0}, ${c[3] || 0}, ${c[2] || 0}, ${c[1] || 0}, ${total}, ${count} FROM anime WHERE bangumi_id = ${a.bangumi_id};\n`;
    rc++;
  }
  fs.writeFileSync(path.join(__dirname, 'expand-top-ratings.sql'), ratingSql);

  console.log(`Written expand-top-data.sql (${newAnime.length}), expand-top-tags.sql (${tagMap.size}), expand-top-ratings.sql (${rc}).`);
}
main().catch(e => { console.error(e); process.exit(1); });
