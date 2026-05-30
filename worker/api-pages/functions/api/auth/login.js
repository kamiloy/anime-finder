import { verifyPassword, createSession, checkRateLimit, clientIP, jsonRes, corsRes, bodyJSON, verifyTurnstile } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsRes();
  if (request.method !== 'POST') return jsonRes({ ok: false, error: 'POST only' }, 405);

  const ip = clientIP(request);

  // 限流：每 IP 每分钟 10 次登录
  if (!(await checkRateLimit(env, ip, 'login', 10, 60))) {
    return jsonRes({ ok: false, error: '操作太频繁，请稍后再试' }, 429);
  }

  const body = await bodyJSON(request);
  const { username, password, turnstile } = body;

  if (!username || !password) {
    return jsonRes({ ok: false, error: '请输入用户名和密码' }, 400);
  }

  // Turnstile 验证（宽松模式：secret 未配时跳过）
  const tsSecret = env.TURNSTILE_SECRET;
  if (tsSecret && turnstile) {
    await verifyTurnstile(tsSecret, turnstile, ip);
    // 登录场景不因 Turnstile 失败而拒绝（可能是前端未加载），只在有 token 时验证
  }

  const name = username.trim();
  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, nickname, bio, created_at FROM users WHERE username = ?'
  ).bind(name).first();

  if (!user) return jsonRes({ ok: false, error: '用户名或密码错误' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return jsonRes({ ok: false, error: '用户名或密码错误' }, 401);

  const token = await createSession(env, user.id);

  return jsonRes({
    ok: true,
    token,
    user: { id: user.id, username: user.username, nickname: user.nickname, bio: user.bio || '', created_at: user.created_at }
  });
}
