// 补丁 5 条敏感风险锐评 + 并发重生成 110 条「童年回忆杀」模板开头
// 用法: node patch-and-regen.mjs
import fs from 'node:fs';
import path from 'node:path';

const API_BASE = 'https://fanji-api.pages.dev';
const GLM_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const GLM_MODEL = 'glm-4-flash';
const DIR = import.meta.dirname;
const PERSONA = fs.readFileSync(path.join(DIR, 'persona.md'), 'utf8');
const ANTI_TPL = '\n\n【本次额外硬性要求】禁止以"童年回忆杀"开头；也不要用"X是X，但…"的句式开场。换一个新鲜、具体的切入点。';
const MOODS_OK = ['致郁', '治愈', '下饭', '燃', '甜', '沙雕', 'EMO后劲', '名场面', '烧脑'];
const PROGRESS_PATH = path.join(DIR, 'progress.json');
const SQL_PATH = path.join(DIR, 'update-shion.sql');

function getKey() {
  if (process.env.GLM_API_KEY) return process.env.GLM_API_KEY;
  try { return JSON.parse(fs.readFileSync('C:\\Users\\阿杰\\ds-vision-proxy\\config.json', 'utf8')).vision?.apiKey || null; } catch { return null; }
}
const KEY = getKey();
if (!KEY) { console.error('✗ 缺 GLM key'); process.exit(1); }

async function getJSON(url) { const res = await fetch(url); if (!res.ok) throw new Error(`${res.status}`); return res.json(); }
async function getDetail(id) { for (let t = 0; t < 3; t++) { try { return (await getJSON(`${API_BASE}/api/anime/${id}`)).data; } catch (e) { if (t === 2) throw e; await new Promise(r => setTimeout(r, 600 * (t + 1))); } } }
function dataTags(d) { const t = []; const eps = d.total_episodes || d.eps || 0; if (eps > 0 && eps <= 13) t.push('一季完结'); if (eps >= 40) t.push('长篇大坑'); if (d.is_airing) t.push('当季新番'); return t; }

async function shionReview(d) {
  const tagStr = (d.tags || []).map(t => t.name_cn || t.name).filter(Boolean).slice(0, 12).join('、');
  const score = (d.rating && d.rating.score) || d.score || '暂无';
  const userMsg = `番名《${d.name_cn || d.name}》评分${score} 集数${d.total_episodes || d.eps || '?'} 标签:${tagStr || '无'} 简介:${(d.summary || '').replace(/\s+/g, ' ').slice(0, 400) || '无'}`;
  const res = await fetch(`${GLM_BASE}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: GLM_MODEL, messages: [{ role: 'system', content: PERSONA + ANTI_TPL }, { role: 'user', content: userMsg }], temperature: 1.0, max_tokens: 300 }),
  });
  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content || '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { const o = JSON.parse(m[0]); const moods = (Array.isArray(o.moods) ? o.moods : []).filter(x => MOODS_OK.includes(x)); return { review: o.review || '', moods }; } catch {} }
  return { review: '', moods: [] };
}

const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));

// ---- ① 手写补丁 5 条（只改 review,保留 moods）----
const PATCHES = {
  2373: '历史题材撑场面，但剧情和节奏都偏平，作画也只算及格，冲立意看看吧。',
  1329: '纪实向题材，立意是有，深度欠点火候，节奏偏闷，更适合当背景音。',
  2596: '立意正经，艺术表现偏弱，说教味有点重，看着容易走神。',
  1415: '题材是正能量，可惜作画和剧情都是硬伤，诚意有余完成度不足。',
  1063: '画面和剧情都偏粗糙，立意大于成片，情怀向观众再斟酌。',
};
let patched = 0;
for (const [id, review] of Object.entries(PATCHES)) {
  if (progress[id] && progress[id].review) { progress[id].review = review; patched++; console.log(`  补丁 [${id}]《${progress[id].title}》→ "${review}"`); }
  else console.log(`  ⚠ ${id} 未找到,跳过`);
}
fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
console.log(`\n① 补丁完成: ${patched} 条\n`);

// ---- ② 并发重生成 110 条「童年回忆杀」开头 ----
const targets = Object.values(progress).filter(x => x.review && x.review.startsWith('童年回忆杀'));
console.log(`② 待重生成(童年回忆杀开头): ${targets.length} 条,并发 5 路...\n`);
const CONC = 5;
let cursor = 0, regen = 0, fail = 0, stillTpl = 0;
async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= targets.length) break;
    const old = targets[i];
    try {
      const d = await getDetail(old.id);
      if (!d) { fail++; continue; }
      const r = await shionReview(d);
      if (!r.review) { fail++; continue; }
      if (r.review.startsWith('童年回忆杀')) stillTpl++;
      progress[old.id].review = r.review;
      progress[old.id].moods = r.moods;
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
      regen++;
      if (regen % 25 === 0) console.log(`  [+${regen}]《${progress[old.id].title}》${r.review}`);
    } catch (e) { fail++; }
    await new Promise(r => setTimeout(r, 60));
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));
console.log(`\n② 重生成完成: ${regen} 条, 失败 ${fail}, 仍以模板开头 ${stillTpl} 条`);

// ---- ③ 重新生成 update-shion.sql ----
const sqlStr = s => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
const recs = Object.values(progress).filter(r => r.review);
const sql = recs.map(r => `UPDATE anime SET shion_review=${sqlStr(r.review)}, mood_tags=${sqlStr(JSON.stringify(r.moods || []))} WHERE id=${r.id};`).join('\n') + '\n';
fs.writeFileSync(SQL_PATH, sql, 'utf8');
console.log(`\n③ update-shion.sql 已重新生成 (${recs.length} 条 UPDATE)`);
