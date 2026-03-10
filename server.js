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

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
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

await ensureDirs();
const db = new Low(new JSONFile(DB_PATH), { products: [] });
await db.read();
db.data ||= { products: [] };

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/catalog', async (req, res) => {
  await db.read();
  res.json(db.data.products || []);
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
        model: typeof p.model === 'string' ? p.model : '',
        marker: typeof p.marker === 'string' ? p.marker : '',
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
  res.json(products);
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
    model: typeof body.model === 'string' ? body.model : '',
    marker: typeof body.marker === 'string' ? body.marker : '',
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
  res.json(product);
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
    updatedAt: Date.now()
  };
  db.data.products[idx] = next;
  await db.write();
  res.json(next);
});

app.delete('/api/products/:id', async (req, res) => {
  await db.read();
  const id = String(req.params.id);
  const before = db.data.products.length;
  db.data.products = (db.data.products || []).filter((p) => p && p.id !== id);
  const after = db.data.products.length;
  await db.write();
  res.json({ ok: true, removed: before - after });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }
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

app.post('/api/upload/model', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Missing file' });
  const url = await saveUpload(req, file, 'model');
  res.json({ url });
});

app.post('/api/upload/marker', upload.single('file'), async (req, res) => {
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
  res.json({ url: absoluteUrl(req, '/api/targets.mind') });
});

app.get('/api/targets.mind', async (req, res) => {
  try {
    await fs.access(TARGETS_PATH);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(TARGETS_PATH);
  } catch (e) {
    res.status(404).json({ message: 'targets.mind not found' });
  }
});

app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: false }));
app.use(express.static(__dirname));

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
