import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './state/auth.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { ModelsPage } from './pages/ModelsPage.jsx';
import { MarkersPage } from './pages/MarkersPage.jsx';
import { Shell } from './components/Shell.jsx';

function RequireAuth({ children }) {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function App() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e) => {
      if (!e?.detail?.status || e.detail.status !== 401) return;
      logout();
      navigate('/login', { replace: true });
    };
    window.addEventListener('webar:unauthorized', handler);
    return () => window.removeEventListener('webar:unauthorized', handler);
  }, [logout, navigate]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="markers" element={<MarkersPage />} />
      </Route>
      <Route path="*" element={<Navigate to={token ? '/' : '/login'} replace />} />
    </Routes>
  );
}

