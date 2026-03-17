import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/auth.jsx';
import { classNames } from '../utils/format.js';

function Icon({ name }) {
  const n = String(name || '');
  if (n === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 13h6v7H4z" />
        <path d="M14 4h6v9h-6z" />
        <path d="M14 17h6v3h-6z" />
        <path d="M4 4h6v5H4z" />
      </svg>
    );
  }
  if (n === 'models') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2 2 7l10 5 10-5-10-5Z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    );
  }
  if (n === 'markers') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 16V8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0L4 6.27A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="M7.5 12h9" />
        <path d="M12 7.5v9" />
      </svg>
    );
  }
  return null;
}

function NavItem({ to, icon, children }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        classNames(
          'group flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition',
          isActive
            ? 'bg-gradient-to-r from-sky-500/15 to-indigo-500/10 text-white ring-1 ring-sky-500/20'
            : 'text-slate-300 hover:bg-slate-900/60 hover:text-white'
        )
      }
    >
      <span className={classNames('grid h-8 w-8 place-items-center rounded-lg transition', 'text-slate-400 group-hover:text-slate-200')}>
        <Icon name={icon} />
      </span>
      {children}
    </NavLink>
  );
}

export function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const { logout } = useAuth();
  const navigate = useNavigate();

  const nav = useMemo(
    () => (
      <nav className="space-y-1">
        <NavItem to="/" icon="dashboard">
          Dashboard
        </NavItem>
        <NavItem to="/models" icon="models">
          Modelos
        </NavItem>
        <NavItem to="/markers" icon="markers">
          Markers
        </NavItem>
      </nav>
    ),
    []
  );

  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const openHelp = () => setHelpOpen(true);
  const closeHelp = () => setHelpOpen(false);

  useEffect(() => {
    const onToast = (e) => {
      const detail = e && e.detail ? e.detail : {};
      const message = typeof detail.message === 'string' ? detail.message : '';
      if (!message) return;
      const tone = typeof detail.tone === 'string' ? detail.tone : 'default';
      const ttl = Number.isFinite(Number(detail.ttl)) ? Number(detail.ttl) : 3500;
      const id =
        typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const toast = { id, message, tone, ttl };
      setToasts((prev) => [...prev, toast].slice(-3));
      if (ttl > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, ttl);
      }
    };
    window.addEventListener('webar:toast', onToast);
    return () => window.removeEventListener('webar:toast', onToast);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-gradient-to-b from-sky-500/10 via-indigo-500/5 to-transparent" />
      <div className="relative mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-72 border-r border-slate-900/70 bg-slate-950/60 p-4 backdrop-blur md:block">
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 text-sm font-semibold text-slate-950">
                AR
              </div>
              <div>
                <div className="text-base font-semibold tracking-tight text-white">WebAR Admin</div>
                <div className="text-xs text-slate-400">Panel de control</div>
              </div>
            </div>
          </div>
          {nav}
          <div className="mt-8">
            <button
              onClick={onLogout}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-slate-200 hover:bg-slate-900"
            >
              Cerrar sesión
            </button>
          </div>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-slate-900/70 bg-slate-950/60 backdrop-blur">
            <div className="flex items-center justify-between px-4 py-3 md:px-6">
              <button
                onClick={() => setMobileOpen((v) => !v)}
                className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 md:hidden"
              >
                Menú
              </button>
              <div className="text-sm text-slate-400">Administración</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={openHelp}
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
                >
                  Ayuda
                </button>
                <button
                  onClick={onLogout}
                  className="hidden rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 md:inline-flex"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          </header>

          {mobileOpen ? (
            <div className="border-b border-slate-900/70 bg-slate-950 px-4 py-3 md:hidden">
              {nav}
            </div>
          ) : null}

          <main className="flex-1 px-4 py-6 md:px-6">
            <Outlet />
          </main>
        </div>
      </div>

      {helpOpen ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/70" onClick={closeHelp} />
          <div className="absolute inset-0 overflow-auto p-4">
            <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-900 bg-slate-950 shadow-xl shadow-black/40">
              <div className="flex items-center justify-between border-b border-slate-900 px-5 py-4">
                <div>
                  <div className="text-base font-semibold tracking-tight text-white">Guía rápida del panel</div>
                  <div className="mt-0.5 text-xs text-slate-400">Pensado para cualquier persona (sin configuración técnica)</div>
                </div>
                <button
                  onClick={closeHelp}
                  className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900"
                >
                  Cerrar
                </button>
              </div>
              <div className="p-5">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
                    <div className="text-sm font-medium text-white">1) Crear un modelo</div>
                    <div className="mt-2 text-sm text-slate-300">
                      Ve a <span className="font-medium">Modelos</span> → <span className="font-medium">Nuevo</span> → sube un archivo GLB y una imagen.
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      La imagen se convierte en marcador y el sistema actualiza targets.mind automáticamente.
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
                    <div className="text-sm font-medium text-white">2) Escala y posición (automático)</div>
                    <div className="mt-2 text-sm text-slate-300">
                      En la cámara, el modelo se centra y se ajusta de tamaño solo. No necesitas tocar escala/posición.
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Si un GLB viene “gigante” o “minúsculo”, se normaliza al cargar.
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
                    <div className="text-sm font-medium text-white">3) Ver el estado del sistema</div>
                    <div className="mt-2 text-sm text-slate-300">En Dashboard revisa cantidad de modelos, archivos y el estado de targets.mind.</div>
                    <div className="mt-2 text-xs text-slate-500">Si targets.mind está OK, el escaneo debería reconocer tus markers.</div>
                  </div>
                  <div className="rounded-2xl border border-slate-900 bg-slate-950 p-4">
                    <div className="text-sm font-medium text-white">4) Orden y limpieza</div>
                    <div className="mt-2 text-sm text-slate-300">
                      Desde Dashboard puedes analizar y eliminar archivos GLB/imagenes que ya no estén referenciados por ningún modelo.
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Usa primero “Analizar” (no borra nada). Luego “Eliminar” si estás seguro.</div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-slate-900 bg-slate-950 p-4">
                  <div className="text-sm font-medium text-white">Atajos</div>
                  <div className="mt-2 text-sm text-slate-300">
                    En la cámara, el atajo abre el panel en una pestaña nueva para no cortar la experiencia de AR.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {toasts.length ? (
        <div className="fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={classNames(
                'rounded-2xl border px-4 py-3 text-sm shadow-lg shadow-black/40 backdrop-blur',
                t.tone === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-50'
                  : t.tone === 'error'
                    ? 'border-red-500/20 bg-red-500/10 text-red-50'
                    : 'border-slate-800 bg-slate-950/80 text-slate-200'
              )}
            >
              {t.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
