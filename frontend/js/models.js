// ==========================================================================
// Foundry Runtime — Model Registry & Score Cards
// 15 curated enterprise models. Custom domain-tuned variants imported separately.
// ==========================================================================

const Models = {
    registry: [
        {
            id: 'llama-3.1-8b', name: 'Llama 3.1 8B', family: 'Meta',
            params: '8B', quant: 'Q6_K', min_vram: 6, recommended_vram: 8,
            tok_s_estimate: 45, context: 131072, category: 'General',
            description: 'Strong all-rounder. 128K context, good at coding and reasoning.',
            benchmarks: { '500q': 72, gsm8k: 78, held_out: null, humaneval: 62 }
        },
        {
            id: 'qwen3-8b', name: 'Qwen 3 8B', family: 'Alibaba',
            params: '8B', quant: 'Q6_K', min_vram: 6, recommended_vram: 8,
            tok_s_estimate: 45, context: 32768, category: 'General',
            description: 'Latest Qwen. Strong multilingual + reasoning capabilities.',
            benchmarks: { '500q': 74, gsm8k: 82, held_out: null, humaneval: 65 }
        },
        {
            id: 'gemma-3-12b', name: 'Gemma 3 12B', family: 'Google',
            params: '12B', quant: 'Q6_K', min_vram: 8, recommended_vram: 12,
            tok_s_estimate: 35, context: 32768, category: 'General',
            description: 'Google mid-range. Excellent instruction following.',
            benchmarks: { '500q': 78, gsm8k: 85, held_out: null, humaneval: 68 }
        },
        {
            id: 'phi-4-14b', name: 'Phi-4 14B', family: 'Microsoft',
            params: '14B', quant: 'Q6_K', min_vram: 10, recommended_vram: 16,
            tok_s_estimate: 30, context: 16384, category: 'Reasoning',
            description: 'Exceptional math and reasoning for its size.',
            benchmarks: { '500q': 82, gsm8k: 88, held_out: null, humaneval: 72 }
        },
        {
            id: 'qwen-2.5-14b', name: 'Qwen 2.5 14B', family: 'Alibaba',
            params: '14B', quant: 'Q6_K', min_vram: 10, recommended_vram: 16,
            tok_s_estimate: 30, context: 32768, category: 'General',
            description: 'Strong baseline — calibration-ready architecture.',
            benchmarks: { '500q': 85, gsm8k: 91.6, held_out: null, humaneval: 74 }
        },
        {
            id: 'qwen3-14b', name: 'Qwen 3 14B', family: 'Alibaba',
            params: '14B', quant: 'Q6_K', min_vram: 10, recommended_vram: 16,
            tok_s_estimate: 28, context: 32768, category: 'General',
            description: 'Latest generation. Improved reasoning and tool-calling.',
            benchmarks: { '500q': 86, gsm8k: 90, held_out: null, humaneval: 76 }
        },
        {
            id: 'qwen-2.5-coder-14b', name: 'Qwen 2.5 Coder 14B', family: 'Alibaba',
            params: '14B', quant: 'Q6_K', min_vram: 10, recommended_vram: 16,
            tok_s_estimate: 28, context: 32768, category: 'Coding',
            description: 'Best mid-range coding model. Complex codebase understanding.',
            benchmarks: { '500q': 80, gsm8k: 82, held_out: null, humaneval: 82 }
        },
        {
            id: 'deepseek-r1-14b', name: 'DeepSeek R1 14B', family: 'DeepSeek',
            params: '14B', quant: 'Q6_K', min_vram: 10, recommended_vram: 16,
            tok_s_estimate: 28, context: 32768, category: 'Reasoning',
            description: 'Chain-of-thought reasoning. Math/logic specialist.',
            benchmarks: { '500q': 88, gsm8k: 87.4, held_out: null, humaneval: 70 }
        },
        {
            id: 'mistral-small-24b', name: 'Mistral Small 24B', family: 'Mistral',
            params: '24B', quant: 'Q4_K_M', min_vram: 16, recommended_vram: 24,
            tok_s_estimate: 22, context: 32768, category: 'General',
            description: 'Mistral mid-tier. Excellent instruction following.',
            benchmarks: { '500q': 84, gsm8k: 88, held_out: null, humaneval: 74 }
        },
        {
            id: 'gemma-3-27b', name: 'Gemma 3 27B', family: 'Google',
            params: '27B', quant: 'Q4_K_M', min_vram: 18, recommended_vram: 24,
            tok_s_estimate: 20, context: 32768, category: 'General',
            description: 'Google flagship. Near-frontier quality. Calibration-ready architecture.',
            benchmarks: { '500q': 87, gsm8k: 90, held_out: 23, humaneval: 78 }
        },
        {
            id: 'qwen3-32b', name: 'Qwen 3 32B', family: 'Alibaba',
            params: '32B', quant: 'Q4_K_M', min_vram: 20, recommended_vram: 32,
            tok_s_estimate: 18, context: 32768, category: 'General',
            description: 'Powerhouse. Excellent complex multi-step reasoning.',
            benchmarks: { '500q': 89, gsm8k: 92, held_out: null, humaneval: 80 }
        },
        {
            id: 'deepseek-r1-32b', name: 'DeepSeek R1 32B', family: 'DeepSeek',
            params: '32B', quant: 'Q4_K_M', min_vram: 20, recommended_vram: 32,
            tok_s_estimate: 16, context: 32768, category: 'Reasoning',
            description: 'Heavy-duty reasoning. Competes with GPT-4 on math/logic.',
            benchmarks: { '500q': 92.4, gsm8k: 91, held_out: null, humaneval: 78 }
        },
        {
            id: 'qwen-2.5-coder-32b', name: 'Qwen 2.5 Coder 32B', family: 'Alibaba',
            params: '32B', quant: 'Q4_K_M', min_vram: 20, recommended_vram: 32,
            tok_s_estimate: 16, context: 32768, category: 'Coding',
            description: 'Best local coding model. Rivals GPT-4 on code generation.',
            benchmarks: { '500q': 86, gsm8k: 84, held_out: null, humaneval: 86 }
        },
        {
            id: 'qwen-3.5-35b', name: 'Qwen 3.5 35B', family: 'Alibaba',
            params: '35B', quant: 'Q6_K', min_vram: 24, recommended_vram: 32,
            tok_s_estimate: 18, context: 32768, category: 'General',
            description: 'Near-GPT-4 quality. Higher quant for maximum accuracy.',
            benchmarks: { '500q': 91, gsm8k: 93, held_out: null, humaneval: 82 }
        },
        {
            id: 'llama-3.3-70b', name: 'Llama 3.3 70B', family: 'Meta',
            params: '70B', quant: 'Q4_K_M', min_vram: 40, recommended_vram: 48,
            tok_s_estimate: 10, context: 131072, category: 'General',
            description: 'Meta flagship. 128K context, frontier-class reasoning.',
            benchmarks: { '500q': 93, gsm8k: 95, held_out: null, humaneval: 85 }
        }
    ],

    getRegistry() {
        return this.registry;
    },

    init() {
        this.renderGrid();
    },

    renderGrid() {
        const container = document.getElementById('model-grid-container');
        if (!container) return;

        let html = `
            <div class="flex justify-between items-center mb-lg">
                <div class="flex gap-sm">
                    <button class="btn btn-sm btn-secondary filter-btn active" data-filter="all">All</button>
                    <button class="btn btn-sm btn-ghost filter-btn" data-filter="General">General</button>
                    <button class="btn btn-sm btn-ghost filter-btn" data-filter="Coding">Coding</button>
                    <button class="btn btn-sm btn-ghost filter-btn" data-filter="Reasoning">Reasoning</button>
                </div>
                <button class="btn btn-sm btn-secondary" id="btn-import-gguf">Import Custom GGUF</button>
            </div>
            <div class="model-grid" id="models-grid">
        `;

        this.registry.forEach(m => {
            const benchHtml = this.renderBenchmarkBars(m.benchmarks);
            html += `
                <div class="model-card" data-category="${m.category}">
                    <div class="flex justify-between items-center">
                        <div>
                            <div class="model-name">${m.name}</div>
                            <div class="model-params">${m.params} · ${m.quant} · ${m.family}</div>
                        </div>
                        <span class="badge badge-info">${m.category}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:var(--space-sm)">${m.description}</div>
                    ${benchHtml}
                    <div class="model-stats">
                        <div class="model-stat">
                            <span class="model-stat-label">VRAM</span>
                            <span class="model-stat-value">${m.recommended_vram} GB</span>
                        </div>
                        <div class="model-stat">
                            <span class="model-stat-label">Speed</span>
                            <span class="model-stat-value">${m.tok_s_estimate} tok/s</span>
                        </div>
                        <div class="model-stat">
                            <span class="model-stat-label">Context</span>
                            <span class="model-stat-value">${(m.context / 1024).toFixed(0)}K</span>
                        </div>
                        <div class="model-stat">
                            <span class="model-stat-label">500Q</span>
                            <span class="model-stat-value">${m.benchmarks['500q'] || '—'}%</span>
                        </div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;

        // Filter handlers
        container.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.filter-btn').forEach(b => {
                    b.classList.remove('active');
                    b.classList.remove('btn-secondary');
                    b.classList.add('btn-ghost');
                });
                btn.classList.add('active');
                btn.classList.remove('btn-ghost');
                btn.classList.add('btn-secondary');

                const filter = btn.dataset.filter;
                container.querySelectorAll('.model-card').forEach(card => {
                    if (filter === 'all' || card.dataset.category === filter) {
                        card.style.display = '';
                    } else {
                        card.style.display = 'none';
                    }
                });
            });
        });
    },

    renderBenchmarkBars(benchmarks) {
        if (!benchmarks) return '';

        const metrics = [
            { key: '500q', label: '500Q', max: 100 },
            { key: 'gsm8k', label: 'GSM8K', max: 100 },
            { key: 'humaneval', label: 'HumanEval', max: 100 }
        ];

        let html = '<div style="margin-top:var(--space-md);padding-top:var(--space-md);border-top:1px solid var(--border-muted)">';
        metrics.forEach(m => {
            const val = benchmarks[m.key];
            if (val == null) return;
            const pct = (val / m.max * 100).toFixed(0);
            const color = val >= 90 ? 'var(--status-success)' : val >= 80 ? 'var(--accent-blue)' : 'var(--status-warning)';
            html += `
                <div class="flex items-center gap-sm mb-sm" style="font-size:11px">
                    <span style="width:60px;color:var(--text-tertiary)">${m.label}</span>
                    <div style="flex:1;height:4px;background:var(--bg-primary);border-radius:2px;overflow:hidden">
                        <div style="width:${pct}%;height:100%;background:${color};border-radius:2px;transition:width 0.5s ease"></div>
                    </div>
                    <span class="text-mono" style="width:40px;text-align:right;font-weight:600">${val}%</span>
                </div>
            `;
        });
        html += '</div>';
        return html;
    }
};
