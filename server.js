import express from 'express';
import multer from 'multer';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import https from 'node:https';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';

const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim() || 'admin';
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '') || 'admin123';
const ADMIN_TOKEN_TTL_MS = Number(process.env.ADMIN_TOKEN_TTL_MS || 1000 * 60 * 60 * 24 * 7);
const adminTokens = new Map();

const IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
if (IS_PROD && ADMIN_USERNAME === 'admin' && ADMIN_PASSWORD === 'admin123') {
  console.error('Producción: configura ADMIN_USERNAME y ADMIN_PASSWORD (no uses credenciales por defecto).');
  process.exit(1);
}

function resolveDir(envValue, fallbackAbs) {
  const raw = String(envValue || '').trim();
  if (!raw) return fallbackAbs;
  return path.isAbsolute(raw) ? raw : path.join(__dirname, raw);
}

const DATA_DIR = resolveDir(process.env.DATA_DIR, path.join(__dirname, 'storage', 'data'));
const DB_PATH = path.join(DATA_DIR, 'db.json');

const UPLOADS_DIR = resolveDir(process.env.UPLOADS_DIR, path.join(__dirname, 'storage', 'uploads'));
const MODELS_DIR = path.join(UPLOADS_DIR, 'models');
const MARKERS_DIR = path.join(UPLOADS_DIR, 'markers');
const PATTERNS_DIR = path.join(UPLOADS_DIR, 'patterns');
const MARKER_PREVIEWS_DIR = path.join(UPLOADS_DIR, 'marker-previews');
const TARGETS_DIR = path.join(UPLOADS_DIR, 'targets');
const TARGETS_PATH = path.join(TARGETS_DIR, 'targets.mind');

const FRONTEND_DIR = resolveDir(process.env.FRONTEND_DIR, path.join(__dirname, 'frontend-ar'));
const ADMIN_DIST_DIR = resolveDir(process.env.ADMIN_DIST_DIR, path.join(__dirname, 'admin-dashboard', 'dist'));

let cachedMindArCompilerJs = null;
let cachedMindArCompilerJsAt = 0;

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(MODELS_DIR, { recursive: true });
  await fs.mkdir(MARKERS_DIR, { recursive: true });
  await fs.mkdir(PATTERNS_DIR, { recursive: true });
  await fs.mkdir(MARKER_PREVIEWS_DIR, { recursive: true });
  await fs.mkdir(TARGETS_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch (e) {
    await fs.writeFile(DB_PATH, JSON.stringify({ products: [], admins: [] }, null, 2), 'utf8');
  }
}

