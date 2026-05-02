// ==========================================================================
// Foundry Enterprise Runtime — Knowledge Base Management
// Pro-tier feature. Manage project knowledge bases (RAG) linked to folders.
// Provides UI for creating, indexing, searching, and deleting knowledge bases.
// ==========================================================================

const Knowledge = {

    knowledgeBases: [],

    async init() {
        await this.refresh();
        this.updateBadge();
    },

    async refresh() {
        if (!window.__TAURI__) return;
        try {
            this.knowledgeBases = await window.__TAURI__.core.invoke('kb_list');
        } catch (e) {
            console.warn('[knowledge] Cannot load KBs:', e);
            this.knowledgeBases = [];
        }
    },

    updateBadge() {
        const badge = document.getElementById('kb-badge');
        if (!badge) return;
        const count = this.knowledgeBases.length;
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    },

    // ============================================================
    // RENDER — main Knowledge Base dashboard
    // ============================================================
    async render() {
        const container = document.getElementById('knowledge-dashboard');
        if (!container) return;

        await this.refresh();
        this.updateBadge();

        const hasKBs = this.knowledgeBases.length > 0;

        container.innerHTML = `
            <div style="max-width:800px;margin:0 auto;padding:var(--space-xl)">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-xl)">
                    <div>
                        <h1 class="installer-headline tracking-tight" style="margin:0;font-size:24px">Knowledge Bases</h1>
                        <p class="installer-subtext" style="margin:4px 0 0 0;font-size:13px">
                            Link project folders to give your models context about your codebase and documents.
                        </p>
                    </div>
                    <button class="btn btn-primary" id="btn-create-kb" style="white-space:nowrap">
                        + New Knowledge Base
                    </button>
                </div>

                ${hasKBs ? this.renderKBList() : this.renderEmptyState()}

                ${hasKBs ? `
                    <div class="card" style="margin-top:var(--space-xl)">
                        <div class="card-title" style="font-size:14px">Search Knowledge</div>
                        <div class="card-subtitle mb-md" style="font-size:12px">Test retrieval across all linked knowledge bases.</div>
                        <div style="display:flex;gap:var(--space-sm)">
                            <input type="text" class="input" id="kb-search-input" placeholder="Search your knowledge bases..."
                                style="flex:1;padding:8px 14px;font-size:13px">
                            <button class="btn btn-secondary" id="btn-kb-search">Search</button>
                        </div>
                        <div id="kb-search-results" style="margin-top:var(--space-md)"></div>
                    </div>
                ` : ''}
            </div>
        `;

        this.attachHandlers();
    },

    renderEmptyState() {
        return `
            <div class="card" style="text-align:center;padding:var(--space-2xl)">
                <div style="font-size:48px;margin-bottom:var(--space-md);opacity:0.3">📚</div>
                <div style="font-size:16px;font-weight:700;margin-bottom:var(--space-sm)">No Knowledge Bases</div>
                <div style="font-size:13px;color:var(--text-secondary);max-width:400px;margin:0 auto;line-height:1.6">
                    Link a project folder to create a knowledge base. Your models will automatically
                    retrieve relevant documents when answering questions about your project.
                </div>
                <div style="margin-top:var(--space-lg);display:flex;gap:var(--space-md);justify-content:center;flex-wrap:wrap">
                    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-tertiary);font-family:var(--font-mono)">
                        <span>📄</span> Markdown, Text, Code
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-tertiary);font-family:var(--font-mono)">
                        <span>📕</span> PDF (basic)
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-tertiary);font-family:var(--font-mono)">
                        <span>🐍</span> 30+ languages
                    </div>
                </div>
            </div>
        `;
    },

    renderKBList() {
        return this.knowledgeBases.map(kb => {
            const statusColor = kb.status === 'ready' ? 'var(--status-success)'
                : kb.status === 'indexing' ? 'var(--status-warning)'
                : 'var(--status-error)';
            const statusIcon = kb.status === 'ready' ? '●' : kb.status === 'indexing' ? '◌' : '✗';

            return `
                <div class="card" style="margin-bottom:var(--space-md);transition:border-color 200ms" data-kb-id="${kb.id}">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-md)">
                        <div style="flex:1;min-width:0">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                                <span style="font-size:14px">📚</span>
                                <span style="font-weight:700;font-size:15px;letter-spacing:-0.02em">${this.escapeHtml(kb.namespace)}</span>
                                <span style="color:${statusColor};font-size:10px;font-family:var(--font-mono)">${statusIcon} ${kb.status}</span>
                            </div>
                            <div style="font-size:12px;font-family:var(--font-mono);color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:8px"
                                 title="${this.escapeHtml(kb.root_path)}">${this.escapeHtml(kb.root_path)}</div>
                            <div style="display:flex;gap:var(--space-lg);font-size:12px;color:var(--text-secondary)">
                                <div>
                                    <span style="font-weight:600;color:var(--text-primary);font-size:16px">${kb.file_count}</span>
                                    <span style="font-family:var(--font-mono);font-size:10px;margin-left:4px">files</span>
                                </div>
                                <div>
                                    <span style="font-weight:600;color:var(--text-primary);font-size:16px">${kb.chunk_count}</span>
                                    <span style="font-family:var(--font-mono);font-size:10px;margin-left:4px">chunks</span>
                                </div>
                                <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);display:flex;align-items:center">
                                    ${new Date(kb.created_at).toLocaleDateString()}
                                </div>
                            </div>
                        </div>
                        <div style="display:flex;gap:6px;flex-shrink:0">
                            <button class="btn btn-secondary btn-sm kb-reindex-btn" data-kb-id="${kb.id}" title="Re-index" style="font-size:11px">
                                ↻ Re-index
                            </button>
                            <button class="btn btn-ghost btn-sm kb-delete-btn" data-kb-id="${kb.id}" title="Delete" style="font-size:14px;color:var(--status-error);padding:4px 8px">
                                ✕
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    // ============================================================
    // EVENT HANDLERS
    // ============================================================
    attachHandlers() {
        document.getElementById('btn-create-kb')?.addEventListener('click', () => this.showCreateDialog());

        document.querySelectorAll('.kb-reindex-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const kbId = btn.dataset.kbId;
                btn.disabled = true;
                btn.textContent = '◌ Indexing...';
                try {
                    const result = await window.__TAURI__.core.invoke('kb_index', { kbId });
                    btn.textContent = `✓ ${result.chunks_created} chunks`;
                    btn.style.color = 'var(--status-success)';
                    setTimeout(() => this.render(), 1500);
                } catch (e) {
                    btn.textContent = '✗ Failed';
                    btn.style.color = 'var(--status-error)';
                    console.error('[knowledge] Re-index failed:', e);
                }
            });
        });

        document.querySelectorAll('.kb-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const kbId = btn.dataset.kbId;
                const kb = this.knowledgeBases.find(k => k.id === kbId);
                if (!confirm(`Delete knowledge base "${kb?.namespace || kbId}"? This removes all indexed chunks.`)) return;
                try {
                    await window.__TAURI__.core.invoke('kb_delete', { kbId });
                    this.render();
                } catch (e) {
                    console.error('[knowledge] Delete failed:', e);
                }
            });
        });

        document.getElementById('btn-kb-search')?.addEventListener('click', () => this.doSearch());
        document.getElementById('kb-search-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.doSearch();
        });
    },

    // ============================================================
    // CREATE DIALOG — folder picker + namespace input
    // ============================================================
    showCreateDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;display:flex;align-items:center;justify-content:center;animation:pageIn 200ms ease';

        overlay.innerHTML = `
            <div class="glass-elevated" style="width:500px;border-radius:var(--radius-2xl);padding:var(--space-lg);display:flex;flex-direction:column;gap:var(--space-lg)">
                <div style="display:flex;align-items:center;justify-content:space-between">
                    <div>
                        <div style="font-size:18px;font-weight:700;letter-spacing:-0.02em">New Knowledge Base</div>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Link a folder to index its contents</div>
                    </div>
                    <button class="btn btn-ghost btn-sm" id="kb-close-dialog" style="font-size:18px;padding:4px 8px">✕</button>
                </div>

                <div>
                    <label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">Namespace</label>
                    <input type="text" class="input" id="kb-namespace-input" placeholder="e.g. my-project, docs, codebase"
                        style="width:100%;padding:10px 14px;font-size:14px">
                    <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px;font-family:var(--font-mono)">
                        Lowercase identifier. Used to scope searches to this knowledge base.
                    </div>
                </div>

                <div>
                    <label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">Folder Path</label>
                    <input type="text" class="input" id="kb-path-input" placeholder="C:\\Users\\you\\project or /home/you/project"
                        style="width:100%;padding:10px 14px;font-size:14px;font-family:var(--font-mono)">
                    <div style="font-size:10px;color:var(--text-tertiary);margin-top:4px;font-family:var(--font-mono)">
                        Absolute path to the project folder. All supported files will be indexed.
                    </div>
                </div>

                <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:12px 14px">
                    <div style="font-size:11px;font-family:var(--font-mono);color:var(--text-tertiary);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Supported formats</div>
                    <div style="display:flex;flex-wrap:wrap;gap:4px">
                        ${['md', 'txt', 'py', 'rs', 'js', 'ts', 'json', 'yaml', 'html', 'css', 'sql', 'java', 'go', 'pdf'].map(ext =>
                            `<span style="font-size:10px;font-family:var(--font-mono);padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.04);border:1px solid var(--border-default);color:var(--text-tertiary)">.${ext}</span>`
                        ).join('')}
                    </div>
                </div>

                <div style="display:flex;gap:var(--space-sm);justify-content:flex-end">
                    <button class="btn btn-secondary" id="kb-cancel-create">Cancel</button>
                    <button class="btn btn-primary" id="kb-confirm-create">Create & Index</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        document.getElementById('kb-close-dialog')?.addEventListener('click', close);
        document.getElementById('kb-cancel-create')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        document.getElementById('kb-confirm-create')?.addEventListener('click', async () => {
            const namespace = document.getElementById('kb-namespace-input')?.value?.trim();
            const rootPath = document.getElementById('kb-path-input')?.value?.trim();

            if (!namespace) { alert('Please enter a namespace.'); return; }
            if (!rootPath) { alert('Please enter a folder path.'); return; }

            const confirmBtn = document.getElementById('kb-confirm-create');
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Creating...';

            try {
                const kb = await window.__TAURI__.core.invoke('kb_create', {
                    namespace, rootPath
                });

                confirmBtn.textContent = 'Indexing...';

                const result = await window.__TAURI__.core.invoke('kb_index', {
                    kbId: kb.id
                });

                close();
                this.render();

                console.log(`[knowledge] Created & indexed: ${result.files_processed} files, ${result.chunks_created} chunks`);
            } catch (e) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Create & Index';
                alert(`Error: ${e}`);
                console.error('[knowledge] Create failed:', e);
            }
        });

        // Auto-focus namespace input
        setTimeout(() => document.getElementById('kb-namespace-input')?.focus(), 100);
    },

    // ============================================================
    // SEARCH — test retrieval from the dashboard
    // ============================================================
    async doSearch() {
        const input = document.getElementById('kb-search-input');
        const container = document.getElementById('kb-search-results');
        if (!input || !container) return;

        const query = input.value.trim();
        if (!query) return;

        container.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;color:var(--text-secondary);font-size:12px;padding:8px 0">
                <div class="spinner" style="width:12px;height:12px;border-width:1.5px"></div>
                <span>Searching...</span>
            </div>
        `;

        try {
            const results = await window.__TAURI__.core.invoke('kb_search', {
                query, namespace: null, limit: 5
            });

            if (results.length === 0) {
                container.innerHTML = `
                    <div style="font-size:12px;color:var(--text-tertiary);padding:8px 0;font-style:italic">
                        No results found for "${this.escapeHtml(query)}"
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div style="font-size:11px;font-family:var(--font-mono);color:var(--text-tertiary);margin-bottom:8px">
                    ${results.length} result${results.length > 1 ? 's' : ''}
                </div>
                ${results.map((r, i) => `
                    <div style="padding:10px 14px;background:rgba(255,255,255,0.02);border:1px solid var(--border-default);border-radius:var(--radius-md);margin-bottom:6px">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                            <span style="font-size:12px;font-weight:600;color:var(--accent);font-family:var(--font-mono)">${this.escapeHtml(r.source_path)}</span>
                            <span style="font-size:10px;color:var(--text-tertiary);font-family:var(--font-mono)">${r.namespace}</span>
                        </div>
                        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;max-height:80px;overflow:hidden;position:relative">
                            ${this.escapeHtml(r.chunk_text.slice(0, 300))}${r.chunk_text.length > 300 ? '...' : ''}
                            <div style="position:absolute;bottom:0;left:0;right:0;height:24px;background:linear-gradient(transparent,var(--bg-primary));pointer-events:none"></div>
                        </div>
                    </div>
                `).join('')}
            `;
        } catch (e) {
            container.innerHTML = `
                <div style="font-size:12px;color:var(--status-error);padding:8px 0">
                    Search failed: ${this.escapeHtml(e.toString())}
                </div>
            `;
        }
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
