// js/admin-panel.js
// Handles the Admin Panel logic and GitHub API integration

class GitHubService {
    constructor(token, owner, repo, branch = 'main') {
        this.token = token;
        this.owner = owner;
        this.repo = repo;
        this.branch = branch;
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
        const normalizedPath = String(path || '').replace(/^\/+/, '');
        const base64 = String(contentBase64 || '').replace(/\s+/g, '');
        const estimatedBytes = Math.floor((base64.length * 3) / 4);
        const isSmallTextFile = /\.(json|txt|md|csv)$/i.test(normalizedPath);
        const canUseContentsApi = isSmallTextFile && estimatedBytes <= 400 * 1024;

        if (!canUseContentsApi) {
            return await this.uploadFileViaGitData(normalizedPath, base64, message);
        }

        const body = {
            message: message,
            content: base64
        };

        if (sha) {
            body.sha = sha; // Required if updating an existing file
        }

        const response = await fetch(`${this.baseUrl}/contents/${normalizedPath}`, {
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
            if (response.status === 422 && /too large/i.test(String(err?.message || ''))) {
                return await this.uploadFileViaGitData(normalizedPath, base64, message);
            }
            throw new Error(`Upload Failed (${response.status})${msg}`);
        }

        return await response.json();
    }

    async getRef(branch) {
        const response = await fetch(`${this.baseUrl}/git/ref/heads/${encodeURIComponent(branch)}`, {
            headers: {
                ...this.getHeaders()
            }
        });

        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`GitHub Ref Error (${response.status})${msg}`);
        }

        return await response.json();
    }

    async getCommit(sha) {
        const response = await fetch(`${this.baseUrl}/git/commits/${sha}`, {
            headers: {
                ...this.getHeaders()
            }
        });

        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`GitHub Commit Error (${response.status})${msg}`);
        }

        return await response.json();
    }

    async createBlob(contentBase64) {
        const response = await fetch(`${this.baseUrl}/git/blobs`, {
            method: 'POST',
            headers: {
                ...this.getHeaders({ 'Content-Type': 'application/json' })
            },
            body: JSON.stringify({
                content: contentBase64,
                encoding: 'base64'
            })
        });

        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`GitHub Blob Error (${response.status})${msg}`);
        }

        return await response.json();
    }

    async createTree(baseTreeSha, entries) {
        const response = await fetch(`${this.baseUrl}/git/trees`, {
            method: 'POST',
            headers: {
                ...this.getHeaders({ 'Content-Type': 'application/json' })
            },
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: entries
            })
        });

        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`GitHub Tree Error (${response.status})${msg}`);
        }

        return await response.json();
    }

    async createCommit(message, treeSha, parentCommitSha) {
        const response = await fetch(`${this.baseUrl}/git/commits`, {
            method: 'POST',
            headers: {
                ...this.getHeaders({ 'Content-Type': 'application/json' })
            },
            body: JSON.stringify({
                message,
                tree: treeSha,
                parents: [parentCommitSha]
            })
        });

        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`GitHub Create Commit Error (${response.status})${msg}`);
        }

        return await response.json();
    }

    async updateRef(branch, commitSha) {
        const response = await fetch(`${this.baseUrl}/git/refs/heads/${encodeURIComponent(branch)}`, {
            method: 'PATCH',
            headers: {
                ...this.getHeaders({ 'Content-Type': 'application/json' })
            },
            body: JSON.stringify({
                sha: commitSha,
                force: false
            })
        });

        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`GitHub Update Ref Error (${response.status})${msg}`);
        }

        return await response.json();
    }

    async uploadFileViaGitData(path, contentBase64, message) {
        const branch = String(this.branch || 'main');
        const normalizedPath = String(path || '').replace(/^\/+/, '');
        const blob = await this.createBlob(contentBase64);
        const blobSha = blob?.sha;
        if (!blobSha) throw new Error('GitHub Blob Error: no blob SHA');

        const maxAttempts = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const ref = await this.getRef(branch);
                const parentCommitSha = ref?.object?.sha;
                if (!parentCommitSha) throw new Error('GitHub Ref Error: no commit SHA');

                const parentCommit = await this.getCommit(parentCommitSha);
                const baseTreeSha = parentCommit?.tree?.sha;
                if (!baseTreeSha) throw new Error('GitHub Commit Error: no tree SHA');

                const tree = await this.createTree(baseTreeSha, [
                    { path: normalizedPath, mode: '100644', type: 'blob', sha: blobSha }
                ]);

                const newCommit = await this.createCommit(message, tree.sha, parentCommitSha);
                await this.updateRef(branch, newCommit.sha);

                const rawUrl = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${encodeURIComponent(branch)}/${normalizedPath}`;
                return {
                    content: {
                        download_url: rawUrl
                    },
                    commit: {
                        sha: newCommit.sha
                    }
                };
            } catch (error) {
                lastError = error;
                const msg = String(error?.message || '');
                const isNonFastForward = /\(422\)/.test(msg) && /not a fast forward/i.test(msg);
                if (!isNonFastForward || attempt === maxAttempts) break;
            }
        }

        throw lastError || new Error('Upload Failed: unknown error');

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

    async getViewer() {
        const response = await fetch(`https://api.github.com/user`, {
            headers: {
                ...this.getHeaders()
            }
        });

        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`GitHub User Error (${response.status})${msg}`);
        }

        return await response.json();
    }
}

