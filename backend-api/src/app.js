import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import mongoose from 'mongoose';
import { PROJECT_ROOT, UPLOADS_DIR } from './config/paths.js';
import { authRoutes } from './routes/authRoutes.js';
import { modelRoutes } from './routes/modelRoutes.js';

function resolveRootFromEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.join(PROJECT_ROOT, raw);
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  app.get('/panel', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(PROJECT_ROOT, 'admin-dashboard', 'panel.html'));
  });

  app.get('/api/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, now: Date.now() });
  });

  app.get('/api/ready', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const state = mongoose.connection ? mongoose.connection.readyState : 0;
    const dbOk = state === 1;
    const checks = {};
    try {
      await fs.access(UPLOADS_DIR);
      checks.uploadsDir = true;
    } catch (e) {
      checks.uploadsDir = false;
    }
    checks.db = dbOk;
    const ok = Boolean(checks.uploadsDir && checks.db);
    res.status(ok ? 200 : 503).json({ ok, checks });
  });

  app.use('/api', authRoutes);
  app.use('/api', modelRoutes);

  app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: false, maxAge: '30d', immutable: true }));
  const adminDist = resolveRootFromEnv('ADMIN_DIST_DIR') || path.join(PROJECT_ROOT, 'admin-dashboard', 'dist');
  app.use('/admin', express.static(adminDist, { maxAge: '1h' }));
  const frontendDir = resolveRootFromEnv('FRONTEND_DIR') || path.join(PROJECT_ROOT, 'frontend-ar');
  app.use(express.static(frontendDir, { maxAge: '1h' }));

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

  return app;
}
