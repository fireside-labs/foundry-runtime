// ==========================================================================
// Foundry Enterprise Runtime — Status Bar (Live Telemetry)
// Polls GPU metrics, inference server health, and VRAM usage.
// ==========================================================================

const StatusBar = {
    pollInterval: null,
    gpuInterval: null,

    start() {
        // Immediate poll
        this.pollInference();
        this.pollGpu();

        // Set intervals
        this.pollInterval = setInterval(() => this.pollInference(), 3000);
        this.gpuInterval = setInterval(() => this.pollGpu(), 2000);

        // Click to copy endpoint
        document.getElementById('status-endpoint')?.addEventListener('click', () => {
            const endpoint = document.getElementById('status-endpoint').textContent;
            navigator.clipboard?.writeText(endpoint).then(() => {
                const el = document.getElementById('status-endpoint');
                const original = el.textContent;
                el.textContent = '✓ Copied';
                setTimeout(() => { el.textContent = original; }, 1500);
            });
        });
    },

    stop() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        if (this.gpuInterval) clearInterval(this.gpuInterval);
    },

    async pollInference() {
        try {
            const metrics = await window.__TAURI__.core.invoke('get_inference_metrics');
            const dot = document.getElementById('status-dot');
            const serverEl = document.getElementById('status-server');
            const modelEl = document.getElementById('status-model');
            const tpsEl = document.getElementById('status-tps');

            if (metrics.running) {
                dot.className = 'status-dot online';
                serverEl.textContent = 'Online';
                serverEl.style.color = 'var(--status-success)';
                modelEl.textContent = metrics.model || '—';

                if (metrics.tokens_per_second > 0) {
                    tpsEl.textContent = metrics.tokens_per_second.toFixed(1);
                }
            } else {
                dot.className = 'status-dot offline';
                serverEl.textContent = 'Offline';
                serverEl.style.color = 'var(--status-error)';
                modelEl.textContent = '—';
                tpsEl.textContent = '—';
            }
        } catch (e) {
            // Dev mode — try direct health check
            try {
                const res = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(2000) });
                if (res.ok) {
                    const data = await res.json();
                    document.getElementById('status-dot').className = 'status-dot online';
                    document.getElementById('status-server').textContent = 'Online';
                    document.getElementById('status-server').style.color = 'var(--status-success)';
                    if (data.model) {
                        const modelName = data.model.split(/[/\\]/).pop();
                        document.getElementById('status-model').textContent = modelName;
                    }
                }
            } catch (_) {
                document.getElementById('status-dot').className = 'status-dot offline';
                document.getElementById('status-server').textContent = 'Offline';
                document.getElementById('status-server').style.color = 'var(--status-error)';
            }
        }
    },

    async pollGpu() {
        try {
            const gpu = await window.__TAURI__.core.invoke('get_gpu_metrics');
            const vramEl = document.getElementById('status-vram');
            const tempEl = document.getElementById('status-temp');

            if (gpu.vram_total_mb > 0) {
                const usedGb = (gpu.vram_used_mb / 1024).toFixed(1);
                const totalGb = (gpu.vram_total_mb / 1024).toFixed(0);
                const pct = (gpu.vram_used_mb / gpu.vram_total_mb * 100).toFixed(0);

                vramEl.textContent = `${usedGb}/${totalGb} GB (${pct}%)`;

                // Color code VRAM usage
                if (pct > 90) {
                    vramEl.style.color = 'var(--status-error)';
                } else if (pct > 75) {
                    vramEl.style.color = 'var(--status-warning)';
                } else {
                    vramEl.style.color = '';
                }
            }

            if (gpu.temperature_c > 0) {
                tempEl.textContent = `${gpu.temperature_c.toFixed(0)}°C`;
                if (gpu.temperature_c > 85) {
                    tempEl.style.color = 'var(--status-error)';
                } else if (gpu.temperature_c > 75) {
                    tempEl.style.color = 'var(--status-warning)';
                } else {
                    tempEl.style.color = '';
                }
            }
        } catch (e) {
            // nvidia-smi not available in dev mode
        }
    }
};
