// Foundry Memory Dashboard — Persistent memory UI with 5 cognitive types.
// Renders into #memory-dashboard, communicates via Tauri IPC.

(function() {
    'use strict';

    const { invoke } = window.__TAURI__.core;
    const { listen } = window.__TAURI__.event;

    let currentTab = 'core';
    let memoryData = { core: '', semantic: [], episodic: [], procedural: [], changelog: [], stats: null };

    // -----------------------------------------------------------------------
    // Init — called when Memory page becomes visible
    // -----------------------------------------------------------------------

    window.initMemoryPage = async function() {
        const container = document.getElementById('memory-dashboard');
        if (!container) return;

        // Pro gate: free-tier users get the upgrade callout, not the dashboard.
        // The sidebar Pro-gate already redirects most clicks to the booking page,
        // but this is defense-in-depth: if the page does load (race condition, license
        // expiry, or direct programmatic navigation), the page itself stays locked.
        if (typeof App !== 'undefined' && !App.hasPro()) {
            container.innerHTML = buildLockedStateHTML();
            return;
        }

        container.innerHTML = buildDashboardHTML();
        attachEvents();
        await refreshAll();
    };

    // Locked-state UI for free-tier users — this is a Pro-conversion surface.
    // Brand: copper accents, obsidian dark, JetBrains Mono labels.
    // Lists what Pro memory unlocks + booking CTA.
    function buildLockedStateHTML() {
        const memoryTypes = [
            { name: 'Core Identity',     desc: 'Always-loaded context. What the AI knows about you on every prompt.' },
            { name: 'Facts & Knowledge', desc: 'Long-term semantic memory. Names, preferences, project details — recalled when relevant.' },
            { name: 'Conversations',     desc: 'Episodic memory of past dialogues. Searchable, summarizable, never lost.' },
            { name: 'Procedures',        desc: 'Learned workflows. The AI captures how you do things and reapplies them.' },
            { name: 'Audit Trail',       desc: 'Every memory change tracked. Tamper-evident, exportable, defensible to compliance.' },
        ];
        const featureRows = memoryTypes.map(m => `
            <div class="mem-pro-feature">
                <div class="mem-pro-feature-name">${m.name}</div>
                <div class="mem-pro-feature-desc">${m.desc}</div>
            </div>
        `).join('');
        return `
            <div class="mem-locked-shell">
                <div class="mem-locked-eyebrow">PRO FEATURE</div>
                <h1 class="mem-locked-title">Persistent Memory.</h1>
                <p class="mem-locked-lede">
                    Your Foundry assistant remembers facts, preferences, conversations, and learned procedures
                    across every session. Five cognitive memory types that compound over time —
                    locally, on your hardware, never sent to the cloud.
                </p>

                <div class="mem-pro-grid">
                    ${featureRows}
                </div>

                <div class="mem-locked-cta">
                    <div class="mem-locked-cta-text">
                        <div class="mem-locked-price">Pro · <span class="text-mono">$249/year</span></div>
                        <div class="mem-locked-sub">
                            Persistent memory + Roundtable mode + premium templates + PowerPoint export.
                            Hardware-bound license. 20-minute intro call to discuss your use case.
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="App.requestProAccess('memory-lockscreen')">
                        Request Pro Key →
                    </button>
                </div>
            </div>
        `;
    }

    // -----------------------------------------------------------------------
    // Dashboard HTML
    // -----------------------------------------------------------------------

    function buildDashboardHTML() {
        return `
        <div class="memory-header">
            <div>
                <h1 class="installer-headline tracking-tight" style="margin:0">Memory</h1>
                <p class="installer-subtext" style="margin:4px 0 0 0">Your AI's persistent knowledge — what it remembers about you.</p>
            </div>
            <div class="memory-header-stats" id="mem-header-stats"></div>
        </div>

        <div class="memory-tabs" id="mem-tabs">
            <button class="mem-tab active" data-tab="core">Core Identity</button>
            <button class="mem-tab" data-tab="semantic">Facts & Knowledge</button>
            <button class="mem-tab" data-tab="episodic">Conversations</button>
            <button class="mem-tab" data-tab="procedural">Procedures</button>
            <button class="mem-tab" data-tab="changelog">Changelog</button>
            <button class="mem-tab" data-tab="helper">Helper Model</button>
        </div>

        <div class="memory-content" id="mem-content"></div>
        `;
    }

    // -----------------------------------------------------------------------
    // Tab content renderers
    // -----------------------------------------------------------------------

    function renderCore() {
        const charCount = memoryData.core.length;
        const charLimit = 2000;
        const pct = Math.round((charCount / charLimit) * 100);
        const barColor = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : 'var(--accent)';

        return `
        <div class="card" style="max-width:720px">
            <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
                <span>Core Memory</span>
                <span class="text-mono" style="font-size:11px;color:var(--text-tertiary)">${charCount} / ${charLimit} chars</span>
            </div>
            <div class="card-subtitle" style="margin-bottom:12px">
                Always loaded in your AI's system prompt. This is what it knows about you at all times.
            </div>
            <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;margin-bottom:16px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px;transition:width 0.3s"></div>
            </div>
            <textarea id="core-editor" class="memory-editor" rows="10" maxlength="${charLimit}"
                placeholder="Your AI doesn't know anything about you yet. Start a conversation and it will learn, or type here to tell it."
            >${escHtml(memoryData.core)}</textarea>
            <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
                <button class="btn btn-ghost btn-sm" id="btn-core-reset">Reset</button>
                <button class="btn btn-primary btn-sm" id="btn-core-save">Save Changes</button>
            </div>
        </div>
        <div class="card mt-md" style="max-width:720px">
            <div class="card-subtitle" style="font-size:11px;color:var(--text-tertiary)">
                💡 Tip: The model updates this automatically during conversations. You can also manually edit to correct mistakes or add context.
            </div>
        </div>`;
    }

    function renderSemantic() {
        const memories = memoryData.semantic;
        let rows = '';

        if (memories.length === 0) {
            rows = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-tertiary)">No memories yet. Start a conversation to build knowledge.</td></tr>';
        } else {
            for (const m of memories) {
                const conf = Math.round(m.confidence * 100);
                const confColor = conf >= 80 ? 'var(--accent)' : conf >= 50 ? '#f59e0b' : '#ef4444';
                const superseded = m.supersedes ? `<span style="font-size:10px;color:var(--text-tertiary);text-decoration:line-through">${escHtml(m.supersedes)}</span>` : '';

                rows += `
                <tr data-key="${escHtml(m.key)}">
                    <td class="text-mono" style="font-size:12px;color:var(--text-secondary);max-width:160px;overflow:hidden;text-overflow:ellipsis">${escHtml(m.key)}</td>
                    <td>
                        <span class="mem-value" contenteditable="false">${escHtml(m.value)}</span>
                        ${superseded}
                    </td>
                    <td><span class="mem-category-badge">${escHtml(m.category)}</span></td>
                    <td style="text-align:center"><span style="color:${confColor};font-weight:600">${conf}%</span></td>
                    <td style="text-align:right">
                        <button class="btn btn-ghost btn-xs mem-edit-btn" title="Edit">✎</button>
                        <button class="btn btn-ghost btn-xs mem-delete-btn" title="Delete" style="color:#ef4444">✕</button>
                    </td>
                </tr>`;
            }
        }

        return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <span class="text-mono" style="font-size:12px;color:var(--text-tertiary)">${memories.length} memories</span>
            <div style="display:flex;gap:8px">
                <input type="text" id="mem-search-input" class="input-field" placeholder="Search memories..." style="width:240px;height:32px;font-size:12px">
                <button class="btn btn-ghost btn-sm" id="btn-mem-add">+ Add Memory</button>
            </div>
        </div>
        <div class="card" style="padding:0;overflow:hidden">
            <table class="memory-table">
                <thead>
                    <tr>
                        <th style="width:160px">Key</th>
                        <th>Value</th>
                        <th style="width:100px">Category</th>
                        <th style="width:60px;text-align:center">Conf.</th>
                        <th style="width:70px"></th>
                    </tr>
                </thead>
                <tbody id="semantic-tbody">${rows}</tbody>
            </table>
        </div>`;
    }

    function renderEpisodic() {
        const episodes = memoryData.episodic;
        if (episodes.length === 0) {
            return '<div class="card" style="text-align:center;padding:48px;color:var(--text-tertiary)">No conversation memories yet. Memories are created after dream cycles.</div>';
        }

        let items = '';
        for (const ep of episodes) {
            const topics = safeParse(ep.topics, []);
            const tags = topics.map(t => `<span class="mem-category-badge">${escHtml(t)}</span>`).join(' ');

            items += `
            <div class="memory-timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <span class="text-mono" style="font-size:11px;color:var(--text-tertiary)">${escHtml(ep.date)}</span>
                        ${ep.emotional_tone ? `<span style="font-size:11px;color:var(--text-tertiary)">${escHtml(ep.emotional_tone)}</span>` : ''}
                    </div>
                    <p style="margin:6px 0 8px;color:var(--text-primary);line-height:1.5">${escHtml(ep.summary)}</p>
                    <div style="display:flex;gap:4px;flex-wrap:wrap">${tags}</div>
                </div>
            </div>`;
        }

        return `
        <div class="text-mono" style="font-size:12px;color:var(--text-tertiary);margin-bottom:16px">${episodes.length} conversations remembered</div>
        <div class="memory-timeline">${items}</div>`;
    }

    function renderProcedural() {
        const procs = memoryData.procedural;
        if (procs.length === 0) {
            return '<div class="card" style="text-align:center;padding:48px;color:var(--text-tertiary)">No procedures learned yet. The AI saves multi-step workflows automatically.</div>';
        }

        let cards = '';
        for (const p of procs) {
            const steps = safeParse(p.steps, []);
            const stepHtml = steps.map((s, i) => `<li style="margin:4px 0;color:var(--text-secondary)">${escHtml(s)}</li>`).join('');

            cards += `
            <div class="card" style="margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <div class="card-title" style="margin:0">${escHtml(p.name)}</div>
                    <span class="text-mono" style="font-size:10px;color:var(--text-tertiary)">used ${p.times_referenced}x</span>
                </div>
                <div class="card-subtitle" style="margin:4px 0 12px">${escHtml(p.description)}</div>
                <ol style="margin:0;padding-left:20px;font-size:13px">${stepHtml}</ol>
            </div>`;
        }

        return cards;
    }

    function renderChangelog() {
        const log = memoryData.changelog;
        if (log.length === 0) {
            return '<div class="card" style="text-align:center;padding:48px;color:var(--text-tertiary)">No changes recorded yet.</div>';
        }

        let rows = '';
        for (const entry of log) {
            const actionColor = { ADD: 'var(--accent)', UPDATE: '#f59e0b', DELETE: '#ef4444', EDIT: '#8b5cf6', CONSOLIDATE: '#06b6d4' }[entry.action] || 'var(--text-tertiary)';

            rows += `
            <tr>
                <td class="text-mono" style="font-size:11px;color:var(--text-tertiary);white-space:nowrap">${escHtml(entry.timestamp.slice(0, 16))}</td>
                <td><span style="color:${actionColor};font-weight:600;font-size:11px">${escHtml(entry.action)}</span></td>
                <td style="font-size:12px">${escHtml(entry.memory_type)}</td>
                <td class="text-mono" style="font-size:11px">${escHtml(entry.memory_key || '')}</td>
                <td style="font-size:12px;color:var(--text-secondary);max-width:300px;overflow:hidden;text-overflow:ellipsis">${escHtml(entry.reason || '')}</td>
            </tr>`;
        }

        return `
        <div class="card" style="padding:0;overflow:hidden">
            <table class="memory-table">
                <thead><tr><th>Time</th><th>Action</th><th>Type</th><th>Key</th><th>Reason</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }

    function renderHelper() {
        return `
        <div class="card" style="max-width:600px">
            <div class="card-title">Helper Model</div>
            <div class="card-subtitle" style="margin-bottom:16px">
                A small model that runs in the background to manage memories. Extracts facts, resolves conflicts, and consolidates knowledge.
            </div>
            <div id="helper-status-display" style="margin-bottom:16px">
                <div style="display:flex;align-items:center;gap:8px">
                    <div class="status-dot offline" id="helper-dot"></div>
                    <span id="helper-status-text" style="color:var(--text-secondary)">Checking...</span>
                </div>
            </div>
            <div style="display:flex;gap:8px">
                <button class="btn btn-primary btn-sm" id="btn-helper-start">Start Helper</button>
                <button class="btn btn-ghost btn-sm" id="btn-helper-stop">Stop</button>
                <button class="btn btn-ghost btn-sm" id="btn-dream-cycle">Run Dream Cycle</button>
            </div>
        </div>
        <div class="card mt-md" style="max-width:600px">
            <div class="card-title" style="font-size:13px">Setup</div>
            <div class="card-subtitle" style="font-size:12px;line-height:1.6">
                Place a small GGUF model in <code style="background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;font-size:11px">~/.foundry/helpers/</code><br>
                Recommended: Qwen2.5-0.5B-Q8, Gemma-3n-E2B-Q4, or any small instruction model.<br>
                The helper runs on CPU by default (zero VRAM impact).
            </div>
        </div>`;
    }

    // -----------------------------------------------------------------------
    // Data loading
    // -----------------------------------------------------------------------

    async function refreshAll() {
        try {
            const [core, semantic, episodic, procedural, changelog, stats] = await Promise.all([
                invoke('mem_core_read').catch(() => ''),
                invoke('mem_get_all_semantic').catch(() => []),
                invoke('mem_get_all_episodic').catch(() => []),
                invoke('mem_get_all_procedural').catch(() => []),
                invoke('mem_changelog', { limit: 100 }).catch(() => []),
                invoke('mem_stats').catch(() => null),
            ]);

            memoryData = { core, semantic, episodic, procedural, changelog, stats };
            renderCurrentTab();
            renderStats();
            updateBadge();
        } catch (e) {
            console.error('[memory] Refresh failed:', e);
        }
    }

    function renderCurrentTab() {
        const content = document.getElementById('mem-content');
        if (!content) return;

        const renderers = { core: renderCore, semantic: renderSemantic, episodic: renderEpisodic, procedural: renderProcedural, changelog: renderChangelog, helper: renderHelper };
        content.innerHTML = (renderers[currentTab] || renderCore)();
        attachTabEvents();
    }

    function renderStats() {
        const el = document.getElementById('mem-header-stats');
        if (!el || !memoryData.stats) return;

        const s = memoryData.stats;
        const total = s.semantic_count + s.episodic_count + s.procedural_count;

        el.innerHTML = `
        <div style="display:flex;gap:24px;align-items:center">
            <div class="mem-stat">
                <span class="mem-stat-value">${total}</span>
                <span class="mem-stat-label">memories</span>
            </div>
            <div class="mem-stat">
                <span class="mem-stat-value">${s.semantic_count}</span>
                <span class="mem-stat-label">facts</span>
            </div>
            <div class="mem-stat">
                <span class="mem-stat-value">${s.episodic_count}</span>
                <span class="mem-stat-label">sessions</span>
            </div>
            <div class="mem-stat">
                <span class="mem-stat-value">${s.procedural_count}</span>
                <span class="mem-stat-label">procedures</span>
            </div>
        </div>`;
    }

    function updateBadge() {
        const badge = document.getElementById('memory-badge');
        if (!badge || !memoryData.stats) return;
        const total = memoryData.stats.semantic_count + memoryData.stats.episodic_count + memoryData.stats.procedural_count;
        if (total > 0) {
            badge.textContent = total;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }

    // -----------------------------------------------------------------------
    // Event handlers
    // -----------------------------------------------------------------------

    function attachEvents() {
        // Tab switching
        document.getElementById('mem-tabs')?.addEventListener('click', (e) => {
            const tab = e.target.closest('[data-tab]');
            if (!tab) return;
            currentTab = tab.dataset.tab;
            document.querySelectorAll('.mem-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderCurrentTab();
        });
    }

    function attachTabEvents() {
        // Core memory save
        document.getElementById('btn-core-save')?.addEventListener('click', async () => {
            const editor = document.getElementById('core-editor');
            if (!editor) return;
            try {
                await invoke('mem_core_set', { content: editor.value });
                memoryData.core = editor.value;
                showToast('Core memory saved');
            } catch (e) { showToast('Error: ' + e, true); }
        });

        document.getElementById('btn-core-reset')?.addEventListener('click', async () => {
            if (!confirm('Reset core memory? This clears everything your AI knows about you.')) return;
            try {
                await invoke('mem_core_set', { content: '' });
                memoryData.core = '';
                renderCurrentTab();
                showToast('Core memory cleared');
            } catch (e) { showToast('Error: ' + e, true); }
        });

        // Semantic memory search
        document.getElementById('mem-search-input')?.addEventListener('input', debounce(async (e) => {
            const q = e.target.value.trim();
            if (q.length < 2) {
                memoryData.semantic = await invoke('mem_get_all_semantic').catch(() => []);
            } else {
                memoryData.semantic = await invoke('mem_search', { query: q, limit: 50 }).catch(() => []);
            }
            document.getElementById('semantic-tbody').innerHTML = renderSemantic().match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1] || '';
        }, 300));

        // Semantic delete buttons
        document.querySelectorAll('.mem-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const row = e.target.closest('tr');
                const key = row?.dataset.key;
                if (!key || !confirm(`Delete memory "${key}"?`)) return;
                try {
                    await invoke('mem_forget', { key });
                    await refreshAll();
                    showToast('Memory deleted');
                } catch (e) { showToast('Error: ' + e, true); }
            });
        });

        // Semantic edit buttons
        document.querySelectorAll('.mem-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const row = e.target.closest('tr');
                const key = row?.dataset.key;
                const valSpan = row?.querySelector('.mem-value');
                if (!valSpan) return;

                if (valSpan.contentEditable === 'true') {
                    // Save
                    const newVal = valSpan.textContent.trim();
                    invoke('mem_edit', { key, newValue: newVal }).then(() => {
                        valSpan.contentEditable = 'false';
                        valSpan.style.outline = '';
                        showToast('Memory updated');
                    }).catch(err => showToast('Error: ' + err, true));
                } else {
                    // Enter edit mode
                    valSpan.contentEditable = 'true';
                    valSpan.style.outline = '1px solid var(--accent)';
                    valSpan.style.borderRadius = '4px';
                    valSpan.style.padding = '2px 4px';
                    valSpan.focus();
                }
            });
        });

        // Add memory button
        document.getElementById('btn-mem-add')?.addEventListener('click', () => {
            const key = prompt('Memory key (e.g., preferences.editor):');
            if (!key) return;
            const value = prompt('Value:');
            if (!value) return;
            const category = prompt('Category (preference/fact/relationship/project/technical):', 'fact');
            invoke('mem_save', { key, value, category: category || 'fact' }).then(() => {
                refreshAll();
                showToast('Memory saved');
            }).catch(e => showToast('Error: ' + e, true));
        });

        // Helper controls
        document.getElementById('btn-helper-start')?.addEventListener('click', async () => {
            try {
                const msg = await invoke('helper_start');
                showToast(msg);
                setTimeout(refreshHelperStatus, 3000);
            } catch (e) { showToast('Error: ' + e, true); }
        });

        document.getElementById('btn-helper-stop')?.addEventListener('click', async () => {
            try {
                await invoke('helper_stop');
                showToast('Helper stopped');
                refreshHelperStatus();
            } catch (e) { showToast('Error: ' + e, true); }
        });

        document.getElementById('btn-dream-cycle')?.addEventListener('click', async () => {
            showToast('Running dream cycle...');
            try {
                const result = await invoke('helper_dream_cycle', { conversationJson: '[]' });
                showToast('Dream cycle complete');
                await refreshAll();
            } catch (e) { showToast('Error: ' + e, true); }
        });

        // Refresh helper status if on helper tab
        if (currentTab === 'helper') refreshHelperStatus();
    }

    async function refreshHelperStatus() {
        try {
            const status = await invoke('helper_status');
            const dot = document.getElementById('helper-dot');
            const text = document.getElementById('helper-status-text');
            if (dot) dot.className = `status-dot ${status.running ? 'online' : 'offline'}`;
            if (text) text.textContent = status.running
                ? `Running — ${status.model} (${status.mode}, port ${status.port})`
                : 'Offline';
        } catch (e) { /* ignore */ }
    }

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------

    function escHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function safeParse(s, fallback) {
        try { return JSON.parse(s); } catch { return fallback; }
    }

    function debounce(fn, ms) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    function showToast(msg, isError) {
        const existing = document.querySelector('.memory-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'memory-toast';
        toast.style.cssText = `
            position:fixed;bottom:60px;right:24px;padding:10px 20px;border-radius:8px;font-size:13px;z-index:9999;
            background:${isError ? 'rgba(239,68,68,0.9)' : 'rgba(16,185,129,0.9)'};color:#fff;
            animation:fadeIn 0.2s ease;box-shadow:0 4px 12px rgba(0,0,0,0.3);
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
})();