async function ensureTargetsMindValid() {
  const fallbacks = [path.join(FRONTEND_DIR, 'targets.mind')];
  let size = 0;
  try {
    const st = await fs.stat(TARGETS_PATH);
    size = Number(st.size) || 0;
  } catch (e) {
    size = 0;
  }
  if (size >= 1024) return;
  for (const fb of fallbacks) {
    try {
      const st2 = await fs.stat(fb);
      const size2 = Number(st2.size) || 0;
      if (size2 < 1024) continue;
      const tmp = `${TARGETS_PATH}.tmp`;
      await fs.copyFile(fb, tmp);
      await fs.rename(tmp, TARGETS_PATH);
      return;
    } catch (e2) {}
  }
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

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

async function generateMarkerArtifactsFromFile({ markerAbsPath, patternsDir, previewsDir, baseName }) {
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

function parseBearerToken(req) {
  const h = String(req?.headers?.authorization || '').trim();
  if (!h) return '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

function isAdminTokenValid(token) {
  const t = String(token || '').trim();
  if (!t) return false;
  const v = adminTokens.get(t);
  const exp = typeof v === 'object' && v ? v.exp : v;
  if (!Number.isFinite(Number(exp))) return false;
  if (Date.now() > Number(exp)) {
    adminTokens.delete(t);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  const token = parseBearerToken(req);
  if (isAdminTokenValid(token)) return next();
  return res.status(401).json({ message: 'Unauthorized' });
}

function safeName(input) {
  const raw = String(input || 'file').replace(/\\/g, '/').split('/').pop();
  const cleaned = raw.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned || 'file';
}

function absoluteUrl(req, pathname) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function normalizeUploadValue(value) {
  if (!value || typeof value !== 'string') return '';
  let pathname = '';
  try {
    pathname = value.startsWith('http') ? new URL(value).pathname : value;
  } catch (e) {
    pathname = value;
  }
  if (pathname.startsWith('/uploads/')) return pathname;
  return value;
}

function normalizeProductForResponse(product) {
  if (!product || typeof product !== 'object') return product;
  return {
    ...product,
    model: normalizeUploadValue(product.model),
    marker: normalizeUploadValue(product.marker),
    markerPatt: normalizeUploadValue(product.markerPatt),
    markerPreview: normalizeUploadValue(product.markerPreview)
  };
}

await ensureDirs();
const db = new Low(new JSONFile(DB_PATH), { products: [], admins: [] });
await db.read();
db.data ||= { products: [], admins: [] };
db.data.products ||= [];
db.data.admins ||= [];

function normalizeAdminUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function makePasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const p = String(password || '');
  const s = String(salt || '');
  const hash = crypto.scryptSync(p, s, 64).toString('hex');
  return `scrypt:${s}:${hash}`;
}

function verifyPassword(password, stored) {
  const raw = String(stored || '');
  if (!raw.startsWith('scrypt:')) return false;
  const parts = raw.split(':');
  if (parts.length !== 3) return false;
  const salt = String(parts[1] || '');
  const expected = String(parts[2] || '');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
  } catch (e) {
    return false;
  }
}

function ensureAdminBootstrap() {
  const admins = Array.isArray(db.data.admins) ? db.data.admins : [];
  if (admins.length) return false;
  const now = Date.now();
  const username = IS_PROD ? ADMIN_USERNAME : 'admin';
  const password = IS_PROD ? ADMIN_PASSWORD : 'admin123';
  const user = { username: normalizeAdminUsername(username), passwordHash: makePasswordHash(password), createdAt: now, updatedAt: now };
  db.data.admins = [user];
  return true;
}

{
  const created = ensureAdminBootstrap();
  if (IS_PROD) {
    const admins = Array.isArray(db.data.admins) ? db.data.admins : [];
    const maybeDefault = admins.find((a) => normalizeAdminUsername(a?.username) === 'admin');
    if (maybeDefault && verifyPassword('admin123', maybeDefault.passwordHash)) {
      console.error('Producción: cambia/elimina el usuario admin con contraseña admin123.');
      process.exit(1);
    }
  }
  if (created) await db.write();
}

function autoReindexProducts(products) {
  const list = Array.isArray(products) ? products.filter((p) => p && typeof p === 'object') : [];
  const sortable = list.map((p, idx) => {
    const ti = Number(p.targetIndex);
    const hasTi = Number.isFinite(ti);
    const createdAt = Number(p.createdAt);
    const created = Number.isFinite(createdAt) ? createdAt : 0;
    const name = typeof p.name === 'string' ? p.name.toLowerCase() : '';
    const id = typeof p.id === 'string' ? p.id : '';
    return { p, idx, hasTi, ti: hasTi ? ti : Number.POSITIVE_INFINITY, created, name, id };
  });

  sortable.sort((a, b) => {
    if (a.ti !== b.ti) return a.ti - b.ti;
    if (a.created !== b.created) return a.created - b.created;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return a.idx - b.idx;
  });

  let nextIndex = 0;
  const reindexed = sortable.map(({ p }) => {
    const hasAssets = typeof p.marker === 'string' && p.marker && typeof p.model === 'string' && p.model;
    if (!hasAssets) return { ...p, targetIndex: null };
    const out = { ...p, targetIndex: nextIndex };
    nextIndex += 1;
    return out;
  });

  return reindexed;
}

{
  const before = JSON.stringify(db.data.products || []);
  const next = autoReindexProducts(db.data.products || []);
  const after = JSON.stringify(next);
  if (before !== after) {
    db.data.products = next;
    await db.write();
  }
}

async function tryRepairMissingUploads() {
  const products = Array.isArray(db.data.products) ? db.data.products : [];
  if (!products.length) return;

  let modelEntries = [];
  let markerEntries = [];
  try {
    modelEntries = await fs.readdir(MODELS_DIR, { withFileTypes: true });
  } catch (e) {}
  try {
    markerEntries = await fs.readdir(MARKERS_DIR, { withFileTypes: true });
  } catch (e) {}

  const modelFiles = await Promise.all(
    modelEntries
      .filter((e) => e && e.isFile() && e.name.toLowerCase().endsWith('.glb'))
      .map(async (e) => {
        const abs = path.join(MODELS_DIR, e.name);
        try {
          const st = await fs.stat(abs);
          return { name: e.name, mtimeMs: Number(st.mtimeMs) || 0 };
        } catch (err) {
          return null;
        }
      })
  );
  const markerFiles = await Promise.all(
    markerEntries
      .filter((e) => e && e.isFile() && (e.name.toLowerCase().endsWith('.png') || e.name.toLowerCase().endsWith('.jpg') || e.name.toLowerCase().endsWith('.jpeg')))
      .map(async (e) => {
        const abs = path.join(MARKERS_DIR, e.name);
        try {
          const st = await fs.stat(abs);
          return { name: e.name, mtimeMs: Number(st.mtimeMs) || 0 };
        } catch (err) {
          return null;
        }
      })
  );

  const latestModel = modelFiles.filter(Boolean).sort((a, b) => (b.mtimeMs - a.mtimeMs))[0]?.name || null;
  const latestMarker = markerFiles.filter(Boolean).sort((a, b) => (b.mtimeMs - a.mtimeMs))[0]?.name || null;
  if (!latestModel && !latestMarker) return;

  let changed = false;
  for (const p of products) {
    if (!p || typeof p !== 'object') continue;

    const modelInfo = uploadBasenameFromValue(p.model);
    if (latestModel && modelInfo && modelInfo.folder === 'models') {
      const abs = path.join(MODELS_DIR, modelInfo.filename);
      try {
        await fs.access(abs);
      } catch (e) {
        p.model = `/uploads/models/${latestModel}`;
        changed = true;
      }
    }

    const markerInfo = uploadBasenameFromValue(p.marker);
    if (latestMarker && markerInfo && markerInfo.folder === 'markers') {
      const abs = path.join(MARKERS_DIR, markerInfo.filename);
      try {
        await fs.access(abs);
      } catch (e) {
        p.marker = `/uploads/markers/${latestMarker}`;
        changed = true;
      }
    }
  }

  if (changed) await db.write();
}

await tryRepairMissingUploads();
await ensureTargetsMindValid();

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, now: Date.now() });
});

