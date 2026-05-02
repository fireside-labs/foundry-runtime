// ==========================================================================
// Foundry Enterprise Runtime — Multi-Chat Workspace v2
// Features: Solo/Roundtable, Templates, @directives, Export, Role Assignment,
//           Smart Context Windowing.
// ==========================================================================

const MODEL_COLORS = [
    { bg: 'rgba(200,117,51,0.12)', border: 'rgba(200,117,51,0.3)', text: '#C87533', name: 'copper' },
    { bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.3)', text: '#38BDF8', name: 'cyan' },
    { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.3)', text: '#A855F7', name: 'violet' },
    { bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.3)', text: '#34D399', name: 'emerald' },
];

const CTX = {
    RECENT_FULL: 6,
    COMPRESSED_MAX: 14,
    COMPRESS_LEN: 150,
};

// ============================================================
// ROUNDTABLE TEMPLATES — one-click roundtable presets
// Each has models (by ID) + assigned roles + tailored system prompt
// ============================================================
const TEMPLATES = [
    {
        id: 'strategy',
        icon: '◈',
        name: 'Strategy Session',
        description: 'Business planning with three perspectives',
        models: [
            { id: 'qwen-2.5-14b', role: 'Strategist' },
            { id: 'deepseek-r1-14b', role: 'Devil\'s Advocate' },
            { id: 'gemma-3-12b', role: 'Market Analyst' },
        ],
        systemPrompt: 'This is a strategy session. Be specific with market data, risks, and actionable recommendations. No fluff. Challenge assumptions rigorously.'
    },
    {
        id: 'code-review',
        icon: '⬡',
        name: 'Code Audit',
        description: 'Multi-angle code review & security analysis',
        models: [
            { id: 'qwen-2.5-coder-14b', role: 'Code Reviewer' },
            { id: 'deepseek-r1-14b', role: 'Security Auditor' },
            { id: 'phi-4-14b', role: 'Architect' },
        ],
        systemPrompt: 'Review code for correctness, security vulnerabilities, and architectural decisions. Be specific about line numbers and suggest concrete fixes.'
    },
    {
        id: 'red-blue',
        icon: '⚔',
        name: 'Red Team / Blue Team',
        description: 'Adversarial analysis — attack & defend',
        models: [
            { id: 'deepseek-r1-14b', role: 'Red Team' },
            { id: 'qwen-2.5-14b', role: 'Blue Team' },
        ],
        systemPrompt: 'This is an adversarial exercise. Red Team: find every weakness, vulnerability, and failure mode. Blue Team: defend, patch, and counter each attack vector. Be thorough and technical.'
    },
    {
        id: 'research',
        icon: '◉',
        name: 'Research Panel',
        description: 'Deep-dive analysis with fact-checking',
        models: [
            { id: 'qwen3-14b', role: 'Lead Researcher' },
            { id: 'gemma-3-27b', role: 'Fact Checker' },
            { id: 'deepseek-r1-14b', role: 'Critic' },
        ],
        systemPrompt: 'This is a research panel. Be rigorous with citations and evidence. Fact Checker: verify claims made by others. Critic: identify logical gaps and methodological issues.'
    },
    {
        id: 'brainstorm',
        icon: '✦',
        name: 'Brainstorm',
        description: 'Creative ideation — quantity over quality, then refine',
        models: [
            { id: 'qwen-2.5-14b', role: 'Creative Lead' },
            { id: 'llama-3.1-8b', role: 'Wild Card' },
            { id: 'phi-4-14b', role: 'Synthesizer' },
        ],
        systemPrompt: 'Brainstorm mode: Creative Lead generates bold ideas. Wild Card pushes boundaries with unconventional thinking. Synthesizer finds the strongest threads and weaves them into actionable concepts. Aim for volume first, refinement second.'
    },
];

const ROLE_SUGGESTIONS = [
    'Analyst', 'Critic', 'Code Reviewer', 'Security Auditor',
    'Summarizer', 'Devil\'s Advocate', 'Domain Expert', 'Fact Checker',
    'Creative Lead', 'Technical Writer', 'Red Team', 'Blue Team'
];

