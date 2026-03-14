import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { generateMarkerArtifactsFromFile } from './backend-api/src/utils/markerGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';

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
    marker: normalizeUploadValue(product.marker),
    markerPatt: normalizeUploadValue(product.markerPatt),
    markerPreview: normalizeUploadValue(product.markerPreview)
  };
}

await ensureDirs();
const db = new Low(new JSONFile(DB_PATH), { products: [] });
await db.read();
db.data ||= { products: [] };

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

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,DELETE,OPTIONS');
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
    markerPatt: normalizeUploadValue(typeof body.markerPatt === 'string' ? body.markerPatt : prev.markerPatt),
    markerPreview: normalizeUploadValue(typeof body.markerPreview === 'string' ? body.markerPreview : prev.markerPreview),
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
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Missing file' });
  const out = await saveUpload(req, file, 'model');
  res.json(out);
});

app.post('/api/upload/marker', uploadMarker.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Missing file' });
  const out = await saveUpload(req, file, 'marker');
  res.json(out);
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

app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: false, maxAge: '30d', immutable: true }));
app.use('/admin', express.static(ADMIN_DIST_DIR, { maxAge: '1h' }));
app.use(express.static(FRONTEND_DIR, { maxAge: '1h' }));

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

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
