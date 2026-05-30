// @ts-nocheck
// 紫音今日钦点 hero 招牌入场动效
// 触发：renderHeroFeature 渲染完毕、el.hidden=false 之后
// 编排：封面 spring-in → 战力胶囊 sweep → 标题 SplitText 逐字 → 锐评 SplitText 逐字打字感
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
gsap.registerPlugin(SplitText);

let _splits: SplitText[] = [];

export function playHeroPick(el: HTMLElement): void {
  if (!el) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // 清掉上次的 SplitText（每次 renderHeroFeature 都会触发）
  _splits.forEach(s => s.revert());
  _splits = [];

  const cover = el.querySelector('.hf-cover-wrap');
  const verdict = el.querySelector('.hf-verdict');
  const scoreEl = el.querySelector('.hf-score');
  const yearEl = el.querySelector('.hf-year');
  const titleEl = el.querySelector('#hfTitle') as HTMLElement;
  const reviewEl = el.querySelector('#hfReview') as HTMLElement;

  // SplitText 拆字（中文每字一 char）
  const titleSplit = titleEl ? new SplitText(titleEl, { type: 'chars' }) : null;
  const reviewSplit = reviewEl && reviewEl.textContent?.trim()
    ? new SplitText(reviewEl, { type: 'chars' })
    : null;
  if (titleSplit) _splits.push(titleSplit);
  if (reviewSplit) _splits.push(reviewSplit);

  const targets = [cover, verdict, scoreEl, yearEl,
                   ...(titleSplit?.chars || []),
                   ...(reviewSplit?.chars || [])].filter(Boolean);

  const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
  tl.set(targets, { autoAlpha: 0 });

  // 封面 spring 浮起
  if (cover) tl.fromTo(cover,
    { y: 28, scale: 0.94 },
    { y: 0, scale: 1, autoAlpha: 1, duration: 0.7, ease: 'back.out(1.3)' });

  // 战力胶囊 弹入 + 微微旋转
  if (verdict) tl.fromTo(verdict,
    { x: -16, scale: 0.6, rotation: -6 },
    { x: 0, scale: 1, rotation: 0, autoAlpha: 1, duration: 0.55, ease: 'back.out(2)' },
    '-=0.45');

  // 评分 + 年份 跟胶囊
  const metaSecondary = [scoreEl, yearEl].filter(Boolean);
  if (metaSecondary.length) tl.fromTo(metaSecondary,
    { y: -6 },
    { y: 0, autoAlpha: 1, duration: 0.35, stagger: 0.08 },
    '-=0.25');

  // 标题逐字
  if (titleSplit) tl.fromTo(titleSplit.chars,
    { y: 14 },
    { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.025 },
    '-=0.3');

  // 锐评打字感（更细 stagger，更长）
  if (reviewSplit) tl.fromTo(reviewSplit.chars,
    { y: 6 },
    { y: 0, autoAlpha: 1, duration: 0.4, stagger: 0.022 },
    '-=0.4');
}
