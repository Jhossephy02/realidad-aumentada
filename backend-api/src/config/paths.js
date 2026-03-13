import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? (path.isAbsolute(process.env.UPLOADS_DIR) ? process.env.UPLOADS_DIR : path.join(PROJECT_ROOT, process.env.UPLOADS_DIR))
  : path.join(PROJECT_ROOT, 'storage', 'uploads');
export const MODELS_DIR = path.join(UPLOADS_DIR, 'models');
export const MARKERS_DIR = path.join(UPLOADS_DIR, 'markers');
export const PATTERNS_DIR = path.join(UPLOADS_DIR, 'patterns');
export const MARKER_PREVIEWS_DIR = path.join(UPLOADS_DIR, 'marker-previews');
export const TARGETS_DIR = path.join(UPLOADS_DIR, 'targets');
export const TARGETS_PATH = path.join(TARGETS_DIR, 'targets.mind');
