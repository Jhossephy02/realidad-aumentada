import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../state/auth.jsx';
import { apiFetch, absUrl } from '../utils/api.js';
import { formatDate } from '../utils/format.js';
import { ModelFormModal } from '../components/ModelFormModal.jsx';

function EmptyState() {
  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-950 p-6 text-center">
      <div className="text-sm font-medium text-white">No hay modelos</div>
      <div className="mt-1 text-sm text-slate-400">Crea tu primer objeto AR</div>
    </div>
  );
}

function ModelCell({ src }) {
  if (!src) return <div className="text-xs text-slate-500">—</div>;
  return (
    <div className="h-16 w-28 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      <model-viewer
        src={absUrl(src)}
        camera-controls
        auto-rotate
        rotation-per-second="18deg"
        style={{ width: '100%', height: '100%' }}
        exposure="0.85"
        shadow-intensity="0.8"
        interaction-prompt="none"
      />
    </div>
  );
}

function MarkerCell({ src }) {
  if (!src) return <div className="text-xs text-slate-500">—</div>;
  return <img src={absUrl(src)} alt="marker" className="h-16 w-16 rounded-xl border border-slate-800 bg-slate-950 object-contain" />;
}

export function ModelsPage() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [models, setModels] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selected, setSelected] = useState(null);
  const [busyId, setBusyId] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/api/models', { token });
      setModels(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message ? String(e.message) : 'Error cargando modelos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [token]);

  const sorted = useMemo(() => {
    return [...models].sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());
  }, [models]);

  const openCreate = () => {
    setSelected(null);
    setModalMode('create');
    setModalOpen(true);
  };

  const openEdit = (m) => {
    setSelected(m);
    setModalMode('edit');
    setModalOpen(true);
  };

  const onDelete = async (m) => {
    const arId = String(m?.arId || '').trim();
    if (!arId) return;
    if (!confirm(`Eliminar "${m?.name || arId}"?`)) return;
    setBusyId(arId);
    try {
      await apiFetch(`/api/models/${encodeURIComponent(arId)}`, { method: 'DELETE', token });
      await refresh();
    } catch (e) {
      setError(e?.message ? String(e.message) : 'No se pudo eliminar');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-xl font-semibold tracking-tight text-white">Modelos AR</div>
          <div className="text-sm text-slate-400">Crear, editar, eliminar y previsualizar</div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            Actualizar
          </button>
          <button onClick={openCreate} className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400">
            Nuevo
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-900 bg-slate-950 p-6 text-sm text-slate-400">Cargando…</div>
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-900 bg-slate-950">
          <div className="overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-950">
                <tr className="border-b border-slate-900 text-xs text-slate-400">
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Marker</th>
                  <th className="px-4 py-3">Preview 3D</th>
                  <th className="px-4 py-3">Creado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m._id || m.arId} className="border-b border-slate-900/70 last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{m.name || '—'}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{m.arId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <MarkerCell src={m.markerImage} />
                    </td>
                    <td className="px-4 py-3">
                      <ModelCell src={m.glb} />
                    </td>
                    <td className="px-4 py-3 text-slate-300">{formatDate(m.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(m)}
                          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 hover:bg-slate-900"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => onDelete(m)}
                          disabled={busyId === m.arId}
                          className="rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2 text-xs text-red-200 hover:bg-red-950/40 disabled:opacity-60"
                        >
                          {busyId === m.arId ? 'Eliminando…' : 'Eliminar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ModelFormModal
        open={modalOpen}
        token={token}
        mode={modalMode}
        model={selected}
        onClose={() => setModalOpen(false)}
        onSaved={() => refresh()}
      />
    </div>
  );
}

