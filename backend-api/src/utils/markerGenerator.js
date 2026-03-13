import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

function rotateCoord(x, y, size, rotation) {
  const s = size - 1;
  if (rotation === 0) return { x, y };
  if (rotation === 90) return { x: s - y, y: x };
  if (rotation === 180) return { x: s - x, y: s - y };
  return { x: y, y: s - x };
}

function pattFromRgba(rgba, width, height) {
  const size = Math.min(width, height);
  const rotations = [0, 90, 180, 270];
  const blocks = [];
  for (const rot of rotations) {
    const lines = [];
    for (let y = 0; y < size; y++) {
      const parts = [];
      for (let x = 0; x < size; x++) {
        const c = rotateCoord(x, y, size, rot);
        const idx = (c.y * width + c.x) * 4;
        const r = rgba[idx] ?? 0;
        const g = rgba[idx + 1] ?? 0;
        const b = rgba[idx + 2] ?? 0;
        parts.push(`${r} ${g} ${b}`);
      }
      lines.push(parts.join(' '));
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

async function buildPreviewPng(inputBuffer) {
  const canvasSize = 512;
  const border = 32;
  const innerSize = canvasSize - border * 2;
  const image = sharp(inputBuffer).rotate().resize(innerSize, innerSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } });
  const topBottom = Buffer.alloc(canvasSize * border * 3, 0);
  const leftRight = Buffer.alloc(border * canvasSize * 3, 0);
  const composed = sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite([
      { input: topBottom, raw: { width: canvasSize, height: border, channels: 3 }, top: 0, left: 0 },
      { input: topBottom, raw: { width: canvasSize, height: border, channels: 3 }, top: canvasSize - border, left: 0 },
      { input: leftRight, raw: { width: border, height: canvasSize, channels: 3 }, top: 0, left: 0 },
      { input: leftRight, raw: { width: border, height: canvasSize, channels: 3 }, top: 0, left: canvasSize - border },
      { input: await image.png().toBuffer(), top: border, left: border }
    ])
    .png();
  return await composed.toBuffer();
}

export async function generateMarkerArtifactsFromFile({ markerAbsPath, patternsDir, previewsDir, baseName }) {
  const inputBuffer = await fs.readFile(markerAbsPath);

  const { data, info } = await sharp(inputBuffer)
    .rotate()
    .resize(16, 16, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const patt = pattFromRgba(data, info.width, info.height);
  const pattFilename = `${baseName}.patt`;
  const pattAbsPath = path.join(patternsDir, pattFilename);
  await fs.writeFile(pattAbsPath, patt, 'utf8');

  const previewBuffer = await buildPreviewPng(inputBuffer);
  const previewFilename = `${baseName}.png`;
  const previewAbsPath = path.join(previewsDir, previewFilename);
  await fs.writeFile(previewAbsPath, previewBuffer);

  return {
    pattFilename,
    previewFilename,
    meta: { size: 16, sourceBytes: inputBuffer.length }
  };
}
