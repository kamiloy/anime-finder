# FanJi · 番剧探索

## Memory System — MANDATORY FIRST ACTION

**CRITICAL: Before responding to ANY message in a new session, you MUST load memory first. No exceptions.**

This applies even if the user's first message is short, casual, or unrelated to the project. Load memory before doing anything else.

Memory directory:
```
C:\Users\阿杰\.claude\projects\D--anime-anime-finder\memory\
```

Required steps (execute immediately, before responding):
1. Read `MEMORY.md` for the index
2. Read **every** `.md` file listed in MEMORY.md
3. Only after reading all files, respond to the user

Save new information to memory throughout the session. Update MEMORY.md index when new memory files are added.

## Project Summary
FanJi is a solo-developed anime discovery PWA with Capacitor Android wrapping. Single HTML/CSS/JS file architecture, Bangumi API data source, localStorage for user data. No backend, no build step.

## Key Constraints
- Solo student developer with very limited budget
- All features must be client-side or use free tiers
- User prefers Chinese (zh-CN) communication

## 自主研究 & 提升（用户授权）
做设计/UX/视觉/技术选型/任何不确定的任务时，**主动上网查阅**（WebSearch/WebFetch）行业标杆、最佳实践、官方文档——拓宽眼界、提升审美、选对工具，**不必每次征求许可**。原则：①**研究先行**，先把审美和方案质量拉上来再动手；②**碰到能力墙先找"正确的工具/方法"**，别用弱工具硬怼（例：图像编辑用 Nano Banana，而非手动改像素）。详见 memory 的 [[feedback-autonomous-research]]。

## Pre-Code Checklist — WRITE NOTHING BEFORE CHECKING

**每次写新文件/新代码前，必须执行以下检查，违反过的错误绝不再犯：**

1. **先读同类文件** — 创建新文件前，找一个同目录层级、同类型的已有文件，核对：
   - import 路径层级（数目录深度：`functions/` 下 N 层 = N 个 `../`）
   - 导出签名（`export async function onRequest(context)` vs 其他模式）
   - 函数参数（`context.request, context.env` vs `request, env`）
2. **先做一个验证** — 创建 1 个文件 → 确认 build/deploy 通过 → 再批量复制模式。不要一次写 13 个再回头修。
3. **不确定就 grep** — 路径、函数名、签名不确定时，先 Grep 已有代码，别猜。
4. **犯错立即记** — 每次犯错的根因和修正规则写入 memory 或本文件，确保下次加载时能看到。
5. **碰壁先翻 Memory** — 报错/缺配置/认证失败时，第一反应是 grep memory 目录搜关键词，不是重试或搜硬盘。Memory 里可能已有 credential、命令、配置。
