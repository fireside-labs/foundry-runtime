// ==========================================================================
// Foundry Enterprise Runtime — Installer Wizard
// 5 steps: System Check → License → Model Pick → Deploy → Done
// Dev-mode aware: bypasses Tauri IPC when running in browser.
// ==========================================================================

const DEV_MODE = !window.__TAURI__;

const Installer = {
    step: 1,
    totalSteps: 5,
    systemInfo: null,
    selectedModel: null,

    init() {
        this.render();
    },

    render() {
        const container = document.getElementById('installer-container');
        container.innerHTML = `
            ${this.renderStepBar()}
            <div class="installer-content" id="installer-step-content">
                ${this.renderStep()}
            </div>
        `;
        this.attachHandlers();
    },

    renderStepBar() {
        const steps = ['System', 'License', 'Model', 'Deploy', 'Ready'];
        let html = '<div class="installer-step-bar">';
        steps.forEach((label, i) => {
            const num = i + 1;
            const cls = num < this.step ? 'done' : (num === this.step ? 'active' : '');
            html += `
                <div class="step-indicator ${cls}">
                    <div class="step-number">${num < this.step ? '✓' : num}</div>
                    <span class="step-label">${label}</span>
                </div>
            `;
            if (i < steps.length - 1) {
                html += `<div class="step-connector ${num < this.step ? 'done' : ''}"></div>`;
            }
        });
        html += '</div>';
        return html;
    },

    renderStep() {
        switch (this.step) {
            case 1: return this.renderSystemCheck();
            case 2: return this.renderLicense();
            case 3: return this.renderModelPick();
            case 4: return this.renderDeploy();
            case 5: return this.renderComplete();
            default: return '';
        }
    },

    // ====== Step 1: System Check ======
    renderSystemCheck() {
        return `
            <div class="text-center mb-lg">
                <div class="badge badge-live mb-md" style="margin:0 auto var(--space-lg)">
                    <span class="ping-dot"></span>
                    <span>Scanning Hardware</span>
                </div>
                <h2 class="installer-headline text-gradient">System Requirements</h2>
                <p class="installer-subtext">Detecting your GPU, VRAM, and platform capabilities.</p>
            </div>
            <div class="spec-grid" id="system-specs" style="margin-top:var(--space-xl)">
                <div class="spec-box">
                    <div class="spinner" style="margin:8px auto"></div>
                    <div class="spec-label">GPU</div>
                </div>
                <div class="spec-box">
                    <div class="spinner" style="margin:8px auto"></div>
                    <div class="spec-label">VRAM</div>
                </div>
                <div class="spec-box">
                    <div class="spinner" style="margin:8px auto"></div>
                    <div class="spec-label">RAM</div>
                </div>
                <div class="spec-box">
                    <div class="spinner" style="margin:8px auto"></div>
                    <div class="spec-label">Platform</div>
                </div>
            </div>
            <div id="system-check-result" class="mt-lg text-center"></div>
            <div class="installer-actions">
                <div></div>
                <button class="btn btn-primary btn-lg" id="btn-step1-next" disabled>
                    <span class="spinner" style="width:14px;height:14px;border-width:1.5px"></span>
                    Scanning...
                </button>
            </div>
        `;
    },

    async runSystemCheck() {
        // Simulate a brief scan delay for premium feel
        await new Promise(r => setTimeout(r, 800));

        try {
            if (!DEV_MODE) {
                this.systemInfo = await window.__TAURI__.core.invoke('get_system_info');
            } else {
                // Dev mode fallback — simulated hardware
                this.systemInfo = { gpu: 'NVIDIA RTX 5090', vram_gb: 32, ram_gb: 64, os: 'windows', arch: 'x86_64' };
            }
        } catch (e) {
            this.systemInfo = { gpu: 'Unknown GPU', vram_gb: 8, ram_gb: 16, os: 'windows', arch: 'x86_64' };
        }

        const info = this.systemInfo;

        // Staggered spec reveal (like the website hero metrics)
        const specs = [
            { value: info.gpu, label: 'GPU' },
            { value: `${info.vram_gb} GB`, label: 'VRAM' },
            { value: `${info.ram_gb} GB`, label: 'RAM' },
            { value: `${info.os} ${info.arch}`, label: 'Platform' }
        ];

        const grid = document.getElementById('system-specs');
        grid.innerHTML = '';

        for (let i = 0; i < specs.length; i++) {
            await new Promise(r => setTimeout(r, 200));
            const s = specs[i];
            const div = document.createElement('div');
            div.className = 'spec-box';
            div.style.animation = 'pageIn 400ms cubic-bezier(0.16, 1, 0.3, 1)';
            div.innerHTML = `
                <div class="spec-value ${i < 2 ? 'text-gradient' : ''}" style="font-size:${i === 0 ? '16px' : '28px'}">${s.value}</div>
                <div class="spec-label">${s.label}</div>
            `;
            grid.appendChild(div);
        }

        const resultEl = document.getElementById('system-check-result');
        const btn = document.getElementById('btn-step1-next');

        if (info.vram_gb >= 4) {
            resultEl.innerHTML = `<span class="badge badge-success" style="margin-top:var(--space-md)">✓ System meets requirements</span>`;
        } else {
            resultEl.innerHTML = `
                <span class="badge badge-warning" style="margin-top:var(--space-md)">⚠ Low VRAM — ${info.vram_gb} GB</span>
                <p class="text-muted mt-sm text-sm">Minimum 4 GB recommended. Smaller models will still work.</p>
            `;
        }

        btn.disabled = false;
        btn.innerHTML = 'Continue →';
    },

    // ====== Step 2: License ======
    renderLicense() {
        return `
            <div class="text-center mb-lg">
                <h2 class="installer-headline text-gradient">License Activation</h2>
                <p class="installer-subtext">Enter your Foundry Enterprise license key to bind this runtime to your hardware.</p>
            </div>
            <div style="max-width:520px;margin:var(--space-xl) auto 0">
                <div class="card">
                    <div class="input-group">
                        <label class="input-label">License Key</label>
                        <div class="license-input-wrapper">
                            <input type="text" class="input input-mono" id="license-key-input"
                                placeholder="FDRY-ENT-A1B2C3D4-E5F6A7B8-1234ABCD"
                                autocomplete="off" spellcheck="false"
                                style="padding-right:48px">
                            <span class="license-status-icon" id="license-icon"></span>
                        </div>
                    </div>
                    <div id="license-result" class="text-center mt-lg"></div>
                </div>
                <div class="mt-lg text-center">
                    <p class="text-mono text-xs" style="color:var(--text-tertiary);letter-spacing:0.8px;line-height:1.8">
                        HARDWARE-BOUND ENCRYPTION<br>
                        BOUND TO THIS MACHINE · OFFLINE · TAMPER-EVIDENT
                    </p>
                </div>
            </div>
            <div class="installer-actions">
                <button class="btn btn-secondary" id="btn-step2-back">← Back</button>
                <div class="flex gap-sm">
                    ${DEV_MODE ? '<button class="btn btn-ghost" id="btn-step2-skip" style="color:var(--text-tertiary)">Skip (Dev)</button>' : ''}
                    <button class="btn btn-primary btn-lg" id="btn-step2-next" disabled>Activate →</button>
                </div>
            </div>
        `;
    },

    async validateLicenseKey() {
        const input = document.getElementById('license-key-input');
        const icon = document.getElementById('license-icon');
        const result = document.getElementById('license-result');
        const btn = document.getElementById('btn-step2-next');
        const key = input.value.trim();

        console.log('[foundry] validateLicenseKey called. key:', key, 'DEV_MODE:', DEV_MODE, 'key.length:', key.length);

        if (key.length < 10) {
            icon.textContent = '';
            result.innerHTML = '';
            btn.disabled = true;
            return;
        }

        try {
            let info;
            if (!DEV_MODE) {
                info = await window.__TAURI__.core.invoke('validate_license', { key });
            } else {
                // Dev mode: accept any key matching format FDRY-XXX-XXXX-XXXX-XXXX
                const parts = key.split('-');
                if (parts.length === 5 && parts[0] === 'FDRY') {
                    const tierMap = { STR: 'starter', PRO: 'professional', ENT: 'enterprise' };
                    info = {
                        valid: true,
                        tier: tierMap[parts[1].toUpperCase()] || 'enterprise',
                        customer_id: `${parts[2]}-${parts[3]}`,
                        hardware_bound: true,
                        hardware_match: true,
                        expiry: 'perpetual'
                    };
                } else {
                    throw 'Invalid format';
                }
            }

            if (info.valid && info.hardware_match) {
                icon.textContent = '✓';
                icon.style.color = 'var(--status-success)';
                result.innerHTML = `
                    <span class="badge badge-success">✓ Valid License</span>
                    <div class="spec-grid mt-md" style="grid-template-columns:1fr 1fr 1fr">
                        <div class="spec-box" style="padding:var(--space-md)">
                            <div class="spec-value text-gradient" style="font-size:14px">${info.tier}</div>
                            <div class="spec-label">Tier</div>
                        </div>
                        <div class="spec-box" style="padding:var(--space-md)">
                            <div class="spec-value" style="font-size:14px;color:var(--status-success)">${info.expiry}</div>
                            <div class="spec-label">Expiry</div>
                        </div>
                        <div class="spec-box" style="padding:var(--space-md)">
                            <div class="spec-value" style="font-size:14px;color:var(--status-success)">✓ Bound</div>
                            <div class="spec-label">Hardware</div>
                        </div>
                    </div>
                `;
                btn.disabled = false;
            } else if (info.valid && !info.hardware_match) {
                icon.textContent = '✗';
                icon.style.color = 'var(--status-error)';
                result.innerHTML = `<span class="badge badge-error">Hardware mismatch — key bound to different machine</span>`;
                btn.disabled = true;
            }
        } catch (e) {
            icon.textContent = '✗';
            icon.style.color = 'var(--status-error)';
            result.innerHTML = `<span class="badge badge-error">Invalid license key format</span>`;
            btn.disabled = true;
        }
    },

    async bindLicenseKey() {
        const key = document.getElementById('license-key-input').value.trim();
        if (DEV_MODE) {
            // Dev mode: store in memory
            const parts = key.split('-');
            const tierMap = { STR: 'starter', PRO: 'professional', ENT: 'enterprise' };
            App.license = {
                valid: true,
                tier: tierMap[parts[1]?.toUpperCase()] || 'enterprise',
                customer_id: `${parts[2]}-${parts[3]}`,
                hardware_bound: true,
                hardware_match: true,
                expiry: 'perpetual'
            };
            return;
        }
        try {
            await window.__TAURI__.core.invoke('bind_license', { key });
            App.license = await window.__TAURI__.core.invoke('get_license_status');
        } catch (e) {
            console.error('[foundry] License bind failed:', e);
        }
    },

    // ====== Step 3: Model Pick ======
    renderModelPick() {
        const vram = this.systemInfo ? this.systemInfo.vram_gb : 32;
        const models = Models.getRegistry().filter(m => m.min_vram <= vram);
        const recommended = models.filter(m => m.recommended_vram <= vram)
            .sort((a, b) => b.recommended_vram - a.recommended_vram)[0];

        let html = `
            <div class="text-center mb-lg">
                <h2 class="installer-headline text-gradient">Select a Model</h2>
                <p class="installer-subtext">Choose a base model. Custom domain-tuned variants can be imported after setup.</p>
            </div>
            <div class="model-grid" style="margin-top:var(--space-xl)">
        `;

        models.forEach(m => {
            const isRec = recommended && m.id === recommended.id;
            const fits = m.recommended_vram <= vram;
            html += `
                <div class="model-card ${isRec ? 'recommended' : ''} ${this.selectedModel === m.id ? 'selected' : ''}"
                     data-model-id="${m.id}">
                    <div class="model-name">${m.name}</div>
                    <div class="model-params">${m.params} · ${m.quant} · ${m.family}</div>
                    <div class="text-sm text-muted mt-sm">${m.description}</div>
                    <div class="model-stats">
                        <div>
                            <span class="model-stat-label">VRAM</span>
                            <span class="model-stat-value ${fits ? 'text-success' : 'text-warning'}">${m.recommended_vram} GB</span>
                        </div>
                        <div>
                            <span class="model-stat-label">Speed</span>
                            <span class="model-stat-value">${m.tok_s_estimate} tok/s</span>
                        </div>
                        <div>
                            <span class="model-stat-label">Context</span>
                            <span class="model-stat-value">${(m.context / 1024).toFixed(0)}K</span>
                        </div>
                        <div>
                            <span class="model-stat-label">Category</span>
                            <span class="model-stat-value">${m.category}</span>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `
            </div>
            <div class="mt-lg text-center">
                <button class="btn btn-secondary btn-sm" id="btn-import-custom">Import Custom GGUF</button>
            </div>
            <div class="installer-actions">
                <button class="btn btn-secondary" id="btn-step3-back">← Back</button>
                <button class="btn btn-primary btn-lg" id="btn-step3-next" ${this.selectedModel ? '' : 'disabled'}>
                    Deploy →
                </button>
            </div>
        `;
        return html;
    },

    // ====== Step 4: Deploy ======
    renderDeploy() {
        const model = Models.getRegistry().find(m => m.id === this.selectedModel);
        const name = model ? model.name : this.selectedModel;

        return `
            <div class="text-center mb-lg">
                <h2 class="installer-headline">Deploying <span class="text-gradient">${name}</span></h2>
                <p class="installer-subtext">Downloading and initializing inference server...</p>
            </div>
            <div style="max-width:520px;margin:var(--space-xl) auto 0">
                <div class="card">
                    <div id="deploy-status" class="flex items-center gap-md mb-md">
                        <div class="spinner"></div>
                        <span>Initializing...</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" id="deploy-progress" style="width:0%"></div>
                    </div>
                    <div class="flex justify-between mt-sm text-xs text-muted text-mono">
                        <span id="deploy-downloaded">0 MB</span>
                        <span id="deploy-speed">—</span>
                        <span id="deploy-percent">0%</span>
                    </div>
                </div>
                <div id="deploy-steps" class="mt-xl" style="max-width:300px;margin-left:auto;margin-right:auto">
                    <div class="flex items-center gap-sm mb-md text-muted text-sm" id="step-download">
                        <span style="width:20px;text-align:center">⏳</span> <span>Download model</span>
                    </div>
                    <div class="flex items-center gap-sm mb-md text-muted text-sm" id="step-verify">
                        <span style="width:20px;text-align:center">⏳</span> <span>Verify GGUF integrity</span>
                    </div>
                    <div class="flex items-center gap-sm mb-md text-muted text-sm" id="step-start">
                        <span style="width:20px;text-align:center">⏳</span> <span>Start inference server</span>
                    </div>
                    <div class="flex items-center gap-sm mb-md text-muted text-sm" id="step-health">
                        <span style="width:20px;text-align:center">⏳</span> <span>Health check</span>
                    </div>
                </div>
            </div>
        `;
    },

    async runDeploy() {
        const setStep = (id, status) => {
            const el = document.getElementById(id);
            if (!el) return;
            const icons = { done: '✅', running: '🔄', error: '❌', pending: '⏳' };
            el.querySelector('span:first-child').textContent = icons[status] || '⏳';
            el.style.color = status === 'done' ? 'var(--status-success)' : status === 'running' ? 'var(--text-primary)' : status === 'error' ? 'var(--status-error)' : '';
        };

        if (DEV_MODE) {
            // Simulate deployment in dev mode
            const steps = ['step-download', 'step-verify', 'step-start', 'step-health'];
            for (const step of steps) {
                setStep(step, 'running');
                // Animate progress
                for (let p = 0; p <= 100; p += 5) {
                    const bar = document.getElementById('deploy-progress');
                    const pctEl = document.getElementById('deploy-percent');
                    if (bar) bar.style.width = p + '%';
                    if (pctEl) pctEl.textContent = p + '%';
                    await new Promise(r => setTimeout(r, 30));
                }
                await new Promise(r => setTimeout(r, 300));
                setStep(step, 'done');
            }
            document.getElementById('deploy-status').innerHTML = `<span class="badge badge-success">✓ Deployment Complete</span>`;
            setTimeout(() => { this.step = 5; this.render(); }, 1000);
            return;
        }

        // Real Tauri deployment
        try {
            const unlisten = await window.__TAURI__.event.listen('download-progress', (event) => {
                const p = event.payload;
                const bar = document.getElementById('deploy-progress');
                if (bar) bar.style.width = p.percent.toFixed(1) + '%';
                const dl = document.getElementById('deploy-downloaded');
                if (dl) dl.textContent = p.downloaded_mb.toFixed(0) + ' MB';
                const sp = document.getElementById('deploy-speed');
                if (sp) sp.textContent = p.speed_mbps.toFixed(1) + ' MB/s';
                const pc = document.getElementById('deploy-percent');
                if (pc) pc.textContent = p.percent.toFixed(1) + '%';

                if (p.status === 'verifying') { setStep('step-download', 'done'); setStep('step-verify', 'running'); }
                if (p.status === 'complete') { setStep('step-verify', 'done'); }
            });

            setStep('step-download', 'running');
            await window.__TAURI__.core.invoke('download_brain', { model: this.selectedModel, quant: '6-bit', dest: '~/.foundry/models' });
            setStep('step-download', 'done');
            setStep('step-verify', 'done');

            setStep('step-start', 'running');
            await window.__TAURI__.core.invoke('start_llama_server');
            setStep('step-start', 'done');

            setStep('step-health', 'running');
            await window.__TAURI__.core.invoke('test_connection');
            setStep('step-health', 'done');

            await window.__TAURI__.core.invoke('write_config', { config: { license_key: '', model: this.selectedModel } });
            unlisten();
            setTimeout(() => { this.step = 5; this.render(); }, 1000);
        } catch (e) {
            console.error('[foundry] Deploy error:', e);
            document.getElementById('deploy-status').innerHTML = `
                <span class="badge badge-error">Deployment Error</span>
                <p class="mt-md text-sm text-muted">${e}</p>
                <button class="btn btn-secondary btn-sm mt-md" onclick="Installer.runDeploy()">Retry</button>
            `;
        }
    },

    // ====== Step 5: Complete ======
    renderComplete() {
        return `
            <div class="text-center" style="padding:var(--space-3xl) 0">
                <div style="width:64px;height:64px;margin:0 auto var(--space-lg);border-radius:50%;background:var(--status-success);display:flex;align-items:center;justify-content:center;font-size:28px;color:#000;font-weight:800;box-shadow:0 0 30px rgba(52,211,153,0.4)">✓</div>
                <h2 class="installer-headline">Foundry Runtime <span class="text-gradient">Ready</span></h2>
                <p class="installer-subtext mb-lg">Your enterprise AI deployment is active and serving.</p>

                <div class="spec-grid" style="max-width:500px;margin:var(--space-xl) auto">
                    <div class="spec-box">
                        <div class="spec-value" style="font-size:14px;color:var(--status-success)">● Online</div>
                        <div class="spec-label">Server</div>
                    </div>
                    <div class="spec-box">
                        <div class="spec-value text-mono" style="font-size:13px">127.0.0.1:8080</div>
                        <div class="spec-label">Endpoint</div>
                    </div>
                    <div class="spec-box">
                        <div class="spec-value text-gradient" style="font-size:14px">${App.license ? App.license.tier : 'Active'}</div>
                        <div class="spec-label">License</div>
                    </div>
                </div>

                <button class="btn btn-primary btn-lg mt-xl" id="btn-launch-workspace" style="padding:14px 48px">
                    Launch Workspace →
                </button>
            </div>
        `;
    },

    // ====== Event Handlers ======
    attachHandlers() {
        if (this.step === 1) {
            document.getElementById('btn-step1-next')?.addEventListener('click', () => { this.step = 2; this.render(); });
            this.runSystemCheck();
        }

        if (this.step === 2) {
            const input = document.getElementById('license-key-input');
            let debounce;
            input?.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => this.validateLicenseKey(), 300);
            });
            document.getElementById('btn-step2-back')?.addEventListener('click', () => { this.step = 1; this.render(); });
            document.getElementById('btn-step2-next')?.addEventListener('click', async () => {
                await this.bindLicenseKey();
                this.step = 3;
                this.render();
            });
            document.getElementById('btn-step2-skip')?.addEventListener('click', () => {
                App.license = { valid: true, tier: 'enterprise', customer_id: 'dev-mode', hardware_bound: false, hardware_match: true, expiry: 'dev' };
                this.step = 3;
                this.render();
            });
        }

        if (this.step === 3) {
            document.querySelectorAll('.model-card').forEach(card => {
                card.addEventListener('click', () => {
                    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    this.selectedModel = card.dataset.modelId;
                    document.getElementById('btn-step3-next').disabled = false;
                });
            });
            document.getElementById('btn-step3-back')?.addEventListener('click', () => { this.step = 2; this.render(); });
            document.getElementById('btn-step3-next')?.addEventListener('click', () => {
                this.step = 4;
                this.render();
                this.runDeploy();
            });
        }

        if (this.step === 5) {
            document.getElementById('btn-launch-workspace')?.addEventListener('click', () => App.showWorkspace());
        }
    }
};
