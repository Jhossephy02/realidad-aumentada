import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../state/auth.jsx';
import { apiFetch } from '../utils/api.js';

function StatCard({ label, value, sub, tone = 'default' }) {
  const tones = {
    default: 'border-slate-900 bg-slate-950',
    sky: 'border-sky-500/20 bg-sky-500/5',
    indigo: 'border-indigo-500/20 bg-indigo-500/5',
    emerald: 'border-emerald-500/20 bg-emerald-500/5'
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.default}`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DashboardPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modelsCount, setModelsCount] = useState(0);
  const [uploads, setUploads] = useState(null);
  const [analytics, setAnalytics] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const models = await apiFetch('/api/models', { token });
        const stats = await apiFetch('/api/uploads/stats', { token });
        const summary = await apiFetch('/api/analytics/summary?days=7', { token });
        if (!alive) return;
        setModelsCount(Array.isArray(models) ? models.length : 0);
        setUploads(stats || null);
        setAnalytics(summary || null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message ? String(e.message) : 'Error cargando dashboard');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const cards = useMemo(() => {
    const models = uploads?.models;
    const markers = uploads?.markers;
    return [
      { label: 'Modelos AR', value: String(modelsCount), tone: 'indigo' },
      {
        label: 'Archivos GLB',
        value: String(models?.count ?? 0),
        sub: models ? `${formatBytes(models.bytes)} total` : '',
        tone: 'default'
      },
      {
        label: 'Imágenes (markers)',
        value: String(markers?.count ?? 0),
        sub: markers ? `${formatBytes(markers.bytes)} total` : '',
        tone: 'default'
      },
      {
        label: 'targets.mind',
        value: uploads?.targets?.exists ? 'OK' : '—',
        sub: uploads?.targets?.exists ? formatBytes(uploads.targets.bytes) : '',
        tone: uploads?.targets?.exists ? 'emerald' : 'default'
      },
      {
        label: 'Usuarios únicos (7 días)',
        value: analytics ? String(analytics.uniqueUsersLastNDays ?? 0) : '—',
        sub: analytics ? `Hoy: ${analytics.uniqueUsersToday ?? 0}` : '',
        tone: 'sky'
      }
    ];
  }, [modelsCount, uploads, analytics]);

  const chart = useMemo(() => {
    const rows = Array.isArray(analytics?.daily) ? analytics.daily : [];
    const values = rows.map((r) => Number(r?.uniqueUsers || 0));
    const max = Math.max(1, ...values);
    return rows.map((r) => ({
      date: String(r.date || ''),
      value: Number(r.uniqueUsers || 0),
      h: Math.round((Number(r.uniqueUsers || 0) / max) * 100)
    }));
  }, [analytics]);

  return (
    <div>
      <div className="mb-6">
        <div className="text-xl font-semibold tracking-tight text-white">Dashboard</div>
        <div className="text-sm text-slate-400">Resumen del sistema</div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={loading ? '…' : c.value}
            sub={loading ? '' : c.sub}
            tone={c.tone}
          />
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-900 bg-slate-950 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-white">Usuarios únicos por día</div>
            <div className="mt-0.5 text-xs text-slate-400">Cuenta dispositivos/navegadores únicos que usaron la app</div>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>Total histórico: {loading ? '…' : String(analytics?.totalUniqueUsers ?? 0)}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-2">
          {chart.map((d) => (
            <div key={d.date} className="flex flex-col items-center gap-2">
              <div className="flex h-28 w-full items-end rounded-xl border border-slate-900 bg-slate-950 px-2 py-2">
                <div className="w-full rounded-lg bg-gradient-to-t from-sky-500/50 to-indigo-500/30" style={{ height: `${d.h}%` }} />
              </div>
              <div className="text-[10px] text-slate-500">{d.date.slice(5)}</div>
              <div className="text-[10px] text-slate-400">{d.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
