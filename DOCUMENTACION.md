# Producción (deploy)

## 1) Requisitos

- Node.js 18+ (recomendado 20+)
- Un dominio o IP pública
- (Opcional) Reverse proxy (Nginx / Caddy) para HTTPS

## 2) Variables de entorno

Este proyecto usa un servidor Node (Express) que sirve:
- AR: `/` (frontend)
- Panel: `/admin`
- API: `/api/*`
- Subidas: `/uploads/*`

Variables:

- `NODE_ENV=production`
- `PORT=8000` (o el puerto que uses)
- `HOST=0.0.0.0`
- `ADMIN_USERNAME` y `ADMIN_PASSWORD` (obligatorio en producción)
- (Opcional) `ADMIN_TOKEN_TTL_MS`
- (Opcional) `DATA_DIR` (default: `storage/data`)
- (Opcional) `UPLOADS_DIR` (default: `storage/uploads`)
- (Opcional) `FRONTEND_DIR` (default: `frontend-ar`)
- (Opcional) `ADMIN_DIST_DIR` (default: `admin-dashboard/dist`)

Importante:
- En producción, el servidor no permite credenciales por defecto (`admin` / `admin123`).
- El sistema crea el primer admin automáticamente cuando no existe ningún admin guardado en la base.

## 3) Build del panel admin

En el servidor (deploy):

```bash
npm ci
npm run build
```

Eso compila el panel en `admin-dashboard/dist` para servirlo desde `/admin`.

## 4) Ejecutar en producción

Ejemplo (Linux) con variables:

```bash
export NODE_ENV=production
export PORT=8000
export HOST=0.0.0.0
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="cambia_esto"

npm ci
npm run build
node server.js
```

URLs:
- AR: `https://TU_DOMINIO/`
- Admin: `https://TU_DOMINIO/admin/`
- Healthcheck: `https://TU_DOMINIO/api/health`

## 5) Reverse proxy (recomendado)

Sirve el puerto interno del Node (ej. 8000) detrás de HTTPS.

Notas:
- La app usa cámara: debe estar en HTTPS o en `localhost`.
- Si el proxy reescribe headers, asegúrate de pasar `Host` y `X-Forwarded-Proto` para URLs absolutas correctas.

## 6) Persistencia de datos

Archivos importantes:
- Base: `storage/data/db.json`
- Subidas: `storage/uploads/*` (models, markers, patterns, marker-previews, targets)

En producción, monta estos directorios en disco persistente (no efímero).

## 7) Gestión de admins

En `/admin` (Dashboard) puedes:
- Crear nuevos administradores
- Cambiar contraseñas

El primer admin se crea si no existe ninguno. En producción, define `ADMIN_USERNAME` y `ADMIN_PASSWORD` para el bootstrap inicial.

