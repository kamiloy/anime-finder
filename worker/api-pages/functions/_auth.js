// FanJi 社区 Auth 模块
// 会话令牌管理 / 密码哈希 / 限流中间件 / 鉴权中间件
// 零第三方依赖，仅 Web Crypto + D1

function sha256hex(s) {
  const enc = new TextEncoder().encode(s);
  return crypto.subtle.digest('SHA-256', enc).then(buf =>
    Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  );
}

// IP 哈希（SHA-256 前 16 字符，不可逆，防日志泄露）
async function ipHash(ip) {
  return (await sha256hex(ip)).slice(0, 16);
}

// PBKDF2 密码哈希：100k 迭代 + 16-byte salt
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  const hash = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hash] = stored.split(':');
  if (!saltHex || !hash) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const enc = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  const computed = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === hash;
}

// 生成会话令牌，写入 D1，返回 token 字符串
async function createSession(env, userId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString(); // 30 天
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(token, userId, expiresAt).run();
  return token;
}

// 验证令牌，返回 user 对象或 null
async function verifyToken(env, token) {
  if (!token) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT u.id, u.username, u.nickname, u.bio, u.created_at, s.expires_at
       FROM sessions s JOIN users u ON s.user_id = u.id
       WHERE s.token = ?`
    ).bind(token).first();
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return null;
    }
    return { id: row.id, username: row.username, nickname: row.nickname, bio: row.bio, created_at: row.created_at };
  } catch (e) {
    return null;
  }
}

// 销毁令牌
async function destroySession(env, token) {
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

// 限流检查：返回 true = 放行，false = 超限
async function checkRateLimit(env, ip, endpoint, maxPerWindow, windowSec = 60) {
  try {
    const h = await ipHash(ip);
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / windowSec) * windowSec;

    const row = await env.DB.prepare(
      'SELECT count FROM rate_limits WHERE ip_hash = ? AND endpoint = ? AND window_start = ?'
    ).bind(h, endpoint, windowStart).first();

    if (!row) {
      await env.DB.prepare(
        'INSERT INTO rate_limits (ip_hash, endpoint, window_start, count) VALUES (?, ?, ?, 1)'
      ).bind(h, endpoint, windowStart).run();
      return true;
    }
    if (row.count >= maxPerWindow) return false;

    await env.DB.prepare(
      'UPDATE rate_limits SET count = count + 1 WHERE ip_hash = ? AND endpoint = ? AND window_start = ?'
    ).bind(h, endpoint, windowStart).run();
    return true;
  } catch (e) {
    return true; // 限流故障时放行，避免误伤
  }
}

// 从 Request 提取 Bearer token
function extractToken(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// 从 Request 提取客户端 IP
function clientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         '127.0.0.1';
}

// 鉴权中间件：返回 user 或 401 Response
async function requireAuth(request, env) {
  const token = extractToken(request);
  if (!token) return null;
  const user = await verifyToken(env, token);
  return user;
}

// JSON 响应辅助
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function corsRes() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

// 提取请求体 JSON
async function bodyJSON(request) {
  try { return await request.json(); } catch { return {}; }
}

// 校验 Turnstile token
async function verifyTurnstile(secret, token, ip) {
  if (!secret || !token) return false;
  try {
    const form = new URLSearchParams({ secret, response: token, remoteip: ip });
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form
    });
    const j = await r.json();
    return !!j.success;
  } catch (e) {
    return false;
  }
}

export {
  hashPassword, verifyPassword,
  createSession, verifyToken, destroySession,
  checkRateLimit, extractToken, clientIP, requireAuth,
  jsonRes, corsRes, bodyJSON, verifyTurnstile
};
