import React, { useMemo, useState } from 'react';
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
              <button
                onClick={onLogout}
                className="hidden rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900 md:inline-flex"
              >
                Cerrar sesión
              </button>
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
    </div>
  );
}
