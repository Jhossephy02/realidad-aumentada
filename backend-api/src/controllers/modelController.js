import fs from 'fs/promises';
import path from 'path';
import { ArModel } from '../models/ArModel.js';
import { MARKER_PREVIEWS_DIR, PATTERNS_DIR, UPLOADS_DIR } from '../config/paths.js';
import { generateMarkerArtifactsFromFile } from '../utils/markerGenerator.js';

function toCatalogItem(doc) {
  return {
    id: doc.arId,
    barcodeValue: doc.barcodeValue ?? null,
    targetIndex: doc.targetIndex ?? null,
    name: doc.name,
    price: doc.price ?? 0,
    description: doc.description ?? '',
    model: normalizeUploadValue(doc.glb),
    marker: normalizeUploadValue(doc.markerImage),
    markerPatt: normalizeUploadValue(doc.markerPatt || ''),
    markerPreview: normalizeUploadValue(doc.markerPreview || ''),
    scale: doc.scale || '1 1 1',
    rotation: doc.rotation || '0 0 0',
    position: doc.position || '0 0 0',
    details: doc.details ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function relUploadPath(kind, filename) {
  if (kind === 'model') return `/uploads/models/${filename}`;
  if (kind === 'marker') return `/uploads/markers/${filename}`;
  if (kind === 'pattern') return `/uploads/patterns/${filename}`;
  if (kind === 'markerPreview') return `/uploads/marker-previews/${filename}`;
  return '';
}

function normalizeUploadValue(value) {
  if (!value || typeof value !== 'string') return '';
  let pathname = '';
  try {
    pathname = value.startsWith('http') ? new URL(value).pathname : value;
  } catch (e) {
    pathname = value;
  }
  if (value.startsWith('http')) {
    if (pathname && pathname.startsWith('/')) return pathname;
    return '';
  }
  return pathname;
}

async function deleteUploadByUrl(url) {
  const value = String(url || '');
  if (!value.startsWith('/uploads/')) return;
  const rel = value.replace(/^\/+/, '');
  const abs = path.join(UPLOADS_DIR, rel.replace(/^uploads[\\/]/, ''));
  const resolved = path.resolve(abs);
  const uploadsResolved = path.resolve(UPLOADS_DIR);
  if (!resolved.startsWith(uploadsResolved)) return;
  try {
    await fs.unlink(resolved);
  } catch (e) {}
}

export async function listModels(req, res) {
  const docs = await ArModel.find({}).sort({ createdAt: -1 }).lean();
  res.json(docs);
}

export async function listCatalog(req, res) {
  const docs = await ArModel.find({}).sort({ createdAt: 1 }).lean();
  const items = docs.map(toCatalogItem);
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (!it) continue;
    if (!Number.isFinite(Number(it.targetIndex))) it.targetIndex = i;
  }
  res.json(items);
}

export async function listArObjects(req, res) {
  const docs = await ArModel.find({}).sort({ createdAt: 1 }).lean();
  const out = docs.map((d) => ({
    id: d.arId,
    name: d.name,
    description: d.description ?? '',
    price: d.price ?? 0,
    barcodeValue: d.barcodeValue ?? null,
    targetIndex: d.targetIndex ?? null,
    model: normalizeUploadValue(d.glb),
    marker: normalizeUploadValue(d.markerImage),
    markerImage: normalizeUploadValue(d.markerImage),
    markerPatt: normalizeUploadValue(d.markerPatt || ''),
    markerPreview: normalizeUploadValue(d.markerPreview || ''),
    scale: d.scale || '1 1 1',
    rotation: d.rotation || '0 0 0',
    position: d.position || '0 0 0',
    details: d.details ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  }));
  res.json(out);
}

export async function getModel(req, res) {
  const arId = String(req.params.arId || '').trim();
  const doc = await ArModel.findOne({ arId }).lean();
  if (!doc) return res.status(404).json({ message: 'Not found' });
  res.json(doc);
}

export async function createModel(req, res) {
  let name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '');
  const price = req.body?.price != null ? Number(req.body.price) : 0;
  const barcodeValue = req.body?.barcodeValue != null && Number.isFinite(Number(req.body.barcodeValue)) ? Number(req.body.barcodeValue) : null;
  let targetIndex = req.body?.targetIndex != null && Number.isFinite(Number(req.body.targetIndex)) ? Number(req.body.targetIndex) : null;
  const scale = typeof req.body?.scale === 'string' ? req.body.scale : '1 1 1';
  const rotation = typeof req.body?.rotation === 'string' ? req.body.rotation : '0 0 0';
  const position = typeof req.body?.position === 'string' ? req.body.position : '0 0 0';

  const glbFile = req.files?.glb?.[0] || req.files?.model?.[0] || null;
  const markerFile = req.files?.marker?.[0] || req.files?.markerImage?.[0] || null;
  if (!glbFile) return res.status(400).json({ message: 'Missing glb' });
  if (!markerFile) return res.status(400).json({ message: 'Missing marker image' });

  if (!name) {
    const base = String(glbFile.originalname || 'Modelo').replace(/\\/g, '/').split('/').pop();
    name = String(base || 'Modelo').replace(/\.glb$/i, '').trim() || 'Modelo';
  }

  const glb = relUploadPath('model', glbFile.filename);
  const markerImage = relUploadPath('marker', markerFile.filename);
  const markerBase = path.basename(markerFile.filename, path.extname(markerFile.filename));
  const markerAbsPath = markerFile.path;
  const artifacts = await generateMarkerArtifactsFromFile({
    markerAbsPath,
    patternsDir: PATTERNS_DIR,
    previewsDir: MARKER_PREVIEWS_DIR,
    baseName: markerBase
  });
  const markerPatt = relUploadPath('pattern', artifacts.pattFilename);
  const markerPreview = relUploadPath('markerPreview', artifacts.previewFilename);

  if (targetIndex === null) {
    const max = await ArModel.find({ targetIndex: { $ne: null } }).sort({ targetIndex: -1 }).select({ targetIndex: 1 }).lean();
    const maxVal = max && max[0] && Number.isFinite(max[0].targetIndex) ? Number(max[0].targetIndex) : -1;
    targetIndex = maxVal + 1;
  }

  const doc = await ArModel.create({
    name,
    description,
    price: Number.isFinite(price) ? price : 0,
    glb,
    markerImage,
    markerPattern: '',
    markerPatt,
    markerPreview,
    markerMeta: artifacts.meta,
    barcodeValue,
    targetIndex,
    scale,
    rotation,
    position
  });

  res.status(201).json(doc);
}

