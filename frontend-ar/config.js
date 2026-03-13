// config.js
// Configuration for the WebAR System
// This file connects the System Repository to the Assets Repository

const CONFIG = {
    // ASSETS REPOSITORY CONFIGURATION
    // Replace these values with your GitHub Assets Repository details
    assets: {
        owner: 'Jhossephy02',      // Your GitHub Username
        repo: 'realidadaumentada_imagen', // The name of your Assets Repository
        branch: 'main',        // Branch where assets are stored
    },

    // System Settings
    system: {
        version: '1.0.0',
        debug: true, // Set to false in production
    },

    api: {
        baseUrl: ''
    },

    // Helper to generate Raw GitHub URLs
    getRawUrl: function(path) {
        return `https://raw.githubusercontent.com/${this.assets.owner}/${this.assets.repo}/${this.assets.branch}/${path}`;
    },

    // Helper to get the full API URL for contents
    getApiUrl: function(path) {
        return `https://api.github.com/repos/${this.assets.owner}/${this.assets.repo}/contents/${path}`;
    },

    getApiBaseUrl: function() {
        let override = '';
        try {
            if (typeof window !== 'undefined' && window && window.localStorage) {
                override = String(window.localStorage.getItem('webar_api_base_url') || '').trim();
            }
        } catch (e) {}
        const base = override || ((this.api && typeof this.api.baseUrl === 'string') ? this.api.baseUrl.trim() : '');
        return String(base || '').replace(/\/+$/, '');
    }
};

// Export for module usage if needed, but primarily global for simplicity in this setup
if (typeof module !== 'undefined') module.exports = CONFIG;
