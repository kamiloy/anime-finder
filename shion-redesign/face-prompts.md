# 紫音 · 多表情立绘 出图指引（Nano Banana / Gemini 2.5 Flash Image）

目标：基于定妆立绘，出 5 张**只换表情、其余完全一致**的反应立绘，接入 app 的「立绘随状态切换」系统。

## 怎么出（网页端，免费）
1. 打开 https://aistudio.google.com → 选 **Gemini 2.5 Flash Image (Nano Banana)**。
2. **上传源图 `shion-hero.png`**（项目根目录那张，已是首屏立绘的裁切/构图）。
   - ⚠️ 必须用 `shion-hero.png` 当源，保证构图/裁切跟首屏 1:1，出图能直接替换、套同一个圆形遮罩。
3. 贴下面对应表情的 prompt → 生成 → 不满意就重抽/微调措辞。
4. 下载 → 重命名为指定文件名 → **放到项目根目录**（跟 `shion-hero.png` 同级）。
5. 出图右下角若有 Gemini 四角星水印 → 底部裁掉或克隆去除（参考定妆那次）。

## 接入（代码已就绪）
- 出好图放进根目录后，把 `index.html` 里的 **`const SHION_FACES_READY=false;` 改成 `true`**（一行开关；false 时零请求零开销，避免没出图时狂刷 404）。
- 开启后 app 会探测哪些图已存在；**没放的表情自动保持默认立绘（零回归）**，放了哪张就点亮哪张（可分批出图）。
- 触发：评分/收藏/弃番时（`shionReact`），立绘按表情切换 2.8s 再还原默认。
- 想加表情：在 `SHION_FACE_FILES` 加一项 + 在 `EMOJI_FACE` 把对应 emoji 映射过去即可。

## 通用约束（每条 prompt 都默认带上）
> Keep her identity EXACTLY the same as the source image: same face, purple-to-cyan twin-tails, **heterochromia (left eye purple, right eye cyan)**, gothic lolita black dress, lace choker, gold cross pendant, star-field dark-purple background, art style, head-and-shoulders framing, and lighting. Change ONLY the facial expression. Same composition and crop as the source.

⚠️ **张嘴易崩**：AI 画张嘴/牙齿常出 artifact（定妆时踩过）。优先**闭口或微张**；崩了就把 prompt 改成 "mouth closed / slight"。

---

## 1) smug — 得意傲娇（默认人格的强化版）→ `shion-face-smug.png`
触发：高分/良作评分、想看、在看、弃番（"我早说过吧"）
```
[通用约束] Expression: a smug, teasing half-smirk. One eyebrow slightly raised, confident closed-mouth smirk pulling to one side, eyes half-lidded looking down at the viewer playfully, faint "I told you so" confidence. Cute, not mean.
```

## 2) pout — 无语/嫌弃 → `shion-face-pout.png`
触发：中庸评分、搁置、移除收藏
```
[通用约束] Expression: an unimpressed, deadpan pout. Lips slightly pursed/pouting, eyes half-lidded with a faint flat side-eye, eyebrows neutral-low, a "...really?" deadpan look. Mouth closed.
```

## 3) angry — 生气（傲娇炸毛前奏）→ `shion-face-angry.png`
触发：低分评分（踩雷）
```
[通用约束] Expression: annoyed and a little angry but still cute. Furrowed brows, slight frown / small pout, one puffed cheek, eyes sharp. Tsundere-angry, not scary. Mouth closed or barely open.
```

## 4) happy — 真心开心/得意 → `shion-face-happy.png`
触发：看完（鼓掌、通关）
```
[通用约束] Expression: genuinely pleased and warm. A soft bright smile, eyes gently curved/half-closed in happiness, faint blush on cheeks, relaxed brows. Wholesome and proud-of-you vibe. Mouth a gentle closed or slightly-open smile.
```

## 5) rage — 暴走炸毛（喜剧向）→ `shion-face-rage.png`
触发：暴走态（状态栏耐心见底；后续可在 app 内触发）
```
[通用约束] Expression: comedic anime rage. Fierce determined eyes, brows angled down hard, a cartoon anger-vein (💢) mark on the temple/forehead, gritted-teeth or small shouting mouth. Over-the-top but chibi-cute, not horror. If open mouth distorts, use gritted closed teeth instead.
```

---

## 备选/扩展（想更丰富时再出）
- `surprised` 惊讶（名场面/神作发现）、`sleepy` 困倦（深夜打开 app）、`shy` 害羞（被夸时）。
- 出了新表情记得同步 `SHION_FACE_FILES` + `EMOJI_FACE`（或新触发点）。
