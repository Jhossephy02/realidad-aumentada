import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { MODELS_DIR, MARKERS_DIR } from '../config/paths.js';

function safeName(input) {
  const raw = String(input || 'file').replace(/\\/g, '/').split('/').pop();
  const cleaned = raw.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
  return cleaned || 'file';
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function makeStorage(destDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, destDir),
    filename: (req, file, cb) => {
      const original = String(file.originalname || 'file');
      const ext = path.extname(original);
      const base = ext ? original.slice(0, -ext.length) : original;
      const filename = `${Date.now()}_${newId()}_${safeName(base)}${ext}`;
      cb(null, filename);
    }
  });
}

export const uploadModelFile = multer({
  storage: makeStorage(MODELS_DIR),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    if (ext !== '.glb') return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'glb'));
    cb(null, true);
  }
});

export const uploadMarkerFile = multer({
  storage: makeStorage(MARKERS_DIR),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const type = String(file.mimetype || '').toLowerCase();
    if (!type.startsWith('image/')) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'marker'));
    cb(null, true);
  }
});

export const uploadArModelFiles = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const field = String(file.fieldname || '').toLowerCase();
      if (field === 'glb' || field === 'model') return cb(null, MODELS_DIR);
      if (field === 'marker' || field === 'markerimage') return cb(null, MARKERS_DIR);
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
    },
    filename: (req, file, cb) => {
      const original = String(file.originalname || 'file');
      const ext = path.extname(original);
      const base = ext ? original.slice(0, -ext.length) : original;
      const filename = `${Date.now()}_${newId()}_${safeName(base)}${ext}`;
      cb(null, filename);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const field = String(file.fieldname || '').toLowerCase();
    if (field === 'glb' || field === 'model') {
      const ext = path.extname(String(file.originalname || '')).toLowerCase();
      if (ext !== '.glb') return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      return cb(null, true);
    }
    if (field === 'marker' || field === 'markerimage') {
      const type = String(file.mimetype || '').toLowerCase();
      if (!type.startsWith('image/')) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
      return cb(null, true);
    }
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
});
