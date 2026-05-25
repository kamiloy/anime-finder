#!/usr/bin/env node
// FanJi HF Image Gen · MCP Server
// 使用 Hugging Face Inference API，免费额度 3 万次/月
// 需要设置环境变量 HF_TOKEN，获取地址：https://huggingface.co/settings/tokens
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR = path.join(__dirname, '..');
const MAX_RETRIES = 3;
const POLL_INTERVAL = 3000; // 每隔 3 秒查一次模型是否加载完
const TIMEOUT = 120000;     // 最长等 2 分钟

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
    name: 'hf_generate_image',
    description: '用 Hugging Face 高质量 AI 模型生成动漫插图。需要先设置 HF_TOKEN 环境变量。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt:   { type: 'string', description: '图片描述（推荐英文）' },
        filename: { type: 'string', description: '保存文件名，不含扩展名' },
        width:    { type: 'number', description: '图片宽度，默认 832' },
        height:   { type: 'number', description: '图片高度，默认 1216' },
        model:    { type: 'string', description: '模型 ID，默认 animagine-xl-4.0' },
        guidance: { type: 'number', description: 'CFG 引导强度 1-20，默认 7' },
        steps:    { type: 'number', description: '推理步数，默认 25' },
        seed:     { type: 'number', description: '随机种子，不传则随机' },
      },
      required: ['prompt', 'filename']
    }
  }
];

// ===== 推荐模型列表 =====
const MODELS = {
  'animagine-xl-4.0':       'cagliostrolab/animagine-xl-4.0',
  'animagine-xl-3.1':       'cagliostrolab/animagine-xl-3.1',
  'animagine-xl-3.0':       'cagliostrolab/animagine-xl-3.0',
  'FLUX.1-dev':             'black-forest-labs/FLUX.1-dev',
  'FLUX.1-schnell':         'black-forest-labs/FLUX.1-schnell',
  'sdxl-turbo':             'stabilityai/sdxl-turbo',
  'sd-3.5-large':           'stabilityai/stable-diffusion-3.5-large',
  'sd-3.5-medium':          'stabilityai/stable-diffusion-3.5-medium',
  'openjourney-v4':         'prompthero/openjourney-v4',
};

// ===== HF Inference API 调用 =====
function hfInference(modelId, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api-inference.huggingface.co/models/${modelId}`);
    const data = JSON.stringify(body);

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: TIMEOUT,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);

        // 模型未就绪：返回预估等待时间
        if (res.statusCode === 503) {
          try {
            const err = JSON.parse(raw.toString());
            // 尝试解析预估等待时间
            const waitMatch = err.error?.match(/currently loading.*?(\d+)/i);
            const wait = waitMatch ? Math.min(parseInt(waitMatch[1]) * 1000 + 5000, 60000) : 30000;
            return resolve({ loading: true, estimatedWait: wait, error: err.error });
          } catch {
            return resolve({ loading: true, estimatedWait: 30000 });
          }
        }

        if (res.statusCode === 401 || res.statusCode === 403) {
          return reject(new Error('HF_TOKEN 无效或被拒绝，请检查 token 是否正确，以及是否开启了 "Make calls to Inference Providers" 权限'));
        }

        if (res.statusCode === 402) {
          return reject(new Error('HF 免费额度已用完（每月 3 万次），需要升级付费或等下个月重置'));
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${raw.toString().slice(0, 200)}`));
        }

        // 检查 Content-Type 判断是否返回了图片
        const ct = res.headers['content-type'] || '';
        if (!ct.startsWith('image/')) {
          return reject(new Error(`返回类型不是图片: ${ct} — ${raw.toString().slice(0, 200)}`));
        }

        resolve({ loading: false, buffer: raw });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(data);
    req.end();
  });
}

// ===== 带重试和等待的生图 =====
async function generateImage(args) {
  const token = process.env.HF_TOKEN;
  if (!token) {
    throw new Error('请先设置 HF_TOKEN 环境变量。获取地址：https://huggingface.co/settings/tokens');
  }

  const {
    prompt,
    filename,
    width = 832,
    height = 1216,
    model: modelShort = 'animagine-xl-4.0',
    guidance = 7,
    steps = 25,
    seed,
  } = args;

  const modelId = MODELS[modelShort] || modelShort;
  const outPath = path.join(OUTPUT_DIR, `${filename}.jpg`);

  const body = {
    inputs: prompt,
    parameters: {
      width,
      height,
      guidance_scale: guidance,
      num_inference_steps: steps,
      ...(seed != null ? { seed } : {}),
    },
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await hfInference(modelId, body, token);

    if (result.loading) {
      // 模型正在加载，等待后重试
      if (attempt < MAX_RETRIES - 1) {
        const wait = Math.min(result.estimatedWait || 30000, 60000);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw new Error(`模型 ${modelId} 加载超时，请稍后再试。${result.error || ''}`);
    }

    // 写入文件
    fs.writeFileSync(outPath, result.buffer);
    return { path: outPath, model: modelId };
  }

  throw new Error('生成失败，已达最大重试次数');
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
        serverInfo: { name: 'fanji-hf-image', version: '1.0.0' }
      }
    });
  }

  if (msg.method === 'notifications/initialized') return;

  if (msg.method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;

    if (name === 'hf_generate_image') {
      try {
        const result = await generateImage(args);
        return send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: `图片生成完成！\n模型：${result.model}\n保存路径：${result.path}`
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
