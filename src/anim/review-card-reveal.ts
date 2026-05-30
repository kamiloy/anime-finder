// @ts-nocheck
// 本周锐评卡（.review-card）ScrollTrigger 进视图触发：
//   封面 scale-in + 标题 fadeUp + 锐评 SplitText 逐字 reveal + quote 流光
// bindReviewCards 渲染完调用 enhanceReviewCards(container)
import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(SplitText, ScrollTrigger);

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function enhanceReviewCards(container: HTMLElement): void {
  if (!container || reduced) return;

  const cards = container.querySelectorAll('.review-card');
  cards.forEach((card: HTMLElement) => {
    const cover = card.querySelector('.rc-cover');
    const title = card.querySelector('.rc-title') as HTMLElement;
    const meta = card.querySelector('.rc-meta');
    const reviewEl = card.querySelector('.rc-review') as HTMLElement;
    const quote = card.querySelector('.rc-quote') as HTMLElement;

    let reviewSplit: SplitText | null = null;
    if (reviewEl && reviewEl.textContent?.trim()) {
      reviewSplit = new SplitText(reviewEl, { type: 'chars' });
    }

    const targets = [cover, title, meta, ...(reviewSplit?.chars || [])].filter(Boolean);
    gsap.set(targets, { autoAlpha: 0 });

    const tl = gsap.timeline({
      defaults: { ease: 'power2.out' },
      scrollTrigger: {
        trigger: card,
        start: 'top 88%',
        toggleActions: 'play none none none',
      },
      onComplete: () => {
        // quote 流光 sweep 一次
        if (quote) {
          gsap.fromTo(quote,
            { filter: 'brightness(1) drop-shadow(0 0 0 transparent)' },
            { filter: 'brightness(1.6) drop-shadow(0 0 12px rgba(255,200,120,.7))',
              duration: 0.5, yoyo: true, repeat: 1, ease: 'sine.inOut' });
        }
      }
    });

    if (cover) tl.fromTo(cover,
      { scale: 0.9, y: 16 },
      { scale: 1, y: 0, autoAlpha: 1, duration: 0.55, ease: 'back.out(1.2)' });
    if (title) tl.fromTo(title,
      { y: 12 },
      { y: 0, autoAlpha: 1, duration: 0.45 }, '-=0.3');
    if (meta) tl.fromTo(meta,
      { y: 8 },
      { y: 0, autoAlpha: 1, duration: 0.35 }, '-=0.25');
    if (reviewSplit) tl.fromTo(reviewSplit.chars,
      { y: 6 },
      { y: 0, autoAlpha: 1, duration: 0.35, stagger: 0.018 }, '-=0.2');
  });

  // 防止之前 ScrollTrigger 实例堆积（每次 fetchDiscover 都会重渲染）
  ScrollTrigger.refresh();
}
