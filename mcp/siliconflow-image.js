#!/usr/bin/env node
// FanJi SiliconFlow Image Gen · MCP Server
// 使用 SiliconFlow API（国内直连，注册送免费额度）
// https://cloud.siliconflow.cn
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
    description: '用 SiliconFlow 高质量 AI 模型生成动漫插图。国内直连，速度快。需要设置 SILICONFLOW_API_KEY。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt:   { type: 'string', description: '图片描述（推荐英文）' },
        filename: { type: 'string', description: '保存文件名，不含扩展名' },
        width:    { type: 'number', description: '图片宽度，默认 832' },
        height:   { type: 'number', description: '图片高度，默认 1216' },
        model:    { type: 'string', description: '模型，默认 Kolors。可选: Kolors, Qwen-Image, Z-Image-Turbo' },
        guidance: { type: 'number', description: 'CFG 引导强度 1-20，默认 7' },
        steps:    { type: 'number', description: '推理步数，默认 20' },
        seed:     { type: 'number', description: '随机种子，不传则随机' },
      },
      required: ['prompt', 'filename']
    }
  }
];

// ===== 模型映射 =====
const MODELS = {
  'Kolors':       'Kwai-Kolors/Kolors',
  'Qwen-Image':   'Qwen/Qwen-Image',
  'Z-Image-Turbo':'Tongyi-MAI/Z-Image-Turbo',
};

// ===== SiliconFlow API 调用 =====
function callAPI(model, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://api.siliconflow.cn/v1/image/generations');
    const data = JSON.stringify(body);

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.toString().slice(0, 300)}`));
        }
        try {
          resolve(JSON.parse(raw.toString()));
        } catch (e) {
          reject(new Error('解析响应失败: ' + raw.toString().slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(data);
    req.end();
  });
}

// ===== 下载图片 =====
function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    mod.get(url, { headers: { 'User-Agent': 'FanJi/1.0' }, timeout: 30000 }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlink(dest, () => {});
        return downloadImage(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close(); fs.unlink(dest, () => {});
        return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ===== 生图逻辑 =====
async function generateImage(args) {
  const token = process.env.SILICONFLOW_API_KEY;
  if (!token) {
    throw new Error('请先设置 SILICONFLOW_API_KEY');
  }

  const {
    prompt,
    filename,
    width = 832,
    height = 1216,
    model: modelShort = 'Kolors',
    guidance = 7,
    steps = 20,
    seed,
  } = args;

  const modelId = MODELS[modelShort] || modelShort;
  const outPath = path.join(OUTPUT_DIR, `${filename}.jpg`);

  // SiliconFlow 的 image_size 格式: "widthxheight"
  const body = {
    model: modelId,
    prompt,
    image_size: `${width}x${height}`,
    batch_size: 1,
    num_inference_steps: steps,
    guidance_scale: guidance,
    ...(seed != null ? { seed } : {}),
  };

  const result = await callAPI(modelId, body, token);

  // 解析响应获取图片 URL
  const images = result.images;
  if (!images || !images.length || !images[0].url) {
    throw new Error('API 返回格式异常: ' + JSON.stringify(result).slice(0, 300));
  }

  const imgUrl = images[0].url;
  await downloadImage(imgUrl, outPath);

  return { path: outPath, model: modelId, url: imgUrl };
}

// ===== MCP 消息处理 =====
async function handle(msg) {
  const id = msg.id;

  if (msg.method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fanji-siliconflow-image', version: '1.0.0' }
      }
    });
  }

  if (msg.method === 'notifications/initialized') return;

  if (msg.method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;

    if (name === 'generate_image') {
      try {
        const result = await generateImage(args);
        return send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: `图片生成完成！\n模型：${result.model}\n保存路径：${result.path}\n在线查看：${result.url}`
            }]
          }
        });
      } catch (e) {
        return send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `生成失败：${e.message}` }],
            isError: true
          }
        });
      }
    }
  }

  if (id != null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
}
