import { hashPassword, createSession, checkRateLimit, clientIP, jsonRes, corsRes, bodyJSON, verifyTurnstile } from '../../_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsRes();
  if (request.method !== 'POST') return jsonRes({ ok: false, error: 'POST only' }, 405);

  const ip = clientIP(request);

  // 限流：每 IP 每小时 3 次注册
  if (!(await checkRateLimit(env, ip, 'register', 3, 3600))) {
    return jsonRes({ ok: false, error: '操作太频繁，请稍后再试' }, 429);
  }

  const body = await bodyJSON(request);
  const { username, password, turnstile } = body;

  // 校验用户名
  if (!username || typeof username !== 'string') {
    return jsonRes({ ok: false, error: '请输入用户名' }, 400);
  }
  const name = username.trim();
  if (name.length < 3 || name.length > 20 || !/^[a-zA-Z0-9_一-鿿]+$/.test(name)) {
    return jsonRes({ ok: false, error: '用户名需 3-20 个字符，仅限中英文、数字、下划线' }, 400);
  }

  // 校验密码
  if (!password || typeof password !== 'string' || password.length < 6 || password.length > 100) {
    return jsonRes({ ok: false, error: '密码需 6-100 个字符' }, 400);
  }

  // Turnstile 验证
  const tsSecret = env.TURNSTILE_SECRET;
  if (tsSecret) {
    if (!turnstile) return jsonRes({ ok: false, error: '请完成安全验证' }, 400);
    if (!(await verifyTurnstile(tsSecret, turnstile, ip))) {
      return jsonRes({ ok: false, error: '安全验证失败，请重试' }, 400);
    }
  }

  // 检查用户名是否已存在
  const exist = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(name).first();
  if (exist) return jsonRes({ ok: false, error: '用户名已被使用' }, 409);

  // 创建用户
  const pwHash = await hashPassword(password);
  const result = await env.DB.prepare(
    'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)'
  ).bind(name, pwHash, name).run();

  const userId = result.meta.last_row_id;
  const token = await createSession(env, userId);

  return jsonRes({
    ok: true,
    token,
    user: { id: userId, username: name, nickname: name, bio: '', created_at: new Date().toISOString() }
  }, 201);
}
