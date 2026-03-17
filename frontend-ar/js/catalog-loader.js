// catalog-loader.js
// Handles fetching the catalog data and initializing the AR scene

const API_BASE = (typeof CONFIG !== 'undefined' && CONFIG && typeof CONFIG.getApiBaseUrl === 'function')
    ? CONFIG.getApiBaseUrl()
    : '';
let CATALOG_URL = API_BASE
    ? `${API_BASE}/api/catalog`
    : '/api/catalog';

// Global object to store app data (compatible with existing components)
window.APP_DATA = {
    models: []
};

const DEBUG = Boolean(
    (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.system && typeof CONFIG.system.debug === 'boolean' && CONFIG.system.debug) ||
    (typeof window !== 'undefined' && window && window.location && new URLSearchParams(window.location.search).get('debug') === '1')
);

document.addEventListener('DOMContentLoaded', () => {
    initCatalog();
});

function shouldIgnoreLocalOverride(data) {
    try {
        const items = Array.isArray(data) ? data : [];
        if (!items.length) return true;
        const currentHost = String(location.host || '').toLowerCase();
        for (const item of items) {
            const model = item && typeof item.model === 'string' ? item.model : '';
            const marker = item && typeof item.marker === 'string' ? item.marker : '';
            for (const value of [model, marker]) {
                if (!value || typeof value !== 'string') continue;
                if (!/^https?:\/\//i.test(value)) continue;
                let urlHost = '';
                try {
                    urlHost = String(new URL(value).host || '').toLowerCase();
                } catch (e) {
                    urlHost = '';
                }
                if (urlHost && currentHost && urlHost !== currentHost) return true;
            }
        }
        return false;
    } catch (e) {
        return true;
    }
}

async function initCatalog() {
    console.log("Initializing Catalog Loader...");
    console.log("Configured Catalog URL:", CATALOG_URL);
    await fetchCatalog();
}

async function fetchCatalog() {
    console.log(`Fetching catalog from ${CATALOG_URL}...`);
    try {
        const response = await fetch(CATALOG_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        await processCatalogDataAsync(data, { assetsFromRepo: false });
    } catch (error) {
        console.error("Failed to load catalog:", error);
        try {
            const msg = error && typeof error.message === 'string' ? error.message : String(error || 'Error cargando el catálogo');
            document.dispatchEvent(new CustomEvent('catalogerror', { detail: { message: msg } }));
        } catch (e) {}
    }
}

const LOCAL_DB_NAME = 'webar_local_assets';
const localObjectUrlCache = new Map();
window.addEventListener('pagehide', () => {
    for (const url of localObjectUrlCache.values()) {
        try { URL.revokeObjectURL(url); } catch (e) {}
    }
    localObjectUrlCache.clear();
});

function openLocalDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(LOCAL_DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('blobs')) {
                db.createObjectStore('blobs', { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getLocalBlob(key) {
    const db = await openLocalDb();
    return await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readonly');
        const store = tx.objectStore('blobs');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
}

function formatPrice(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return `S/ ${value.toFixed(2)}`;
    if (typeof value === 'string') return value;
    return 'S/ 0.00';
}

async function resolveAssetUrlAsync(pathOrUrl, assetsFromRepo) {
    if (!pathOrUrl || typeof pathOrUrl !== 'string') return pathOrUrl;

    if (pathOrUrl.startsWith('idb://')) {
        const key = pathOrUrl.replace(/^idb:\/\//, '');
        if (localObjectUrlCache.has(key)) return localObjectUrlCache.get(key);
        try {
            const blob = await getLocalBlob(key);
            if (!blob) return null;
            const objUrl = URL.createObjectURL(blob);
            localObjectUrlCache.set(key, objUrl);
            return objUrl;
        } catch (e) {
            console.error('Failed to load local blob', e);
            return null;
        }
    }

    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    if (pathOrUrl.startsWith('/')) {
        return API_BASE ? `${API_BASE}${pathOrUrl}` : pathOrUrl;
    }
    if (!assetsFromRepo) return pathOrUrl;
    if (typeof CONFIG === 'undefined' || !CONFIG || typeof CONFIG.getRawUrl !== 'function') return pathOrUrl;
    const normalized = pathOrUrl.replace(/^\/+/, '');
    return CONFIG.getRawUrl(normalized);
}

async function processCatalogDataAsync(data, options = {}) {
    const items = Array.isArray(data) ? data : [];
    const assetsFromRepo = options.assetsFromRepo ?? false;

    // Map the JSON data to the structure our app expects
    // The JSON has "id" as string, but we need numeric ID for barcodes if we stick to barcode system.
    // However, the user wants "id": "sushi01". 
    // We will use "barcodeValue" from JSON if available, or try to parse "id" if it's a number, or auto-assign.
    
    const processedModels = await Promise.all(items.map(async (item, index) => {
        // Ensure we have a valid barcode value
        let barcodeVal = Number.isFinite(item.barcodeValue) ? item.barcodeValue : undefined;
        if (barcodeVal === undefined) {
            // Try to parse from ID if it looks like "sushi01" -> 1? No, too risky.
            // Default to index if not provided (risky if order changes)
            barcodeVal = index; 
        }

        return {
            id: barcodeVal, // internal ID for AR.js barcode
            originalId: item.id, // string ID from DB
            targetIndex: Number.isFinite(item.targetIndex) ? item.targetIndex : index,
            name: item.name,
            desc: item.description,
            price: formatPrice(item.price),
            modelSrc: await resolveAssetUrlAsync(item.model, assetsFromRepo),
            markerSrc: await resolveAssetUrlAsync(item.marker, assetsFromRepo),
            scale: item.scale || "1 1 1",
            rotation: item.rotation || "0 0 0",
            position: item.position || "0 0 0",
            minScale: item.minScale || 0.1,
            maxScale: item.maxScale || 5,
            rotationSpeed: item.rotationSpeed || 1.5,
            details: item.details || {
                ingredients: "Ingredientes no disponibles",
                calories: "N/A",
                time: "N/A",
                chefNote: ""
            }
        };
    }));

    // Update Global State
    processedModels.forEach((m) => {
        if (!m) return;
        const missingModel = !m.modelSrc;
        const missingMarker = !m.markerSrc;
        if (missingModel || missingMarker) {
            console.error(`Modelo descartado: ${m.name || m.originalId || m.id} | model=${m.modelSrc} | marker=${m.markerSrc}`);
        }
    });
    const filteredModels = processedModels.filter((m) => m && m.modelSrc && m.markerSrc);
    window.APP_DATA.models = filteredModels;

    if (!filteredModels.length) {
        console.error('Catálogo cargado pero sin modelos válidos (modelSrc/markerSrc nulos).');
        try {
            document.dispatchEvent(new CustomEvent('catalogerror', { detail: { message: 'Catálogo sin modelos válidos' } }));
        } catch (e) {}
        return;
    }
    
    const toPrefetch = filteredModels
        .map((m) => m && typeof m.modelSrc === 'string' ? m.modelSrc : '')
        .filter(Boolean)
        .slice(0, 4);
    if (toPrefetch.length) {
        setTimeout(() => {
            Promise.allSettled(
                toPrefetch.map((url) => {
                    try {
                        if (!url || typeof url !== 'string') return Promise.resolve();
                        if (url.startsWith('blob:')) return Promise.resolve();
                        if (url.startsWith('idb://')) return Promise.resolve();
                        return fetch(url, { cache: 'force-cache' }).then(() => {});
                    } catch (e) {
                        return Promise.resolve();
                    }
                })
            ).catch(() => {});
        }, 0);
    }

    // Generate the AR Scene
    generateARScene(filteredModels);

    document.dispatchEvent(new CustomEvent('catalogloaded', { detail: { models: filteredModels } }));
}

function generateARScene(models) {
    const scene = document.querySelector('a-scene');

    if (!scene) {
        console.error("Scene not found!");
        return;
    }

    let worldContainer = document.getElementById('world-container');
    if (!worldContainer) {
        worldContainer = document.createElement('a-entity');
        worldContainer.setAttribute('id', 'world-container');
        scene.appendChild(worldContainer);
    }

    const existingDynamicNodes = document.querySelectorAll('[dynamic="true"]');
    existingDynamicNodes.forEach((el) => el.parentNode?.removeChild(el));

    worldContainer.innerHTML = '';

    if (DEBUG) console.log(`Generating scene for ${models.length} models...`);

    const shouldPreloadModels = models.length <= 6;

    models.forEach(model => {
        const target = document.createElement('a-entity');
        const targetIndex = Number.isFinite(model.targetIndex) ? model.targetIndex : model.id;
        target.setAttribute('mindar-image-target', `targetIndex: ${targetIndex}`);
        target.setAttribute('id', `marker-${model.id}`);
        target.setAttribute('marker-handler', '');
        target.setAttribute('dynamic', 'true');
        
        // Placeholder (Visual guide when model is not active)
        const placeholder = document.createElement('a-entity');
        placeholder.setAttribute('id', `placeholder-${model.id}`);
        placeholder.setAttribute('visible', 'false');
        
        // Circle hit area
        const circle = document.createElement('a-circle');
        circle.setAttribute('radius', '0.8');
        circle.setAttribute('position', '0 0 0');
        circle.setAttribute('material', 'opacity: 0; transparent: true');
        circle.setAttribute('class', 'clickable');
        circle.setAttribute('click-handler', '');
        placeholder.appendChild(circle);

        // Visual Ring
        const ring = document.createElement('a-ring');
        ring.setAttribute('class', 'clickable');
        ring.setAttribute('click-handler', '');
        ring.setAttribute('color', '#00FFFF');
        ring.setAttribute('radius-inner', '0.4');
        ring.setAttribute('radius-outer', '0.6');
        ring.setAttribute('position', '0 0 0');
        placeholder.appendChild(ring);
        
        target.appendChild(placeholder);
        
        const modelEnt = document.createElement('a-entity');
        modelEnt.setAttribute('class', 'model-entity clickable');
        modelEnt.setAttribute('id', `model-${model.id}`);
        modelEnt.setAttribute('position', model.position || '0 0 0');
        modelEnt.setAttribute('rotation', model.rotation);
        modelEnt.setAttribute('scale', model.scale || '1 1 1');
        modelEnt.setAttribute('data-gltf-src', model.modelSrc);
        if (shouldPreloadModels && model.modelSrc) {
            modelEnt.setAttribute('gltf-model', model.modelSrc);
        }
        modelEnt.setAttribute('click-handler', '');
        modelEnt.setAttribute('model-controller', `minScale: ${model.minScale}; maxScale: ${model.maxScale}; rotationSpeed: ${model.rotationSpeed}`);
        modelEnt.setAttribute('visible', 'false');
        
        target.appendChild(modelEnt);
        worldContainer.appendChild(target);
    });
    
    if (DEBUG) console.log("Scene generation complete.");
}
