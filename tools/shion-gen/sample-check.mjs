import fs from 'node:fs';
const P = JSON.parse(fs.readFileSync(new URL('./progress.json', import.meta.url), 'utf8'));
const all = Object.values(P).filter(x => x.review);
const MOODS_OK = ['致郁', '治愈', '下饭', '燃', '甜', '沙雕', 'EMO后劲', '名场面', '烧脑'];
const rnd = (arr, n) => { const c = [...arr]; const o = []; while (o.length < n && c.length) o.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return o; };
const sc = x => (typeof x.score === 'number' ? x.score : null);
const show = x => `  · [${sc(x) ?? '无'}] 《${x.title}》${(x.dataTags || []).includes('当季新番') ? ' 🟢新番' : ''}\n      "${x.review}"  {${(x.moods || []).join('/')}}`;

console.log(`\n===== 总览 (${all.length} 条) =====`);
const bands = { '神作≥8.5': 0, '良作7.5-8.5': 0, '中6-7.5': 0, '低<6': 0, '无评分': 0 };
for (const x of all) { const s = sc(x); if (s == null) bands['无评分']++; else if (s >= 8.5) bands['神作≥8.5']++; else if (s >= 7.5) bands['良作7.5-8.5']++; else if (s >= 6) bands['中6-7.5']++; else bands['低<6']++; }
console.log('评分分布:', JSON.stringify(bands));
const airing = all.filter(x => (x.dataTags || []).includes('当季新番'));
console.log('新番(塑料夸高危):', airing.length, '条');

console.log(`\n===== 质量校验 =====`);
const badMood = all.filter(x => (x.moods || []).some(m => !MOODS_OK.includes(m)));
console.log('标签越界(白名单外):', badMood.length, '条', badMood.slice(0, 5).map(x => `${x.title}:${x.moods}`));
const tooShort = all.filter(x => x.review.length < 8);
console.log('过短review(<8字):', tooShort.length, '条', tooShort.slice(0, 5).map(x => `${x.title}:"${x.review}"`));
const noMood = all.filter(x => !x.moods || x.moods.length === 0);
console.log('无情绪标签:', noMood.length, '条');
const praise = /神作|封神|必看|良心|经典之作|无可挑剔|完美|巅峰/;
const mismatch = all.filter(x => sc(x) != null && sc(x) < 5 && praise.test(x.review));
console.log('口碑错配(低分<5却吹捧):', mismatch.length, '条', mismatch.slice(0, 6).map(x => `[${sc(x)}]${x.title}:"${x.review}"`));
// 模板化检测：统计高频开头
const heads = {}; for (const x of all) { const h = x.review.slice(0, 6); heads[h] = (heads[h] || 0) + 1; }
const topHeads = Object.entries(heads).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('高频开头(模板化嫌疑):', topHeads.map(([h, n]) => `"${h}"×${n}`).join('  '));

console.log(`\n===== 高分样本 (≥8.5) =====`);
rnd(all.filter(x => sc(x) >= 8.5), 6).forEach(x => console.log(show(x)));
console.log(`\n===== 中分样本 (6-7.5) =====`);
rnd(all.filter(x => { const s = sc(x); return s >= 6 && s < 7.5; }), 6).forEach(x => console.log(show(x)));
console.log(`\n===== 低分样本 (<5) =====`);
rnd(all.filter(x => sc(x) != null && sc(x) < 5), 6).forEach(x => console.log(show(x)));
console.log(`\n===== 新番样本 (塑料夸高危) =====`);
rnd(airing, 8).forEach(x => console.log(show(x)));
console.log(`\n===== 全量随机样本 =====`);
rnd(all, 10).forEach(x => console.log(show(x)));