app.post('/api/auth/login', async (req, res) => {
  await db.read();
  const body = req.body || {};
  const usernameRaw = String(body.username || '').trim();
  const username = normalizeAdminUsername(usernameRaw);
  const password = String(body.password || '');
  const admins = Array.isArray(db.data.admins) ? db.data.admins : [];
  const admin = admins.find((a) => normalizeAdminUsername(a?.username) === username);
  const ok = Boolean(admin && verifyPassword(password, admin.passwordHash));
  if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' });
  const token = crypto.randomBytes(24).toString('hex');
  const ttl = Number.isFinite(ADMIN_TOKEN_TTL_MS) && ADMIN_TOKEN_TTL_MS > 0 ? ADMIN_TOKEN_TTL_MS : 1000 * 60 * 60 * 24 * 7;
  adminTokens.set(token, { exp: Date.now() + ttl, username });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token, user: { username: usernameRaw || username, role: 'admin' } });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  await db.read();
  const admins = Array.isArray(db.data.admins) ? db.data.admins : [];
  const out = admins
    .map((a) => ({
      username: String(a?.username || ''),
      createdAt: a?.createdAt ?? null,
      updatedAt: a?.updatedAt ?? null
    }))
    .filter((a) => a.username)
    .sort((a, b) => a.username.localeCompare(b.username));
  res.setHeader('Cache-Control', 'no-store');
  res.json(out);
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  await db.read();
  const body = req.body || {};
  const username = normalizeAdminUsername(body.username);
  const password = String(body.password || '');
  if (!username) return res.status(400).json({ message: 'Usuario inválido' });
  if (password.length < 4) return res.status(400).json({ message: 'Contraseña muy corta' });
  const admins = Array.isArray(db.data.admins) ? db.data.admins : [];
  if (admins.some((a) => normalizeAdminUsername(a?.username) === username)) return res.status(409).json({ message: 'Usuario ya existe' });
  const now = Date.now();
  const user = { username, passwordHash: makePasswordHash(password), createdAt: now, updatedAt: now };
  db.data.admins = [...admins, user];
  await db.write();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, username });
});

app.put('/api/admin/users/:username', requireAdmin, async (req, res) => {
  await db.read();
  const username = normalizeAdminUsername(req.params.username);
  const password = String((req.body || {}).password || '');
  if (!username) return res.status(400).json({ message: 'Usuario inválido' });
  if (password.length < 4) return res.status(400).json({ message: 'Contraseña muy corta' });
  const admins = Array.isArray(db.data.admins) ? db.data.admins : [];
  const idx = admins.findIndex((a) => normalizeAdminUsername(a?.username) === username);
  if (idx < 0) return res.status(404).json({ message: 'Usuario no existe' });
  const prev = admins[idx];
  admins[idx] = { ...prev, username, passwordHash: makePasswordHash(password), updatedAt: Date.now() };
  db.data.admins = admins;
  await db.write();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, username });
});