export async function replaceCatalog(req, res) {
  const items = Array.isArray(req.body) ? req.body : [];
  const ids = items
    .map((i) => (i && typeof i.id === 'string' ? i.id.trim() : ''))
    .filter(Boolean);

  if (ids.length === 0) {
    await ArModel.deleteMany({});
    return res.json([]);
  }

  await ArModel.deleteMany({ arId: { $nin: ids } });

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const arId = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!arId) continue;
    const next = {};
    if (typeof raw.name === 'string') next.name = raw.name.trim();
    if (typeof raw.description === 'string') next.description = raw.description;
    if (raw.price != null) next.price = Number(raw.price);
    if (raw.barcodeValue != null) next.barcodeValue = Number.isFinite(Number(raw.barcodeValue)) ? Number(raw.barcodeValue) : null;
    if (raw.targetIndex != null) next.targetIndex = Number.isFinite(Number(raw.targetIndex)) ? Number(raw.targetIndex) : null;
    if (typeof raw.model === 'string') next.glb = normalizeUploadValue(raw.model);
    if (typeof raw.marker === 'string') next.markerImage = normalizeUploadValue(raw.marker);
    if (typeof raw.markerPatt === 'string') next.markerPatt = normalizeUploadValue(raw.markerPatt);
    if (typeof raw.markerPreview === 'string') next.markerPreview = normalizeUploadValue(raw.markerPreview);
    if (typeof raw.scale === 'string') next.scale = raw.scale;
    if (typeof raw.rotation === 'string') next.rotation = raw.rotation;
    if (typeof raw.position === 'string') next.position = raw.position;
    if (raw.details != null) next.details = raw.details;

    const doc = await ArModel.findOne({ arId });
    if (!doc) {
      if (!next.name) continue;
      if (!next.glb) continue;
      if (!next.markerImage) continue;
      await ArModel.create({ arId, ...next });
    } else {
      Object.assign(doc, next);
      await doc.save();
    }
  }

  const docs = await ArModel.find({}).sort({ targetIndex: 1, createdAt: 1 }).lean();
  res.json(docs.map(toCatalogItem));
}

