import './config/env.js';
import fs from 'fs/promises';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { MARKERS_DIR, MARKER_PREVIEWS_DIR, MODELS_DIR, PATTERNS_DIR, TARGETS_DIR } from './config/paths.js';
import { User } from './models/User.js';

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

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';

await ensureDirs();

if (isProd()) {
  requireEnv('JWT_SECRET');
  requireEnv('MONGODB_URI');
  requireEnv('ADMIN_USERNAME');
  requireEnv('ADMIN_PASSWORD');
  process.env.REQUIRE_AUTH ||= '1';
}

await connectDb();
await ensureDevAdmin();

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
