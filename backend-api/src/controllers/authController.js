import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (!secret && isProd) throw new Error('Missing JWT_SECRET');
  return secret || 'dev-secret';
}

export async function login(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ message: 'Missing credentials' });

  const user = await User.findOne({ username }).lean(false);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const ok = await user.verifyPassword(password);
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

  const token = jwt.sign({ sub: user._id.toString(), username: user.username, role: user.role }, getJwtSecret(), { expiresIn: '7d' });
  res.json({ token, username: user.username, role: user.role });
}

export async function createUser(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || 'admin').trim() || 'admin';
  if (!username || !password) return res.status(400).json({ message: 'Missing fields' });

  const exists = await User.findOne({ username }).lean();
  if (exists) return res.status(409).json({ message: 'User exists' });

  const passwordHash = await User.hashPassword(password);
  const user = await User.create({ username, passwordHash, role });
  res.status(201).json({ id: user._id.toString(), username: user.username, role: user.role, createdAt: user.createdAt });
}