export async function updateModel(req, res) {
  const arId = String(req.params.arId || '').trim();
  const doc = await ArModel.findOne({ arId });
  if (!doc) return res.status(404).json({ message: 'Not found' });

  const next = {};
  if (typeof req.body?.name === 'string') next.name = String(req.body.name).trim();
  if (typeof req.body?.description === 'string') next.description = String(req.body.description);
  if (req.body?.price != null) next.price = Number(req.body.price);
  if (req.body?.barcodeValue != null) next.barcodeValue = Number.isFinite(Number(req.body.barcodeValue)) ? Number(req.body.barcodeValue) : null;
  if (req.body?.targetIndex != null) next.targetIndex = Number.isFinite(Number(req.body.targetIndex)) ? Number(req.body.targetIndex) : null;
  if (typeof req.body?.scale === 'string') next.scale = req.body.scale;
  if (typeof req.body?.rotation === 'string') next.rotation = req.body.rotation;
  if (typeof req.body?.position === 'string') next.position = req.body.position;
  if (req.body?.details != null) next.details = req.body.details;

  const glbFile = req.files?.glb?.[0] || req.files?.model?.[0] || null;
  const markerFile = req.files?.marker?.[0] || req.files?.markerImage?.[0] || null;

  if (glbFile) {
    const prev = doc.glb;
    next.glb = relUploadPath('model', glbFile.filename);
    await deleteUploadByUrl(prev);
  }
  if (markerFile) {
    const prev = doc.markerImage;
    const prevPatt = doc.markerPatt;
    const prevPreview = doc.markerPreview;
    next.markerImage = relUploadPath('marker', markerFile.filename);
    await deleteUploadByUrl(prev);
    if (prevPatt) await deleteUploadByUrl(prevPatt);
    if (prevPreview) await deleteUploadByUrl(prevPreview);

    const markerBase = path.basename(markerFile.filename, path.extname(markerFile.filename));
    const artifacts = await generateMarkerArtifactsFromFile({
      markerAbsPath: markerFile.path,
      patternsDir: PATTERNS_DIR,
      previewsDir: MARKER_PREVIEWS_DIR,
      baseName: markerBase
    });
    next.markerPatt = relUploadPath('pattern', artifacts.pattFilename);
    next.markerPreview = relUploadPath('markerPreview', artifacts.previewFilename);
    next.markerMeta = artifacts.meta;
  }

  Object.assign(doc, next);
  await doc.save();
  res.json(doc);
}

export async function deleteModel(req, res) {
  const arId = String(req.params.arId || '').trim();
  const doc = await ArModel.findOne({ arId });
  if (!doc) return res.json({ ok: true });

  const glb = doc.glb;
  const marker = doc.markerImage;
  const patt = doc.markerPatt;
  const preview = doc.markerPreview;
  await ArModel.deleteOne({ arId });
  await Promise.all([deleteUploadByUrl(glb), deleteUploadByUrl(marker), deleteUploadByUrl(patt), deleteUploadByUrl(preview)]);
  res.json({ ok: true });
}