const Workspace = {
    projects: [],
    activeProject: null,
    activeConversation: null,
    streaming: false,
    defaultModel: 'qwen-2.5-14b',

    init() {
        this.loadProjects();
        this.render();

        // Track last dreamed conversation to avoid double-processing
        this._lastDreamedConvId = null;
    },

    // ============================================================
    // DREAM CYCLE — auto-consolidation when leaving a conversation
    // Extracts facts, episodic summaries, and procedures silently.
    // ============================================================
    async maybeDreamCycle(conv) {
        if (!conv || !conv.messages || conv.messages.length < 4) return;
        if (conv.id === this._lastDreamedConvId) return;
        if (!window.__TAURI__) return;
        // Pro gate: persistent cross-session memory is a Pro feature. Free-tier
        // chat works fine, just doesn't get auto-summarized into the memory DB.
        if (typeof App !== 'undefined' && !App.hasPro()) return;

        this._lastDreamedConvId = conv.id;

        try {
            // Check if helper model is available
            const helperStatus = await window.__TAURI__.core.invoke('helper_status');
            if (!helperStatus || !helperStatus.running) {
                console.log('[dream] Helper model not running, skipping dream cycle');
                return;
            }

            // Build conversation JSON for the helper
            const transcript = conv.messages.map(m => ({
                role: m.role,
                content: m.content.slice(0, 500), // Truncate for efficiency
                model: m.model || null,
            }));

            const convJson = JSON.stringify({
                title: conv.title || 'Untitled',
                messages: transcript,
            });

            console.log('[dream] Starting dream cycle for:', conv.title);
            const result = await window.__TAURI__.core.invoke('helper_dream_cycle', {
                conversationJson: convJson,
            });

            console.log('[dream] Dream cycle complete:', result?.slice(0, 200));
        } catch (e) {
            console.warn('[dream] Dream cycle failed (non-critical):', e);
        }
    },

    loadProjects() {
        const saved = localStorage.getItem('foundry_projects');
        if (saved) {
            this.projects = JSON.parse(saved);
        } else {
            this.projects = [{
                id: this.uid(),
                name: 'Default Project',
                systemPrompt: 'You are a helpful assistant.',
                conversations: [],
                created: Date.now()
            }];
            this.saveProjects();
        }
        this.activeProject = this.projects[0];
    },

    saveProjects() {
        localStorage.setItem('foundry_projects', JSON.stringify(this.projects));
    },

    uid() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    },

    // ===== Model helpers =====
    getModelColor(modelId, conv) {
        if (!conv || !conv.models) return MODEL_COLORS[0];
        const idx = conv.models.findIndex(m => this.getModelId(m) === modelId);
        return MODEL_COLORS[Math.max(0, idx) % MODEL_COLORS.length];
    },

    getModelId(entry) {
        return typeof entry === 'string' ? entry : entry.id;
    },

    getModelRole(entry) {
        return typeof entry === 'object' && entry !== null ? entry.role : null;
    },

    getModelShortName(modelId) {
        if (!modelId) return '?';
        const parts = modelId.split('-');
        const name = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        const size = parts.find(p => p.match(/^\d+b$/i)) || '';
        return `${name} ${size.toUpperCase()}`.trim();
    },

    // Returns all models in a conv as { id, role, shortName, color } objects
    getModelRoster(conv) {
        if (!conv || !conv.models) return [];
        return conv.models.map((entry, i) => ({
            id: this.getModelId(entry),
            role: this.getModelRole(entry),
            shortName: this.getModelShortName(this.getModelId(entry)),
            color: MODEL_COLORS[i % MODEL_COLORS.length],
        }));
    },

    render() {
        this.renderProjectSidebar();
        this.renderChatPanel();
    },

    // ===== SIDEBAR =====
    renderProjectSidebar() {
        const list = document.getElementById('project-list');
        if (!list) return;

        list.innerHTML = '';
        this.projects.forEach(p => {
            const isActive = this.activeProject && this.activeProject.id === p.id;
            const div = document.createElement('div');
            div.className = `sidebar-item ${isActive ? 'active' : ''}`;
            div.innerHTML = `<span class="icon">◆</span><span>${this.escapeHtml(p.name)}</span>`;
            div.addEventListener('click', () => {
                this.activeProject = p;
                this.activeConversation = null;
                this.render();
            });
            list.appendChild(div);

            if (isActive && p.conversations) {
                p.conversations.forEach(c => {
                    const cDiv = document.createElement('div');
                    const isCActive = this.activeConversation && this.activeConversation.id === c.id;
                    const isRT = c.models && c.models.length > 1;
                    cDiv.className = `sidebar-item ${isCActive ? 'active' : ''}`;
                    cDiv.style.paddingLeft = '36px';
                    cDiv.style.fontSize = '12px';
                    cDiv.innerHTML = `
                        <span class="icon" style="font-size:10px">${isRT ? '◎' : '●'}</span>
                        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.escapeHtml(c.title || 'Untitled')}</span>
                        <span style="font-size:9px;color:var(--text-tertiary);font-family:var(--font-mono)">${isRT ? c.models.length + '×' : this.getModelShortName(this.getModelId(c.models?.[0]))}</span>
                    `;
                    cDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Dream cycle: consolidate leaving conversation
                        if (this.activeConversation && this.activeConversation.id !== c.id) {
                            this.maybeDreamCycle(this.activeConversation);
                        }
                        this.activeConversation = c;
                        this.renderChatPanel();
                        this.renderProjectSidebar();
                    });
                    list.appendChild(cDiv);
                });
            }
        });

        document.getElementById('btn-new-project')?.removeEventListener('click', this._nph);
        this._nph = () => {
            const name = prompt('Project name:');
            if (!name) return;
            this.projects.push({
                id: this.uid(), name,
                systemPrompt: 'You are a helpful assistant.',
                conversations: [], created: Date.now()
            });
            this.activeProject = this.projects[this.projects.length - 1];
            this.activeConversation = null;
            this.saveProjects();
            this.render();
        };
        document.getElementById('btn-new-project')?.addEventListener('click', this._nph);
    },

    // ===== CHAT PANEL =====
    renderChatPanel() {
        const page = document.getElementById('page-workspace');
        if (!page) return;

        const conv = this.activeConversation;
        const isRT = conv && conv.models && conv.models.length > 1;
        const roster = this.getModelRoster(conv);

        const rosterHtml = roster.map(m => `
            <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:9999px;background:${m.color.bg};border:1px solid ${m.color.border};font-size:10px;font-family:var(--font-mono);color:${m.color.text}">
                <span style="font-weight:700">${m.shortName.charAt(0)}</span>
                ${m.role ? `<span style="opacity:0.8">${m.role}</span>` : m.shortName}
            </span>
        `).join('');

        // @directive hint: show available targets
        let directiveHint = '';
        if (isRT) {
            const targets = roster.map(m =>
                `<span style="color:${m.color.text};font-weight:600">@${m.role || m.shortName}</span>`
            ).join(' ');
            directiveHint = `
                <div class="mention-hint">
                    <span style="font-size:10px;opacity:0.5">⬡</span>
                    <span>Direct to one: ${targets} · or send to all</span>
                </div>
            `;
        }

        page.innerHTML = `
            <div class="workspace-layout">
                <div class="chat-panel">
                    <div class="chat-header">
                        <div class="chat-header-left">
                            <span class="chat-header-title">${conv ? this.escapeHtml(conv.title || 'New Chat') : (this.activeProject ? this.escapeHtml(this.activeProject.name) : 'Workspace')}</span>
                            ${isRT ? '<span class="badge badge-info" style="font-size:9px">ROUNDTABLE</span>' : ''}
                        </div>
                        <div class="chat-header-actions">
                            ${rosterHtml}
                            ${conv && conv.messages && conv.messages.length > 0
                                ? '<button class="btn btn-ghost btn-sm" id="btn-export" title="Export as Markdown" style="font-size:14px">📄</button>'
                                : ''}
                            <button class="btn btn-sm btn-secondary" id="btn-new-solo">+ Solo</button>
                            <button class="btn btn-sm btn-primary pro-feature" id="btn-new-roundtable" data-pro-source="roundtable" style="font-size:10px">+ Roundtable</button>
                        </div>
                    </div>
                    <div class="chat-messages" id="chat-messages">
                        ${this.renderMessages()}
                    </div>
                    <div class="chat-input-area">
                        ${directiveHint}
                        <div class="chat-input-wrapper">
                            <div class="mention-popup" id="directive-popup"></div>
                            <textarea class="chat-input" id="chat-input"
                                placeholder="${isRT ? 'Ask the roundtable... (or @Role for one model)' : 'Message...'}"
                                rows="1"></textarea>
                            <button class="send-btn" id="btn-send" title="Send">↑</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.attachChatHandlers();
        this.scrollToBottom();
    },

    renderMessages() {
        const conv = this.activeConversation;
        if (!conv || !conv.messages || conv.messages.length === 0) {
            return `
                <div style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:var(--space-lg);padding:var(--space-2xl)">
                    <div style="width:56px;height:56px;border-radius:var(--radius-xl);background:var(--glass-bg);border:1px solid var(--glass-border);display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--accent)">⬡</div>
                    <div style="text-align:center;max-width:420px">
                        <div style="font-size:16px;font-weight:700;margin-bottom:6px;letter-spacing:-0.02em">Start a conversation</div>
                        <div class="text-muted text-sm" style="line-height:1.7">
                            <strong style="color:var(--text-primary)">Solo</strong> — one model, full context.<br>
                            <strong style="color:var(--text-primary)">Roundtable</strong> — assign roles, pick a template, or build your own.<br>
                            Use <strong style="color:var(--accent)">@Role</strong> to direct a question to one specific model.
                        </div>
                    </div>
                </div>
            `;
        }

        const isRT = conv.models && conv.models.length > 1;

        return conv.messages.map(msg => {
            if (msg.role === 'user') {
                const directed = msg.directive ? `<span style="font-size:10px;color:var(--accent);font-family:var(--font-mono);margin-left:8px">→ ${msg.directive}</span>` : '';
                return `
                    <div class="chat-message user">
                        <div class="message-bubble">${this.renderMarkdown(msg.content)}</div>
                        <div style="font-size:10px;color:var(--text-tertiary);margin-top:3px;padding:0 var(--space-sm);font-family:var(--font-mono);text-align:right">
                            ${new Date(msg.timestamp).toLocaleTimeString()}${directed}
                        </div>
                    </div>
                `;
            }

            const color = this.getModelColor(msg.model, conv);
            const shortName = this.getModelShortName(msg.model);
            const entry = (conv.models || []).find(e => this.getModelId(e) === msg.model);
            const role = this.getModelRole(entry);
            const displayName = role ? `${shortName} · ${role}` : shortName;

            return `
                <div class="chat-message assistant">
                    ${isRT ? `
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                            <div style="width:22px;height:22px;border-radius:6px;background:${color.bg};border:1px solid ${color.border};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${color.text}">${shortName.charAt(0)}</div>
                            <span style="font-size:12px;font-weight:600;color:${color.text};font-family:var(--font-mono);letter-spacing:0.3px">${displayName}</span>
                        </div>
                    ` : ''}
                    <div class="message-bubble" ${isRT ? `style="border-left:2px solid ${color.border}"` : ''}>
                        ${this.renderMarkdown(msg.content)}
                    </div>
                    <div style="font-size:10px;color:var(--text-tertiary);margin-top:3px;padding:0 var(--space-sm);font-family:var(--font-mono)">
                        ${new Date(msg.timestamp).toLocaleTimeString()}
                        ${!isRT && msg.model ? ` · ${shortName}` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    // ===== EVENT HANDLERS =====
    attachChatHandlers() {
        const input = document.getElementById('chat-input');
        const btn = document.getElementById('btn-send');

        input?.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 200) + 'px';
            this.checkDirective(input);
        });

        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        btn?.addEventListener('click', () => this.sendMessage());

        document.getElementById('btn-new-solo')?.addEventListener('click', () => this.showNewChatDialog('solo'));
        document.getElementById('btn-new-roundtable')?.addEventListener('click', () => this.showNewChatDialog('roundtable'));
        document.getElementById('btn-export')?.addEventListener('click', () => this.exportConversation());
    },

    // ============================================================
    // @DIRECTIVE SYSTEM
    // Type @Role or @ModelName to direct a message to one model.
    // ============================================================
    checkDirective(input) {
        const text = input.value;
        const cursorPos = input.selectionStart;
        const beforeCursor = text.slice(0, cursorPos);
        const match = beforeCursor.match(/@(\w*)$/);

        const popup = document.getElementById('directive-popup');
        if (!popup) return;

        const conv = this.activeConversation;
        if (!conv || !conv.models || conv.models.length <= 1) {
            popup.classList.remove('visible');
            return;
        }

        if (match) {
            const query = match[1].toLowerCase();
            const roster = this.getModelRoster(conv);
            const items = roster.filter(m => {
                const targets = [m.shortName, m.role, m.id].filter(Boolean).map(t => t.toLowerCase());
                return !query || targets.some(t => t.includes(query));
            });

            if (items.length > 0) {
                popup.innerHTML = items.map(m => `
                    <div class="mention-item" data-directive-id="${m.id}" data-directive-label="${m.role || m.shortName}">
                        <div style="width:18px;height:18px;border-radius:5px;background:${m.color.bg};border:1px solid ${m.color.border};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:${m.color.text}">${m.shortName.charAt(0)}</div>
                        <span style="flex:1;font-weight:500">${m.role || m.shortName}</span>
                        <span style="font-size:10px;color:var(--text-tertiary);font-family:var(--font-mono)">${m.shortName}</span>
                    </div>
                `).join('');
                popup.classList.add('visible');

                popup.querySelectorAll('.mention-item').forEach(el => {
                    el.addEventListener('click', () => {
                        const label = el.dataset.directiveLabel;
                        const before = text.slice(0, cursorPos - match[0].length);
                        const after = text.slice(cursorPos);
                        input.value = before + `@${label} ` + after;
                        popup.classList.remove('visible');
                        input.focus();
                    });
                });
            } else {
                popup.classList.remove('visible');
            }
        } else {
            popup.classList.remove('visible');
        }
    },

    parseDirective(text, conv) {
        // Check if message starts with @Role or @ModelName
        const match = text.match(/^@(\S+)\s+([\s\S]*)/);
        if (!match) return { targetModels: null, cleanText: text, directiveLabel: null };

        const directive = match[1];
        const cleanText = match[2];
        const roster = this.getModelRoster(conv);

        // Match by role or short name (case-insensitive)
        const target = roster.find(m => {
            const candidates = [m.role, m.shortName, m.id].filter(Boolean);
            return candidates.some(c => c.toLowerCase() === directive.toLowerCase());
        });

        if (target) {
            return {
                targetModels: [target.id],
                cleanText,
                directiveLabel: target.role || target.shortName
            };
        }

        return { targetModels: null, cleanText: text, directiveLabel: null };
    },

    // ============================================================
    // NEW CHAT DIALOG — with templates tab + model picker
    // ============================================================
    showNewChatDialog(mode) {
        const registry = typeof Models !== 'undefined' ? Models.getRegistry() : [];
        const isRoundtable = mode === 'roundtable';

        const modelHtml = registry.map(m => `
            <div class="model-pick-row" data-model-id="${m.id}" style="padding:8px 12px;border-radius:var(--radius-md);transition:background 150ms">
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px">
                    <input type="${isRoundtable ? 'checkbox' : 'radio'}" name="model-pick" value="${m.id}"
                        ${!isRoundtable && m.id === this.defaultModel ? 'checked' : ''}
                        style="accent-color:var(--accent);width:16px;height:16px;flex-shrink:0">
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600">${m.name}</div>
                        <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono)">${m.params} · ${m.category}</div>
                    </div>
                    <span style="font-size:11px;color:var(--text-tertiary);font-family:var(--font-mono);flex-shrink:0">${m.recommended_vram}GB</span>
                </label>
                ${isRoundtable ? `
                    <div class="role-assign" style="display:none;margin-top:6px;padding-left:28px">
                        <input type="text" class="input" name="role-${m.id}" placeholder="Assign a role..."
                            style="padding:5px 10px;font-size:12px;background:rgba(255,255,255,0.03)">
                        <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">
                            ${ROLE_SUGGESTIONS.slice(0, 6).map(r => `
                                <button type="button" class="role-chip" data-role="${r}" data-target="role-${m.id}"
                                    style="padding:2px 7px;border-radius:9999px;background:rgba(255,255,255,0.04);border:1px solid var(--border-default);color:var(--text-secondary);font-size:10px;font-family:var(--font-mono);cursor:pointer;transition:all 150ms">${r}</button>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `).join('');

        // Template cards (roundtable only)
        let templateHtml = '';
        if (isRoundtable) {
            templateHtml = `
                <div style="margin-bottom:var(--space-lg)">
                    <div style="font-size:11px;font-family:var(--font-mono);color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:var(--space-sm)">Quick Start Templates</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-sm)">
                        ${TEMPLATES.map(t => `
                            <div class="template-card" data-template-id="${t.id}"
                                 style="padding:12px;border-radius:var(--radius-lg);background:rgba(255,255,255,0.03);border:1px solid var(--border-default);cursor:pointer;transition:all 150ms">
                                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                                    <span style="font-size:16px">${t.icon}</span>
                                    <span style="font-weight:600;font-size:13px">${t.name}</span>
                                </div>
                                <div style="font-size:11px;color:var(--text-secondary);line-height:1.4">${t.description}</div>
                                <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">
                                    ${t.models.map((m, i) => `<span style="font-size:9px;font-family:var(--font-mono);color:${MODEL_COLORS[i % MODEL_COLORS.length].text};background:${MODEL_COLORS[i % MODEL_COLORS.length].bg};padding:1px 6px;border-radius:9999px">${m.role}</span>`).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div style="font-size:11px;font-family:var(--font-mono);color:var(--text-tertiary);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:var(--space-sm)">Or Build Custom</div>
            `;
        }

        const overlay = document.createElement('div');
        overlay.id = 'new-chat-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;display:flex;align-items:center;justify-content:center;animation:pageIn 200ms ease';

        overlay.innerHTML = `
            <div class="glass-elevated" style="width:560px;max-height:88vh;border-radius:var(--radius-2xl);padding:var(--space-lg);display:flex;flex-direction:column;overflow:hidden">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg)">
                    <div>
                        <div style="font-size:18px;font-weight:700;letter-spacing:-0.02em">${isRoundtable ? 'New Roundtable' : 'New Chat'}</div>
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${isRoundtable ? 'Pick a template or build a custom panel' : 'Pick a model'}</div>
                    </div>
                    <button class="btn btn-ghost btn-sm" id="close-dialog" style="font-size:18px;padding:4px 8px">✕</button>
                </div>
                <div style="overflow-y:auto;flex:1;margin-bottom:var(--space-lg)">
                    ${templateHtml}
                    ${modelHtml}
                </div>
                <div style="display:flex;gap:var(--space-sm);justify-content:flex-end">
                    <button class="btn btn-secondary" id="cancel-new-chat">Cancel</button>
                    <button class="btn btn-primary" id="confirm-new-chat">${isRoundtable ? 'Start Roundtable' : 'Start Chat'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // --- Template click handlers ---
        overlay.querySelectorAll('.template-card').forEach(card => {
            card.addEventListener('mouseover', () => { card.style.borderColor = 'var(--accent)'; card.style.background = 'rgba(200,117,51,0.06)'; });
            card.addEventListener('mouseout', () => { card.style.borderColor = 'var(--border-default)'; card.style.background = 'rgba(255,255,255,0.03)'; });
            card.addEventListener('click', () => {
                const templateId = card.dataset.templateId;
                const template = TEMPLATES.find(t => t.id === templateId);
                if (!template) return;

                // Create directly from template
                const modelEntries = template.models.map(m => ({ id: m.id, role: m.role }));
                this.createConversation(template.name, modelEntries, template.systemPrompt);
                overlay.remove();
            });
        });

        // --- Checkbox → show role input ---
        if (isRoundtable) {
            overlay.querySelectorAll('input[name="model-pick"]').forEach(cb => {
                cb.addEventListener('change', () => {
                    const row = cb.closest('.model-pick-row');
                    const roleDiv = row.querySelector('.role-assign');
                    if (roleDiv) {
                        roleDiv.style.display = cb.checked ? 'block' : 'none';
                        row.style.background = cb.checked ? 'rgba(255,255,255,0.03)' : 'transparent';
                    }
                });
            });

            overlay.querySelectorAll('.role-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const targetInput = overlay.querySelector(`input[name="${chip.dataset.target}"]`);
                    if (targetInput) {
                        targetInput.value = chip.dataset.role;
                        chip.style.borderColor = 'var(--accent)';
                        chip.style.color = 'var(--accent)';
                    }
                });
            });
        }

        const close = () => overlay.remove();
        document.getElementById('close-dialog')?.addEventListener('click', close);
        document.getElementById('cancel-new-chat')?.addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        document.getElementById('confirm-new-chat')?.addEventListener('click', () => {
            let modelEntries;
            if (isRoundtable) {
                const checked = [...overlay.querySelectorAll('input[name="model-pick"]:checked')];
                if (checked.length < 2) { alert('Select at least 2 models.'); return; }
                if (checked.length > 4) { alert('Maximum 4 models.'); return; }
                modelEntries = checked.map(cb => {
                    const mId = cb.value;
                    const roleInput = overlay.querySelector(`input[name="role-${mId}"]`);
                    const role = roleInput?.value?.trim() || null;
                    return role ? { id: mId, role } : mId;
                });
            } else {
                const checked = overlay.querySelector('input[name="model-pick"]:checked');
                modelEntries = checked ? [checked.value] : [this.defaultModel];
            }
            this.createConversation(null, modelEntries);
            close();
        });
    },

    createConversation(title, models, systemPrompt) {
        if (!this.activeProject) return;
        const conv = {
            id: this.uid(),
            title: title || (models.length > 1 ? 'Roundtable' : 'New Chat'),
            models,
            messages: [],
            systemPrompt: systemPrompt || null,
            created: Date.now()
        };
        if (!this.activeProject.conversations) this.activeProject.conversations = [];
        this.activeProject.conversations.unshift(conv);
        this.activeConversation = conv;
        this.saveProjects();
        this.render();
    },

    // ============================================================
    // SMART CONTEXT WINDOWING
    // [DROPPED] 20+: replaced by count note
    // [COMPRESSED] 7-20: truncated to ~150 chars
    // [FULL] last 6: verbatim
    // ============================================================
    async buildContextMessages(conv, targetModelId) {
        const isRT = conv.models.length > 1;
        const allHistory = conv.messages.slice(0, -1);
        const total = allHistory.length;
        const messages = [];

        // --- System prompt with identity + role ---
        const entry = conv.models.find(e => this.getModelId(e) === targetModelId);
        const role = this.getModelRole(entry);
        const shortName = this.getModelShortName(targetModelId);
        let sysPrompt = conv.systemPrompt || this.activeProject?.systemPrompt || 'You are a helpful assistant.';

        if (isRT) {
            const others = conv.models
                .filter(e => this.getModelId(e) !== targetModelId)
                .map(e => {
                    const n = this.getModelShortName(this.getModelId(e));
                    const r = this.getModelRole(e);
                    return r ? `${n} (${r})` : n;
                }).join(', ');

            const roleDesc = role
                ? `Your assigned role is: **${role}**. Respond exclusively from this perspective.`
                : 'Provide your unique perspective.';

            sysPrompt = [
                `You are ${shortName}${role ? `, the ${role},` : ''} in a roundtable with ${others}.`,
                roleDesc,
                'You can see what others said. Be direct and concise.',
                'Build on, challenge, or refine — do NOT repeat what was already covered.',
                '', sysPrompt
            ].join('\n');
        }

        // Append tool capabilities (presentation generation, document creation, file operations)
        if (typeof Tools !== 'undefined') {
            sysPrompt += '\n\n' + Tools.getPresentationPrompt();
            sysPrompt += '\n\n' + Tools.getDocumentPrompt();
        }
        if (typeof ToolCalls !== 'undefined') {
            sysPrompt += '\n\n' + await ToolCalls.getToolPrompt();
        }

        messages.push({ role: 'system', content: sysPrompt });

        // --- Inject persistent memory context (Pro tier only) ---
        // Free-tier users get within-session chat history only — no cross-session
        // memory injection. Per freemium spec: persistent memory is the headline
        // Pro feature alongside Roundtable.
        try {
            const memoryGated = typeof App !== 'undefined' && !App.hasPro();
            if (window.__TAURI__ && !memoryGated) {
                const memCtx = await window.__TAURI__.core.invoke('mem_build_context');
                if (memCtx && memCtx.trim().length > 0) {
                    messages.push({ role: 'system', content: memCtx });
                }
            }
        } catch (e) {
            console.warn('[workspace] Memory context unavailable:', e);
        }

        // --- Inject RAG knowledge base context (Pro tier only) ---
        // Searches all linked knowledge bases for content relevant to
        // the user's latest message. Injects top-3 matching chunks.
        try {
            const ragGated = typeof App !== 'undefined' && !App.hasPro();
            if (window.__TAURI__ && !ragGated) {
                const lastUserMsg = conv.messages.filter(m => m.role === 'user').pop();
                if (lastUserMsg && lastUserMsg.content) {
                    const ragResults = await window.__TAURI__.core.invoke('kb_search', {
                        query: lastUserMsg.content.slice(0, 200),
                        namespace: null,
                        limit: 3,
                    });
                    if (ragResults && ragResults.length > 0) {
                        let ragCtx = '[KNOWLEDGE BASE — Relevant project documents]\n';
                        ragResults.forEach(r => {
                            ragCtx += `Source: ${r.source_path} (${r.namespace})\n`;
                            ragCtx += r.chunk_text.slice(0, 500) + '\n\n';
                        });
                        messages.push({ role: 'system', content: ragCtx });
                        console.log(`[workspace] RAG: injected ${ragResults.length} chunks`);
                    }
                }
            }
        } catch (e) {
            console.warn('[workspace] RAG context unavailable:', e);
        }

        // --- Context zones ---
        const ancientCutoff = total - CTX.RECENT_FULL - CTX.COMPRESSED_MAX;
        const compressedCutoff = total - CTX.RECENT_FULL;

        if (ancientCutoff > 0) {
            messages.push({ role: 'system', content: `[${ancientCutoff} earlier messages omitted for context efficiency]` });
        }

        for (let i = Math.max(0, ancientCutoff); i < compressedCutoff && i < total; i++) {
            const m = allHistory[i];
            const truncated = m.content.length > CTX.COMPRESS_LEN
                ? m.content.slice(0, CTX.COMPRESS_LEN) + '…'
                : m.content;
            const label = isRT && m.model && m.role !== 'user' ? `[${this.getModelShortName(m.model)}]: ` : '';
            messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: label + truncated });
        }

        for (let i = Math.max(0, compressedCutoff); i < total; i++) {
            const m = allHistory[i];
            const label = isRT && m.model && m.role !== 'user' ? `[${this.getModelShortName(m.model)}]: ` : '';
            messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: label + m.content });
        }

        return messages;
    },

    // ===== SEND MESSAGE =====
    async sendMessage() {
        const input = document.getElementById('chat-input');
        const text = input?.value?.trim();
        if (!text || this.streaming) return;

        if (!this.activeConversation) {
            this.showNewChatDialog('solo');
            return;
        }

        const conv = this.activeConversation;
        const isRT = conv.models && conv.models.length > 1;

        // Parse @directive
        const { targetModels, cleanText, directiveLabel } = isRT
            ? this.parseDirective(text, conv)
            : { targetModels: null, cleanText: text, directiveLabel: null };

        const userMsg = {
            role: 'user',
            content: cleanText,
            timestamp: Date.now(),
            directive: directiveLabel || null
        };
        conv.messages.push(userMsg);

        if (conv.messages.filter(m => m.role === 'user').length === 1) {
            conv.title = cleanText.slice(0, 50);
            this.renderProjectSidebar();
        }

        input.value = '';
        input.style.height = 'auto';
        document.getElementById('directive-popup')?.classList.remove('visible');
        this.appendMessageToDOM(userMsg);

        this.streaming = true;
        document.getElementById('btn-send').disabled = true;

        if (targetModels) {
            // Directed: only query the specified model(s)
            for (const modelId of targetModels) {
                await this.queryModel(modelId, conv);
            }
        } else if (isRT) {
            // Broadcast to all
            for (const entry of conv.models) {
                await this.queryModel(this.getModelId(entry), conv);
            }
        } else {
            // Solo
            await this.queryModel(this.getModelId(conv.models[0]), conv);
        }

        this.streaming = false;
        document.getElementById('btn-send').disabled = false;
        this.saveProjects();
    },

    async queryModel(modelId, conv) {
        const assistantMsg = { role: 'assistant', content: '', timestamp: Date.now(), model: modelId };
        conv.messages.push(assistantMsg);
        this.appendAssistantMessageToDOM(assistantMsg, conv, true);

        try {
            const messages = await this.buildContextMessages(conv, modelId);
            const isRT = conv.models.length > 1;

            const response = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages,
                    stream: true,
                    temperature: 0.7,
                    max_tokens: isRT ? 1536 : 4096
                })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') continue;
                        try {
                            const json = JSON.parse(data);
                            const token = json.choices?.[0]?.delta?.content;
                            if (token) {
                                assistantMsg.content += token;
                                this.updateStreamingMessage(assistantMsg.content);
                            }
                        } catch (e) { /* skip */ }
                    }
                }
            }
        } catch (e) {
            assistantMsg.content = `*Connection error: ${e.message}*\n\nEnsure Foundry Runtime is running on port 8080.`;
            this.updateStreamingMessage(assistantMsg.content);
        }

        const streamEl = document.getElementById('streaming-message');
        if (streamEl) {
            streamEl.removeAttribute('id');
            // Process for tool outputs (slide JSON → download card)
            if (typeof Tools !== 'undefined') {
                Tools.processMessage(streamEl);
            }
            // Process for agentic tool calls (file ops → expandable cards)
            if (typeof ToolCalls !== 'undefined') {
                ToolCalls.processResponse(streamEl);
            }
        }
    },

    // ============================================================
    // EXPORT — one-click markdown export of conversation
    // ============================================================
    exportConversation() {
        const conv = this.activeConversation;
        if (!conv || !conv.messages || conv.messages.length === 0) return;

        const isRT = conv.models && conv.models.length > 1;
        const roster = this.getModelRoster(conv);
        const date = new Date().toISOString().split('T')[0];

        let md = `# ${conv.title || 'Conversation'}\n`;
        md += `**Date:** ${date}  \n`;
        md += `**Type:** ${isRT ? 'Roundtable' : 'Solo'}  \n`;

        if (isRT) {
            md += `\n## Participants\n\n`;
            roster.forEach(m => {
                md += `- **${m.shortName}**${m.role ? ` — ${m.role}` : ''}\n`;
            });
        } else {
            md += `**Model:** ${roster[0]?.shortName || '—'}  \n`;
        }

        md += `\n---\n\n## Transcript\n\n`;

        conv.messages.forEach(msg => {
            if (msg.role === 'user') {
                const time = new Date(msg.timestamp).toLocaleTimeString();
                md += `### 🗣️ User (${time})\n\n${msg.content}\n\n`;
            } else {
                const shortName = this.getModelShortName(msg.model);
                const entry = (conv.models || []).find(e => this.getModelId(e) === msg.model);
                const role = this.getModelRole(entry);
                const label = role ? `${shortName} — ${role}` : shortName;
                const time = new Date(msg.timestamp).toLocaleTimeString();
                md += `### 🤖 ${label} (${time})\n\n${msg.content}\n\n`;
            }
        });

        md += `---\n*Exported from Foundry Enterprise Runtime*\n`;

        // Download as file
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `foundry_${(conv.title || 'chat').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${date}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // ===== DOM =====
    appendMessageToDOM(msg) {
        const container = document.getElementById('chat-messages');
        const emptyState = container.querySelector('[style*="flex:1"]');
        if (emptyState) container.innerHTML = '';

        const div = document.createElement('div');
        div.className = 'chat-message user';
        const directed = msg.directive ? `<span style="font-size:10px;color:var(--accent);font-family:var(--font-mono);margin-left:8px">→ ${msg.directive}</span>` : '';
        div.innerHTML = `
            <div class="message-bubble">${this.renderMarkdown(msg.content)}</div>
            <div style="font-size:10px;color:var(--text-tertiary);margin-top:3px;padding:0 var(--space-sm);font-family:var(--font-mono);text-align:right">
                ${new Date(msg.timestamp).toLocaleTimeString()}${directed}
            </div>
        `;
        container.appendChild(div);
        this.scrollToBottom();
    },

    appendAssistantMessageToDOM(msg, conv, isStreaming) {
        const container = document.getElementById('chat-messages');
        const isRT = conv.models && conv.models.length > 1;
        const color = this.getModelColor(msg.model, conv);
        const shortName = this.getModelShortName(msg.model);
        const entry = (conv.models || []).find(e => this.getModelId(e) === msg.model);
        const role = this.getModelRole(entry);
        const displayName = role ? `${shortName} · ${role}` : shortName;

        const div = document.createElement('div');
        div.className = 'chat-message assistant';
        if (isStreaming) div.id = 'streaming-message';

        div.innerHTML = `
            ${isRT ? `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <div style="width:22px;height:22px;border-radius:6px;background:${color.bg};border:1px solid ${color.border};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${color.text}">${shortName.charAt(0)}</div>
                    <span style="font-size:12px;font-weight:600;color:${color.text};font-family:var(--font-mono);letter-spacing:0.3px">${displayName}</span>
                    ${isStreaming ? '<div class="spinner" style="width:14px;height:14px;border-width:1.5px;margin-left:auto"></div>' : ''}
                </div>
            ` : ''}
            <div class="message-bubble" ${isRT ? `style="border-left:2px solid ${color.border}"` : ''}>
                ${isStreaming
                    ? '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>'
                    : this.renderMarkdown(msg.content)}
            </div>
            <div style="font-size:10px;color:var(--text-tertiary);margin-top:3px;padding:0 var(--space-sm);font-family:var(--font-mono)">
                ${new Date(msg.timestamp).toLocaleTimeString()}
                ${!isRT && msg.model ? ` · ${shortName}` : ''}
            </div>
        `;
        container.appendChild(div);
        this.scrollToBottom();
    },

    updateStreamingMessage(content) {
        const el = document.getElementById('streaming-message');
        if (!el) return;
        el.querySelector('.message-bubble').innerHTML = this.renderMarkdown(content);
        const spinner = el.querySelector('.spinner');
        if (spinner && content.length > 0) spinner.style.display = 'none';
        this.scrollToBottom();
    },

    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        if (container) container.scrollTop = container.scrollHeight;
    },

    renderMarkdown(text) {
        if (!text) return '';
        let html = this.escapeHtml(text);
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="language-${lang}">${code}</code></pre>`);
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--accent)">$1</a>');
        html = html.replace(/\n/g, '<br>');
        return html;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