app.delete('/api/admin/users/:username', requireAdmin, async (req, res) => {
  await db.read();
  const username = normalizeAdminUsername(req.params.username);
  if (!username) return res.status(400).json({ message: 'Usuario inválido' });
  const admins = Array.isArray(db.data.admins) ? db.data.admins : [];
  if (admins.length <= 1) return res.status(400).json({ message: 'No puedes eliminar el último admin' });
  const next = admins.filter((a) => normalizeAdminUsername(a?.username) !== username);
  if (next.length === admins.length) return res.status(404).json({ message: 'Usuario no existe' });
  db.data.admins = next;
  await db.write();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.get('/api/catalog', async (req, res) => {
  await db.read();
  res.setHeader('Cache-Control', 'no-store');
  const list = (db.data.products || [])
    .slice()
    .sort((a, b) => {
      const ati = Number.isFinite(Number(a?.targetIndex)) ? Number(a.targetIndex) : Number.POSITIVE_INFINITY;
      const bti = Number.isFinite(Number(b?.targetIndex)) ? Number(b.targetIndex) : Number.POSITIVE_INFINITY;
      if (ati !== bti) return ati - bti;
      const ac = Number.isFinite(Number(a?.createdAt)) ? Number(a.createdAt) : 0;
      const bc = Number.isFinite(Number(b?.createdAt)) ? Number(b.createdAt) : 0;
      if (ac !== bc) return ac - bc;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  res.json(list.map(normalizeProductForResponse));
});

app.get('/api/ar-objects', async (req, res) => {
  await db.read();
  res.setHeader('Cache-Control', 'no-store');
  const out = (db.data.products || []).map((p) => {
    const n = normalizeProductForResponse(p);
    return {
      id: n.id,
      name: n.name,
      description: n.description ?? '',
      price: n.price ?? 0,
      barcodeValue: n.barcodeValue ?? null,
      targetIndex: n.targetIndex ?? null,
      model: n.model,
      marker: n.marker,
      markerImage: n.marker,
      markerPatt: n.markerPatt || '',
      markerPreview: n.markerPreview || '',
      scale: n.scale || '1 1 1',
      rotation: n.rotation || '0 0 0',
      position: n.position || '0 0 0',
      details: n.details ?? null,
      createdAt: n.createdAt ?? null,
      updatedAt: n.updatedAt ?? null
    };
  });
  res.json(out);
});

function productToModelResponse(p) {
  const n = normalizeProductForResponse(p);
  return {
    _id: n.id,
    arId: n.id,
    name: n.name || '',
    description: n.description ?? '',
    price: n.price ?? 0,
    glb: n.model || '',
    markerImage: n.marker || '',
    markerPatt: n.markerPatt || '',
    markerPreview: n.markerPreview || '',
    targetIndex: n.targetIndex ?? null,
    scale: n.scale || '1 1 1',
    rotation: n.rotation || '0 0 0',
    position: n.position || '0 0 0',
    createdAt: n.createdAt ?? null,
    updatedAt: n.updatedAt ?? null
  };
}

app.get('/api/models', requireAdmin, async (req, res) => {
  await db.read();
  res.setHeader('Cache-Control', 'no-store');
  const list = (db.data.products || [])
    .slice()
    .sort((a, b) => {
      const ati = Number.isFinite(Number(a?.targetIndex)) ? Number(a.targetIndex) : Number.POSITIVE_INFINITY;
      const bti = Number.isFinite(Number(b?.targetIndex)) ? Number(b.targetIndex) : Number.POSITIVE_INFINITY;
      if (ati !== bti) return ati - bti;
      const ac = Number.isFinite(Number(a?.createdAt)) ? Number(a.createdAt) : 0;
      const bc = Number.isFinite(Number(b?.createdAt)) ? Number(b.createdAt) : 0;
      if (ac !== bc) return ac - bc;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  res.json(list.map(productToModelResponse));
});

const uploadModelAndMarker = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const field = String(file.fieldname || '').toLowerCase();
    if (field === 'glb') {
      const ext = path.extname(String(file.originalname || '')).toLowerCase();
      if (ext !== '.glb') return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'glb'));
      return cb(null, true);
    }
    if (field === 'marker') {
      const type = String(file.mimetype || '').toLowerCase();
      if (!type.startsWith('image/')) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'marker'));
      return cb(null, true);
    }
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', field || 'file'));
  }
});

app.post('/api/models', requireAdmin, uploadModelAndMarker.fields([{ name: 'glb', maxCount: 1 }, { name: 'marker', maxCount: 1 }]), async (req, res) => {
  await db.read();
  const files = req.files || {};
  const glbFile = Array.isArray(files.glb) ? files.glb[0] : null;
  const markerFile = Array.isArray(files.marker) ? files.marker[0] : null;
  if (!glbFile || !markerFile) return res.status(400).json({ message: 'Falta glb o marker' });

  const body = req.body || {};
  const name = String(body.name || '').trim();
  const description = String(body.description || '');
  const price = String(body.price || '').trim();
  const targetIndex = String(body.targetIndex || '').trim();
  const scale = String(body.scale || '').trim() || '1 1 1';
  const rotation = String(body.rotation || '').trim() || '0 0 0';
  const position = String(body.position || '').trim() || '0 0 0';

  const uploadedGlb = await saveUpload(req, glbFile, 'model');
  const uploadedMarker = await saveUpload(req, markerFile, 'marker');

  const now = Date.now();
  const product = {
    id: newId(),
    barcodeValue: null,
    targetIndex: Number.isFinite(Number(targetIndex)) ? Number(targetIndex) : null,
    name,
    price: price ? Number(price) : 0,
    description,
    model: normalizeUploadValue(uploadedGlb.url || ''),
    marker: normalizeUploadValue(uploadedMarker.url || ''),
    markerPatt: normalizeUploadValue(uploadedMarker.markerPatt || ''),
    markerPreview: normalizeUploadValue(uploadedMarker.markerPreview || ''),
    scale,
    rotation,
    position,
    createdAt: now,
    updatedAt: now
  };
  db.data.products ||= [];
  db.data.products.push(product);
  db.data.products = autoReindexProducts(db.data.products);
  await db.write();
  res.setHeader('Cache-Control', 'no-store');
  const updated = (db.data.products || []).find((p) => p && p.id === product.id) || product;
  res.json(productToModelResponse(updated));
});

