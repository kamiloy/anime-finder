// FanJi 前端 bundle 构建 — esbuild
// 当前 Phase 1：只 bundle community 5 个文件到 community.bundle.js
// Phase 2 会扩展：拆 index.html 内联 JS 进 src/，加更多 entry
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const isProd = process.argv.includes('--prod');

await mkdir(resolve(root, 'community'), { recursive: true });

const sharedOpts = {
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  minify: isProd,
  sourcemap: isProd ? false : 'inline',
  logLevel: 'info',
};

// 主代码 bundle（原 index.html inline JS 抽出）
await build({
  ...sharedOpts,
  entryPoints: [resolve(root, 'src/main.ts')],
  outfile: resolve(root, 'main.bundle.js'),
});

// 社区 bundle（注册/登录/评论/关注/feed）
await build({
  ...sharedOpts,
  entryPoints: [resolve(root, 'src/community/main.ts')],
  outfile: resolve(root, 'community/main.bundle.js'),
});

console.log(`[build] main.bundle.js + community/main.bundle.js (${isProd ? 'prod' : 'dev'})`);
