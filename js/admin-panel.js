// js/admin-panel.js
// Handles the Admin Panel logic and GitHub API integration

class GitHubService {
    constructor(token, owner, repo) {
        this.token = token;
        this.owner = owner;
        this.repo = repo;
        this.baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
    }

    getHeaders(extra = {}) {
        const token = String(this.token || '').trim();
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...extra
        };
        return headers;
    }

    async getFile(path, decode = true) {
        try {
            const response = await fetch(`${this.baseUrl}/contents/${path}`, {
                headers: {
                    ...this.getHeaders()
                }
            });
            
            if (!response.ok) {
                if (response.status === 404) return null; // File not found
                let details = null;
                try { details = await response.json(); } catch (e) {}
                const msg = details?.message ? `: ${details.message}` : '';
                throw new Error(`GitHub API Error (${response.status})${msg}`);
            }

            const data = await response.json();
            
            let content = data.content;
            if (decode && content) {
                try {
                    // Try to decode as UTF-8 text
                    content = decodeURIComponent(escape(atob(data.content)));
                } catch (e) {
                    console.warn("Could not decode content as text, returning Base64", e);
                }
            }

            return {
                content: content,
                sha: data.sha,
                download_url: data.download_url
            };
        } catch (error) {
            console.error('Error fetching file:', error);
            throw error;
        }
    }

    async uploadFile(path, contentBase64, message, sha = null) {
        const body = {
            message: message,
            content: contentBase64
        };

        if (sha) {
            body.sha = sha; // Required if updating an existing file
        }

        const response = await fetch(`${this.baseUrl}/contents/${path}`, {
            method: 'PUT',
            headers: {
                ...this.getHeaders({ 'Content-Type': 'application/json' })
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`Upload Failed (${response.status})${msg}`);
        }

        return await response.json();
    }

    async getRepo() {
        const response = await fetch(`${this.baseUrl}`, {
            headers: {
                ...this.getHeaders()
            }
        });

        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`GitHub Repo Error (${response.status})${msg}`);
        }

        return await response.json();
    }
}

