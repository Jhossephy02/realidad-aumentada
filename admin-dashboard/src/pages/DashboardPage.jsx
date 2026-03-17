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
  const [cleanup, setCleanup] = useState(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupError, setCleanupError] = useState('');
  const [admins, setAdmins] = useState([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [newAdminUser, setNewAdminUser] = useState('');
  const [newAdminPass, setNewAdminPass] = useState('');

  const toast = (detail) => {
    try {
      window.dispatchEvent(new CustomEvent('webar:toast', { detail }));
    } catch (e) {}
  };

  const loadAdmins = async () => {
    const list = await apiFetch('/api/admin/users', { token });
    setAdmins(Array.isArray(list) ? list : []);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const models = await apiFetch('/api/models', { token });
        const stats = await apiFetch('/api/uploads/stats', { token });
        const summary = await apiFetch('/api/analytics/summary?days=7', { token });
        const adminsList = await apiFetch('/api/admin/users', { token });
        if (!alive) return;
        setModelsCount(Array.isArray(models) ? models.length : 0);
        setUploads(stats || null);
        setAnalytics(summary || null);
        setAdmins(Array.isArray(adminsList) ? adminsList : []);
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

  const createAdmin = async () => {
    const username = String(newAdminUser || '').trim();
    const password = String(newAdminPass || '');
    if (!username || !password) {
      setAdminError('Completa usuario y contraseña');
      return;
    }
    setAdminBusy(true);
    setAdminError('');
    try {
      await apiFetch('/api/admin/users', { method: 'POST', token, json: { username, password } });
      setNewAdminUser('');
      setNewAdminPass('');
      await loadAdmins();
      toast({ tone: 'success', message: 'Administrador creado', ttl: 2500 });
    } catch (e) {
      setAdminError(e?.message ? String(e.message) : 'No se pudo crear');
    } finally {
      setAdminBusy(false);
    }
  };

  const resetAdminPassword = async (username) => {
    const nextPass = prompt(`Nueva contraseña para ${username}`);
    if (nextPass === null) return;
    setAdminBusy(true);
    setAdminError('');
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'PUT', token, json: { password: String(nextPass || '') } });
      await loadAdmins();
      toast({ tone: 'success', message: 'Contraseña actualizada', ttl: 2500 });
    } catch (e) {
      setAdminError(e?.message ? String(e.message) : 'No se pudo actualizar');
    } finally {
      setAdminBusy(false);
    }
  };

  const deleteAdmin = async (username) => {
    if (!confirm(`Eliminar administrador ${username}?`)) return;
    setAdminBusy(true);
    setAdminError('');
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE', token });
      await loadAdmins();
      toast({ tone: 'success', message: 'Administrador eliminado', ttl: 2500 });
    } catch (e) {
      setAdminError(e?.message ? String(e.message) : 'No se pudo eliminar');
    } finally {
      setAdminBusy(false);
    }
  };

  const analyzeCleanup = async () => {
    setCleanupBusy(true);
    setCleanupError('');
    try {
      const report = await apiFetch('/api/uploads/cleanup?dryRun=1', { method: 'POST', token });
      setCleanup(report || null);
      toast({ tone: 'success', message: 'Análisis listo (no se borró nada)', ttl: 2500 });
    } catch (e) {
      setCleanupError(e?.message ? String(e.message) : 'No se pudo analizar');
    } finally {
      setCleanupBusy(false);
    }
  };

  const runCleanup = async () => {
    if (!confirm('Esto eliminará archivos no usados en el servidor. ¿Continuar?')) return;
    setCleanupBusy(true);
    setCleanupError('');
    try {
      const result = await apiFetch('/api/uploads/cleanup', { method: 'POST', token });
      setCleanup(result || null);
      toast({ tone: 'success', message: 'Limpieza completada', ttl: 2500 });
      const stats = await apiFetch('/api/uploads/stats', { token });
      setUploads(stats || null);
    } catch (e) {
      setCleanupError(e?.message ? String(e.message) : 'No se pudo limpiar');
    } finally {
      setCleanupBusy(false);
    }
  };

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

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
          <div className="text-sm font-medium text-white">Estado</div>
          <div className="mt-1 text-sm text-slate-300">Aquí ves si targets.mind está OK y cuántos recursos hay.</div>
        </div>
        <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
          <div className="text-sm font-medium text-white">Limpieza</div>
          <div className="mt-1 text-sm text-slate-300">Detecta y borra archivos que ya no usa ningún modelo.</div>
        </div>
        <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
          <div className="text-sm font-medium text-white">Escala/posición</div>
          <div className="mt-1 text-sm text-slate-300">El ajuste del 3D en cámara es automático (no aquí).</div>
        </div>
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

      <div className="mt-6 rounded-2xl border border-slate-900 bg-slate-950 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-white">Orden y limpieza de archivos</div>
            <div className="mt-0.5 text-xs text-slate-400">Archivos GLB/imagenes que quedan “sueltos” después de borrar modelos</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={analyzeCleanup}
              disabled={cleanupBusy}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-60"
            >
              {cleanupBusy ? 'Analizando…' : 'Analizar'}
            </button>
            <button
              onClick={runCleanup}
              disabled={cleanupBusy}
              className="rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-sm text-red-200 hover:bg-red-950/40 disabled:opacity-60"
            >
              {cleanupBusy ? 'Procesando…' : 'Eliminar no usados'}
            </button>
          </div>
        </div>

        {cleanupError ? (
          <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-200">{cleanupError}</div>
        ) : null}

        {cleanup ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
              <div className="text-sm font-medium text-white">GLB</div>
              <div className="mt-1 text-sm text-slate-300">
                {cleanup.models?.count ?? 0} archivos no usados ({formatBytes(cleanup.models?.bytes ?? 0)})
              </div>
              {Array.isArray(cleanup.models?.sample) && cleanup.models.sample.length ? (
                <div className="mt-2 text-xs text-slate-500">{cleanup.models.sample.join(', ')}</div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
              <div className="text-sm font-medium text-white">Markers</div>
              <div className="mt-1 text-sm text-slate-300">
                {cleanup.markers?.count ?? 0} archivos no usados ({formatBytes(cleanup.markers?.bytes ?? 0)})
              </div>
              {Array.isArray(cleanup.markers?.sample) && cleanup.markers.sample.length ? (
                <div className="mt-2 text-xs text-slate-500">{cleanup.markers.sample.join(', ')}</div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm text-slate-400">Tip: primero usa “Analizar” para ver qué se eliminaría.</div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-900 bg-slate-950 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-white">Administradores</div>
            <div className="mt-0.5 text-xs text-slate-400">Crea usuarios para que otras personas entren al panel</div>
          </div>
        </div>

        {adminError ? (
          <div className="mt-3 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-200">{adminError}</div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-300">Usuario</div>
            <input
              value={newAdminUser}
              onChange={(e) => setNewAdminUser(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              autoComplete="off"
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-300">Contraseña</div>
            <input
              value={newAdminPass}
              onChange={(e) => setNewAdminPass(e.target.value)}
              type="password"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={createAdmin}
              disabled={adminBusy}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-60"
            >
              {adminBusy ? 'Creando…' : 'Crear admin'}
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-900">
          <div className="grid grid-cols-12 bg-slate-950 px-4 py-2 text-xs text-slate-500">
            <div className="col-span-7">Usuario</div>
            <div className="col-span-5 text-right">Acciones</div>
          </div>
          <div className="divide-y divide-slate-900">
            {(admins || []).map((a) => (
              <div key={a.username} className="grid grid-cols-12 items-center px-4 py-3">
                <div className="col-span-7 text-sm text-slate-200">{a.username}</div>
                <div className="col-span-5 flex justify-end gap-2">
                  <button
                    onClick={() => resetAdminPassword(a.username)}
                    disabled={adminBusy}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-60"
                  >
                    Cambiar contraseña
                  </button>
                  <button
                    onClick={() => deleteAdmin(a.username)}
                    disabled={adminBusy || (admins || []).length <= 1}
                    className="rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-950/40 disabled:opacity-60"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
            {!loading && (!admins || admins.length === 0) ? (
              <div className="px-4 py-3 text-sm text-slate-400">No hay administradores registrados.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