app.put('/api/models/:arId', requireAdmin, uploadModelAndMarker.fields([{ name: 'glb', maxCount: 1 }, { name: 'marker', maxCount: 1 }]), async (req, res) => {
  await db.read();
  const id = String(req.params.arId || '').trim();
  const idx = (db.data.products || []).findIndex((p) => p && p.id === id);
  if (idx < 0) return res.status(404).json({ message: 'Not found' });

  const files = req.files || {};
  const glbFile = Array.isArray(files.glb) ? files.glb[0] : null;
  const markerFile = Array.isArray(files.marker) ? files.marker[0] : null;
  const body = req.body || {};

  const prev = db.data.products[idx] || {};
  const next = { ...prev };

  if (body.name !== undefined) next.name = String(body.name || '').trim();
  if (body.description !== undefined) next.description = String(body.description || '');
  if (body.price !== undefined) next.price = String(body.price || '').trim() ? Number(body.price) : 0;
  if (body.targetIndex !== undefined) next.targetIndex = String(body.targetIndex || '').trim() ? Number(body.targetIndex) : null;
  if (body.scale !== undefined) next.scale = String(body.scale || '').trim() || '1 1 1';
  if (body.rotation !== undefined) next.rotation = String(body.rotation || '').trim() || '0 0 0';
  if (body.position !== undefined) next.position = String(body.position || '').trim() || '0 0 0';

  if (glbFile) {
    const uploadedGlb = await saveUpload(req, glbFile, 'model');
    next.model = normalizeUploadValue(uploadedGlb.url || '');
  }
  if (markerFile) {
    const uploadedMarker = await saveUpload(req, markerFile, 'marker');
    next.marker = normalizeUploadValue(uploadedMarker.url || '');
    next.markerPatt = normalizeUploadValue(uploadedMarker.markerPatt || '');
    next.markerPreview = normalizeUploadValue(uploadedMarker.markerPreview || '');
  }

  next.updatedAt = Date.now();
  db.data.products[idx] = next;
  db.data.products = autoReindexProducts(db.data.products);
  await db.write();
  res.setHeader('Cache-Control', 'no-store');
  const updated = (db.data.products || []).find((p) => p && p.id === next.id) || next;
  res.json(productToModelResponse(updated));
});

app.delete('/api/models/:arId', requireAdmin, async (req, res) => {
  await db.read();
  const id = String(req.params.arId || '').trim();
  const existing = (db.data.products || []).find((p) => p && p.id === id);
  const before = (db.data.products || []).length;
  db.data.products = (db.data.products || []).filter((p) => p && p.id !== id);
  db.data.products = autoReindexProducts(db.data.products);
  const after = (db.data.products || []).length;
  await db.write();
  if (existing) {
    const tryDeleteUpload = async (value) => {
      if (!value || typeof value !== 'string') return;
      let pathname = '';
      try {
        pathname = value.startsWith('http') ? new URL(value).pathname : value;
      } catch (e) {
        pathname = value;
      }
      if (!pathname.startsWith('/uploads/')) return;
      const rel = pathname.replace(/^\/+/, '');
      const abs = path.join(__dirname, rel);
      if (!abs.startsWith(UPLOADS_DIR)) return;
      try {
        await fs.unlink(abs);
      } catch (e) {}
    };
    await Promise.all([tryDeleteUpload(existing.model), tryDeleteUpload(existing.marker), tryDeleteUpload(existing.markerPatt), tryDeleteUpload(existing.markerPreview)]);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, removed: before - after });
});

app.get('/api/analytics/summary', async (req, res) => {
  const days = Math.max(1, Math.min(60, Number(req.query?.days || 7) || 7));
  const now = new Date();
  const daily = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    daily.push({ date, uniqueUsers: 0 });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ days, uniqueUsersToday: 0, uniqueUsersLastNDays: 0, totalUniqueUsers: 0, daily });
});

function uploadBasenameFromValue(value) {
  if (!value || typeof value !== 'string') return null;
  let pathname = '';
  try {
    pathname = value.startsWith('http') ? new URL(value).pathname : value;
  } catch (e) {
    pathname = value;
  }
  if (!pathname.startsWith('/uploads/')) return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const folder = parts[1];
  const filename = parts.slice(2).join('/');
  if (filename.includes('/') || filename.includes('\\')) return null;
  if (folder !== 'models' && folder !== 'markers' && folder !== 'patterns' && folder !== 'marker-previews') return null;
  return { folder, filename };
}

async function computeDirStats(dir, referenced) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return { count: 0, bytes: 0, orphanCount: 0, orphanBytes: 0, orphansSample: [] };
  }
  let count = 0;
  let bytes = 0;
  let orphanCount = 0;
  let orphanBytes = 0;
  const orphansSample = [];
  for (const ent of entries) {
    if (!ent || !ent.isFile()) continue;
    count += 1;
    const abs = path.join(dir, ent.name);
    try {
      const st = await fs.stat(abs);
      bytes += Number(st.size) || 0;
      if (referenced && !referenced.has(ent.name)) {
        orphanCount += 1;
        orphanBytes += Number(st.size) || 0;
        if (orphansSample.length < 25) orphansSample.push(ent.name);
      }
    } catch (e) {}
  }
  return { count, bytes, orphanCount, orphanBytes, orphansSample };
}

