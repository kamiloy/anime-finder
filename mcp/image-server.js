#!/usr/bin/env node
// FanJi Image Gen · MCP Server
// 使用 Pollinations.ai，完全免费，无需 API Key
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR = path.join(__dirname, '..');

// ===== MCP stdio 通信 =====
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', chunk => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    const t = line.trim();
    if (t) { try { handle(JSON.parse(t)); } catch(_) {} }
  }
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ===== 工具定义 =====
const TOOLS = [
  {
    name: 'generate_image',
    description: '用 AI 生成图片并保存到 FanJi 项目目录。免费，无需 Key。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt:   { type: 'string', description: '图片描述（英文效果更好）' },
        filename: { type: 'string', description: '保存的文件名，不含扩展名，如 mascot-shion' },
        width:    { type: 'number', description: '图片宽度，默认 512' },
        height:   { type: 'number', description: '图片高度，默认 768' },
        style:    { type: 'string', description: '风格预设：anime（默认）/ chibi / realistic' }
      },
      required: ['prompt', 'filename']
    }
  }
];

// 风格附加词
const STYLE_TAGS = {
  anime:     ', anime style, 2d illustration, clean lineart, soft shading, masterpiece, best quality',
  chibi:     ', chibi style, super deformed, cute, kawaii, big head, small body, simple design, masterpiece',
  realistic: ', photorealistic, highly detailed, 8k uhd, cinematic lighting',
};

// ===== 生图逻辑 =====
async function generateImage({ prompt, filename, width = 512, height = 768, style = 'anime' }) {
  const suffix  = STYLE_TAGS[style] || STYLE_TAGS.anime;
  const full    = prompt + suffix;
  const seed    = Math.floor(Math.random() * 9999999);
  const url     = `https://image.pollinations.ai/prompt/${encodeURIComponent(full)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`;
  const outPath = path.join(OUTPUT_DIR, `${filename}.jpg`);
  await download(url, outPath);
  return outPath;
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('重定向过多'));
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    mod.get(url, { headers: { 'User-Agent': 'FanJi/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlink(dest, () => {});
        return download(res.headers.location, dest, redirects + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close(); fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ===== MCP 消息处理 =====
async function handle(msg) {
  const id = msg.id;

  if (msg.method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fanji-image-gen', version: '1.0.0' }
    }});
  }

  if (msg.method === 'notifications/initialized') return; // 无需回复

  if (msg.method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    if (name === 'generate_image') {
      try {
        // Pollinations 大约需要 10-20 秒
        const outPath = await generateImage(args);
        return send({ jsonrpc: '2.0', id, result: {
          content: [{
            type: 'text',
            text: `图片生成完成！\n保存路径：${outPath}\n\n我用 Read 工具查看一下。`
          }]
        }});
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: `生成失败：${e.message}` }],
          isError: true
        }});
      }
    }
  }

  if (id != null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
}
