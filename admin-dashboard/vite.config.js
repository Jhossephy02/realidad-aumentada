import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  const target = process.env.VITE_API_BASE || 'http://127.0.0.1:8040';
  return {
    base: '/admin/',
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': target,
        '/uploads': target
      }
    }
  };
});