async function listOrphanFiles(dir, referenced) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const orphans = [];
  for (const ent of entries) {
    if (!ent || !ent.isFile()) continue;
    if (referenced && referenced.has(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    try {
      const st = await fs.stat(abs);
      orphans.push({ name: ent.name, bytes: Number(st.size) || 0 });
    } catch (e) {
      orphans.push({ name: ent.name, bytes: 0 });
    }
  }
  return orphans;
}

app.get('/api/uploads/stats', async (req, res) => {
  if (!isAdminTokenValid(parseBearerToken(req))) return res.status(401).json({ message: 'Unauthorized' });
  await db.read();
  const referencedModels = new Set();
  const referencedMarkers = new Set();
  for (const p of db.data.products || []) {
    const model = uploadBasenameFromValue(p?.model);
    const marker = uploadBasenameFromValue(p?.marker);
    if (model && model.folder === 'models') referencedModels.add(model.filename);
    if (marker && marker.folder === 'markers') referencedMarkers.add(marker.filename);
  }
  const [models, markers] = await Promise.all([
    computeDirStats(MODELS_DIR, referencedModels),
    computeDirStats(MARKERS_DIR, referencedMarkers)
  ]);
  let targets = { exists: false, bytes: 0, mtimeMs: null };
  try {
    const st = await fs.stat(TARGETS_PATH);
    targets = { exists: true, bytes: Number(st.size) || 0, mtimeMs: Number(st.mtimeMs) || null };
  } catch (e) {}
  res.setHeader('Cache-Control', 'no-store');
  res.json({ models, markers, targets });
});

app.post('/api/uploads/cleanup', async (req, res) => {
  if (!isAdminTokenValid(parseBearerToken(req))) return res.status(401).json({ message: 'Unauthorized' });
  await db.read();
  const referencedModels = new Set();
  const referencedMarkers = new Set();
  for (const p of db.data.products || []) {
    const model = uploadBasenameFromValue(p?.model);
    const marker = uploadBasenameFromValue(p?.marker);
    if (model && model.folder === 'models') referencedModels.add(model.filename);
    if (marker && marker.folder === 'markers') referencedMarkers.add(marker.filename);
  }

  const dryRun = String(req.query?.dryRun || '').toLowerCase() === '1' || String(req.query?.dryRun || '').toLowerCase() === 'true';
  const modelOrphans = await listOrphanFiles(MODELS_DIR, referencedModels);
  const markerOrphans = await listOrphanFiles(MARKERS_DIR, referencedMarkers);

  if (dryRun) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      dryRun: true,
      models: { count: modelOrphans.length, bytes: modelOrphans.reduce((a, f) => a + (Number(f.bytes) || 0), 0), sample: modelOrphans.slice(0, 25) },
      markers: { count: markerOrphans.length, bytes: markerOrphans.reduce((a, f) => a + (Number(f.bytes) || 0), 0), sample: markerOrphans.slice(0, 25) }
    });
  }

  let deletedModels = 0;
  let deletedMarkers = 0;
  let deletedBytes = 0;
  const errors = [];

  for (const f of modelOrphans) {
    const abs = path.join(MODELS_DIR, f.name);
    try {
      await fs.unlink(abs);
      deletedModels += 1;
      deletedBytes += Number(f.bytes) || 0;
    } catch (e) {
      errors.push({ file: `models/${f.name}`, message: e?.message ? String(e.message) : 'delete failed' });
    }
  }
  for (const f of markerOrphans) {
    const abs = path.join(MARKERS_DIR, f.name);
    try {
      await fs.unlink(abs);
      deletedMarkers += 1;
      deletedBytes += Number(f.bytes) || 0;
    } catch (e) {
      errors.push({ file: `markers/${f.name}`, message: e?.message ? String(e.message) : 'delete failed' });
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: errors.length === 0, dryRun: false, deletedModels, deletedMarkers, deletedBytes, errors: errors.slice(0, 50) });
});

app.put('/api/catalog', requireAdmin, async (req, res) => {
  const incoming = req.body;
  if (!Array.isArray(incoming)) return res.status(400).json({ message: 'Expected an array' });
  const now = Date.now();
  const products = incoming
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const id = p.id ? String(p.id) : newId();
      return {
        id,
        barcodeValue: Number.isFinite(p.barcodeValue) ? p.barcodeValue : null,
        targetIndex: Number.isFinite(p.targetIndex) ? p.targetIndex : null,
        name: typeof p.name === 'string' ? p.name : '',
        price: p.price ?? 0,
        description: typeof p.description === 'string' ? p.description : '',
        model: normalizeUploadValue(typeof p.model === 'string' ? p.model : ''),
        marker: normalizeUploadValue(typeof p.marker === 'string' ? p.marker : ''),
        markerPatt: normalizeUploadValue(typeof p.markerPatt === 'string' ? p.markerPatt : ''),
        markerPreview: normalizeUploadValue(typeof p.markerPreview === 'string' ? p.markerPreview : ''),
        scale: typeof p.scale === 'string' ? p.scale : '1 1 1',
        rotation: typeof p.rotation === 'string' ? p.rotation : '0 0 0',
        position: typeof p.position === 'string' ? p.position : '0 0 0',
        details: p.details ?? null,
        createdAt: Number.isFinite(p.createdAt) ? p.createdAt : now,
        updatedAt: now
      };
    });

  await db.read();
  db.data.products = autoReindexProducts(products);
  await db.write();
  res.json((db.data.products || []).map(normalizeProductForResponse));
});

