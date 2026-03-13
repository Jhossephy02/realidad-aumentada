import React, { createContext, useContext, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api.js';

const AuthContext = createContext(null);

function readToken() {
  try {
    return localStorage.getItem('admin_token') || '';
  } catch (e) {
    return '';
  }
}

function writeToken(token) {
  try {
    if (!token) localStorage.removeItem('admin_token');
    else localStorage.setItem('admin_token', token);
  } catch (e) {}
}

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => readToken());

  const setToken = (next) => {
    const value = String(next || '');
    setTokenState(value);
    writeToken(value);
  };

  const login = async ({ username, password }) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      token: '',
      json: { username, password }
    });
    if (!res?.token) throw new Error('Login inválido');
    setToken(res.token);
    return res;
  };

  const logout = () => setToken('');

  const value = useMemo(() => ({ token, setToken, login, logout }), [token]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}

