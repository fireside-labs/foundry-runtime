// ==========================================================================
// Foundry Enterprise Runtime — App Router & State
// ==========================================================================

const App = {
    currentPage: 'installer',
    onboarded: false,
    license: null,

    async init() {
        // Check if already onboarded
        if (window.__TAURI__) {
            try {
                const license = await window.__TAURI__.core.invoke('get_license_status');
                this.license = license;
                if (license.valid) {
                    this.onboarded = true;
                    this.showWorkspace();
                    return;
                }
            } catch (e) {
                console.log('[foundry] License check failed, showing installer');
            }
        } else {
            console.log('[foundry] Dev mode — no Tauri context');
        }

        // Show installer
        Installer.init();
    },

    showWorkspace() {
        document.getElementById('sidebar').style.display = '';
        document.getElementById('statusbar').style.display = '';
        this.navigateTo('workspace');
        Workspace.init();
        StatusBar.start();
        this.updateSidebarLicense();
    },

    navigateTo(page) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.sidebar-item[data-page]').forEach(i => i.classList.remove('active'));

        // Show target page
        const target = document.getElementById('page-' + page);
        if (target) {
            target.classList.add('active');
        }

        const nav = document.querySelector(`.sidebar-item[data-page="${page}"]`);
        if (nav) nav.classList.add('active');

        this.currentPage = page;

        // Initialize page-specific content
        if (page === 'models') Models.init();
        if (page === 'settings') this.initSettings();
        if (page === 'memory' && typeof initMemoryPage === 'function') initMemoryPage();
    },

    updateSidebarLicense() {
        const el = document.getElementById('sidebar-license');
        if (this.license && this.license.valid) {
            const tierMap = { starter: '🟢', professional: '🔵', enterprise: '🟣' };
            el.innerHTML = `
                <span class="icon">${tierMap[this.license.tier] || '🔑'}</span>
                <span>${this.license.tier.charAt(0).toUpperCase() + this.license.tier.slice(1)}</span>
            `;
        }
    },

    async initSettings() {
        const licenseEl = document.getElementById('settings-license-info');
        const runtimeEl = document.getElementById('settings-runtime-info');

        try {
            const license = await window.__TAURI__.core.invoke('get_license_status');
            const hwid = await window.__TAURI__.core.invoke('get_hardware_id');

            licenseEl.innerHTML = `
                <div class="spec-grid" style="grid-template-columns:1fr 1fr">
                    <div class="spec-box">
                        <div class="spec-value" style="font-size:16px">${license.tier || 'None'}</div>
                        <div class="spec-label">Tier</div>
                    </div>
                    <div class="spec-box">
                        <div class="spec-value" style="font-size:16px">${license.valid ? '✓ Valid' : '✗ Invalid'}</div>
                        <div class="spec-label">Status</div>
                    </div>
                </div>
                <div class="mt-md" style="font-size:12px;color:var(--text-tertiary)">
                    <div><strong>Hardware ID:</strong> <code class="text-mono">${hwid}</code></div>
                    <div><strong>Hardware Bound:</strong> ${license.hardware_match ? '✓ Match' : '✗ Mismatch'}</div>
                    <div><strong>Customer:</strong> ${license.customer_id || '—'}</div>
                </div>
            `;
        } catch (e) {
            licenseEl.innerHTML = '<p class="text-muted">License info unavailable in dev mode</p>';
        }

        try {
            const metrics = await window.__TAURI__.core.invoke('get_inference_metrics');
            runtimeEl.innerHTML = `
                <div class="spec-grid" style="grid-template-columns:1fr 1fr 1fr">
                    <div class="spec-box">
                        <div class="spec-value" style="font-size:14px;color:${metrics.running ? 'var(--status-success)' : 'var(--status-error)'}">${metrics.running ? 'Running' : 'Stopped'}</div>
                        <div class="spec-label">Server</div>
                    </div>
                    <div class="spec-box">
                        <div class="spec-value" style="font-size:14px">${metrics.model}</div>
                        <div class="spec-label">Model</div>
                    </div>
                    <div class="spec-box">
                        <div class="spec-value" style="font-size:14px">${metrics.endpoint}</div>
                        <div class="spec-label">Endpoint</div>
                    </div>
                </div>
            `;
        } catch (e) {
            runtimeEl.innerHTML = '<p class="text-muted">Runtime info unavailable in dev mode</p>';
        }
    }
};

// Navigation handlers
document.querySelectorAll('.sidebar-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
        App.navigateTo(item.dataset.page);
    });
});

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
