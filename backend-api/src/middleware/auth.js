import jwt from 'jsonwebtoken';

function isAuthRequired() {
  const v = String(process.env.REQUIRE_AUTH || '').trim();
  if (v) return v === '1';
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  return isProd;
}

export function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || '').trim();
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  const secret = String(process.env.JWT_SECRET || '').trim() || 'dev-secret';
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (isProd && secret === 'dev-secret') return res.status(500).json({ message: 'Server misconfigured' });
  try {
    req.user = jwt.verify(token, secret);
    return next();
  } catch (e) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

export function requireAuthIfEnabled(req, res, next) {
  if (!isAuthRequired()) return next();
  return requireAuth(req, res, next);
}
