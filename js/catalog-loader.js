// catalog-loader.js
// Handles fetching the catalog data and initializing the AR scene

// Use configuration to determine catalog source
const CATALOG_PATH = 'catalog/catalog.json';
const API_BASE = (typeof CONFIG !== 'undefined' && CONFIG && typeof CONFIG.getApiBaseUrl === 'function')
    ? CONFIG.getApiBaseUrl()
    : '';
let CATALOG_URL = API_BASE
    ? `${API_BASE}/api/catalog`
    : ((typeof CONFIG !== 'undefined' && CONFIG && typeof CONFIG.getRawUrl === 'function') ? CONFIG.getRawUrl(CATALOG_PATH) : 'catalog/catalog.json');

// Global object to store app data (compatible with existing components)
window.APP_DATA = {
    models: []
};

document.addEventListener('DOMContentLoaded', () => {
    initCatalog();
});

async function initCatalog() {
    console.log("Initializing Catalog Loader...");
    console.log("Configured Catalog URL:", CATALOG_URL);
    
    // Check for admin override (local storage from admin panel)
    const localOverride = localStorage.getItem('ar_catalog_data');
    
    if (localOverride) {
        console.log("Loading catalog from LocalStorage (Admin Override)");
        try {
            const data = JSON.parse(localOverride);
            await processCatalogDataAsync(data);
        } catch (e) {
            console.error("Error parsing local catalog:", e);
            await fetchCatalog();
        }
    } else {
        if (!API_BASE) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 600);
                const res = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
                clearTimeout(timer);
                if (res.ok) {
                    CATALOG_URL = '/api/catalog';
                    console.log("Detected local Node API, using:", CATALOG_URL);
                }
            } catch (e) {}
        }
        await fetchCatalog();
    }
}

async function fetchCatalog() {
    console.log(`Fetching catalog from ${CATALOG_URL}...`);
    try {
        const isApi = typeof CATALOG_URL === 'string' && (CATALOG_URL.includes('/api/') || CATALOG_URL.startsWith('/api/'));
        const response = await fetch(CATALOG_URL, isApi ? { cache: 'no-store' } : undefined);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        await processCatalogDataAsync(data, { assetsFromRepo: CATALOG_URL.startsWith('http') && !API_BASE });
    } catch (error) {
        console.error("Failed to load catalog:", error);
        
        // If API fails, try GitHub/raw catalog; then local fallback for dev
        if (typeof CATALOG_URL === 'string' && (CATALOG_URL.includes('/api/') || CATALOG_URL.startsWith('/api/') || (API_BASE && CATALOG_URL.startsWith(API_BASE)))) {
            try {
                const rawUrl = (typeof CONFIG !== 'undefined' && CONFIG && typeof CONFIG.getRawUrl === 'function')
                    ? CONFIG.getRawUrl(CATALOG_PATH)
                    : '';
                if (rawUrl) {
                    console.log("API failed, trying raw catalog:", rawUrl);
                    const response = await fetch(rawUrl);
                    if (response.ok) {
                        const data = await response.json();
                        await processCatalogDataAsync(data, { assetsFromRepo: true });
                        return;
                    }
                }
            } catch (e) {}
        }

        if (typeof CATALOG_URL === 'string' && CATALOG_URL.startsWith('http')) {
            console.log("External load failed, trying local fallback 'catalog/catalog.json'...");
            try {
                const response = await fetch('catalog/catalog.json', { cache: 'no-store' });
                if (response.ok) {
                    const data = await response.json();
                    await processCatalogDataAsync(data, { assetsFromRepo: true });
                    return;
                }
            } catch (e) {
                console.error("Local fallback also failed", e);
            }
        }
        
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
    const items = (Array.isArray(data) ? data : []).filter((item) => item && item.model && item.marker);
    const shouldResolveFromRepo = items.some((item) => {
        const value = item && typeof item.model === 'string' ? item.model : '';
        return value && !value.startsWith('idb://') && !value.startsWith('/') && !/^https?:\/\//i.test(value);
    });

    const assetsFromRepo = options.assetsFromRepo ?? (CATALOG_URL.startsWith('http') && shouldResolveFromRepo);

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
    const filteredModels = processedModels.filter((m) => m && m.modelSrc && m.markerSrc);
    window.APP_DATA.models = filteredModels;
    
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

    console.log(`Generating scene for ${models.length} models...`);

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
        modelEnt.setAttribute('position', model.position);
        modelEnt.setAttribute('rotation', model.rotation);
        modelEnt.setAttribute('scale', model.scale);
        modelEnt.setAttribute('data-gltf-src', model.modelSrc);
        modelEnt.setAttribute('click-handler', '');
        modelEnt.setAttribute('model-controller', `minScale: ${model.minScale}; maxScale: ${model.maxScale}; rotationSpeed: ${model.rotationSpeed}`);
        
        target.appendChild(modelEnt);
        worldContainer.appendChild(target);
    });
    
    console.log("Scene generation complete.");
}
