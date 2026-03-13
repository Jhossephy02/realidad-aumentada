import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';

function resolveDir(envValue, fallbackAbs) {
  const raw = String(envValue || '').trim();
  if (!raw) return fallbackAbs;
  return path.isAbsolute(raw) ? raw : path.join(__dirname, raw);
}

const DATA_DIR = resolveDir(process.env.DATA_DIR, path.join(__dirname, 'data'));
const DB_PATH = path.join(DATA_DIR, 'db.json');

const UPLOADS_DIR = resolveDir(process.env.UPLOADS_DIR, path.join(__dirname, 'uploads'));
const MODELS_DIR = path.join(UPLOADS_DIR, 'models');
const MARKERS_DIR = path.join(UPLOADS_DIR, 'markers');
const TARGETS_DIR = path.join(UPLOADS_DIR, 'targets');
const TARGETS_PATH = path.join(TARGETS_DIR, 'targets.mind');

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(MODELS_DIR, { recursive: true });
  await fs.mkdir(MARKERS_DIR, { recursive: true });
  await fs.mkdir(TARGETS_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch (e) {
    await fs.writeFile(DB_PATH, JSON.stringify({ products: [] }, null, 2), 'utf8');
  }
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
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
    marker: normalizeUploadValue(product.marker)
  };
}

await ensureDirs();
const db = new Low(new JSONFile(DB_PATH), { products: [] });
await db.read();
db.data ||= { products: [] };

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, now: Date.now() });
});

app.get('/api/catalog', async (req, res) => {
  await db.read();
  res.setHeader('Cache-Control', 'no-store');
  res.json((db.data.products || []).map(normalizeProductForResponse));
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
  if (folder !== 'models' && folder !== 'markers') return null;
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

app.put('/api/catalog', async (req, res) => {
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
        scale: typeof p.scale === 'string' ? p.scale : '1 1 1',
        rotation: typeof p.rotation === 'string' ? p.rotation : '0 0 0',
        position: typeof p.position === 'string' ? p.position : '0 0 0',
        createdAt: Number.isFinite(p.createdAt) ? p.createdAt : now,
        updatedAt: now
      };
    });

  await db.read();
  db.data.products = products;
  await db.write();
  res.json(products.map(normalizeProductForResponse));
});

app.post('/api/products', async (req, res) => {
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

  await db.write();
  res.json(normalizeProductForResponse(product));
});

app.put('/api/products/:id', async (req, res) => {
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
    updatedAt: Date.now()
  };
  db.data.products[idx] = next;
  await db.write();
  res.json(normalizeProductForResponse(next));
});

app.delete('/api/products/:id', async (req, res) => {
  await db.read();
  const id = String(req.params.id);
  const existing = (db.data.products || []).find((p) => p && p.id === id);
  const before = db.data.products.length;
  db.data.products = (db.data.products || []).filter((p) => p && p.id !== id);
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
    await Promise.all([tryDeleteUpload(existing.model), tryDeleteUpload(existing.marker)]);
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
  await fs.writeFile(path.join(dir, filename), file.buffer);
  return absoluteUrl(req, rel);
}

app.post('/api/upload/model', uploadModel.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Missing file' });
  const url = await saveUpload(req, file, 'model');
  res.json({ url });
});

app.post('/api/upload/marker', uploadMarker.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Missing file' });
  const url = await saveUpload(req, file, 'marker');
  res.json({ url });
});

app.post('/api/upload/targets', express.json({ limit: '50mb' }), async (req, res) => {
  const { base64 } = req.body || {};
  if (!base64 || typeof base64 !== 'string') return res.status(400).json({ message: 'Missing base64' });
  const buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  await fs.writeFile(TARGETS_PATH, buffer);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ url: absoluteUrl(req, '/api/targets.mind') });
});

app.get('/api/targets.mind', async (req, res) => {
  try {
    await fs.access(TARGETS_PATH);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(TARGETS_PATH);
  } catch (e) {
    res.status(404).json({ message: 'targets.mind not found' });
  }
});

app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: false, maxAge: '30d', immutable: true }));
app.use(express.static(__dirname, { maxAge: '1h' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File too large' });
    return res.status(400).json({ message: 'Invalid upload' });
  }
  if (err && typeof err.message === 'string') {
    return res.status(500).json({ message: err.message });
  }
  return res.status(500).json({ message: 'Server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
