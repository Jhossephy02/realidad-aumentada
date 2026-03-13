import crypto from 'crypto';
import { AnalyticsSession } from '../models/AnalyticsSession.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.js';

function cleanSessionId(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (v.length < 8 || v.length > 80) return '';
  if (!/^[a-zA-Z0-9_-]+$/.test(v)) return '';
  return v;
}

function getClientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return xf || String(req.ip || '');
}

function hashIp(ip) {
  const v = String(ip || '').trim();
  if (!v) return '';
  return crypto.createHash('sha256').update(v).digest('hex');
}

function dateKeyUTC(date) {
  const d = date instanceof Date ? date : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeTimeZone(value, fallback) {
  const v = String(value || '').trim();
  if (!v) return fallback;
  if (v.length > 64) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v }).format(new Date());
    return v;
  } catch (e) {
    return fallback;
  }
}

function hourKeyInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const h = get('hour');
  return `${y}-${m}-${d} ${h}:00`;
}

export async function trackUsage(req, res) {
  const sessionId = cleanSessionId(req.body?.sessionId);
  if (!sessionId) return res.status(400).json({ message: 'Missing sessionId' });
  const now = new Date();
  const lastPath = typeof req.body?.path === 'string' ? req.body.path.slice(0, 300) : '';
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : '';
  const ipHash = hashIp(getClientIp(req));

  await AnalyticsSession.updateOne(
    { sessionId },
    {
      $setOnInsert: { sessionId, firstSeenAt: now },
      $set: { lastSeenAt: now, lastPath, userAgent: ua, ipHash },
      $inc: { hits: 1 }
    },
    { upsert: true }
  );

  try {
    await AnalyticsEvent.create({ sessionId, path: lastPath });
  } catch (e) {}

  res.json({ ok: true });
}

export async function getSummary(req, res) {
  const daysRaw = Number(req.query?.days ?? 7);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 7;

  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const rangeStart = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const totalUniqueUsers = await AnalyticsSession.countDocuments({});
  const uniqueUsersToday = await AnalyticsSession.countDocuments({ lastSeenAt: { $gte: todayStart } });
  const uniqueUsersLastNDays = await AnalyticsSession.countDocuments({ lastSeenAt: { $gte: rangeStart } });

  const grouped = await AnalyticsSession.aggregate([
    { $match: { lastSeenAt: { $gte: rangeStart } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$lastSeenAt',
            timezone: 'UTC'
          }
        },
        uniqueUsers: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  const map = new Map(grouped.map((g) => [String(g._id), Number(g.uniqueUsers || 0)]));
  const daily = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(rangeStart.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dateKeyUTC(d);
    daily.push({ date: key, uniqueUsers: map.get(key) || 0 });
  }

  res.json({
    days,
    totalUniqueUsers,
    uniqueUsersToday,
    uniqueUsersLastNDays,
    daily
  });
}

export async function listSessions(req, res) {
  const limitRaw = Number(req.query?.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
  const daysRaw = req.query?.days != null ? Number(req.query.days) : null;
  const days = daysRaw != null && Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : null;

  const filter = {};
  if (days != null) {
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const rangeStart = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    filter.lastSeenAt = { $gte: rangeStart };
  }

  const docs = await AnalyticsSession.find(filter)
    .sort({ lastSeenAt: -1 })
    .limit(limit)
    .select({ _id: 0, sessionId: 1, firstSeenAt: 1, lastSeenAt: 1, hits: 1, lastPath: 1 })
    .lean();

  res.json(Array.isArray(docs) ? docs : []);
}

export async function getHourly(req, res) {
  const hoursRaw = Number(req.query?.hours ?? 24);
  const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(24 * 30, Math.floor(hoursRaw))) : 24;
  const timeZone = normalizeTimeZone(req.query?.tz, 'America/Lima');

  const now = new Date();
  const end = now;
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  const keys = [];
  for (let i = hours - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 60 * 60 * 1000);
    keys.push(hourKeyInTimeZone(d, timeZone));
  }

  const grouped = await AnalyticsEvent.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d %H:00',
            date: '$createdAt',
            timezone: timeZone
          }
        },
        sessions: { $addToSet: '$sessionId' }
      }
    },
    { $project: { _id: 0, hour: '$_id', uniqueUsers: { $size: '$sessions' } } },
    { $sort: { hour: 1 } }
  ]);

  const map = new Map((grouped || []).map((g) => [String(g.hour), Number(g.uniqueUsers || 0)]));
  const hourly = keys.map((k) => ({ hour: k, uniqueUsers: map.get(k) || 0 }));

  res.json({ hours, timezone: timeZone, hourly });
}