app.post('/api/products', requireAdmin, async (req, res) => {
  await db.read();
  const body = req.body || {};
  const id = body.id ? String(body.id) : newId();

  const product = {
    id,
    barcodeValue: Number.isFinite(body.barcodeValue) ? body.barcodeValue : null,
    targetIndex: Number.isFinite(body.targetIndex) ? body.targetIndex : null,
    name: typeof body.name === 'string' ? body.name : '',
    price: body.price ?? 0,
    description: typeof body.description === 'string' ? body.description : '',
    model: normalizeUploadValue(typeof body.model === 'string' ? body.model : ''),
    marker: normalizeUploadValue(typeof body.marker === 'string' ? body.marker : ''),
    markerPatt: normalizeUploadValue(typeof body.markerPatt === 'string' ? body.markerPatt : ''),
    markerPreview: normalizeUploadValue(typeof body.markerPreview === 'string' ? body.markerPreview : ''),
    scale: typeof body.scale === 'string' ? body.scale : '1 1 1',
    rotation: typeof body.rotation === 'string' ? body.rotation : '0 0 0',
    position: typeof body.position === 'string' ? body.position : '0 0 0',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const existingIndex = (db.data.products || []).findIndex((p) => p && p.id === id);
  if (existingIndex >= 0) {
    db.data.products[existingIndex] = { ...db.data.products[existingIndex], ...product, updatedAt: Date.now() };
  } else {
    db.data.products.push(product);
  }

  db.data.products = autoReindexProducts(db.data.products);
  await db.write();
  const updated = (db.data.products || []).find((p) => p && p.id === id) || product;
  res.json(normalizeProductForResponse(updated));
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  await db.read();
  const id = String(req.params.id);
  const idx = (db.data.products || []).findIndex((p) => p && p.id === id);
  if (idx < 0) return res.status(404).json({ message: 'Not found' });

  const body = req.body || {};
  const prev = db.data.products[idx];
  const next = {
    ...prev,
    ...body,
    id,
    model: normalizeUploadValue(typeof body.model === 'string' ? body.model : prev.model),
    marker: normalizeUploadValue(typeof body.marker === 'string' ? body.marker : prev.marker),
    markerPatt: normalizeUploadValue(typeof body.markerPatt === 'string' ? body.markerPatt : prev.markerPatt),
    markerPreview: normalizeUploadValue(typeof body.markerPreview === 'string' ? body.markerPreview : prev.markerPreview),
    updatedAt: Date.now()
  };
  db.data.products[idx] = next;
  db.data.products = autoReindexProducts(db.data.products);
  await db.write();
  const updated = (db.data.products || []).find((p) => p && p.id === id) || next;
  res.json(normalizeProductForResponse(updated));
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  await db.read();
  const id = String(req.params.id);
  const existing = (db.data.products || []).find((p) => p && p.id === id);
  const before = db.data.products.length;
  db.data.products = (db.data.products || []).filter((p) => p && p.id !== id);
  db.data.products = autoReindexProducts(db.data.products);
  const after = db.data.products.length;
  await db.write();
  if (existing) {
    const tryDeleteUpload = async (value) => {
      if (!value || typeof value !== 'string') return;
      let pathname = '';
      try {
        pathname = value.startsWith('http') ? new URL(value).pathname : value;
      } catch (e) {
        pathname = value;
      }
      if (!pathname.startsWith('/uploads/')) return;
      const rel = pathname.replace(/^\/+/, '');
      const abs = path.join(__dirname, rel);
      if (!abs.startsWith(UPLOADS_DIR)) return;
      try {
        await fs.unlink(abs);
      } catch (e) {}
    };
    await Promise.all([
      tryDeleteUpload(existing.model),
      tryDeleteUpload(existing.marker),
      tryDeleteUpload(existing.markerPatt),
      tryDeleteUpload(existing.markerPreview)
    ]);
  }
  res.json({ ok: true, removed: before - after });
});

const uploadModel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    if (ext !== '.glb') return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'model'));
    cb(null, true);
  }
});

const uploadMarker = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const type = String(file.mimetype || '').toLowerCase();
    const ok = type.startsWith('image/');
    if (!ok) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'marker'));
    cb(null, true);
  }
});

async function saveUpload(req, file, kind) {
  const original = String(file.originalname || 'file');
  const ext = path.extname(original);
  const base = ext ? original.slice(0, -ext.length) : original;
  const filename = `${Date.now()}_${newId()}_${safeName(base)}${ext}`;
  const dir = kind === 'model' ? MODELS_DIR : MARKERS_DIR;
  const rel = kind === 'model' ? `/uploads/models/${filename}` : `/uploads/markers/${filename}`;
  const abs = path.join(dir, filename);
  await fs.writeFile(abs, file.buffer);
  if (kind !== 'marker') return { url: absoluteUrl(req, rel) };

  const markerBase = path.basename(filename, path.extname(filename));
  const artifacts = await generateMarkerArtifactsFromFile({
    markerAbsPath: abs,
    patternsDir: PATTERNS_DIR,
    previewsDir: MARKER_PREVIEWS_DIR,
    baseName: markerBase
  });
  return {
    url: absoluteUrl(req, rel),
    markerPatt: absoluteUrl(req, `/uploads/patterns/${artifacts.pattFilename}`),
    markerPreview: absoluteUrl(req, `/uploads/marker-previews/${artifacts.previewFilename}`)
  };
}

app.post('/api/upload/model', uploadModel.single('file'), async (req, res) => {
  if (!isAdminTokenValid(parseBearerToken(req))) return res.status(401).json({ message: 'Unauthorized' });
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Missing file' });
  const out = await saveUpload(req, file, 'model');
  res.json(out);
});

app.post('/api/upload/marker', uploadMarker.single('file'), async (req, res) => {
  if (!isAdminTokenValid(parseBearerToken(req))) return res.status(401).json({ message: 'Unauthorized' });
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Missing file' });
  const out = await saveUpload(req, file, 'marker');
  res.json(out);
});