export async function deleteProduct(req, res) {
  req.params = { ...(req.params || {}), arId: String(req.params.id || '') };
  return await deleteModel(req, res);
}

export async function uploadModelOnly(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Missing file' });
  const url = relUploadPath('model', file.filename);
  res.json({ url });
}

export async function uploadMarkerOnly(req, res) {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Missing file' });
  const url = relUploadPath('marker', file.filename);
  res.json({ url });
}

export async function createProduct(req, res) {
  const body = req.body || {};
  const name = String(body?.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Missing name' });
  const model = normalizeUploadValue(body?.model);
  const marker = normalizeUploadValue(body?.marker);
  if (!model) return res.status(400).json({ message: 'Missing model' });
  if (!marker) return res.status(400).json({ message: 'Missing marker' });

  let targetIndex = Number.isFinite(Number(body?.targetIndex)) ? Number(body.targetIndex) : null;
  if (targetIndex === null) {
    const max = await ArModel.find({ targetIndex: { $ne: null } }).sort({ targetIndex: -1 }).select({ targetIndex: 1 }).lean();
    const maxVal = max && max[0] && Number.isFinite(max[0].targetIndex) ? Number(max[0].targetIndex) : -1;
    targetIndex = maxVal + 1;
  }

  const doc = await ArModel.create({
    name,
    description: typeof body?.description === 'string' ? body.description : '',
    price: body?.price != null ? Number(body.price) : 0,
    glb: model,
    markerImage: marker,
    markerPattern: typeof body?.markerPattern === 'string' ? body.markerPattern : '',
    barcodeValue: Number.isFinite(Number(body?.barcodeValue)) ? Number(body.barcodeValue) : null,
    targetIndex,
    scale: typeof body?.scale === 'string' ? body.scale : '1 1 1',
    rotation: typeof body?.rotation === 'string' ? body.rotation : '0 0 0',
    position: typeof body?.position === 'string' ? body.position : '0 0 0',
    details: body?.details ?? null
  });

  res.status(201).json(toCatalogItem(doc.toObject()));
}

export async function updateProduct(req, res) {
  const arId = String(req.params.id || '').trim();
  const doc = await ArModel.findOne({ arId });
  if (!doc) return res.status(404).json({ message: 'Not found' });

  const body = req.body || {};
  if (typeof body?.name === 'string') doc.name = String(body.name).trim();
  if (typeof body?.description === 'string') doc.description = String(body.description);
  if (body?.price != null) doc.price = Number(body.price);
  if (body?.model != null) doc.glb = normalizeUploadValue(body.model);
  if (body?.marker != null) doc.markerImage = normalizeUploadValue(body.marker);
  if (typeof body?.markerPattern === 'string') doc.markerPattern = body.markerPattern;
  if (body?.barcodeValue != null) doc.barcodeValue = Number.isFinite(Number(body.barcodeValue)) ? Number(body.barcodeValue) : null;
  if (body?.targetIndex != null) doc.targetIndex = Number.isFinite(Number(body.targetIndex)) ? Number(body.targetIndex) : null;
  if (typeof body?.scale === 'string') doc.scale = body.scale;
  if (typeof body?.rotation === 'string') doc.rotation = body.rotation;
  if (typeof body?.position === 'string') doc.position = body.position;
  if (body?.details != null) doc.details = body.details;

  if (doc.targetIndex == null) {
    const max = await ArModel.find({ targetIndex: { $ne: null }, arId: { $ne: arId } }).sort({ targetIndex: -1 }).select({ targetIndex: 1 }).lean();
    const maxVal = max && max[0] && Number.isFinite(max[0].targetIndex) ? Number(max[0].targetIndex) : -1;
    doc.targetIndex = maxVal + 1;
  }

  await doc.save();
  res.json(toCatalogItem(doc.toObject()));
}