// UI Manager
const UI = {
    elements: {
        loginScreen: document.getElementById('login-screen'),
        dashboardScreen: document.getElementById('dashboard-screen'),
        loginForm: document.getElementById('login-form'),
        loadingOverlay: document.getElementById('loading-overlay'),
        loadingText: document.getElementById('loading-text'),
        productList: document.getElementById('product-list'),
        productForm: document.getElementById('product-form'),
        editContainer: document.getElementById('edit-form-container'),
        emptyState: document.getElementById('empty-state'),
        
        // Form Inputs
        prodIndex: document.getElementById('prod-index'),
        prodName: document.getElementById('prod-name'),
        prodBarcode: document.getElementById('prod-barcode'),
        prodTargetIndex: document.getElementById('prod-target-index'),
        prodId: document.getElementById('prod-id'),
        prodPrice: document.getElementById('prod-price'),
        prodDesc: document.getElementById('prod-desc'),
        prodModelUrl: document.getElementById('prod-model-url'),
        prodMarkerUrl: document.getElementById('prod-marker-url'),
        prodScale: document.getElementById('prod-scale'),
        prodRotation: document.getElementById('prod-rotation'),
        prodPosition: document.getElementById('prod-position'),
        
        fileModel: document.getElementById('file-model'),
        fileMarker: document.getElementById('file-marker'),

        fileMarkersBulk: document.getElementById('file-markers-bulk'),
        fileModelsBulk: document.getElementById('file-models-bulk'),
        btnCreateDemo4: document.getElementById('btn-create-demo-4'),
        demoStatus: document.getElementById('demo-status'),
        
        btnAdd: document.getElementById('btn-add-new'),
        btnDelete: document.getElementById('btn-delete'),
        btnBuildTargets: document.getElementById('btn-build-targets'),
        targetsStatus: document.getElementById('targets-status'),
        btnLogout: document.getElementById('btn-logout')
    },

    state: {
        github: null,
        catalog: [],
        catalogSha: null,
        selectedIndex: -1
    },

    init() {
        // Check for session
        const session = sessionStorage.getItem('webar_session');
        if (session) {
            const creds = JSON.parse(session);
            this.login(creds.user, creds.repo, creds.token);
        }

        this.elements.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            // Assets Repo Details
            const user = document.getElementById('gh-user').value;
            const repo = document.getElementById('gh-repo').value;
            const token = document.getElementById('gh-token').value;
            
            // Simple mock authentication for panel access
            const panelUser = document.getElementById('username').value;
            const panelPass = document.getElementById('password').value;

            if (panelUser === 'admin' && panelPass === 'admin123') {
                this.login(user, repo, token);
            } else {
                alert('Usuario o contraseña del panel incorrectos');
            }
        });

        this.elements.btnAdd.addEventListener('click', () => this.addNew());
        this.elements.btnDelete.addEventListener('click', () => this.deleteCurrent());
        if (this.elements.btnBuildTargets) {
            this.elements.btnBuildTargets.addEventListener('click', () => this.buildAndUploadTargetsMind());
        }
        if (this.elements.btnCreateDemo4) {
            this.elements.btnCreateDemo4.addEventListener('click', () => this.createDemo4());
        }
        this.elements.btnLogout.addEventListener('click', () => {
            sessionStorage.removeItem('webar_session');
            location.reload();
        });

        this.elements.productForm.addEventListener('submit', (e) => this.saveProduct(e));
    },

    async login(user, repo, token) {
        this.showLoading('Conectando con GitHub...');
        
        try {
            this.state.github = new GitHubService(token, user, repo);

            await this.state.github.getRepo();
            
            // Test connection by fetching catalog from ASSETS repo
            const fileData = await this.state.github.getFile('catalog/catalog.json');
            
            if (fileData) {
                this.state.catalog = JSON.parse(fileData.content);
                this.state.catalogSha = fileData.sha;
            } else {
                // Initialize empty if not exists
                console.warn("catalog/catalog.json not found in assets repo, starting fresh.");
                this.state.catalog = [];
                this.state.catalogSha = null;
            }

            // Save session
            sessionStorage.setItem('webar_session', JSON.stringify({ user, repo, token }));

            // Show Dashboard
            this.elements.loginScreen.style.display = 'none';
            this.elements.dashboardScreen.style.display = 'block';
            this.renderList();
            this.hideLoading();

        } catch (error) {
            console.error(error);
            alert('Error de conexión con GitHub: ' + this.getGitHubHint(error.message));
            this.hideLoading();
        }
    },

    getGitHubHint(message) {
        const msg = String(message || '');
        if (/Resource not accessible by personal access token/i.test(msg)) {
            return `${msg}\n\nSolución: tu token Fine-grained no tiene permisos de escritura o no tiene acceso al repo.\n- Debe tener acceso al repo realidadaumentada_imagen\n- Permissions: Contents = Read and write`;
        }
        if (/\(403\)/.test(msg)) {
            return `${msg}\n\nSolución típica: el token no tiene acceso/permisos al repo (403).`;
        }
        if (/\(404\)/.test(msg)) {
            return `${msg}\n\nRevisa owner/repo y la ruta (404).`;
        }
        return msg;
    },

    renderList() {
        const list = this.elements.productList;
        list.innerHTML = '';

        this.state.catalog.forEach((item, index) => {
            const el = document.createElement('a');
            el.className = `list-group-item list-group-item-action ${index === this.state.selectedIndex ? 'active' : ''}`;
            el.style.cursor = 'pointer';
            el.innerHTML = `
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1">${item.name || 'Sin Nombre'}</h6>
                    <small>ID: ${item.barcodeValue !== undefined ? item.barcodeValue : index}</small>
                </div>
                <small class="text-truncate d-block" style="max-width: 150px;">${item.id}</small>
            `;
            el.onclick = () => this.selectItem(index);
            list.appendChild(el);
        });
    },

    selectItem(index) {
        this.state.selectedIndex = index;
        const item = this.state.catalog[index];

        this.elements.emptyState.style.display = 'none';
        this.elements.editContainer.style.display = 'block';
        
        // Fill form
        this.elements.prodIndex.value = index;
        this.elements.prodName.value = item.name || '';
        this.elements.prodId.value = item.id || '';
        this.elements.prodBarcode.value = item.barcodeValue !== undefined ? item.barcodeValue : index;
        this.elements.prodTargetIndex.value = Number.isFinite(item.targetIndex) ? item.targetIndex : '';
        this.elements.prodPrice.value = item.price || '';
        this.elements.prodDesc.value = item.description || ''; // Note: JSON uses 'description', app uses 'desc'. Catalog.json should be source of truth.
        this.elements.prodModelUrl.value = item.model || '';
        this.elements.prodMarkerUrl.value = item.marker || '';
        this.elements.prodScale.value = item.scale || '1 1 1';
        this.elements.prodRotation.value = item.rotation || '0 0 0';
        this.elements.prodPosition.value = item.position || '0 0 0';

        // Reset file inputs
        this.elements.fileModel.value = '';
        this.elements.fileMarker.value = '';

        this.renderList(); // Update active state
    },

    addNew() {
        const newId = this.state.catalog.length > 0 
            ? Math.max(...this.state.catalog.map(i => i.barcodeValue || 0)) + 1 
            : 0;

        const newItem = {
            id: `item-${Date.now()}`,
            barcodeValue: newId,
            targetIndex: null,
            name: "Nuevo Producto",
            price: 0,
            description: "",
            model: "",
            marker: "",
            scale: "1 1 1",
            rotation: "0 0 0",
            position: "0 0 0"
        };

        this.state.catalog.push(newItem);
        this.selectItem(this.state.catalog.length - 1);
    },

    async saveProduct(e) {
        e.preventDefault();
        if (this.state.selectedIndex === -1) return;

        this.showLoading('Subiendo archivos y guardando...');

        const item = this.state.catalog[this.state.selectedIndex];
        let shouldRebuildTargets = false;
        
        // Update basic fields
        item.name = this.elements.prodName.value;
        item.id = this.elements.prodId.value;
        item.price = this.elements.prodPrice.value;
        item.description = this.elements.prodDesc.value;
        item.scale = this.elements.prodScale.value;
        item.rotation = this.elements.prodRotation.value;
        item.position = this.elements.prodPosition.value;
        item.targetIndex = Number.isFinite(item.targetIndex) ? item.targetIndex : null;

        try {
            // 1. Upload Model if selected
            const modelFile = this.elements.fileModel.files[0];
            if (modelFile) {
                const content = await this.toBase64(modelFile);
                const path = `models/${modelFile.name}`; // Uploads to models/ folder in Assets Repo
                
                // Check if file exists to get SHA (for overwrite) - Don't decode content
                const existing = await this.state.github.getFile(path, false);
                const sha = existing ? existing.sha : null;

                const uploadResult = await this.state.github.uploadFile(path, content, `Update model ${item.name}`, sha);
                
                // Construct Raw URL
                item.model = uploadResult.content.download_url;
                // Fix for raw.githubusercontent.com if needed, but download_url is usually reliable
                if (item.model.includes('github.com') && item.model.includes('/blob/')) {
                     item.model = item.model.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
                }
                this.elements.prodModelUrl.value = item.model;
                shouldRebuildTargets = true;
            }

            // 2. Upload Marker if selected
            const markerFile = this.elements.fileMarker.files[0];
            if (markerFile) {
                const content = await this.toBase64(markerFile);
                const path = `markers/${markerFile.name}`; // Uploads to markers/ folder in Assets Repo
                
                const existing = await this.state.github.getFile(path, false);
                const sha = existing ? existing.sha : null;

                const uploadResult = await this.state.github.uploadFile(path, content, `Update marker ${item.name}`, sha);
                
                item.marker = uploadResult.content.download_url;
                if (item.marker.includes('github.com') && item.marker.includes('/blob/')) {
                     item.marker = item.marker.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
                }
                this.elements.prodMarkerUrl.value = item.marker;
                shouldRebuildTargets = true;
            }

            // 3. Update Catalog JSON in ASSETS repo
            // Re-fetch catalog SHA just in case it changed
            const currentCatalog = await this.state.github.getFile('catalog/catalog.json');
            const catalogSha = currentCatalog ? currentCatalog.sha : null;
            
            const jsonContent = btoa(unescape(encodeURIComponent(JSON.stringify(this.state.catalog, null, 4))));
            
            await this.state.github.uploadFile('catalog/catalog.json', jsonContent, 'Update catalog', catalogSha);
            
            this.state.catalogSha = (await this.state.github.getFile('catalog/catalog.json')).sha; // Update local SHA

            // Save to LocalStorage for instant preview on this device
            localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));

            if (shouldRebuildTargets) {
                await this.buildAndUploadTargetsMind({ silent: true });
            }

            alert('Guardado correctamente en GitHub!');
            this.renderList();

        } catch (error) {
            console.error(error);
            alert('Error guardando: ' + error.message);
        } finally {
            this.hideLoading();
        }
    },

    async createDemo4() {
        if (!this.state.github) {
            alert('Primero inicia sesión y conecta el repo de assets.');
            return;
        }

        const markerFiles = Array.from(this.elements.fileMarkersBulk?.files || []);
        const modelFiles = Array.from(this.elements.fileModelsBulk?.files || []);

        if (markerFiles.length !== 4 || modelFiles.length !== 4) {
            alert('Selecciona exactamente 4 imágenes y 4 modelos (.glb).');
            return;
        }

        const normalizeFileName = (name) => String(name || 'file')
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9._-]/g, '');

        const stripExt = (name) => String(name || '').replace(/\.[^.]+$/, '');

        this.showLoading('Creando demo (subiendo archivos)...');
        if (this.elements.demoStatus) this.elements.demoStatus.innerText = '';

        try {
            const stamp = Date.now();
            const newCatalog = [];

            for (let i = 0; i < 4; i++) {
                if (this.elements.demoStatus) this.elements.demoStatus.innerText = `Subiendo ${i + 1}/4...`;

                const markerFile = markerFiles[i];
                const modelFile = modelFiles[i];

                const markerBase64 = await this.toBase64(markerFile);
                const modelBase64 = await this.toBase64(modelFile);

                const markerPath = `markers/zelva_${stamp}_${i}_${normalizeFileName(markerFile.name)}`;
                const modelPath = `models/zelva_${stamp}_${i}_${normalizeFileName(modelFile.name)}`;

                const markerExisting = await this.state.github.getFile(markerPath, false);
                const modelExisting = await this.state.github.getFile(modelPath, false);

                const markerUpload = await this.state.github.uploadFile(markerPath, markerBase64, `Demo marker ${i + 1}`, markerExisting ? markerExisting.sha : null);
                const modelUpload = await this.state.github.uploadFile(modelPath, modelBase64, `Demo model ${i + 1}`, modelExisting ? modelExisting.sha : null);

                const markerUrl = markerUpload.content.download_url.includes('github.com') && markerUpload.content.download_url.includes('/blob/')
                    ? markerUpload.content.download_url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
                    : markerUpload.content.download_url;

                const modelUrl = modelUpload.content.download_url.includes('github.com') && modelUpload.content.download_url.includes('/blob/')
                    ? modelUpload.content.download_url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
                    : modelUpload.content.download_url;

                newCatalog.push({
                    id: `zelva-${stamp}-${i}`,
                    barcodeValue: i,
                    targetIndex: i,
                    name: stripExt(markerFile.name) || `Zelva ${i + 1}`,
                    price: 0,
                    description: '',
                    model: modelUrl,
                    marker: markerUrl,
                    scale: '1 1 1',
                    rotation: '0 0 0',
                    position: '0 0 0'
                });
            }

            this.state.catalog = newCatalog;
            this.state.selectedIndex = -1;
            this.elements.editContainer.style.display = 'none';
            this.elements.emptyState.style.display = 'block';
            this.renderList();

            if (this.elements.demoStatus) this.elements.demoStatus.innerText = 'Actualizando catálogo...';
            const currentCatalog = await this.state.github.getFile('catalog/catalog.json');
            const catalogSha = currentCatalog ? currentCatalog.sha : null;
            const jsonContent = btoa(unescape(encodeURIComponent(JSON.stringify(this.state.catalog, null, 4))));
            await this.state.github.uploadFile('catalog/catalog.json', jsonContent, 'Set demo catalog (4 items)', catalogSha);

            localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));

            if (this.elements.demoStatus) this.elements.demoStatus.innerText = 'Generando targets.mind...';
            await this.buildAndUploadTargetsMind({ silent: true });

            if (this.elements.demoStatus) this.elements.demoStatus.innerText = 'Listo: 4 markers y targets.mind actualizado.';
            alert('Listo. Se reemplazó el catálogo a 4 items y se generó targets.mind con esos 4 targets.');
        } catch (error) {
            console.error(error);
            alert('Error creando demo: ' + error.message);
        } finally {
            this.hideLoading();
        }
    },

    async buildAndUploadTargetsMind(options = {}) {
        const silent = !!options.silent;
        this.showLoading('Generando targets.mind...');
        if (this.elements.targetsStatus) this.elements.targetsStatus.innerText = '';

        try {
            if (!window.__MindARCompiler) {
                throw new Error('MindAR Compiler no está disponible en este navegador.');
            }

            const candidates = this.state.catalog.filter((i) => i && i.marker && i.model);
            if (candidates.length === 0) {
                throw new Error('No hay productos con imagen target y modelo 3D en el catálogo.');
            }

            const used = new Set();
            for (const item of this.state.catalog) {
                if (!item) continue;
                const idx = Number.isFinite(item.targetIndex) ? item.targetIndex : null;
                if (idx === null) continue;
                if (used.has(idx)) {
                    item.targetIndex = null;
                    continue;
                }
                used.add(idx);
            }

            const getNextIndex = () => {
                let i = 0;
                while (used.has(i)) i++;
                used.add(i);
                return i;
            };

            for (const item of candidates) {
                if (!Number.isFinite(item.targetIndex)) {
                    item.targetIndex = getNextIndex();
                }
            }

            const items = [...candidates].sort((a, b) => a.targetIndex - b.targetIndex);

            const compiler = new window.__MindARCompiler();
            const images = [];

            for (let i = 0; i < items.length; i++) {
                let url = items[i].marker;
                if (typeof url === 'string' && !/^https?:\/\//i.test(url)) {
                    if (typeof CONFIG !== 'undefined' && CONFIG && typeof CONFIG.getRawUrl === 'function') {
                        url = CONFIG.getRawUrl(url.replace(/^\/+/, ''));
                    }
                }
                const file = await this.fetchUrlAsFile(url, `target-${i}.png`);
                const img = await this.loadImageFromFile(file);
                images.push(img);
            }

            await compiler.compileImageTargets(images, (progress) => {
                if (this.elements.targetsStatus) {
                    this.elements.targetsStatus.innerText = `Progreso: ${progress.toFixed(2)}%`;
                }
            });

            const exportedBuffer = await compiler.exportData();
            const base64 = this.arrayBufferToBase64(exportedBuffer);

            const targetsPath = 'targets.mind';
            const existingTargets = await this.state.github.getFile(targetsPath, false);
            const targetsSha = existingTargets ? existingTargets.sha : null;

            await this.state.github.uploadFile(targetsPath, base64, 'Update targets.mind', targetsSha);

            const currentCatalog = await this.state.github.getFile('catalog/catalog.json');
            const catalogSha = currentCatalog ? currentCatalog.sha : null;
            const jsonContent = btoa(unescape(encodeURIComponent(JSON.stringify(this.state.catalog, null, 4))));
            await this.state.github.uploadFile('catalog/catalog.json', jsonContent, 'Update catalog (targets)', catalogSha);

            localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));
            if (this.elements.targetsStatus) this.elements.targetsStatus.innerText = 'targets.mind actualizado en GitHub.';

            if (this.state.selectedIndex !== -1) {
                this.elements.prodTargetIndex.value = Number.isFinite(this.state.catalog[this.state.selectedIndex].targetIndex)
                    ? this.state.catalog[this.state.selectedIndex].targetIndex
                    : '';
            }

            if (!silent) {
                alert('targets.mind actualizado. Abre la experiencia AR y escanea la imagen target.');
            }
        } catch (error) {
            console.error(error);
            alert('Error generando targets.mind: ' + error.message);
        } finally {
            this.hideLoading();
        }
    },

    async deleteCurrent() {
        if (this.state.selectedIndex === -1) return;
        if (!confirm('¿Seguro que deseas eliminar este producto? Los archivos en GitHub no se borrarán automáticamente, pero el registro sí.')) return;

        this.showLoading('Eliminando...');
        
        try {
            this.state.catalog.splice(this.state.selectedIndex, 1);
            
            // Sync with GitHub (Assets Repo)
            const currentCatalog = await this.state.github.getFile('catalog/catalog.json');
            const catalogSha = currentCatalog ? currentCatalog.sha : null;
            const jsonContent = btoa(unescape(encodeURIComponent(JSON.stringify(this.state.catalog, null, 4))));
            
            await this.state.github.uploadFile('catalog/catalog.json', jsonContent, 'Remove product', catalogSha);
            
            this.state.selectedIndex = -1;
            this.elements.editContainer.style.display = 'none';
            this.elements.emptyState.style.display = 'block';
            this.renderList();
            
        } catch (error) {
            alert('Error eliminando: ' + error.message);
        } finally {
            this.hideLoading();
        }
    },

    toBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                // Remove Data-URL prefix (e.g. "data:image/png;base64,")
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = error => reject(error);
        });
    },

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    async fetchUrlAsFile(url, name) {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`No se pudo descargar imagen target: ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        const fileType = blob.type || 'image/png';
        return new File([blob], name, { type: fileType });
    },

    loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            let objectUrl = null;
            img.onload = () => {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                resolve(img);
            };
            img.onerror = () => reject(new Error('No se pudo cargar la imagen target'));
            objectUrl = URL.createObjectURL(file);
            img.src = objectUrl;
        });
    },

    showLoading(text) {
        this.elements.loadingText.innerText = text;
        this.elements.loadingOverlay.style.display = 'flex';
    },

    hideLoading() {
        this.elements.loadingOverlay.style.display = 'none';
    }
};

// Start
document.addEventListener('DOMContentLoaded', () => UI.init());