app.post('/api/upload/targets', express.json({ limit: '50mb' }), async (req, res) => {
  if (!isAdminTokenValid(parseBearerToken(req))) return res.status(401).json({ message: 'Unauthorized' });
  const { base64 } = req.body || {};
  if (!base64 || typeof base64 !== 'string') return res.status(400).json({ message: 'Missing base64' });
  const buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  if (!buffer || buffer.length < 1024) return res.status(400).json({ message: 'Invalid targets.mind' });
  const tmpPath = `${TARGETS_PATH}.tmp`;
  await fs.writeFile(tmpPath, buffer);
  await fs.rename(tmpPath, TARGETS_PATH);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ url: absoluteUrl(req, '/api/targets.mind') });
});

app.get('/api/targets.mind', async (req, res) => {
  const fallbackAbs = path.join(FRONTEND_DIR, 'targets.mind');
  try {
    let abs = TARGETS_PATH;
    let size = 0;
    try {
      const st = await fs.stat(abs);
      size = Number(st.size) || 0;
    } catch (e) {
      size = 0;
    }

    if (size < 1024) {
      abs = fallbackAbs;
      const st2 = await fs.stat(abs);
      size = Number(st2.size) || 0;
      if (size < 1024) throw new Error('targets.mind too small');
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(abs);
  } catch (e) {
    res.status(404).json({ message: 'targets.mind not found' });
  }
});

function downloadText(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: 'GET',
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname || ''}${u.search || ''}`,
        headers: {
          'user-agent': 'webar-server',
          accept: '*/*'
        }
      },
      (resp) => {
        const status = Number(resp.statusCode) || 0;
        const location = resp.headers.location ? String(resp.headers.location) : '';
        if (status >= 300 && status < 400 && location) {
          resp.resume();
          return resolve(downloadText(new URL(location, url).toString()));
        }
        if (status < 200 || status >= 300) {
          resp.resume();
          return reject(new Error(`HTTP ${status}`));
        }
        resp.setEncoding('utf8');
        let buf = '';
        resp.on('data', (chunk) => {
          buf += chunk;
        });
        resp.on('end', () => resolve(buf));
      }
    );
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

app.get('/vendor/mindar/compiler.js', async (req, res) => {
  try {
    const now = Date.now();
    if (cachedMindArCompilerJs && now - cachedMindArCompilerJsAt < 1000 * 60 * 60 * 12) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      return res.send(cachedMindArCompilerJs);
    }

    const urls = [
      'https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.5/src/image-target/compiler.js',
      'https://esm.sh/gh/hiukim/mind-ar-js@1.2.5/src/image-target/compiler.js'
    ];
    let lastErr = null;
    for (const url of urls) {
      try {
        const js = await downloadText(url);
        if (!js || js.length < 2000) throw new Error('compiler script too small');
        cachedMindArCompilerJs = js;
        cachedMindArCompilerJsAt = Date.now();
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        return res.send(js);
      } catch (e) {
        lastErr = e;
      }
    }
    res.status(503).json({ message: `No se pudo obtener MindAR compiler: ${String(lastErr?.message || lastErr || 'error')}` });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: false, maxAge: '30d', immutable: true }));
app.use(
  '/admin',
  express.static(ADMIN_DIST_DIR, {
    maxAge: '1h',
    setHeaders(res, filePath) {
      const p = String(filePath || '').toLowerCase();
      if (p.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
        return;
      }
      if (p.includes('/assets/') && (p.endsWith('.js') || p.endsWith('.css'))) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      if (p.endsWith('.js') || p.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    }
  })
);
app.get('/admin', (req, res) => res.redirect(302, '/admin/'));
app.get('/admin/*', async (req, res) => {
  try {
    const indexAbs = path.join(ADMIN_DIST_DIR, 'index.html');
    await fs.access(indexAbs);
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(indexAbs);
  } catch (e) {
    return res.status(503).json({ message: 'Admin no compilado. Ejecuta build del admin-dashboard.' });
  }
});
app.use(
  express.static(FRONTEND_DIR, {
    maxAge: '1h',
    setHeaders(res, filePath) {
      const p = String(filePath || '').toLowerCase();
      if (p.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store');
        return;
      }
      if (p.endsWith('.js') || p.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    }
  })
);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File too large' });
    return res.status(400).json({ message: 'Invalid upload' });
  }
  const status = Number(err?.status || err?.statusCode || 0) || 500;
  if (status >= 400 && status < 600 && status !== 500) {
    if (typeof err?.message === 'string' && err.message) return res.status(status).json({ message: err.message });
    return res.sendStatus(status);
  }
  if (err && typeof err.message === 'string') {
    return res.status(500).json({ message: err.message });
  }
  return res.status(500).json({ message: 'Server error' });
});

function listenOnce(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', (err) => {
      try {
        server.close(() => {});
      } catch (e) {}
      reject(err);
    });
    server.once('listening', () => resolve(server));
    server.listen(port, HOST);
  });
}

async function listenWithFallback(startPort) {
  const maxTries = Math.max(1, Math.min(50, Number(process.env.PORT_TRIES || 20) || 20));
  let port = Number(startPort) || 8000;
  for (let i = 0; i < maxTries; i += 1) {
    try {
      const server = await listenOnce(port);
      return { server, port };
    } catch (err) {
      const code = String(err?.code || '');
      if (code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`No hay puerto disponible desde ${startPort}`);
}

listenWithFallback(BASE_PORT)
  .then(({ port }) => {
    console.log(`Server running at http://${HOST}:${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
