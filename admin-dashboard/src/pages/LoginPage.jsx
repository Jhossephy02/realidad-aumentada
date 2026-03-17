import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/auth.jsx';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ username, password });
      const to = location.state?.from || '/';
      navigate(to, { replace: true });
    } catch (err) {
      setError(err?.message ? String(err.message) : 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-900 bg-slate-950 p-6 shadow-xl shadow-black/30">
          <div className="mb-6">
            <div className="text-xl font-semibold tracking-tight text-white">WebAR Admin</div>
            <div className="text-sm text-slate-400">Inicia sesión para administrar modelos</div>
          </div>

          {error ? (
            <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Usuario</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">Contraseña</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-sky-500/30 focus:ring-4"
                autoComplete="current-password"
              />
            </div>
            <button
              disabled={loading}
              className="w-full rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
            >
              {loading ? 'Ingresando…' : 'Ingresar'}
            </button>
          </form>

          <div className="mt-4 text-xs text-slate-500">
            Si ves errores 404 dentro del panel, normalmente es porque el backend no está sirviendo /api. En el modo integrado, el mismo servidor sirve /admin y /api.
          </div>
        </div>
      </div>
    </div>
  );
}
