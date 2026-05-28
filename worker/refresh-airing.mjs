// 刷新在播番(is_airing=1)的 score + rating_counts —— 当季番评分随播出累积，库里分数会过时
// 用法: node refresh-airing.mjs   (需 CLOUDFLARE_API_TOKEN)；生成 refresh-airing.sql 后用 wrangler 导入
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA = 'fanji-finder/1.0 (https://github.com/kamiloy/anime-finder)';
const CONC = 5;
const SLEEP = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function bgm(id) {
  const r = await fetch('https://api.bgm.tv/v0/subjects/' + id, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const out = execSync('npx wrangler d1 execute fanji-db --remote --command "SELECT id, bangumi_id FROM anime WHERE is_airing=1 AND bangumi_id IS NOT NULL" --json', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
const rows = JSON.parse(out)[0]?.results || [];
console.log('Airing with bangumi_id:', rows.length);

const updates = [];
const queue = [...rows];
let done = 0;
async function worker() {
  while (queue.length) {
    const { id, bangumi_id } = queue.shift();
    let d;
    try { d = await bgm(bangumi_id); } catch (e) { done++; console.log('  err', bangumi_id, e.message); await sleep(SLEEP); continue; }
    const rating = d.rating || {};
    const score = rating.score || 0;
    const c = rating.count || {};
    const total = Object.entries(c).reduce((s, [k, v]) => s + (parseInt(k) * (v || 0)), 0);
    const count = Object.values(c).reduce((s, v) => s + (v || 0), 0);
    updates.push({ id, score, c, total, count });
    done++;
    if (done % 20 === 0) console.log(`  [${done}/${rows.length}]`);
    await sleep(SLEEP);
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));

let sql = '-- refresh airing score + rating_counts\n';
for (const u of updates) {
  sql += `UPDATE anime SET score=${u.score}, updated_at=datetime('now') WHERE id=${u.id};\n`;
  if (u.count > 0) {
    const c = u.c;
    sql += `INSERT OR REPLACE INTO rating_counts (anime_id, score_10, score_9, score_8, score_7, score_6, score_5, score_4, score_3, score_2, score_1, total_score, total_count) VALUES (${u.id}, ${c[10] || 0}, ${c[9] || 0}, ${c[8] || 0}, ${c[7] || 0}, ${c[6] || 0}, ${c[5] || 0}, ${c[4] || 0}, ${c[3] || 0}, ${c[2] || 0}, ${c[1] || 0}, ${u.total}, ${u.count});\n`;
  }
}
fs.writeFileSync(path.join(__dirname, 'refresh-airing.sql'), sql);
const scored = updates.filter(u => u.score > 0).length;
console.log(`Written refresh-airing.sql: ${updates.length} updates (${scored} with score>0)`);
