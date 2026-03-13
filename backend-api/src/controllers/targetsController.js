import fs from 'fs/promises';
import { TARGETS_PATH } from '../config/paths.js';

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
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(TARGETS_PATH);
  } catch (e) {
    res.status(404).json({ message: 'targets.mind not found' });
  }
}

