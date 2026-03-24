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

  window.__mindarCompilerLoading = Promise.resolve()
    .then(async () => {
      if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
        throw new Error('Sin conexión a internet para generar targets.mind');
      }
      const mod = await import('mind-ar/src/image-target/compiler.js');
      const Compiler = mod && mod.Compiler ? mod.Compiler : null;
      if (!Compiler) throw new Error('No se pudo cargar el compilador de MindAR');
      window.__MindARCompiler = Compiler;
      return Compiler;
    })
    .catch((err) => {
      throw err instanceof Error ? err : new Error('No se pudo cargar el compilador de MindAR');
    });

  return await window.__mindarCompilerLoading;
}

function toast(detail) {
  try {
    window.dispatchEvent(new CustomEvent('webar:toast', { detail }));
  } catch (e) {}
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

  const withTargets = [];
  const withoutTargets = [];
  for (let i = 0; i < list.length; i += 1) {
    const it = list[i];
    if (!it || !it.marker || !it.model) continue;
    const ti = Number(it.targetIndex);
    if (Number.isFinite(ti)) withTargets.push({ item: it, idx: i, ti });
    else withoutTargets.push({ item: it, idx: i, ti: null });
  }
  withTargets.sort((a, b) => a.ti - b.ti || a.idx - b.idx);
  const ordered = [...withTargets, ...withoutTargets].map((x) => x.item);

  const targetIndexById = new Map();
  for (let i = 0; i < ordered.length; i += 1) {
    const it = ordered[i];
    const id = it && typeof it.id === 'string' ? it.id : '';
    if (id) targetIndexById.set(id, i);
  }

  const normalizedCatalog = list.map((item) => {
    if (!item || !item.marker || !item.model) return { ...item, targetIndex: null };
    const id = item && typeof item.id === 'string' ? item.id : '';
    const nextIndex = id && targetIndexById.has(id) ? targetIndexById.get(id) : null;
    return { ...item, targetIndex: nextIndex };
  });

  await apiFetch('/api/catalog', { method: 'PUT', token, json: normalizedCatalog });

  const Compiler = await ensureMindArCompiler();
  const compiler = new Compiler();
  const orderedCatalog = normalizedCatalog.filter((i) => i && i.marker && i.model).sort((a, b) => a.targetIndex - b.targetIndex);

  const images = [];
  for (let i = 0; i < orderedCatalog.length; i += 1) {
    const src = absUrl(orderedCatalog[i].marker);
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
  const [price, setPrice] = useState('');
  const [aiLabels, setAiLabels] = useState('');
  const [ingredients, setIngredients] = useState('');
  const [calories, setCalories] = useState('');
  const [time, setTime] = useState('');
  const [chefNote, setChefNote] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [carbsG, setCarbsG] = useState('');
  const [fatG, setFatG] = useState('');
  const [fiberG, setFiberG] = useState('');
  const [sugarG, setSugarG] = useState('');
  const [sodiumMg, setSodiumMg] = useState('');
  const [targetIndex, setTargetIndex] = useState('');
  const [scale, setScale] = useState('');
  const [rotation, setRotation] = useState('');
  const [position, setPosition] = useState('');
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
    setPrice(model?.price != null ? String(model.price) : '');
    setAiLabels(Array.isArray(model?.aiLabels) ? model.aiLabels.join(', ') : '');
    setIngredients(String(model?.details?.ingredients || ''));
    setCalories(String(model?.details?.calories || ''));
    setTime(String(model?.details?.time || ''));
    setChefNote(String(model?.details?.chefNote || ''));
    setProteinG(model?.details?.nutrients?.protein_g != null ? String(model.details.nutrients.protein_g) : '');
    setCarbsG(model?.details?.nutrients?.carbs_g != null ? String(model.details.nutrients.carbs_g) : '');
    setFatG(model?.details?.nutrients?.fat_g != null ? String(model.details.nutrients.fat_g) : '');
    setFiberG(model?.details?.nutrients?.fiber_g != null ? String(model.details.nutrients.fiber_g) : '');
    setSugarG(model?.details?.nutrients?.sugar_g != null ? String(model.details.nutrients.sugar_g) : '');
    setSodiumMg(model?.details?.nutrients?.sodium_mg != null ? String(model.details.nutrients.sodium_mg) : '');
    setTargetIndex(model?.targetIndex != null ? String(model.targetIndex) : '');
    setScale(String(model?.scale || '1 1 1'));
    setRotation(String(model?.rotation || '0 0 0'));
    setPosition(String(model?.position || '0 0 0'));
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
      if (String(price || '').trim()) fd.set('price', String(price).trim());
      if (String(aiLabels || '').trim()) fd.set('aiLabels', String(aiLabels).trim());
      {
        const nutrients = {};
        if (String(proteinG || '').trim()) nutrients.protein_g = Number(proteinG);
        if (String(carbsG || '').trim()) nutrients.carbs_g = Number(carbsG);
        if (String(fatG || '').trim()) nutrients.fat_g = Number(fatG);
        if (String(fiberG || '').trim()) nutrients.fiber_g = Number(fiberG);
        if (String(sugarG || '').trim()) nutrients.sugar_g = Number(sugarG);
        if (String(sodiumMg || '').trim()) nutrients.sodium_mg = Number(sodiumMg);
        const details = {
          ingredients: String(ingredients || '').trim(),
          calories: String(calories || '').trim(),
          time: String(time || '').trim(),
          chefNote: String(chefNote || '').trim(),
          nutrients: Object.keys(nutrients).length ? nutrients : null
        };
        fd.set('details', JSON.stringify(details));
      }
      if (String(targetIndex || '').trim()) fd.set('targetIndex', String(targetIndex).trim());
      if (String(scale || '').trim()) fd.set('scale', String(scale).trim());
      if (String(rotation || '').trim()) fd.set('rotation', String(rotation).trim());
      if (String(position || '').trim()) fd.set('position', String(position).trim());
      if (glbFile) fd.set('glb', glbFile);
      if (markerFile) fd.set('marker', markerFile);

      const saved = isEdit
        ? await apiFetch(`/api/models/${encodeURIComponent(model.arId)}`, { method: 'PUT', token, formData: fd })
        : await apiFetch('/api/models', { method: 'POST', token, formData: fd });

      toast({ tone: 'success', message: 'Modelo subido', ttl: 2200 });
      onSaved(saved);
      onClose();

      toast({ tone: 'default', message: 'Generando targets.mind… (puede tardar)', ttl: 4500 });
      const runRebuild = async () => {
        await rebuildTargetsMind({ token });
        try {
          localStorage.setItem('webar_targets_updated_at', String(Date.now()));
        } catch (e) {}
        toast({ tone: 'success', message: 'targets.mind actualizado', ttl: 3500 });
      };
      if (window.__webarTargetsRebuildPromise) return;
      window.__webarTargetsRebuildPromise = Promise.resolve()
        .then(() => runRebuild())
        .catch((err) => {
          let msg = String(err?.message || err || '').trim();
          if (!msg) msg = 'Error desconocido';
          if (msg.toLowerCase().includes('failed to fetch')) {
            msg = 'No se pudo descargar el compilador. Revisa tu conexión a internet.';
          }
          if (msg.toLowerCase().includes('dynamically imported module')) {
            msg = 'El navegador bloqueó el compilador. Reintenta o revisa la conexión.';
          }
          toast({
            tone: 'error',
            message: `No se pudo generar targets.mind: ${msg.slice(0, 140)}`,
            ttl: 6000
          });
        })
        .finally(() => {
          try {
            delete window.__webarTargetsRebuildPromise;
          } catch (e) {
            window.__webarTargetsRebuildPromise = null;
          }
        });
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
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Precio</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              placeholder="0"
              inputMode="decimal"
            />
          </div>
          <div className="rounded-2xl border border-slate-900 bg-slate-950 px-4 py-3">
            <div className="text-xs font-medium text-slate-300">Escala y posición</div>
            <div className="mt-1 text-sm text-slate-200">Automático en cámara</div>
            <div className="mt-1 text-xs text-slate-500">El sistema centra y ajusta el tamaño del GLB al cargar.</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Etiquetas IA (YOLO)</label>
            <input
              value={aiLabels}
              onChange={(e) => setAiLabels(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              placeholder="ej: banana, apple, bottle"
            />
            <div className="mt-1 text-xs text-slate-500">Separadas por comas. Deben coincidir con las clases de tu modelo YOLO.</div>
          </div>
          <div className="rounded-2xl border border-slate-900 bg-slate-950 px-4 py-3">
            <div className="text-xs font-medium text-slate-300">Ficha nutricional</div>
            <div className="mt-1 text-sm text-slate-200">Se muestra en el modal de información</div>
            <div className="mt-1 text-xs text-slate-500">Puedes llenar calorías y macros (g / mg).</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Ingredientes</label>
            <input
              value={ingredients}
              onChange={(e) => setIngredients(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              placeholder="Opcional"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Calorías</label>
            <input
              value={calories}
              onChange={(e) => setCalories(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              placeholder="ej: 250 kcal"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Tiempo</label>
            <input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              placeholder="ej: 15 min"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Nota</label>
            <input
              value={chefNote}
              onChange={(e) => setChefNote(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              placeholder="Opcional"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Proteínas (g)</label>
            <input
              value={proteinG}
              onChange={(e) => setProteinG(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              inputMode="decimal"
              placeholder="0"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Carbohidratos (g)</label>
            <input
              value={carbsG}
              onChange={(e) => setCarbsG(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              inputMode="decimal"
              placeholder="0"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Grasas (g)</label>
            <input
              value={fatG}
              onChange={(e) => setFatG(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              inputMode="decimal"
              placeholder="0"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Fibra (g)</label>
            <input
              value={fiberG}
              onChange={(e) => setFiberG(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              inputMode="decimal"
              placeholder="0"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Azúcar (g)</label>
            <input
              value={sugarG}
              onChange={(e) => setSugarG(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              inputMode="decimal"
              placeholder="0"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">Sodio (mg)</label>
            <input
              value={sodiumMg}
              onChange={(e) => setSodiumMg(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
              inputMode="decimal"
              placeholder="0"
            />
          </div>
        </div>

        <details className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-200">Ajustes avanzados</summary>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">targetIndex</label>
              <input
                value={targetIndex}
                onChange={(e) => setTargetIndex(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
                placeholder="0"
                inputMode="numeric"
              />
              <div className="mt-1 text-xs text-slate-500">Normalmente no es necesario: se recalcula al generar targets.mind.</div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Rotation</label>
              <input
                value={rotation}
                onChange={(e) => setRotation(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
                placeholder="0 0 0"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Scale</label>
              <input
                value={scale}
                onChange={(e) => setScale(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
                placeholder="1 1 1"
              />
              <div className="mt-1 text-xs text-slate-500">En cámara se normaliza al cargar (esto es opcional).</div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Position</label>
              <input
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
                placeholder="0 0 0"
              />
              <div className="mt-1 text-xs text-slate-500">En cámara se centra automáticamente (esto es opcional).</div>
            </div>
          </div>
        </details>

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
            disabled={saving}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-60"
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
