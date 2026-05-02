// ==========================================================================
// Foundry Runtime — App Router & State
// ==========================================================================

// Calendly intro-call URL — Pro upgrade route per freemium architecture.
// "Request Pro Key" buttons open this in the user's default browser via the
// Tauri shell plugin. Jordan comps the Pro key on the resulting call.
const CALENDLY_URL = 'https://calendly.com/j-nguyen-firesidelabs?utm_source=foundry-runtime&utm_medium=pro-upgrade';

// Pro tier feature gate. UI elements check `App.hasPro()` before enabling.
// Free tier ships with: chat, model download, status bar, markdown export, basic templates, single-session memory.
// Pro tier unlocks: Roundtable mode, premium templates, PowerPoint export, persistent cross-session memory.
const PRO_FEATURES = ['roundtable', 'premium_templates', 'pptx_export', 'persistent_memory'];

const LICENSE_CACHE_KEY = 'foundry.license.cache.v1';

const App = {
    currentPage: 'installer',
    onboarded: false,
    license: null, // hydrated by init() — never null after init
    PRO_FEATURES,

    async init() {
        // License check is fail-OPEN: any failure → free tier active, workspace still loads.
        // (Hospital/bank IT will block outbound network calls — license must not gate access.)
        this.license = await this.loadLicense();

        // Onboarding is decoupled from license. User is "onboarded" once they've
        // completed initial setup (model picked + downloaded). Free tier users
        // still need the installer wizard for first-run.
        // TODO(install-state): persist onboarded flag separately from license once
        // installer completion is tracked in Tauri config (see write_config in main.rs).
        if (window.__TAURI__) {
            // For now: skip installer if license is present (existing behavior preserved).
            // Free-tier onboarding flow will need its own completion check.
            if (this.license.valid) {
                this.onboarded = true;
                this.showWorkspace();
                return;
            }
        } else {
            console.log('[foundry] Dev mode — no Tauri context');
        }

        // First-run installer — license is OPTIONAL inside the installer.
        Installer.init();
    },

    // Load license state with fail-open semantics + localStorage caching.
    // Order: live Tauri call → localStorage cache → free-tier default.
    async loadLicense() {
        const FREE_TIER_DEFAULT = { valid: false, tier: 'free', hardware_match: false, customer_id: null };

        if (window.__TAURI__) {
            try {
                const live = await window.__TAURI__.core.invoke('get_license_status');
                // Cache the live result so next launch (offline or IT-blocked) sees the same tier.
                try {
                    localStorage.setItem(LICENSE_CACHE_KEY, JSON.stringify({
                        ...live,
                        cached_at: Date.now(),
                    }));
                } catch (e) { /* localStorage might be disabled — ignore */ }
                return live;
            } catch (e) {
                console.log('[foundry] License check unavailable, falling back to cache or free tier');
            }
        }

        // Fall back to last-known cached license, if any.
        try {
            const cached = JSON.parse(localStorage.getItem(LICENSE_CACHE_KEY) || 'null');
            if (cached && typeof cached === 'object') return cached;
        } catch (e) { /* malformed cache — ignore */ }

        return FREE_TIER_DEFAULT;
    },

    // Pro tier check: license is valid AND tier is paid (professional or enterprise).
    // 'starter' (legacy) and 'free' return false. Used by every UI Pro-gate.
    hasPro() {
        if (!this.license || !this.license.valid) return false;
        return this.license.tier === 'professional' || this.license.tier === 'enterprise';
    },

    // Open Calendly in the user's default browser. Used by all "Request Pro Key" CTAs.
    async requestProAccess(source) {
        const url = source ? `${CALENDLY_URL}&utm_content=${encodeURIComponent(source)}` : CALENDLY_URL;
        if (window.__TAURI__) {
            try {
                // Tauri 2 shell plugin — open URL in user's default browser.
                await window.__TAURI__.core.invoke('plugin:shell|open', { path: url });
                return;
            } catch (e) {
                console.warn('[foundry] Tauri shell open failed, falling back to window.open:', e);
            }
        }
        window.open(url, '_blank');
    },

    showWorkspace() {
        document.getElementById('sidebar').style.display = '';
        document.getElementById('statusbar').style.display = '';
        this.navigateTo('workspace');
        Workspace.init();
        StatusBar.start();
        this.updateSidebarLicense();
        this.applyProGates();
    },

    // Apply Pro feature gates to any element marked `.pro-feature` in the DOM.
    // Idempotent (skips elements already gated). Called after workspace mount and
    // can be re-called by feature renderers (e.g., tools.js) after dynamic insertion.
    applyProGates() {
        if (this.hasPro()) {
            // Pro user: remove any locked styling that may have been applied.
            document.querySelectorAll('.pro-feature.pro-locked').forEach(el => {
                el.classList.remove('pro-locked');
                el.querySelector('.pro-badge')?.remove();
            });
            return;
        }
        document.querySelectorAll('.pro-feature:not(.pro-locked)').forEach(el => {
            el.classList.add('pro-locked');
            // Add a small "PRO" badge inside the element
            if (!el.querySelector('.pro-badge')) {
                const badge = document.createElement('span');
                badge.className = 'pro-badge';
                badge.textContent = 'PRO';
                el.appendChild(badge);
            }
            // Capture-phase click hijack — runs before any feature-specific handler.
            // We can't remove existing handlers, but we can short-circuit by stopping propagation.
            const sourceLabel = el.dataset.proSource || el.id || 'unknown';
            const proHandler = (e) => {
                if (App.hasPro()) return; // Re-check at click time
                e.preventDefault();
                e.stopImmediatePropagation();
                App.requestProAccess(sourceLabel);
            };
            // Mark handler so we don't re-add on re-renders
            if (!el.dataset.proHandlerAttached) {
                el.addEventListener('click', proHandler, true);
                el.dataset.proHandlerAttached = '1';
            }
        });
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
        if (!el) return;
        if (this.hasPro()) {
            const tierMap = { professional: '🔵', enterprise: '🟣' };
            el.innerHTML = `
                <span class="icon">${tierMap[this.license.tier] || '🔑'}</span>
                <span>${this.license.tier.charAt(0).toUpperCase() + this.license.tier.slice(1)}</span>
            `;
        } else {
            // Free tier: show "Free" with an upgrade affordance.
            el.innerHTML = `
                <span class="icon">⚪</span>
                <span>Free</span>
                <button class="btn btn-ghost btn-xs" style="margin-left:auto;font-size:9px"
                        onclick="App.requestProAccess('sidebar')">Upgrade</button>
            `;
        }
    },

    async initSettings() {
        const licenseEl = document.getElementById('settings-license-info');
        const runtimeEl = document.getElementById('settings-runtime-info');

        // License panel — show current tier + Pro upgrade CTA for free users.
        const license = this.license;
        const hasPro = this.hasPro();
        let licenseHtml = `
            <div class="spec-grid" style="grid-template-columns:1fr 1fr">
                <div class="spec-box">
                    <div class="spec-value" style="font-size:16px">${license.tier ? license.tier.charAt(0).toUpperCase() + license.tier.slice(1) : 'Free'}</div>
                    <div class="spec-label">Tier</div>
                </div>
                <div class="spec-box">
                    <div class="spec-value" style="font-size:16px">${hasPro ? '✓ Active' : 'Free'}</div>
                    <div class="spec-label">Status</div>
                </div>
            </div>
        `;
        if (window.__TAURI__) {
            try {
                const hwid = await window.__TAURI__.core.invoke('get_hardware_id');
                licenseHtml += `
                    <div class="mt-md" style="font-size:12px;color:var(--text-tertiary)">
                        <div><strong>Hardware ID:</strong> <code class="text-mono">${hwid}</code></div>
                        ${hasPro ? `<div><strong>Hardware Bound:</strong> ${license.hardware_match ? '✓ Match' : '✗ Mismatch'}</div>` : ''}
                        ${license.customer_id ? `<div><strong>Customer:</strong> ${license.customer_id}</div>` : ''}
                    </div>
                `;
            } catch (e) {
                /* Hardware ID unavailable in dev mode — skip the detail block */
            }
        }
        if (!hasPro) {
            licenseHtml += `
                <div class="mt-lg" style="padding:var(--space-md);border:1px solid var(--copper-dim);border-radius:6px;background:rgba(200,117,51,0.04)">
                    <div style="font-size:13px;font-weight:600;margin-bottom:4px">Unlock Pro features</div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:var(--space-sm)">Roundtable mode, premium templates, PowerPoint export, persistent cross-session memory. $249/yr.</div>
                    <button class="btn btn-primary btn-sm" onclick="App.requestProAccess('settings')">Request Pro Key</button>
                </div>
            `;
        }
        licenseEl.innerHTML = licenseHtml;

        if (window.__TAURI__) {
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
        } else {
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
