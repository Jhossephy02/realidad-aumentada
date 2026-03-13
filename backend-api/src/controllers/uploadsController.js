import fs from 'fs/promises';
import path from 'path';
import { ArModel } from '../models/ArModel.js';
import { MARKER_PREVIEWS_DIR, MODELS_DIR, MARKERS_DIR, PATTERNS_DIR, TARGETS_PATH } from '../config/paths.js';

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

export async function getUploadsStats(req, res) {
  const docs = await ArModel.find({}).select({ glb: 1, markerImage: 1, markerPatt: 1, markerPreview: 1 }).lean();
  const referencedModels = new Set();
  const referencedMarkers = new Set();
  const referencedPatterns = new Set();
  const referencedPreviews = new Set();
  for (const p of docs) {
    const model = uploadBasenameFromValue(p?.glb);
    const marker = uploadBasenameFromValue(p?.markerImage);
    const patt = uploadBasenameFromValue(p?.markerPatt);
    const preview = uploadBasenameFromValue(p?.markerPreview);
    if (model && model.folder === 'models') referencedModels.add(model.filename);
    if (marker && marker.folder === 'markers') referencedMarkers.add(marker.filename);
    if (patt && patt.folder === 'patterns') referencedPatterns.add(patt.filename);
    if (preview && preview.folder === 'marker-previews') referencedPreviews.add(preview.filename);
  }
  const [models, markers, patterns, markerPreviews] = await Promise.all([
    computeDirStats(MODELS_DIR, referencedModels),
    computeDirStats(MARKERS_DIR, referencedMarkers),
    computeDirStats(PATTERNS_DIR, referencedPatterns),
    computeDirStats(MARKER_PREVIEWS_DIR, referencedPreviews)
  ]);
  let targets = { exists: false, bytes: 0, mtimeMs: null };
  try {
    const st = await fs.stat(TARGETS_PATH);
    targets = { exists: true, bytes: Number(st.size) || 0, mtimeMs: Number(st.mtimeMs) || null };
  } catch (e) {}
  res.setHeader('Cache-Control', 'no-store');
  res.json({ models, markers, patterns, markerPreviews, targets });
}

export async function cleanupUploads(req, res) {
  const docs = await ArModel.find({}).select({ glb: 1, markerImage: 1, markerPatt: 1, markerPreview: 1 }).lean();
  const referencedModels = new Set();
  const referencedMarkers = new Set();
  const referencedPatterns = new Set();
  const referencedPreviews = new Set();
  for (const p of docs) {
    const model = uploadBasenameFromValue(p?.glb);
    const marker = uploadBasenameFromValue(p?.markerImage);
    const patt = uploadBasenameFromValue(p?.markerPatt);
    const preview = uploadBasenameFromValue(p?.markerPreview);
    if (model && model.folder === 'models') referencedModels.add(model.filename);
    if (marker && marker.folder === 'markers') referencedMarkers.add(marker.filename);
    if (patt && patt.folder === 'patterns') referencedPatterns.add(patt.filename);
    if (preview && preview.folder === 'marker-previews') referencedPreviews.add(preview.filename);
  }

  const dryRun = String(req.query?.dryRun || '').toLowerCase() === '1' || String(req.query?.dryRun || '').toLowerCase() === 'true';
  const modelOrphans = await listOrphanFiles(MODELS_DIR, referencedModels);
  const markerOrphans = await listOrphanFiles(MARKERS_DIR, referencedMarkers);
  const patternOrphans = await listOrphanFiles(PATTERNS_DIR, referencedPatterns);
  const previewOrphans = await listOrphanFiles(MARKER_PREVIEWS_DIR, referencedPreviews);

  if (dryRun) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      dryRun: true,
      models: { count: modelOrphans.length, bytes: modelOrphans.reduce((a, f) => a + (Number(f.bytes) || 0), 0), sample: modelOrphans.slice(0, 25) },
      markers: { count: markerOrphans.length, bytes: markerOrphans.reduce((a, f) => a + (Number(f.bytes) || 0), 0), sample: markerOrphans.slice(0, 25) },
      patterns: { count: patternOrphans.length, bytes: patternOrphans.reduce((a, f) => a + (Number(f.bytes) || 0), 0), sample: patternOrphans.slice(0, 25) },
      markerPreviews: { count: previewOrphans.length, bytes: previewOrphans.reduce((a, f) => a + (Number(f.bytes) || 0), 0), sample: previewOrphans.slice(0, 25) }
    });
  }

  let deletedModels = 0;
  let deletedMarkers = 0;
  let deletedPatterns = 0;
  let deletedPreviews = 0;
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
  for (const f of patternOrphans) {
    const abs = path.join(PATTERNS_DIR, f.name);
    try {
      await fs.unlink(abs);
      deletedPatterns += 1;
      deletedBytes += Number(f.bytes) || 0;
    } catch (e) {
      errors.push({ file: `patterns/${f.name}`, message: e?.message ? String(e.message) : 'delete failed' });
    }
  }
  for (const f of previewOrphans) {
    const abs = path.join(MARKER_PREVIEWS_DIR, f.name);
    try {
      await fs.unlink(abs);
      deletedPreviews += 1;
      deletedBytes += Number(f.bytes) || 0;
    } catch (e) {
      errors.push({ file: `marker-previews/${f.name}`, message: e?.message ? String(e.message) : 'delete failed' });
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: errors.length === 0,
    dryRun: false,
    deletedModels,
    deletedMarkers,
    deletedPatterns,
    deletedPreviews,
    deletedBytes,
    errors: errors.slice(0, 50)
  });
}
