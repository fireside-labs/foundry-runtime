// ==========================================================================
// Foundry Enterprise Runtime — Tool Call Parser + UI
//
// Detects OpenAI-style tool_calls in model responses, dispatches them to
// Tauri commands (tool_read_file, tool_write_file, etc.), and renders
// expandable result cards inline in the chat stream.
//
// Integration point: workspace.js calls ToolCalls.processResponse() after
// each streaming message completes, similar to Tools.processMessage().
// ==========================================================================

const ToolCalls = {

    // ============================================================
    // TOOL SCHEMAS — injected into system prompt so models know
    // what tools are available and how to call them.
    // ============================================================
    getToolPrompt() {
        return `
You have access to the following tools for working with the user's project files. To use a tool, output a JSON code block tagged with \`tool_call\`:

\`\`\`tool_call
{"name": "list_dir", "arguments": {"rel_path": "."}}
\`\`\`

Available tools:

1. **list_dir** — List files and directories
   Arguments: {"rel_path": "string"} (use "." for project root)

2. **read_file** — Read a file's contents
   Arguments: {"rel_path": "string"}

3. **write_file** — Create or overwrite a file
   Arguments: {"rel_path": "string", "content": "string"}

4. **edit_file** — Edit a file (string replace or line-range replace)
   String replace: {"rel_path": "string", "old": "exact text to find", "new": "replacement text"}
   Line replace: {"rel_path": "string", "start_line": number, "end_line": number, "new": "replacement text"}

5. **run_script** — Execute a script (.py, .ps1, .cmd, .bat, .sh)
   Arguments: {"rel_path": "string", "args": ["optional", "arguments"]}
   Note: This requires explicit user approval before execution.

Rules:
- Output ONE tool_call per code block. You may output multiple blocks for sequential operations.
- After each tool_call block, STOP and wait for the result. The system will provide it.
- Paths are relative to the project folder root. Never use absolute paths.
- Always list_dir first to understand the project structure before editing files.
- For edit_file with string replace, use enough surrounding context in "old" to ensure a unique match.`;
    },

    // ============================================================
    // RESPONSE PARSER
    // Scans a completed message element for ```tool_call blocks,
    // executes them, and replaces the code block with a result card.
    // ============================================================
    async processResponse(messageElement) {
        if (!messageElement || !window.__TAURI__) return;

        const codeBlocks = messageElement.querySelectorAll('pre code');
        for (const block of codeBlocks) {
            const text = block.textContent.trim();

            // Detect tool_call blocks (the model wraps in ```tool_call ... ```)
            // Also detect if the content looks like a tool call JSON
            if (!this.looksLikeToolCall(text)) continue;

            try {
                const call = JSON.parse(text);
                if (!call.name || !call.arguments) continue;

                const pre = block.closest('pre');
                if (!pre) continue;

                // Replace code block with a pending card
                const card = this.createCard(call, 'pending');
                pre.replaceWith(card);

                // Execute the tool call
                await this.executeToolCall(call, card);
            } catch (e) {
                // Not valid JSON or not a tool call — leave as-is
            }
        }
    },

    looksLikeToolCall(text) {
        try {
            const obj = JSON.parse(text);
            return obj && typeof obj.name === 'string' &&
                   typeof obj.arguments === 'object' &&
                   ['list_dir', 'read_file', 'write_file', 'edit_file', 'run_script'].includes(obj.name);
        } catch {
            return false;
        }
    },

    // ============================================================
    // TOOL EXECUTION — dispatches to Tauri commands
    // ============================================================
    async executeToolCall(call, card) {
        const { name, arguments: args } = call;

        try {
            let result;

            switch (name) {
                case 'list_dir':
                    result = await window.__TAURI__.core.invoke('tool_list_dir', {
                        relPath: args.rel_path || '.'
                    });
                    this.updateCard(card, call, 'success', this.formatListDir(result));
                    break;

                case 'read_file':
                    result = await window.__TAURI__.core.invoke('tool_read_file', {
                        relPath: args.rel_path
                    });
                    this.updateCard(card, call, 'success', this.formatFileContent(result, args.rel_path));
                    break;

                case 'write_file':
                    result = await window.__TAURI__.core.invoke('tool_write_file', {
                        relPath: args.rel_path,
                        content: args.content
                    });
                    this.updateCard(card, call, 'success', this.formatWriteResult(result, args.rel_path));
                    break;

                case 'edit_file':
                    result = await window.__TAURI__.core.invoke('tool_edit_file', {
                        relPath: args.rel_path,
                        old: args.old || null,
                        new: args.new || '',
                        startLine: args.start_line || null,
                        endLine: args.end_line || null
                    });
                    this.updateCard(card, call, 'success', this.formatEditResult(result, args.rel_path));
                    break;

                case 'run_script': {
                    // Requires user approval
                    const approved = await this.showApprovalDialog(args.rel_path, args.args);
                    if (!approved) {
                        this.updateCard(card, call, 'denied', 'User denied script execution.');
                        return;
                    }
                    result = await window.__TAURI__.core.invoke('tool_run_script', {
                        relPath: args.rel_path,
                        args: args.args || null
                    });
                    this.updateCard(card, call, result.exit_code === 0 ? 'success' : 'error',
                        this.formatScriptResult(result));
                    break;
                }

                default:
                    this.updateCard(card, call, 'error', `Unknown tool: ${name}`);
            }
        } catch (e) {
            this.updateCard(card, call, 'error', e.toString());
        }
    },

    // ============================================================
    // APPROVAL DIALOG — shown before run_script executes
    // ============================================================
    showApprovalDialog(scriptPath, args) {
        return new Promise((resolve) => {
            const argsStr = args && args.length > 0 ? args.join(' ') : '';
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:300;display:flex;align-items:center;justify-content:center;animation:pageIn 200ms ease';

            overlay.innerHTML = `
                <div class="glass-elevated" style="width:480px;border-radius:var(--radius-2xl);padding:var(--space-xl);display:flex;flex-direction:column;gap:var(--space-lg)">
                    <div style="display:flex;align-items:center;gap:12px">
                        <div style="width:40px;height:40px;border-radius:10px;background:rgba(255,180,60,0.12);border:1px solid rgba(255,180,60,0.3);display:flex;align-items:center;justify-content:center;font-size:20px">⚠</div>
                        <div>
                            <div style="font-size:16px;font-weight:700;letter-spacing:-0.02em">Script Execution Request</div>
                            <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">The model wants to run a script on your system.</div>
                        </div>
                    </div>

                    <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:12px 16px">
                        <div style="font-size:11px;color:var(--text-tertiary);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Command</div>
                        <div style="font-size:14px;font-family:var(--font-mono);color:var(--accent);word-break:break-all">${this.escapeHtml(scriptPath)}${argsStr ? ' ' + this.escapeHtml(argsStr) : ''}</div>
                    </div>

                    <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;background:rgba(255,100,60,0.06);border:1px solid rgba(255,100,60,0.15);border-radius:var(--radius-md);padding:10px 14px">
                        <strong style="color:var(--text-primary)">Warning:</strong> Scripts run with your full user permissions, including filesystem and network access. Only approve if you trust the operation.
                    </div>

                    <div style="display:flex;gap:var(--space-sm);justify-content:flex-end">
                        <button class="btn btn-secondary" id="script-deny">Deny</button>
                        <button class="btn btn-primary" id="script-allow" style="background:var(--accent);border-color:var(--accent)">Allow</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            overlay.querySelector('#script-allow').addEventListener('click', () => {
                overlay.remove();
                resolve(true);
            });

            overlay.querySelector('#script-deny').addEventListener('click', () => {
                overlay.remove();
                resolve(false);
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(false);
                }
            });
        });
    },

    // ============================================================
    // CARD UI — expandable result cards rendered inline in chat
    // ============================================================
    createCard(call, status) {
        const card = document.createElement('div');
        card.className = 'tool-call-card';
        card.dataset.toolName = call.name;
        card.dataset.status = status;

        const icon = this.getToolIcon(call.name);
        const label = this.getToolLabel(call.name);
        const argSummary = this.getArgSummary(call);

        card.style.cssText = 'margin:8px 0;border-radius:10px;border:1px solid var(--border-default);overflow:hidden;font-size:13px;transition:border-color 200ms';

        card.innerHTML = `
            <div class="tool-card-header" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(255,255,255,0.02);cursor:pointer;user-select:none">
                <span style="font-size:14px;flex-shrink:0">${icon}</span>
                <span style="font-weight:600;color:var(--text-primary)">${label}</span>
                <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${this.escapeHtml(argSummary)}</span>
                <div class="tool-status-indicator" style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:var(--status-warning);animation:pulse 1.5s infinite"></div>
                <span class="tool-expand-icon" style="font-size:10px;color:var(--text-tertiary);flex-shrink:0;transition:transform 200ms">▼</span>
            </div>
            <div class="tool-card-body" style="display:none;padding:10px 14px;border-top:1px solid var(--border-default);max-height:300px;overflow-y:auto">
                <div style="display:flex;align-items:center;gap:6px;color:var(--text-secondary);font-size:12px">
                    <div class="spinner" style="width:12px;height:12px;border-width:1.5px"></div>
                    <span>Executing...</span>
                </div>
            </div>
        `;

        // Toggle expand/collapse
        const header = card.querySelector('.tool-card-header');
        header.addEventListener('click', () => {
            const body = card.querySelector('.tool-card-body');
            const arrow = card.querySelector('.tool-expand-icon');
            if (body.style.display === 'none') {
                body.style.display = 'block';
                arrow.style.transform = 'rotate(180deg)';
            } else {
                body.style.display = 'none';
                arrow.style.transform = '';
            }
        });

        return card;
    },

    updateCard(card, call, status, content) {
        card.dataset.status = status;

        const indicator = card.querySelector('.tool-status-indicator');
        if (indicator) {
            indicator.style.animation = 'none';
            switch (status) {
                case 'success':
                    indicator.style.background = 'var(--status-success)';
                    card.style.borderColor = 'rgba(52,211,153,0.2)';
                    break;
                case 'error':
                    indicator.style.background = 'var(--status-error)';
                    card.style.borderColor = 'rgba(255,100,60,0.2)';
                    break;
                case 'denied':
                    indicator.style.background = 'var(--text-tertiary)';
                    card.style.borderColor = 'rgba(255,255,255,0.1)';
                    break;
            }
        }

        const body = card.querySelector('.tool-card-body');
        if (body) {
            body.innerHTML = content;
            // Auto-expand on completion
            body.style.display = 'block';
            const arrow = card.querySelector('.tool-expand-icon');
            if (arrow) arrow.style.transform = 'rotate(180deg)';
        }
    },

    // ============================================================
    // RESULT FORMATTERS — turn raw data into pretty HTML
    // ============================================================
    formatListDir(entries) {
        if (!entries || entries.length === 0) {
            return '<div style="color:var(--text-secondary);font-size:12px;font-style:italic">Empty directory</div>';
        }

        const rows = entries.map(e => {
            const icon = e.entry_type === 'dir' ? '📁' : this.getFileIcon(e.name);
            const size = e.entry_type === 'file' ? this.formatBytes(e.size_bytes) : '';
            return `
                <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">
                    <span style="flex-shrink:0">${icon}</span>
                    <span style="flex:1;font-family:var(--font-mono);color:${e.entry_type === 'dir' ? 'var(--accent)' : 'var(--text-primary)'}">${this.escapeHtml(e.name)}</span>
                    <span style="font-family:var(--font-mono);color:var(--text-tertiary);font-size:10px">${size}</span>
                </div>
            `;
        }).join('');

        return `
            <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:6px;font-family:var(--font-mono)">${entries.length} items</div>
            ${rows}
        `;
    },

    formatFileContent(content, path) {
        const ext = path.split('.').pop() || '';
        const lines = content.split('\n').length;
        const truncated = content.length > 3000;
        const displayContent = truncated ? content.slice(0, 3000) + '\n...\n[truncated]' : content;

        return `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font-size:11px;font-family:var(--font-mono);color:var(--text-tertiary)">${this.escapeHtml(path)} · ${lines} lines · ${this.formatBytes(content.length)}</span>
                <button class="btn btn-ghost btn-sm tool-copy-btn" style="font-size:10px;padding:2px 8px">📋 Copy</button>
            </div>
            <pre style="margin:0;padding:10px;background:rgba(0,0,0,0.3);border-radius:var(--radius-md);font-size:11px;line-height:1.5;overflow-x:auto;max-height:250px"><code class="language-${ext}">${this.escapeHtml(displayContent)}</code></pre>
        `;
    },

    formatWriteResult(result, path) {
        return `
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--status-success)">
                <span>✓</span>
                <span>${this.escapeHtml(result)}</span>
            </div>
        `;
    },

    formatEditResult(result, path) {
        return `
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--status-success)">
                <span>✓</span>
                <span>Edited ${this.escapeHtml(path)}: ${result.replacements} replacement(s), ${this.formatBytes(result.new_length)} total</span>
            </div>
        `;
    },

    formatScriptResult(result) {
        const statusColor = result.exit_code === 0 ? 'var(--status-success)' : 'var(--status-error)';
        const statusIcon = result.exit_code === 0 ? '✓' : '✗';
        const timedOutNote = result.timed_out ? ' <span style="color:var(--status-warning)">(timed out)</span>' : '';

        let html = `
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:8px">
                <span style="color:${statusColor}">${statusIcon}</span>
                <span style="color:${statusColor}">Exit code: ${result.exit_code}</span>
                <span style="color:var(--text-tertiary);font-family:var(--font-mono)">${result.duration_ms}ms${timedOutNote}</span>
            </div>
        `;

        if (result.stdout.trim()) {
            html += `
                <div style="font-size:10px;font-family:var(--font-mono);color:var(--text-tertiary);margin-bottom:4px">stdout:</div>
                <pre style="margin:0 0 8px 0;padding:8px;background:rgba(0,0,0,0.3);border-radius:var(--radius-md);font-size:11px;max-height:200px;overflow:auto"><code>${this.escapeHtml(result.stdout)}</code></pre>
            `;
        }

        if (result.stderr.trim()) {
            html += `
                <div style="font-size:10px;font-family:var(--font-mono);color:var(--status-error);margin-bottom:4px">stderr:</div>
                <pre style="margin:0;padding:8px;background:rgba(255,60,60,0.06);border:1px solid rgba(255,60,60,0.1);border-radius:var(--radius-md);font-size:11px;max-height:150px;overflow:auto"><code style="color:var(--status-error)">${this.escapeHtml(result.stderr)}</code></pre>
            `;
        }

        return html;
    },

    // ============================================================
    // HELPERS
    // ============================================================
    getToolIcon(name) {
        const icons = {
            list_dir: '📂',
            read_file: '📄',
            write_file: '✏️',
            edit_file: '🔧',
            run_script: '▶️',
        };
        return icons[name] || '🔹';
    },

    getToolLabel(name) {
        const labels = {
            list_dir: 'List Directory',
            read_file: 'Read File',
            write_file: 'Write File',
            edit_file: 'Edit File',
            run_script: 'Run Script',
        };
        return labels[name] || name;
    },

    getArgSummary(call) {
        const args = call.arguments;
        switch (call.name) {
            case 'list_dir': return args.rel_path || '.';
            case 'read_file': return args.rel_path;
            case 'write_file': return `${args.rel_path} (${(args.content || '').length} chars)`;
            case 'edit_file': return args.rel_path;
            case 'run_script': return args.rel_path + (args.args ? ' ' + args.args.join(' ') : '');
            default: return JSON.stringify(args).slice(0, 60);
        }
    },

    getFileIcon(name) {
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const map = {
            py: '🐍', js: '📜', ts: '📜', rs: '⚙️', md: '📝',
            json: '📋', toml: '📋', yaml: '📋', yml: '📋',
            html: '🌐', css: '🎨', txt: '📄', csv: '📊',
            pdf: '📕', docx: '📘', pptx: '📙',
            sh: '🖥️', ps1: '🖥️', cmd: '🖥️', bat: '🖥️',
        };
        return map[ext] || '📄';
    },

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
