import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const ss = (page, name) => page.screenshot({ path: `test-${name}.png`, fullPage: false });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // iPhone 14 size
const page = await ctx.newPage();
const errors = [];
page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text());
  if (m.type() === 'warning') console.log('  [warn]', m.text());
});
page.on('pageerror', e => errors.push(e.message));
page.on('requestfailed', r => console.log('  [reqfail]', r.url(), r.failure()?.errorText));
page.on('response', r => { if (r.url().includes('bgm.tv')) console.log('  [bgm]', r.status(), r.url().slice(0,80)); });

console.log('▶ 1. 加载首页（新番视图）');
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
await ss(page, '1-schedule');

console.log('▶ 2. 切换到热门');
await page.click('[data-view="hot"]');
await ss(page, '2-loading'); // 立即截图看加载状态
try {
  await page.waitForSelector('#hotGrid .card', { timeout: 20000 });
} catch(e) {
  await ss(page, '2-timeout');
  const hotHtml = await page.locator('#hotGrid').innerHTML();
  console.log('  hotGrid 内容:', hotHtml.slice(0, 300));
  throw e;
}
await ss(page, '2-hot');
const cardCount = await page.locator('#hotGrid .card').count();
console.log(`   卡片数量: ${cardCount}`);

console.log('▶ 3. 搜索「进击的巨人」');
await page.fill('#searchInput', '进击的巨人');
await page.keyboard.press('Enter');
await page.waitForSelector('#hotGrid .card', { timeout: 20000 });
await ss(page, '3-search');
const searchCount = await page.locator('#hotGrid .card').count();
console.log(`   搜索结果: ${searchCount} 张卡片`);

console.log('▶ 4. 点开第一张卡片（详情抽屉）');
await page.locator('#hotGrid .card').first().click();
await page.waitForSelector('.drawer-bg.open', { timeout: 8000 });
await page.waitForSelector('.drawer-title', { timeout: 8000 });
const title = await page.locator('.drawer-title').textContent();
console.log(`   详情标题: ${title}`);
await ss(page, '4-drawer');

console.log('▶ 5. 验证观看渠道按钮');
const watchBtns = await page.locator('.watch-btn').count();
console.log(`   渠道按钮数量: ${watchBtns}`);
const btnLabels = await page.locator('.watch-btn').allTextContents();
console.log(`   渠道: ${btnLabels.map(s => s.trim()).join(' | ')}`);

console.log('▶ 6. 收藏该番剧');
await page.click('#drawerFavBtn');
await page.waitForSelector('.toast.show', { timeout: 3000 });
const toast = await page.locator('.toast').textContent();
console.log(`   Toast: ${toast}`);
await ss(page, '5-fav');

console.log('▶ 7. 关闭抽屉，切换到排行榜');
await page.click('#drawerClose');
await page.click('[data-view="ranking"]');
await page.waitForSelector('#rankGrid .card', { timeout: 15000 });
const rankCards = await page.locator('#rankGrid .card').count();
console.log(`   排行榜卡片: ${rankCards}`);
await ss(page, '6-ranking');

console.log('▶ 8. 切换到收藏页');
await page.click('[data-view="favorites"]');
await page.waitForSelector('#favGrid .card', { timeout: 5000 });
const favCount = await page.locator('#favGrid .card').count();
console.log(`   收藏数量: ${favCount}`);
await ss(page, '7-favorites');

await browser.close();

console.log('\n========== 测试结果 ==========');
if (errors.length) {
  console.log('❌ 控制台错误:');
  errors.forEach(e => console.log('  ', e));
} else {
  console.log('✅ 无 JS 错误');
}
console.log('✅ 截图已保存: test-*.png');
