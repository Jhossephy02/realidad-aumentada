import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, absUrl } from '../utils/api.js';
import { Dropzone } from './Dropzone.jsx';
import { formatDate } from '../utils/format.js';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

async function ensureMindArCompiler() {
  if (window.__MindARCompiler) return window.__MindARCompiler;
  if (window.__mindarCompilerLoading) return await window.__mindarCompilerLoading;

  window.__mindarCompilerLoading = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('MindAR compiler timeout')), 8000);
    window.__mindarCompilerResolve = (Compiler) => {
      clearTimeout(timeout);
      window.__MindARCompiler = Compiler;
      resolve(Compiler);
    };
    window.__mindarCompilerReject = (err) => {
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error('MindAR compiler failed'));
    };
    const s = document.createElement('script');
    s.type = 'module';
    s.textContent = `
      import { Compiler } from "https://cdn.jsdelivr.net/gh/hiukim/mind-ar-js@1.2.5/src/image-target/compiler.js";
      window.__mindarCompilerResolve(Compiler);
    `;
    s.onerror = () => window.__mindarCompilerReject(new Error('Failed to load MindAR compiler'));
    document.head.appendChild(s);
  });

  return await window.__mindarCompilerLoading;
}

async function fetchImageFromUrl(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo descargar imagen (${res.status})`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = objUrl;
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    });
    return img;
  } finally {
    try {
      URL.revokeObjectURL(objUrl);
    } catch (e) {}
  }
}

async function rebuildTargetsMind({ token, onProgress }) {
  const catalog = await apiFetch('/api/catalog', { token });
  const list = Array.isArray(catalog) ? catalog : [];
  const candidates = list.filter((i) => i && i.marker && i.model);
  if (candidates.length === 0) throw new Error('No hay productos con imagen target y modelo');

  let idx = 0;
  const normalizedCatalog = list.map((item) => {
    if (!item || !item.marker || !item.model) return { ...item, targetIndex: null };
    const next = { ...item, targetIndex: idx };
    idx += 1;
    return next;
  });

  await apiFetch('/api/catalog', { method: 'PUT', token, json: normalizedCatalog });

  const Compiler = await ensureMindArCompiler();
  const compiler = new Compiler();
  const ordered = normalizedCatalog.filter((i) => i && i.marker && i.model).sort((a, b) => a.targetIndex - b.targetIndex);

  const images = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const src = absUrl(ordered[i].marker);
    images.push(await fetchImageFromUrl(src));
  }

  await compiler.compileImageTargets(images, (progress) => {
    if (typeof onProgress === 'function') onProgress(progress);
  });
  const exportedBuffer = await compiler.exportData();
  const base64 = arrayBufferToBase64(exportedBuffer);
  await apiFetch('/api/upload/targets', { method: 'POST', token, json: { base64 } });
  return true;
}

function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-0 overflow-auto p-4">
        <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-900 bg-slate-950 shadow-xl shadow-black/40">
          <div className="flex items-center justify-between border-b border-slate-900 px-5 py-4">
            <div className="text-base font-semibold tracking-tight text-white">{title}</div>
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
            >
              Cerrar
            </button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function MarkerThumb({ src }) {
  if (!src) return <div className="text-xs text-slate-500">Sin marker</div>;
  return (
    <img
      src={absUrl(src)}
      alt="marker"
      className="h-24 w-24 rounded-xl border border-slate-800 bg-slate-950 object-contain"
      loading="lazy"
    />
  );
}

function GlbPreview({ src }) {
  if (!src) return <div className="text-xs text-slate-500">Sin GLB</div>;
  return (
    <div className="h-24 w-40 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
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

export function ModelFormModal({ open, token, mode, model, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [glbFile, setGlbFile] = useState(null);
  const [markerFile, setMarkerFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [targetsStatus, setTargetsStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
    setTargetsStatus('');
    setName(String(model?.name || ''));
    setDescription(String(model?.description || ''));
    setGlbFile(null);
    setMarkerFile(null);
  }, [open, model]);

  const title = isEdit ? 'Editar modelo' : 'Nuevo modelo';

  const canSubmit = useMemo(() => {
    if (!isEdit) return Boolean(glbFile && markerFile);
    return true;
  }, [glbFile, markerFile, isEdit]);

  const onPickGlb = (file) => {
    setGlbFile(file);
    const current = String(name || '').trim();
    if (!current && file && typeof file.name === 'string') {
      const next = file.name.replace(/\.glb$/i, '').trim();
      if (next) setName(next);
    }
  };

  const onPickMarker = (file) => {
    setMarkerFile(file);
    const current = String(name || '').trim();
    if (!current && file && typeof file.name === 'string') {
      const next = file.name.replace(/\.[a-z0-9]+$/i, '').trim();
      if (next) setName(next);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    setTargetsStatus('');
    try {
      const fd = new FormData();
      fd.set('name', String(name).trim());
      fd.set('description', String(description || ''));
      if (glbFile) fd.set('glb', glbFile);
      if (markerFile) fd.set('marker', markerFile);

      const saved = isEdit
        ? await apiFetch(`/api/models/${encodeURIComponent(model.arId)}`, { method: 'PUT', token, formData: fd })
        : await apiFetch('/api/models', { method: 'POST', token, formData: fd });

      setTargetsStatus('Generando targets.mind…');
      await rebuildTargetsMind({
        token,
        onProgress: (p) => setTargetsStatus(`Generando targets.mind… ${Number(p).toFixed(0)}%`)
      });
      setTargetsStatus('targets.mind actualizado');
      try {
        localStorage.setItem('webar_targets_updated_at', String(Date.now()));
      } catch (e) {}
      onSaved(saved);
      onClose();
    } catch (e2) {
      setError(e2?.message ? String(e2.message) : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={title} onClose={onClose}>
      {error ? (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-200">{error}</div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              placeholder="Opcional (se autogenera)"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Descripción</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              placeholder="Opcional"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Dropzone
            accept=".glb"
            label="Modelo 3D (GLB)"
            hint={isEdit ? 'Opcional (solo si deseas reemplazar)' : 'Requerido'}
            file={glbFile}
            onChange={onPickGlb}
          />
          <Dropzone
            accept="image/*"
            label="Imagen (se convertirá en marcador)"
            hint={isEdit ? 'Opcional (si deseas cambiar la imagen)' : 'Requerido'}
            file={markerFile}
            onChange={onPickMarker}
          />
        </div>

        {isEdit ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="mb-1 text-xs font-medium text-slate-300">Marker actual</div>
              <MarkerThumb src={model?.markerImage} />
            </div>
            <div className="md:col-span-2">
              <div className="mb-1 text-xs font-medium text-slate-300">Preview 3D actual</div>
              <GlbPreview src={model?.glb} />
              <div className="mt-2 text-xs text-slate-500">Creado: {formatDate(model?.createdAt)}</div>
            </div>
          </div>
        ) : null}

        {targetsStatus ? <div className="text-xs text-slate-400">{targetsStatus}</div> : null}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            Cancelar
          </button>
          <button
            disabled={!canSubmit || saving}
            className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
