import fs from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT, TARGETS_PATH } from '../config/paths.js';

export async function uploadTargets(req, res) {
  const base64 = req.body?.base64;
  if (!base64 || typeof base64 !== 'string') return res.status(400).json({ message: 'Missing base64' });
  const buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  await fs.writeFile(TARGETS_PATH, buffer);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ url: '/api/targets.mind' });
}

export async function getTargets(req, res) {
  try {
    await fs.access(TARGETS_PATH);
    const st = await fs.stat(TARGETS_PATH);
    if (!st || !Number.isFinite(st.size) || st.size < 1000) throw new Error('targets.mind too small');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(TARGETS_PATH);
  } catch (e) {
    const fallbacks = [
      path.join(PROJECT_ROOT, 'to-move-assets', 'targets', 'targets.mind'),
      path.join(PROJECT_ROOT, 'frontend-ar', 'targets.mind')
    ];
    for (const fallback of fallbacks) {
      try {
        await fs.access(fallback);
        const st2 = await fs.stat(fallback);
        if (!st2 || !Number.isFinite(st2.size) || st2.size < 1000) continue;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        return res.sendFile(fallback);
      } catch (e2) {}
    }
    res.status(404).json({ message: 'targets.mind not found' });
  }
}
