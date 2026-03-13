import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/auth.jsx';
import { apiFetch, absUrl } from '../utils/api.js';

export function MarkersPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [models, setModels] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await apiFetch('/api/models', { token });
        if (!alive) return;
        setModels(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!alive) return;
        setError(e?.message ? String(e.message) : 'Error cargando markers');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const items = useMemo(() => {
    return models
      .filter((m) => m && m.markerImage)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [models]);

  return (
    <div>
      <div className="mb-6">
        <div className="text-xl font-semibold tracking-tight text-white">Markers</div>
        <div className="text-sm text-slate-400">Gestión visual de imágenes target</div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-900 bg-slate-950 p-6 text-sm text-slate-400">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-900 bg-slate-950 p-6 text-sm text-slate-400">No hay markers</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <button
              key={m._id || m.arId}
              onClick={() => navigate('/models')}
              className="rounded-2xl border border-slate-900 bg-slate-950 p-4 text-left hover:bg-slate-900/40"
            >
              <div className="flex items-center gap-4">
                <img
                  src={absUrl(m.markerPreview || m.markerImage)}
                  alt={m.name || 'marker'}
                  className="h-20 w-20 rounded-xl border border-slate-800 bg-slate-950 object-contain"
                  loading="lazy"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{m.name || '—'}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{m.arId}</div>
                  {m.markerPatt ? (
                    <a
                      href={absUrl(m.markerPatt)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-2 inline-flex items-center rounded-lg border border-slate-800 bg-slate-900/40 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
                      download
                    >
                      Descargar .patt
                    </a>
                  ) : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
