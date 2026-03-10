# Documentación del Proyecto WebAR (MindAR)

## Objetivo

El proyecto permite que cada imagen “marker/target” (por ejemplo, una hoja/página impresa de un catálogo) sea reconocida por la cámara y muestre un modelo 3D (.glb) encima.

La administración (cambiar/agregar modelos e imágenes target) se hace desde el panel administrativo, sin editar código.

## Cómo funciona (resumen)

1. En el panel administrativo se sube:
   - Modelo 3D (.glb)
   - Imagen target (la foto/imagen que se va a escanear)
2. El sistema genera un archivo `targets.mind` con todas las imágenes target del catálogo.
3. La experiencia AR carga:
   - `targets.mind`
   - `catalog/catalog.json`
4. Cuando MindAR detecta una imagen target, usa `targetIndex` para mostrar el modelo correcto.

## Conceptos clave

- **Imagen target**: la imagen que la cámara reconoce (una “hoja” del catálogo, una captura, una impresión, etc.).
- **targets.mind**: archivo que contiene la versión “compilada” de todas las imágenes target. MindAR lo necesita para poder detectar rápido y estable.
- **targetIndex**: número entero que enlaza una imagen dentro de `targets.mind` con un producto del catálogo.

## Repositorios (código vs assets)

- **Repositorio del sistema (este proyecto)**: HTML/JS y lógica del panel.
- **Repositorio de assets**: imágenes target, modelos 3D y el catálogo `catalog/catalog.json`.

La URL del repo de assets se define en `config.js`.

## Flujo de trabajo (Admin → AR)

### 1) Cargar/editar un producto

1. Abrir `admin/panel.html`.
2. Iniciar sesión (credenciales del panel) y configurar el repo de assets (usuario/repo/token).
3. Seleccionar un producto o crear uno nuevo.
4. Subir:
   - **Modelo 3D (.glb)**
   - **Imagen Target (MindAR)** (la foto que vas a escanear)
5. Guardar.

Si cambiaste imagen o modelo, el sistema regenera `targets.mind` automáticamente.

### 2) Generar targets.mind manualmente (opcional)

En el panel, botón “Generar y subir targets.mind”.

Útil cuando:
- cargaste muchos productos de golpe,
- quieres forzar una reconstrucción completa.

### 3) Probar en AR

1. Abrir `index.html` en un servidor (por ejemplo `python -m http.server`).
2. Permitir cámara.
3. Escanear la hoja/página (imagen target) y ver el modelo.

## “Cada hoja del catálogo debe ser un marker”

Sí se puede, con esta regla:

- Cada hoja/página debe existir como **imagen** (PNG/JPG) en el panel.
- Esa imagen se usa como “Imagen Target”.

### Cómo convertir tu catálogo web en targets

Si tu catálogo está en una web (por ejemplo `https://zelva.icatafi.com/`), MindAR no puede “tomar la web” como target automáticamente. Necesitas una imagen estable por hoja, por ejemplo:

- Captura de pantalla de cada hoja,
- Exportar/convertir el catálogo a PDF y luego extraer cada página como imagen.

Luego, subes cada imagen en el panel como “Imagen Target” y asignas su modelo 3D.

Para escanear, puedes usar:
- La hoja impresa,
- La imagen en otra pantalla (tablet/otro celular), idealmente sin reflejos.

## Archivos importantes

- `admin/panel.html`: interfaz del panel.
- `js/admin-panel.js`: lógica de subida y generación de `targets.mind`.
- `js/catalog-loader.js`: carga el catálogo y crea entidades MindAR usando `targetIndex`.
- `index.html`: experiencia AR (carga `targets.mind` del repo de assets vía `config.js`).
- `config.js`: configuración del repo de assets.

