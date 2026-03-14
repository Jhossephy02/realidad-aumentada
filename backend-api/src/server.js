import './config/env.js';
import fs from 'fs/promises';
import path from 'path';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { MARKERS_DIR, MARKER_PREVIEWS_DIR, MODELS_DIR, PATTERNS_DIR, PROJECT_ROOT, TARGETS_DIR } from './config/paths.js';
import { User } from './models/User.js';
import { ArModel } from './models/ArModel.js';

function isProd() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function requireEnv(name) {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function ensureDirs() {
  await fs.mkdir(MODELS_DIR, { recursive: true });
  await fs.mkdir(MARKERS_DIR, { recursive: true });
  await fs.mkdir(PATTERNS_DIR, { recursive: true });
  await fs.mkdir(MARKER_PREVIEWS_DIR, { recursive: true });
  await fs.mkdir(TARGETS_DIR, { recursive: true });
}

async function ensureDevAdmin() {
  const count = await User.countDocuments({});
  if (count > 0) return;

  const envUser = String(process.env.ADMIN_USERNAME || '').trim();
  const envPass = String(process.env.ADMIN_PASSWORD || '');
  const username = envUser || (isProd() ? '' : 'admin');
  const password = envPass || (isProd() ? '' : 'admin123');
  if (!username || !password) return;

  const passwordHash = await User.hashPassword(password);
  await User.create({ username, passwordHash, role: 'admin' });
}

async function ensureDevSeedUploads() {
  if (isProd()) return;

  const srcGlbAbs = path.join(PROJECT_ROOT, 'to-move-assets', 'models', 'salmon_nigiri.glb');
  const srcMarkerAbs = path.join(PROJECT_ROOT, 'to-move-assets', 'markers', 'Captura de pantalla 2026-03-10 093801.png');
  const destGlbName = 'salmon_nigiri.glb';
  const destMarkerName = 'Captura_de_pantalla_2026-03-10_093801.png';
  const destGlbAbs = path.join(MODELS_DIR, destGlbName);
  const destMarkerAbs = path.join(MARKERS_DIR, destMarkerName);

  try {
    await fs.access(srcGlbAbs);
    await fs.access(srcMarkerAbs);
  } catch (e) {
    return;
  }

  try {
    await fs.access(destGlbAbs);
  } catch (e) {
    try {
      await fs.copyFile(srcGlbAbs, destGlbAbs);
    } catch (err) {}
  }

  try {
    await fs.access(destMarkerAbs);
  } catch (e) {
    try {
      await fs.copyFile(srcMarkerAbs, destMarkerAbs);
    } catch (err) {}
  }
}

async function ensureDevSeedModel() {
  if (isProd()) return;
  const count = await ArModel.countDocuments({});
  if (count > 0) return;

  const glbUrl = '/uploads/models/salmon_nigiri.glb';
  const markerUrl = '/uploads/markers/Captura_de_pantalla_2026-03-10_093801.png';
  await ArModel.create({
    name: 'Salmón Nigiri',
    description: 'Demo',
    price: 0,
    glb: glbUrl,
    markerImage: markerUrl,
    targetIndex: 0,
    scale: '0.5 0.5 0.5',
    rotation: '0 45 0',
    position: '0 0.1 0'
  });
}

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';

await ensureDirs();
await ensureDevSeedUploads();

if (isProd()) {
  requireEnv('JWT_SECRET');
  requireEnv('MONGODB_URI');
  requireEnv('ADMIN_USERNAME');
  requireEnv('ADMIN_PASSWORD');
  process.env.REQUIRE_AUTH ||= '1';
}

await connectDb();
await ensureDevAdmin();
await ensureDevSeedModel();

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
