#!/usr/bin/env node
// FanJi ASCII Art Generator - 将紫音图片转成终端字符画
import { Jimp, intToRGBA } from 'jimp';

const chars = ' .:-=+*#%@';

function rgbToAnsi256(r, g, b) {
  // 6x6x6 color cube
  const ri = Math.round(r / 51), gi = Math.round(g / 51), bi = Math.round(b / 51);
  return 16 + ri * 36 + gi * 6 + bi;
}

async function main() {
  const imgPath = process.argv[2] || './shion-official.jpg';
  const maxWidth = parseInt(process.argv[3] || '70');
  const colored = process.argv.includes('--color');

  try {
    const img = await Jimp.read(imgPath);
    const aspect = img.bitmap.height / img.bitmap.width;
    const w = maxWidth;
    const h = Math.round(w * aspect * 0.45);
    img.resize({ w });

    let output = '\n';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = intToRGBA(img.getPixelColor(x, y));
        const brightness = (c.r * 0.299 + c.g * 0.587 + c.b * 0.114) / 255;
        const idx = Math.floor(brightness * (chars.length - 1));

        if (colored) {
          const code = rgbToAnsi256(c.r, c.g, c.b);
          output += `\x1b[38;5;${code}m${chars[idx]}${chars[idx]}\x1b[0m`;
        } else {
          output += chars[idx].repeat(2);
        }
      }
      output += '\n';
    }
    console.log(output);
    console.log(`  ${imgPath}  →  ${w}×${h}`);
    if (!colored) console.log('  加 --color 参数 → 彩色版');
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

main();