class ApiService {
    constructor(baseUrl = '') {
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    }

    url(path) {
        const p = String(path || '');
        if (!this.baseUrl) return p;
        if (p.startsWith('http')) return p;
        return `${this.baseUrl}${p.startsWith('/') ? '' : '/'}${p}`;
    }

    async request(path, options = {}) {
        const response = await fetch(this.url(path), options);
        if (!response.ok) {
            let err = null;
            try { err = await response.json(); } catch (e) {}
            const msg = err?.message ? `: ${err.message}` : '';
            throw new Error(`API Error (${response.status})${msg}`);
        }
        return response;
    }

    async health() {
        await this.request('/api/health', { cache: 'no-store' });
        return true;
    }

    async getCatalog() {
        const res = await this.request('/api/catalog', { cache: 'no-store' });
        return await res.json();
    }

    async getUploadsStats() {
        const res = await this.request('/api/uploads/stats', { cache: 'no-store' });
        return await res.json();
    }

    async cleanupUploads({ dryRun } = {}) {
        const q = dryRun ? '?dryRun=1' : '';
        const res = await this.request(`/api/uploads/cleanup${q}`, { method: 'POST' });
        return await res.json();
    }

    async replaceCatalog(items) {
        const res = await this.request('/api/catalog', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(items || [])
        });
        return await res.json();
    }

    async upsertProduct(product) {
        const res = await this.request('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(product || {})
        });
        return await res.json();
    }

    async deleteProduct(id) {
        await this.request(`/api/products/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
        return true;
    }

    async upload(kind, file) {
        const form = new FormData();
        form.append('file', file);
        const res = await this.request(`/api/upload/${kind}`, { method: 'POST', body: form });
        return await res.json();
    }

    async uploadTargets(base64) {
        const res = await this.request('/api/upload/targets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64 })
        });
        return await res.json();
    }
}

// UI Manager
const UI = {
    elements: {
        loginScreen: document.getElementById('login-screen'),
        dashboardScreen: document.getElementById('dashboard-screen'),
        loginForm: document.getElementById('login-form'),
        loginNotice: document.getElementById('login-notice'),
        apiBaseUrl: document.getElementById('api-base-url'),
        loadingOverlay: document.getElementById('loading-overlay'),
        loadingText: document.getElementById('loading-text'),
        serverStatus: document.getElementById('server-status'),
        serverStats: document.getElementById('server-stats'),
        btnCleanOrphans: document.getElementById('btn-clean-orphans'),
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
        bulkReplaceCatalog: document.getElementById('bulk-replace-catalog'),
        bulkPreview: document.getElementById('bulk-preview'),
        demoStatus: document.getElementById('demo-status'),
        
        btnAdd: document.getElementById('btn-add-new'),
        btnDelete: document.getElementById('btn-delete'),
        btnBuildTargets: document.getElementById('btn-build-targets'),
        targetsStatus: document.getElementById('targets-status'),
        btnLogout: document.getElementById('btn-logout')
    },

    state: {
        github: null,
        api: null,
        catalog: [],
        catalogSha: null,
        selectedIndex: -1,
        viewerLogin: null,
        useNodeApi: true,
        useLocalDb: false
    },

    init() {
        this.state.useNodeApi = true;
        this.state.useLocalDb = false;

        this.syncApiBaseUrlInput();

        // Check for session
        const session = sessionStorage.getItem('webar_session');
        if (session) {
            try {
                const creds = JSON.parse(session);
                if (creds && creds.node) {
                    const baseUrl = (window.CONFIG && typeof window.CONFIG.getApiBaseUrl === 'function') ? window.CONFIG.getApiBaseUrl() : '';
                    const host = String(location.hostname || '').toLowerCase();
                    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
                    if (baseUrl || isLocalHost) this.loginNode({ allowFallbackLocal: true });
                    else {
                        sessionStorage.removeItem('webar_session');
                        this.loginLocal({ notice: 'Modo local: no hay servidor configurado.' });
                    }
                } else sessionStorage.removeItem('webar_session');
            } catch (e) {
                sessionStorage.removeItem('webar_session');
            }
        }

        if (this.elements.loginForm) this.elements.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            // Simple mock authentication for panel access
            const panelUser = document.getElementById('username')?.value;
            const panelPass = document.getElementById('password')?.value;

            if (panelUser === 'admin' && panelPass === 'admin123') {
                this.persistApiBaseUrlOverride();
                this.loginNode({ allowFallbackLocal: true });
            } else {
                this.setLoginNotice('danger', 'Usuario o contraseña del panel incorrectos.');
            }
        });

        if (this.elements.btnAdd) this.elements.btnAdd.addEventListener('click', () => this.addNew());
        if (this.elements.btnDelete) this.elements.btnDelete.addEventListener('click', () => this.deleteCurrent());
        if (this.elements.btnBuildTargets) {
            this.elements.btnBuildTargets.addEventListener('click', () => this.buildAndUploadTargetsMind());
        }
        if (this.elements.btnCreateDemo4) {
            this.elements.btnCreateDemo4.addEventListener('click', () => this.createDemo4());
        }
        if (this.elements.fileMarkersBulk) {
            this.elements.fileMarkersBulk.addEventListener('change', () => this.updateBulkPreview());
        }
        if (this.elements.fileModelsBulk) {
            this.elements.fileModelsBulk.addEventListener('change', () => this.updateBulkPreview());
        }
        if (this.elements.bulkReplaceCatalog) {
            this.elements.bulkReplaceCatalog.addEventListener('change', () => this.updateBulkPreview());
        }
        if (this.elements.btnCleanOrphans) {
            this.elements.btnCleanOrphans.addEventListener('click', () => this.cleanupOrphans());
        }
        if (this.elements.btnLogout) this.elements.btnLogout.addEventListener('click', () => {
            sessionStorage.removeItem('webar_session');
            location.reload();
        });

        if (this.elements.productForm) this.elements.productForm.addEventListener('submit', (e) => this.saveProduct(e));
        this.updateBulkPreview();
    },

    syncApiBaseUrlInput() {
        if (!this.elements.apiBaseUrl) return;
        try {
            const baseUrl = (window.CONFIG && typeof window.CONFIG.getApiBaseUrl === 'function')
                ? window.CONFIG.getApiBaseUrl()
                : '';
            this.elements.apiBaseUrl.value = String(baseUrl || '');
        } catch (e) {}
    },

    persistApiBaseUrlOverride() {
        if (!this.elements.apiBaseUrl) return;
        try {
            const raw = String(this.elements.apiBaseUrl.value || '').trim();
            if (!raw) localStorage.removeItem('webar_api_base_url');
            else localStorage.setItem('webar_api_base_url', raw.replace(/\/+$/, ''));
        } catch (e) {}
    },

    setLoginNotice(kind, text) {
        const el = this.elements.loginNotice;
        if (!el) return;
        const msg = String(text || '').trim();
        if (!msg) {
            el.style.display = 'none';
            el.innerText = '';
            return;
        }
        el.className = `alert alert-${kind || 'warning'} py-2 px-3`;
        el.innerText = msg;
        el.style.display = 'block';
    },

    async loginNode(options = {}) {
        this.showLoading('Conectando con el servidor...');
        try {
            const baseUrl = (window.CONFIG && typeof window.CONFIG.getApiBaseUrl === 'function') ? window.CONFIG.getApiBaseUrl() : '';
            const host = String(location.hostname || '').toLowerCase();
            const isLocalHost = host === 'localhost' || host === '127.0.0.1';
            if (!baseUrl && !isLocalHost) {
                if (options.allowFallbackLocal) {
                    await this.loginLocal({ notice: 'No hay backend Node configurado. Entraste en modo local (los cambios se guardan en este navegador).' });
                    return;
                }
                throw new Error('No hay backend Node configurado para este sitio.');
            }
            this.state.api = new ApiService(baseUrl);
            await this.state.api.health();
            const catalog = await this.state.api.getCatalog();
            this.state.catalog = Array.isArray(catalog) ? catalog : [];
            this.state.catalogSha = null;
            this.state.github = null;
            this.state.viewerLogin = null;
            this.state.selectedIndex = -1;
            sessionStorage.setItem('webar_session', JSON.stringify({ node: true }));
            this.elements.loginScreen.style.display = 'none';
            this.elements.dashboardScreen.style.display = 'block';
            this.renderList();
            this.setServerStatus('Servidor: conectado');
            await this.refreshServerStats();
        } catch (error) {
            console.error(error);
            this.setServerStatus('Servidor: desconectado');
            this.setServerStats('');
            sessionStorage.removeItem('webar_session');
            const msg = String(error?.message || '');
            if (options.allowFallbackLocal) {
                const hint = msg.includes('API Error (404)')
                    ? 'No se encontró la API (/api/*). Entraste en modo local (este navegador).'
                    : `No se pudo conectar al servidor. Entraste en modo local (este navegador).\n\nDetalle: ${msg}`;
                await this.loginLocal({ notice: hint });
                return;
            }
            this.setLoginNotice('danger', `Error conectando al servidor: ${msg}`);
        } finally {
            this.hideLoading();
        }
    },

    async loginLocal(options = {}) {
        this.showLoading('Cargando base de datos local...');
        try {
            const stored = localStorage.getItem('ar_catalog_data');
            this.state.catalog = stored ? JSON.parse(stored) : [];
            this.state.catalogSha = null;
            this.state.github = null;
            this.state.api = null;
            this.state.viewerLogin = null;
            this.state.selectedIndex = -1;
            sessionStorage.setItem('webar_session', JSON.stringify({ local: true }));
            this.elements.loginScreen.style.display = 'none';
            this.elements.dashboardScreen.style.display = 'block';
            this.renderList();
            this.setServerStatus('Modo local');
            this.setServerStats('');
            this.setLoginNotice('', '');
            const notice = String(options.notice || '').trim();
            if (notice) this.setServerStatus(`Modo local · ${notice}`);
        } catch (error) {
            console.error(error);
            this.setLoginNotice('danger', 'Error cargando base local: ' + error.message);
        } finally {
            this.hideLoading();
        }
    },

    async login(user, repo, token, branch = 'main') {
        this.showLoading('Conectando con GitHub...');
        
        try {
            this.state.api = null;
            this.state.github = new GitHubService(token, user, repo, branch);
            this.setServerStatus('');
            this.setServerStats('');

            const viewer = await this.state.github.getViewer();
            this.state.viewerLogin = viewer?.login ? String(viewer.login) : null;
            await this.state.github.getRepo();

            if (this.state.viewerLogin && String(user).toLowerCase() !== this.state.viewerLogin.toLowerCase()) {
                alert(
                    `Aviso: el token pertenece a "${this.state.viewerLogin}" pero el repo configurado es "${user}/${repo}".\n\n` +
                    `Para poder subir archivos necesitas:\n` +
                    `- Que "${this.state.viewerLogin}" tenga permisos de escritura en ese repo, o\n` +
                    `- Usar un token del owner del repo.`
                );
            }
            
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
            sessionStorage.setItem('webar_session', JSON.stringify({ user, repo, token, branch }));

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
        if (/\(422\)/.test(msg) && /too large/i.test(msg)) {
            return `${msg}\n\nEsto pasa cuando se intenta subir un archivo grande con la API /contents. La versión nueva del panel ya usa otra ruta para archivos grandes.\nSi estás en Netlify: haz Clear cache and deploy o Ctrl+F5.`;
        }
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

    getGitHubHintWithViewer(message) {
        const base = this.getGitHubHint(message);
        if (/Resource not accessible by personal access token/i.test(String(message || '')) && this.state.viewerLogin) {
            return `${base}\n\nToken pertenece a: ${this.state.viewerLogin}\nRevisa también que el campo Owner en el panel sea ese usuario o que tenga permisos en el repo.`;
        }
        return base;
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
            const normalizeFileName = (name) => String(name || 'file')
                .replace(/\\/g, '/')
                .split('/')
                .pop()
                .replace(/\s+/g, '_')
                .replace(/[^a-zA-Z0-9._-]/g, '');

            if (this.state.api) {
                const modelFile = this.elements.fileModel.files[0];
                if (modelFile) {
                    const result = await this.state.api.upload('model', modelFile);
                    item.model = result?.url || '';
                    this.elements.prodModelUrl.value = item.model;
                    shouldRebuildTargets = true;
                }

                const markerFile = this.elements.fileMarker.files[0];
                if (markerFile) {
                    const prepared = await this.prepareMarkerFile(markerFile);
                    const result = await this.state.api.upload('marker', prepared);
                    item.marker = result?.url || '';
                    this.elements.prodMarkerUrl.value = item.marker;
                    shouldRebuildTargets = true;
                }

                const saved = await this.state.api.upsertProduct(item);
                if (saved && typeof saved === 'object') {
                    this.state.catalog[this.state.selectedIndex] = saved;
                }

                localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));
                if (shouldRebuildTargets) {
                    await this.buildAndUploadTargetsMind({ silent: true });
                }
                alert('Guardado en el servidor.');
                this.renderList();
                await this.refreshServerStats();
            } else if (this.state.github) {
                const modelFile = this.elements.fileModel.files[0];
                if (modelFile) {
                    const content = await this.toBase64(modelFile);
                    const path = `models/${modelFile.name}`;
                    const existing = await this.state.github.getFile(path, false);
                    const sha = existing ? existing.sha : null;
                    const uploadResult = await this.state.github.uploadFile(path, content, `Update model ${item.name}`, sha);
                    item.model = uploadResult.content.download_url;
                    if (item.model.includes('github.com') && item.model.includes('/blob/')) {
                        item.model = item.model.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
                    }
                    this.elements.prodModelUrl.value = item.model;
                    shouldRebuildTargets = true;
                }

                const markerFile = this.elements.fileMarker.files[0];
                if (markerFile) {
                    const prepared = await this.prepareMarkerFile(markerFile);
                    const content = await this.toBase64(prepared);
                    const path = `markers/${prepared.name}`;
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

                const currentCatalog = await this.state.github.getFile('catalog/catalog.json');
                const catalogSha = currentCatalog ? currentCatalog.sha : null;
                const jsonContent = btoa(unescape(encodeURIComponent(JSON.stringify(this.state.catalog, null, 4))));
                await this.state.github.uploadFile('catalog/catalog.json', jsonContent, 'Update catalog', catalogSha);
                this.state.catalogSha = (await this.state.github.getFile('catalog/catalog.json')).sha;
                localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));
                if (shouldRebuildTargets) {
                    await this.buildAndUploadTargetsMind({ silent: true });
                }
                alert('Guardado correctamente en GitHub!');
                this.renderList();
            } else {
                const modelFile = this.elements.fileModel.files[0];
                if (modelFile) {
                    const key = `models/${Date.now()}_${normalizeFileName(modelFile.name)}`;
                    await this.putLocalBlob(key, modelFile);
                    item.model = `idb://${key}`;
                    this.elements.prodModelUrl.value = item.model;
                    shouldRebuildTargets = true;
                }

                const markerFile = this.elements.fileMarker.files[0];
                if (markerFile) {
                    const prepared = await this.prepareMarkerFile(markerFile);
                    const key = `markers/${Date.now()}_${normalizeFileName(prepared.name)}`;
                    await this.putLocalBlob(key, prepared);
                    item.marker = `idb://${key}`;
                    this.elements.prodMarkerUrl.value = item.marker;
                    shouldRebuildTargets = true;
                }

                localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));
                if (shouldRebuildTargets) {
                    await this.buildAndUploadTargetsMind({ silent: true });
                }
                alert('Guardado localmente.');
                this.renderList();
            }

        } catch (error) {
            console.error(error);
            alert('Error guardando: ' + (this.state.github ? this.getGitHubHintWithViewer(error.message) : error.message));
        } finally {
            this.hideLoading();
        }
    },

    computeBulkPairs(markerFiles, modelFiles) {
        const normalizeFileName = (name) => String(name || 'file')
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9._-]/g, '');
        const stripExt = (name) => String(name || '').replace(/\.[^.]+$/, '');
        const normalizeStem = (name) => stripExt(normalizeFileName(name)).toLowerCase();

        const pairs = [];
        const missingModels = [];
        const missingMarkers = [];

        if (!Array.isArray(markerFiles) || !Array.isArray(modelFiles)) {
            return { pairs, mode: 'none', missingModels, missingMarkers };
        }

        if (markerFiles.length === modelFiles.length) {
            for (let i = 0; i < markerFiles.length; i++) {
                pairs.push({ markerFile: markerFiles[i], modelFile: modelFiles[i], mode: 'order' });
            }
            return { pairs, mode: 'order', missingModels, missingMarkers };
        }

        const modelsByStem = new Map();
        for (const f of modelFiles) {
            modelsByStem.set(normalizeStem(f.name), f);
        }
        const usedModels = new Set();
        for (const m of markerFiles) {
            const key = normalizeStem(m.name);
            const model = modelsByStem.get(key);
            if (model) {
                pairs.push({ markerFile: m, modelFile: model, mode: 'name' });
                usedModels.add(model);
            } else {
                missingModels.push(m.name);
            }
        }
        for (const f of modelFiles) {
            if (!usedModels.has(f)) missingMarkers.push(f.name);
        }

        return { pairs, mode: 'name', missingModels, missingMarkers };
    },

    updateBulkPreview() {
        if (!this.elements.bulkPreview) return;
        const markerFiles = Array.from(this.elements.fileMarkersBulk?.files || []);
        const modelFiles = Array.from(this.elements.fileModelsBulk?.files || []);
        if (markerFiles.length === 0 && modelFiles.length === 0) {
            this.elements.bulkPreview.innerText = '';
            if (this.elements.btnCreateDemo4) this.elements.btnCreateDemo4.disabled = true;
            return;
        }
        const { pairs, mode, missingModels, missingMarkers } = this.computeBulkPairs(markerFiles, modelFiles);
        const modeLabel = mode === 'order' ? 'orden' : (mode === 'name' ? 'nombre' : '-');
        const replace = !!this.elements.bulkReplaceCatalog?.checked;
        const head = `Imágenes: ${markerFiles.length} | Modelos: ${modelFiles.length} | Emparejados: ${pairs.length} | Modo: ${modeLabel} | ${replace ? 'Reemplaza' : 'Agrega'}`;
        const lines = [head];
        const maxLines = 6;
        for (let i = 0; i < Math.min(pairs.length, maxLines); i++) {
            lines.push(`${i + 1}. ${pairs[i].markerFile?.name || ''} ↔ ${pairs[i].modelFile?.name || ''}`);
        }
        if (pairs.length > maxLines) lines.push(`... y ${pairs.length - maxLines} más`);
        if (missingModels.length) lines.push(`Sin modelo: ${missingModels.slice(0, 4).join(', ')}${missingModels.length > 4 ? '...' : ''}`);
        if (missingMarkers.length) lines.push(`Sin imagen: ${missingMarkers.slice(0, 4).join(', ')}${missingMarkers.length > 4 ? '...' : ''}`);
        this.elements.bulkPreview.innerText = lines.join('\n');
        if (this.elements.btnCreateDemo4) this.elements.btnCreateDemo4.disabled = pairs.length === 0;
    },

    async createDemo4() {
        const markerFiles = Array.from(this.elements.fileMarkersBulk?.files || []);
        const modelFiles = Array.from(this.elements.fileModelsBulk?.files || []);

        const normalizeFileName = (name) => String(name || 'file')
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9._-]/g, '');

        const stripExt = (name) => String(name || '').replace(/\.[^.]+$/, '');

        const normalizeStem = (name) => stripExt(normalizeFileName(name)).toLowerCase();
        const humanNameFromStem = (stem) => String(stem || 'Producto')
            .replace(/[_-]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');

        const replaceCatalog = !!this.elements.bulkReplaceCatalog?.checked;

        if (markerFiles.length === 0 || modelFiles.length === 0) {
            alert('Selecciona imágenes y modelos.');
            return;
        }

        const pairing = this.computeBulkPairs(markerFiles, modelFiles);
        const pairs = pairing.pairs;
        if (pairs.length === 0) {
            alert('No se pudo emparejar. Sube la misma cantidad o usa nombres iguales para emparejar.');
            return;
        }

        this.showLoading('Importando (subiendo archivos)...');
        if (this.elements.demoStatus) this.elements.demoStatus.innerText = '';

        try {
            const stamp = Date.now();
            const baseCatalog = replaceCatalog ? [] : [...this.state.catalog];
            const maxBarcode = baseCatalog.reduce((acc, it) => Number.isFinite(it?.barcodeValue) ? Math.max(acc, it.barcodeValue) : acc, -1);
            let nextBarcode = maxBarcode + 1;

            for (let i = 0; i < pairs.length; i++) {
                if (this.elements.demoStatus) this.elements.demoStatus.innerText = `Subiendo ${i + 1}/${pairs.length}...`;

                const markerFile = pairs[i].markerFile;
                const modelFile = pairs[i].modelFile;
                const stem = normalizeStem(markerFile.name);

                const markerPath = `markers/${stamp}_${i}_${normalizeFileName(markerFile.name)}`;
                const modelPath = `models/${stamp}_${i}_${normalizeFileName(modelFile.name)}`;

                let markerUrl = '';
                let modelUrl = '';
                let quality = null;

                if (this.state.api) {
                    const preparedMarker = await this.prepareMarkerFile(markerFile);
                    quality = await this.scoreTargetImage(preparedMarker);
                    const markerRes = await this.state.api.upload('marker', preparedMarker);
                    const modelRes = await this.state.api.upload('model', modelFile);
                    markerUrl = markerRes?.url || '';
                    modelUrl = modelRes?.url || '';
                } else if (this.state.github) {
                    const preparedMarker = await this.prepareMarkerFile(markerFile);
                    quality = await this.scoreTargetImage(preparedMarker);
                    const markerBase64 = await this.toBase64(preparedMarker);
                    const modelBase64 = await this.toBase64(modelFile);
                    const markerExisting = await this.state.github.getFile(markerPath, false);
                    const modelExisting = await this.state.github.getFile(modelPath, false);
                    const markerUpload = await this.state.github.uploadFile(markerPath, markerBase64, `Import marker ${i + 1}`, markerExisting ? markerExisting.sha : null);
                    const modelUpload = await this.state.github.uploadFile(modelPath, modelBase64, `Import model ${i + 1}`, modelExisting ? modelExisting.sha : null);
                    markerUrl = markerUpload.content.download_url.includes('github.com') && markerUpload.content.download_url.includes('/blob/')
                        ? markerUpload.content.download_url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
                        : markerUpload.content.download_url;
                    modelUrl = modelUpload.content.download_url.includes('github.com') && modelUpload.content.download_url.includes('/blob/')
                        ? modelUpload.content.download_url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
                        : modelUpload.content.download_url;
                } else {
                    const preparedMarker = await this.prepareMarkerFile(markerFile);
                    quality = await this.scoreTargetImage(preparedMarker);
                    await this.putLocalBlob(markerPath, preparedMarker);
                    await this.putLocalBlob(modelPath, modelFile);
                    markerUrl = `idb://${markerPath}`;
                    modelUrl = `idb://${modelPath}`;
                }

                if (quality && this.elements.demoStatus) {
                    const sharp = Number(quality.sharpness || 0);
                    const cont = Number(quality.contrast || 0);
                    const warn = sharp < 40 || cont < 25 ? ' (baja calidad)' : '';
                    this.elements.demoStatus.innerText = `Subiendo ${i + 1}/${pairs.length}... Calidad: ${Math.round(sharp)}/${Math.round(cont)}${warn}`;
                }

                baseCatalog.push({
                    id: `${stem || 'item'}-${stamp}-${i}`,
                    barcodeValue: nextBarcode++,
                    targetIndex: null,
                    name: humanNameFromStem(stem) || `Producto ${i + 1}`,
                    price: 0,
                    description: '',
                    model: modelUrl,
                    marker: markerUrl,
                    scale: '1 1 1',
                    rotation: '0 0 0',
                    position: '0 0 0'
                });
            }

            this.state.catalog = baseCatalog;
            this.state.selectedIndex = -1;
            this.elements.editContainer.style.display = 'none';
            this.elements.emptyState.style.display = 'block';
            this.renderList();

            localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));

            if (this.elements.demoStatus) this.elements.demoStatus.innerText = 'Generando targets.mind...';
            await this.buildAndUploadTargetsMind({ silent: true });

            if (this.elements.demoStatus) this.elements.demoStatus.innerText = 'Listo: targets.mind actualizado.';
            alert('Listo. Se importaron productos y se generó targets.mind.');
        } catch (error) {
            console.error(error);
            alert('Error importando: ' + (this.state.github ? this.getGitHubHintWithViewer(error.message) : error.message));
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
                if (typeof url === 'string' && !url.startsWith('idb://') && !/^https?:\/\//i.test(url)) {
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

            if (this.state.api) {
                await this.state.api.uploadTargets(base64);
                await this.state.api.replaceCatalog(this.state.catalog);
                localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));
                if (this.elements.targetsStatus) this.elements.targetsStatus.innerText = 'targets.mind actualizado en el servidor.';
                await this.refreshServerStats();
            } else if (this.state.github) {
                const targetsPath = 'targets.mind';
                const existingTargets = await this.state.github.getFile(targetsPath, false);
                const targetsSha = existingTargets ? existingTargets.sha : null;
                await this.state.github.uploadFile(targetsPath, base64, 'Update targets.mind', targetsSha);

                const currentCatalog = await this.state.github.getFile('catalog/catalog.json');
                const catalogSha = currentCatalog ? currentCatalog.sha : null;
                const jsonContent = btoa(unescape(encodeURIComponent(JSON.stringify(this.state.catalog, null, 4))));
                await this.state.github.uploadFile('catalog/catalog.json', jsonContent, 'Update catalog (targets)', catalogSha);

                localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));
                if (this.elements.targetsStatus) this.elements.targetsStatus.innerText = 'targets.mind actualizado.';
            } else {
                const blob = new Blob([exportedBuffer], { type: 'application/octet-stream' });
                await this.putLocalBlob('targets.mind', blob);
                localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));
                if (this.elements.targetsStatus) this.elements.targetsStatus.innerText = 'targets.mind actualizado localmente.';
            }

            try {
                localStorage.setItem('webar_targets_updated_at', String(Date.now()));
            } catch (e) {}

            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'RELOAD_TARGETS' }, '*');
                }
            } catch (e) {}

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
            alert('Error generando targets.mind: ' + (this.state.github ? this.getGitHubHintWithViewer(error.message) : error.message));
        } finally {
            this.hideLoading();
        }
    },

    async deleteCurrent() {
        if (this.state.selectedIndex === -1) return;
        if (!confirm('¿Seguro que deseas eliminar este producto?')) return;

        this.showLoading('Eliminando...');
        
        try {
            const item = this.state.catalog[this.state.selectedIndex];
            if (this.state.api && item?.id) {
                await this.state.api.deleteProduct(item.id);
            }
            this.state.catalog.splice(this.state.selectedIndex, 1);
            if (this.state.github) {
                const currentCatalog = await this.state.github.getFile('catalog/catalog.json');
                const catalogSha = currentCatalog ? currentCatalog.sha : null;
                const jsonContent = btoa(unescape(encodeURIComponent(JSON.stringify(this.state.catalog, null, 4))));
                await this.state.github.uploadFile('catalog/catalog.json', jsonContent, 'Remove product', catalogSha);
            } else {
                localStorage.setItem('ar_catalog_data', JSON.stringify(this.state.catalog));
            }
            
            this.state.selectedIndex = -1;
            this.elements.editContainer.style.display = 'none';
            this.elements.emptyState.style.display = 'block';
            this.renderList();
            await this.refreshServerStats();
            
        } catch (error) {
            alert('Error eliminando: ' + (this.state.github ? this.getGitHubHintWithViewer(error.message) : error.message));
        } finally {
            this.hideLoading();
        }
    },

    openLocalDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('webar_local_assets', 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('blobs')) {
                    db.createObjectStore('blobs', { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async putLocalBlob(key, blob) {
        const db = await this.openLocalDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('blobs', 'readwrite');
            const store = tx.objectStore('blobs');
            store.put({ key, blob });
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    },

    async getLocalBlob(key) {
        const db = await this.openLocalDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('blobs', 'readonly');
            const store = tx.objectStore('blobs');
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result ? req.result.blob : null);
            req.onerror = () => reject(req.error);
        });
    },

    async prepareMarkerFile(file) {
        try {
            if (!(file instanceof Blob)) return file;
            const bitmap = await createImageBitmap(file);
            const maxSize = 1024;
            const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
            if (!ctx) return file;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.filter = 'contrast(1.1) saturate(1.05)';
            ctx.drawImage(bitmap, 0, 0, width, height);
            const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.92));
            if (!outBlob) return file;
            const baseName = String(file.name || 'marker').replace(/\.[^.]+$/, '');
            return new File([outBlob], `${baseName}.png`, { type: 'image/png' });
        } catch (e) {
            return file;
        }
    },

    async scoreTargetImage(file) {
        try {
            const bitmap = await createImageBitmap(file);
            const size = 256;
            const scale = size / Math.max(bitmap.width, bitmap.height);
            const w = Math.max(1, Math.round(bitmap.width * scale));
            const h = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return { sharpness: 0, contrast: 0 };
            ctx.drawImage(bitmap, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h).data;
            const gray = new Float32Array(w * h);
            for (let i = 0, p = 0; i < img.length; i += 4, p++) {
                const r = img[i], g = img[i + 1], b = img[i + 2];
                gray[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            }
            let sum = 0;
            for (let i = 0; i < gray.length; i++) sum += gray[i];
            const mean = sum / gray.length;
            let varSum = 0;
            for (let i = 0; i < gray.length; i++) {
                const d = gray[i] - mean;
                varSum += d * d;
            }
            const contrast = Math.sqrt(varSum / gray.length);

            const lap = [];
            for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                    const c = gray[y * w + x];
                    const v = (gray[(y - 1) * w + x] + gray[(y + 1) * w + x] + gray[y * w + (x - 1)] + gray[y * w + (x + 1)] - 4 * c);
                    lap.push(v);
                }
            }
            if (lap.length === 0) return { sharpness: 0, contrast };
            let lsum = 0;
            for (let i = 0; i < lap.length; i++) lsum += lap[i];
            const lmean = lsum / lap.length;
            let lvar = 0;
            for (let i = 0; i < lap.length; i++) {
                const d = lap[i] - lmean;
                lvar += d * d;
            }
            const sharpness = lvar / lap.length;
            return { sharpness, contrast };
        } catch (e) {
            return { sharpness: 0, contrast: 0 };
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
        if (typeof url === 'string' && url.startsWith('idb://')) {
            const key = url.replace(/^idb:\/\//, '');
            const blob = await this.getLocalBlob(key);
            if (!blob) {
                throw new Error('No se encontró la imagen target en la base local.');
            }
            const fileType = blob.type || 'image/png';
            return new File([blob], name, { type: fileType });
        }
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
    },

    setServerStatus(text) {
        if (!this.elements.serverStatus) return;
        this.elements.serverStatus.innerText = String(text || '');
    },

    setServerStats(text) {
        if (!this.elements.serverStats) return;
        this.elements.serverStats.innerText = String(text || '');
    },

    formatBytes(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const idx = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
        const value = n / Math.pow(1024, idx);
        return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
    },

    renderUploadsStats(stats) {
        if (!stats || typeof stats !== 'object') {
            this.setServerStats('');
            return;
        }
        const models = stats.models || {};
        const markers = stats.markers || {};
        const targets = stats.targets || {};
        const lines = [
            `Modelos: ${Number(models.count) || 0} (${this.formatBytes(models.bytes)})`,
            `Marcadores: ${Number(markers.count) || 0} (${this.formatBytes(markers.bytes)})`,
            `Huérfanos: ${(Number(models.orphanCount) || 0) + (Number(markers.orphanCount) || 0)} (${this.formatBytes((Number(models.orphanBytes) || 0) + (Number(markers.orphanBytes) || 0))})`,
            `targets.mind: ${targets.exists ? this.formatBytes(targets.bytes) : 'no existe'}`
        ];
        this.setServerStats(lines.join('\n'));
    },

    async refreshServerStats() {
        if (!this.state.api) return;
        try {
            const stats = await this.state.api.getUploadsStats();
            this.renderUploadsStats(stats);
        } catch (e) {
            this.setServerStats('Stats no disponibles');
        }
    },

    async cleanupOrphans() {
        if (!this.state.api) return;
        try {
            const preview = await this.state.api.cleanupUploads({ dryRun: true });
            const previewCount = (Number(preview?.models?.count) || 0) + (Number(preview?.markers?.count) || 0);
            if (previewCount === 0) {
                alert('No hay huérfanos para limpiar.');
                await this.refreshServerStats();
                return;
            }
            const previewBytes = (Number(preview?.models?.bytes) || 0) + (Number(preview?.markers?.bytes) || 0);
            const ok = confirm(`Se eliminarán ${previewCount} archivos huérfanos (~${this.formatBytes(previewBytes)}). ¿Continuar?`);
            if (!ok) return;
            const result = await this.state.api.cleanupUploads({ dryRun: false });
            const deleted = (Number(result?.deletedModels) || 0) + (Number(result?.deletedMarkers) || 0);
            if (result?.ok) {
                alert(`Listo: eliminados ${deleted} archivos (${this.formatBytes(result?.deletedBytes)}).`);
            } else {
                alert(`Parcial: eliminados ${deleted} archivos (${this.formatBytes(result?.deletedBytes)}).`);
            }
            await this.refreshServerStats();
        } catch (e) {
            alert('No se pudo limpiar huérfanos: ' + (e?.message ? String(e.message) : 'error'));
        }
    }
};

// Start
document.addEventListener('DOMContentLoaded', () => UI.init());
