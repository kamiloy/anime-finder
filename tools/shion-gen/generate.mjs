// 紫音锐评 + 情绪标签 · 预生成脚本（验证 / 全量 / 写库）
// 用法:
//   node generate.mjs 10        小批量取高分番 10 部
//   node generate.mjs curated   经典番验证集
//   node generate.mjs all       全量(分页取全部番)
// AI:  智谱 GLM glm-4-flash (免费); key: env.GLM_API_KEY 或 ds-vision-proxy/config.json
// 产出: progress.json (断点续传, source of truth) + update-shion.sql (导入 D1)

import fs from 'node:fs';
import path from 'node:path';

const API_BASE = 'https://fanji-api.pages.dev';
const GLM_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const GLM_MODEL = 'glm-4-flash';
const DIR = import.meta.dirname;
const PERSONA = fs.readFileSync(path.join(DIR, 'persona.md'), 'utf8');
const MOODS_OK = ['致郁', '治愈', '下饭', '燃', '甜', '沙雕', 'EMO后劲', '名场面', '烧脑'];
const PROGRESS_PATH = path.join(DIR, 'progress.json');
const SQL_PATH = path.join(DIR, 'update-shion.sql');

function getKey() {
  if (process.env.GLM_API_KEY) return process.env.GLM_API_KEY;
  try { return JSON.parse(fs.readFileSync('C:\\Users\\阿杰\\ds-vision-proxy\\config.json', 'utf8')).vision?.apiKey || null; }
  catch { return null; }
}
const KEY = getKey();
if (!KEY) { console.error('✗ 缺 GLM key: 设 env GLM_API_KEY 或确保 ds-vision-proxy/config.json 有 vision.apiKey'); process.exit(1); }

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// 数据类标签：脚本本地算,不耗 AI
function dataTags(d) {
  const t = [];
  const eps = d.total_episodes || d.eps || 0;
  if (eps > 0 && eps <= 13) t.push('一季完结');
  if (eps >= 40) t.push('长篇大坑');
  if (d.is_airing) t.push('当季新番');
  return t;
}

async function shionReview(d) {
  const tagStr = (d.tags || []).map(t => t.name_cn || t.name).filter(Boolean).slice(0, 12).join('、');
  const score = (d.rating && d.rating.score) || d.score || '暂无';
  const userMsg = `番名《${d.name_cn || d.name}》评分${score} 集数${d.total_episodes || d.eps || '?'} 标签:${tagStr || '无'} 简介:${(d.summary || '').replace(/\s+/g, ' ').slice(0, 400) || '无'}`;
  const res = await fetch(`${GLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: GLM_MODEL, messages: [{ role: 'system', content: PERSONA }, { role: 'user', content: userMsg }], temperature: 0.9, max_tokens: 300 }),
  });
  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content || '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      const moods = (Array.isArray(o.moods) ? o.moods : []).filter(x => MOODS_OK.includes(x));
      return { review: o.review || '', moods };
    } catch {}
  }
  return { review: '', moods: [], bad: raw };
}

const sqlStr = s => "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";

async function collectList(arg) {
  if (arg === 'curated') {
    const CURATED = ['进击的巨人', '钢之炼金术师', 'CLANNAD', '紫罗兰', '约会大作战'];
    const out = [];
    for (const n of CURATED) {
      try { const r = (await getJSON(`${API_BASE}/api/anime/search?q=${encodeURIComponent(n)}&limit=1`)).data || []; if (r[0]) out.push(r[0]); } catch {}
    }
    return out;
  }
  if (arg === 'all') {
    const first = await getJSON(`${API_BASE}/api/anime?sort=heat&page=1&limit=100`);
    const total = first.total || 0;
    const out = [...(first.data || [])];
    const pages = Math.ceil(total / 100);
    for (let p = 2; p <= pages; p++) {
      try { const r = await getJSON(`${API_BASE}/api/anime?sort=heat&page=${p}&limit=100`); out.push(...(r.data || [])); }
      catch (e) { console.log(`  ✗ page ${p}: ${e.message}`); }
      await new Promise(r => setTimeout(r, 150));
    }
    return out;
  }
  const N = parseInt(arg || '20');
  return (await getJSON(`${API_BASE}/api/anime?sort=heat&limit=${N}`)).data || [];
}

// 断点续传：加载已有进度
let progress = {};
if (fs.existsSync(PROGRESS_PATH)) { try { progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); } catch {} }

const arg = process.argv[2] || '20';
const list = await collectList(arg);
console.log(`取到 ${list.length} 部 (mode=${arg}),已有进度 ${Object.keys(progress).length} 部\n`);

// 详情拉取带重试（应对 CN→CF 偶发 fetch failed）
async function getDetail(id) {
  for (let t = 0; t < 3; t++) {
    try { return (await getJSON(`${API_BASE}/api/anime/${id}`)).data; }
    catch (e) { if (t === 2) throw e; await new Promise(r => setTimeout(r, 600 * (t + 1))); }
  }
}

// 并发 worker 池：共享游标 cursor,单线程下 cursor++ 与 writeFileSync 均原子,不会冲突
const CONC = parseInt(process.env.CONC || '5');
let done = 0, skipped = 0, failed = 0, cursor = 0;
async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= list.length) break;
    const a = list[i];
    if (progress[a.id] && progress[a.id].review) { skipped++; continue; }
    try {
      const d = await getDetail(a.id);
      if (!d) { failed++; continue; }
      const r = await shionReview(d);
      if (!r.review) { failed++; continue; }
      progress[a.id] = { id: a.id, title: d.name_cn || d.name, score: (d.rating && d.rating.score) || d.score, review: r.review, moods: r.moods, dataTags: dataTags(d) };
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8'); // 同步写,单线程原子,断点不丢
      done++;
      if (done % 50 === 0) console.log(`[+${done}] 【${progress[a.id].title}】 ${r.review}  {${r.moods.join('/')}}`);
    } catch (e) { failed++; }
    await new Promise(r => setTimeout(r, 60));
  }
}
console.log(`并发 ${CONC} 路启动...`);
await Promise.all(Array.from({ length: CONC }, () => worker()));

// 从 progress 生成完整 UPDATE SQL（导入 D1 用）
const recs = Object.values(progress).filter(r => r.review);
const sql = recs.map(r => `UPDATE anime SET shion_review=${sqlStr(r.review)}, mood_tags=${sqlStr(JSON.stringify(r.moods || []))} WHERE id=${r.id};`).join('\n') + '\n';
fs.writeFileSync(SQL_PATH, sql, 'utf8');

console.log(`\n完成: 本次新生成 ${done}, 跳过(已有) ${skipped}, 失败 ${failed}`);
console.log(`progress.json 累计 ${recs.length} 部; update-shion.sql 已生成 (${recs.length} 条 UPDATE)`);
