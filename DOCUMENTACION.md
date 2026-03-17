# Documentación del Proyecto WebAR (MindAR)

## Objetivo

El proyecto permite que cada imagen “target” (por ejemplo, una hoja/página impresa de un catálogo) sea reconocida por la cámara y muestre un modelo 3D (.glb) encima del celular.

La administración (cambiar/agregar modelos e imágenes target) se hace desde el panel administrativo, sin editar código.

## URLs principales

- AR: `/` (por ejemplo `http://localhost:8000/`)
- Admin: `/admin/` (por ejemplo `http://localhost:8000/admin/`)

## Comandos

- `npm run dev` o `npm start`: inicia el servidor (AR + Admin + API)
- `npm run build`: compila el panel admin (`admin-dashboard/dist`)

## Cómo funciona (resumen)

1. En el panel administrativo (`/admin/`) se sube:
   - Modelo 3D (.glb)
   - Imagen target (la foto/imagen que se va a escanear)
2. El sistema actualiza el catálogo y regenera `targets.mind`.
3. La experiencia AR carga `targets.mind` desde `/api/targets.mind` y el catálogo desde `/api/catalog`.
4. Cuando MindAR detecta una imagen target, usa `targetIndex` para mostrar el modelo correcto.

## Conceptos clave

- **Imagen target**: la imagen que la cámara reconoce (una hoja del catálogo, una captura, una impresión, etc.).
- **targets.mind**: archivo “compilado” de todas las imágenes target.
- **targetIndex**: número entero que enlaza una imagen dentro de `targets.mind` con un producto del catálogo.

## “Cada hoja del catálogo debe ser un target”

Sí se puede, con esta regla:

- Cada hoja/página debe existir como **imagen** (PNG/JPG) en el panel.
- Esa imagen se usa como “Imagen Target”.

Si tu catálogo está en una web, MindAR no puede “usar la web” como target directamente. Necesitas una imagen estable por hoja, por ejemplo:

- Captura de pantalla de cada hoja
- Exportar el catálogo a PDF y extraer cada página como imagen

Para escanear, puedes usar:

- La hoja impresa
- La imagen en otra pantalla (tablet/otro celular), idealmente sin reflejos

## Colocación automática de modelos (misma “vista” para todos)

La experiencia AR aplica una colocación estándar para que los modelos:

- Salgan “encima” del celular (sobresalen)
- No queden al revés

Estos valores están centralizados en `MODEL_PLACEMENT` dentro de [index.html](file:///c:/Users/mjhos/OneDrive/Desktop/webAR/frontend-ar/index.html) (tamaño deseado, elevación, rotación base y distancia de sobresalir).

## Archivos importantes

- Servidor/API: [server.js](file:///c:/Users/mjhos/OneDrive/Desktop/webAR/server.js)
- AR (cliente): [index.html](file:///c:/Users/mjhos/OneDrive/Desktop/webAR/frontend-ar/index.html)
- Carga de catálogo/escena: [catalog-loader.js](file:///c:/Users/mjhos/OneDrive/Desktop/webAR/frontend-ar/js/catalog-loader.js)
- Base de datos: [db.json](file:///c:/Users/mjhos/OneDrive/Desktop/webAR/storage/data/db.json)
- Archivos subidos: `storage/uploads/` (models, markers, targets)

## Variables de entorno (opcional)

- `PORT`: puerto inicial (por defecto 8000, usa fallback si está ocupado)
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`: credenciales del panel
- `DATA_DIR`, `UPLOADS_DIR`: rutas de almacenamiento
- `FRONTEND_DIR`, `ADMIN_DIST_DIR`: rutas para servir AR/Admin

## API base (opcional)

Si necesitas apuntar el frontend a otro servidor, puedes configurar un `baseUrl` usando `CONFIG.getApiBaseUrl()` en [config.js](file:///c:/Users/mjhos/OneDrive/Desktop/webAR/frontend-ar/config.js) o usando `localStorage` con la clave `webar_api_base_url`.
