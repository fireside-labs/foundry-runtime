// ==========================================================================
// Foundry Enterprise Runtime — Tool System
// PowerPoint generation with professional templates.
// Models already know tool usage — we provide the templates + converter.
// ==========================================================================

const Tools = {

    // ============================================================
    // PRESENTATION TEMPLATES
    // Each template defines colors, fonts, layouts, and styling rules
    // that get applied by pptxgenjs when generating the .pptx file.
    // ============================================================
    presentationTemplates: [
        {
            id: 'copper-obsidian',
            name: 'Copper & Obsidian',
            description: 'Foundry brand — dark theme with warm copper accents',
            preview: '◈',
            theme: {
                bgColor: '0A0A0F',
                titleColor: 'F2EDE8',
                bodyColor: '918476',
                accentColor: 'C87533',
                accentBright: 'FFB366',
                fontFace: 'Inter',
                fontMono: 'Courier New',
                slideMaster: {
                    title: { bgColor: '0A0A0F', titleColor: 'F2EDE8', subtitleColor: '918476' },
                    section: { bgColor: '0F0E0D', titleColor: 'C87533' },
                    content: { bgColor: '0A0A0F', titleColor: 'F2EDE8', bulletColor: '918476' },
                    metrics: { bgColor: '0A0A0F', valueColor: 'C87533', labelColor: '918476' },
                    twoColumn: { bgColor: '0A0A0F', titleColor: 'F2EDE8', dividerColor: '2A2520' },
                    closing: { bgColor: '0A0A0F', titleColor: 'C87533', subtitleColor: '918476' },
                }
            }
        },
        {
            id: 'clinical-white',
            name: 'Clinical White',
            description: 'Clean, minimal — medical/legal/regulated industries',
            preview: '○',
            theme: {
                bgColor: 'FFFFFF',
                titleColor: '1A1A1A',
                bodyColor: '4A4A4A',
                accentColor: '0066CC',
                accentBright: '3399FF',
                fontFace: 'Inter',
                fontMono: 'Courier New',
                slideMaster: {
                    title: { bgColor: 'FFFFFF', titleColor: '1A1A1A', subtitleColor: '666666' },
                    section: { bgColor: 'F5F5F5', titleColor: '0066CC' },
                    content: { bgColor: 'FFFFFF', titleColor: '1A1A1A', bulletColor: '4A4A4A' },
                    metrics: { bgColor: 'FFFFFF', valueColor: '0066CC', labelColor: '888888' },
                    twoColumn: { bgColor: 'FFFFFF', titleColor: '1A1A1A', dividerColor: 'E0E0E0' },
                    closing: { bgColor: 'FFFFFF', titleColor: '0066CC', subtitleColor: '666666' },
                }
            }
        },
        {
            id: 'midnight-indigo',
            name: 'Midnight Indigo',
            description: 'Deep blue-black — tech/SaaS/venture',
            preview: '◆',
            theme: {
                bgColor: '0C0E1A',
                titleColor: 'EEEEF5',
                bodyColor: '8888A0',
                accentColor: '818CF8',
                accentBright: 'A5B4FC',
                fontFace: 'Inter',
                fontMono: 'Courier New',
                slideMaster: {
                    title: { bgColor: '0C0E1A', titleColor: 'EEEEF5', subtitleColor: '8888A0' },
                    section: { bgColor: '10122A', titleColor: '818CF8' },
                    content: { bgColor: '0C0E1A', titleColor: 'EEEEF5', bulletColor: '8888A0' },
                    metrics: { bgColor: '0C0E1A', valueColor: '818CF8', labelColor: '8888A0' },
                    twoColumn: { bgColor: '0C0E1A', titleColor: 'EEEEF5', dividerColor: '232340' },
                    closing: { bgColor: '0C0E1A', titleColor: '818CF8', subtitleColor: '8888A0' },
                }
            }
        },
        {
            id: 'emerald-dark',
            name: 'Clinical Emerald',
            description: 'Green-on-dark — healthcare/biotech/clinical',
            preview: '◉',
            theme: {
                bgColor: '0A0F0D',
                titleColor: 'E8F2EE',
                bodyColor: '7A9488',
                accentColor: '00C896',
                accentBright: '66FFCC',
                fontFace: 'Inter',
                fontMono: 'Courier New',
                slideMaster: {
                    title: { bgColor: '0A0F0D', titleColor: 'E8F2EE', subtitleColor: '7A9488' },
                    section: { bgColor: '0D1210', titleColor: '00C896' },
                    content: { bgColor: '0A0F0D', titleColor: 'E8F2EE', bulletColor: '7A9488' },
                    metrics: { bgColor: '0A0F0D', valueColor: '00C896', labelColor: '7A9488' },
                    twoColumn: { bgColor: '0A0F0D', titleColor: 'E8F2EE', dividerColor: '1E302A' },
                    closing: { bgColor: '0A0F0D', titleColor: '00C896', subtitleColor: '7A9488' },
                }
            }
        },
        {
            id: 'warm-sand',
            name: 'Warm Sand',
            description: 'Light warm — executive/board presentations',
            preview: '▣',
            theme: {
                bgColor: 'FDF8F0',
                titleColor: '2D2016',
                bodyColor: '6B5B4D',
                accentColor: 'B85C1E',
                accentBright: 'E07830',
                fontFace: 'Inter',
                fontMono: 'Courier New',
                slideMaster: {
                    title: { bgColor: 'FDF8F0', titleColor: '2D2016', subtitleColor: '8B7B6B' },
                    section: { bgColor: 'F5EDE0', titleColor: 'B85C1E' },
                    content: { bgColor: 'FDF8F0', titleColor: '2D2016', bulletColor: '6B5B4D' },
                    metrics: { bgColor: 'FDF8F0', valueColor: 'B85C1E', labelColor: '8B7B6B' },
                    twoColumn: { bgColor: 'FDF8F0', titleColor: '2D2016', dividerColor: 'E0D5C5' },
                    closing: { bgColor: 'FDF8F0', titleColor: 'B85C1E', subtitleColor: '8B7B6B' },
                }
            }
        }
    ],

    selectedTemplate: 'copper-obsidian',

    // ============================================================
    // SYSTEM PROMPT INJECTION
    // This gets appended to the system prompt when the user triggers
    // presentation mode. Tells the model exactly what JSON to output.
    // ============================================================
    getPresentationPrompt() {
        const tmpl = this.presentationTemplates.find(t => t.id === this.selectedTemplate);
        return `
When the user asks you to create a presentation, pitch deck, or slides, output ONLY a JSON code block with the following structure. Do NOT output anything else — just the JSON.

Available slide layouts: "title", "section", "content", "metrics", "twoColumn", "closing"

Format:
\`\`\`slides
{
  "title": "Presentation Title",
  "slides": [
    {
      "layout": "title",
      "title": "Main Title",
      "subtitle": "Subtitle or tagline"
    },
    {
      "layout": "section",
      "title": "Section Header"
    },
    {
      "layout": "content",
      "title": "Slide Title",
      "bullets": ["Point 1", "Point 2", "Point 3"],
      "notes": "Optional speaker notes"
    },
    {
      "layout": "metrics",
      "title": "Key Metrics",
      "metrics": [
        {"value": "$14B", "label": "TAM"},
        {"value": "99.9%", "label": "Accuracy"},
        {"value": "< 60s", "label": "Deploy Time"}
      ]
    },
    {
      "layout": "twoColumn",
      "title": "Comparison",
      "left": {"heading": "Before", "bullets": ["Manual process", "3 day turnaround"]},
      "right": {"heading": "After", "bullets": ["Automated", "60 second turnaround"]}
    },
    {
      "layout": "closing",
      "title": "Thank You",
      "subtitle": "contact@example.com"
    }
  ]
}
\`\`\`

Create 8-15 slides. Be specific with real numbers and concrete talking points. Use the metrics layout for data-heavy slides. The presentation will be styled with the "${tmpl?.name || 'Copper & Obsidian'}" theme.`;
    },

    // ============================================================
    // DOCUMENT PROMPT — tells model how to create downloadable .md files
    // ============================================================
    getDocumentPrompt() {
        return `
When the user asks you to create a document, report, memo, plan, write-up, notes, readme, or any file, output it as a document block. Start with a JSON metadata line, then the full markdown content:

\`\`\`document
{"title": "Document Title", "filename": "document_title.md"}
---
# Document Title

Your full markdown content here. Use proper markdown formatting:
- Headings (#, ##, ###)
- Bold (**text**), italic (*text*)
- Bullet points and numbered lists
- Code blocks with language tags
- Tables
- Blockquotes

## Section Two

More content...
\`\`\`

Rules:
- The first line MUST be valid JSON with "title" and "filename" keys
- The separator --- must appear on its own line after the JSON
- Everything after the --- is the raw markdown content of the file
- Use .md extension for the filename
- Write complete, professional documents — not stubs or outlines
- If the user asks for a specific format (e.g. SOW, SOP, RFC, PRD), follow that format precisely`;
    },

    // ============================================================
    // PPTX GENERATION via pptxgenjs
    // Takes parsed slide JSON + template → generates .pptx download
    // ============================================================
    generatePPTX(slideData, templateId) {
        const tmpl = this.presentationTemplates.find(t => t.id === (templateId || this.selectedTemplate));
        if (!tmpl) { alert('Template not found'); return; }

        const theme = tmpl.theme;
        const sm = theme.slideMaster;

        // @ts-ignore — pptxgenjs loaded via CDN
        const pptx = new PptxGenJS();
        pptx.author = 'Foundry Enterprise Runtime';
        pptx.company = 'Fireside Labs';
        pptx.subject = slideData.title || 'Presentation';
        pptx.title = slideData.title || 'Presentation';
        pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5

        slideData.slides.forEach(s => {
            const slide = pptx.addSlide();
            const layout = sm[s.layout] || sm.content;

            slide.background = { fill: layout.bgColor || theme.bgColor };

            // Accent bar at top
            slide.addShape(pptx.ShapeType.rect, {
                x: 0, y: 0, w: 13.33, h: 0.05,
                fill: { color: theme.accentColor }
            });

            switch (s.layout) {
                case 'title':
                    slide.addText(s.title || '', {
                        x: 1, y: 2.2, w: 11.33, h: 1.5,
                        fontSize: 44, fontFace: theme.fontFace, color: layout.titleColor,
                        bold: true, align: 'center',
                    });
                    if (s.subtitle) {
                        slide.addText(s.subtitle, {
                            x: 1, y: 3.8, w: 11.33, h: 0.8,
                            fontSize: 20, fontFace: theme.fontFace, color: layout.subtitleColor,
                            align: 'center',
                        });
                    }
                    // Bottom accent line
                    slide.addShape(pptx.ShapeType.rect, {
                        x: 5.5, y: 5, w: 2.33, h: 0.04,
                        fill: { color: theme.accentColor }
                    });
                    break;

                case 'section':
                    slide.addText(s.title || '', {
                        x: 1, y: 2.8, w: 11.33, h: 1.2,
                        fontSize: 36, fontFace: theme.fontFace, color: layout.titleColor,
                        bold: true, align: 'center',
                    });
                    break;

                case 'content':
                    slide.addText(s.title || '', {
                        x: 0.8, y: 0.4, w: 11.73, h: 0.7,
                        fontSize: 24, fontFace: theme.fontFace, color: layout.titleColor,
                        bold: true,
                    });
                    if (s.bullets && s.bullets.length) {
                        const textRows = s.bullets.map(b => ({
                            text: b,
                            options: {
                                fontSize: 16, fontFace: theme.fontFace, color: layout.bulletColor,
                                bullet: { type: 'bullet', indent: 20, color: theme.accentColor },
                                paraSpaceAfter: 8,
                            }
                        }));
                        slide.addText(textRows, {
                            x: 0.8, y: 1.4, w: 11.73, h: 5.0,
                            valign: 'top',
                        });
                    }
                    if (s.notes) slide.addNotes(s.notes);
                    break;

                case 'metrics':
                    slide.addText(s.title || 'Key Metrics', {
                        x: 0.8, y: 0.4, w: 11.73, h: 0.7,
                        fontSize: 24, fontFace: theme.fontFace, color: layout.valueColor || theme.accentColor,
                        bold: true,
                    });
                    if (s.metrics && s.metrics.length) {
                        const cols = s.metrics.length;
                        const colWidth = 10.5 / cols;
                        s.metrics.forEach((m, i) => {
                            const x = 1.4 + (i * colWidth);
                            slide.addText(m.value || '', {
                                x, y: 2.5, w: colWidth - 0.4, h: 1.2,
                                fontSize: 40, fontFace: theme.fontMono, color: layout.valueColor || theme.accentColor,
                                bold: true, align: 'center',
                            });
                            slide.addText(m.label || '', {
                                x, y: 3.8, w: colWidth - 0.4, h: 0.5,
                                fontSize: 12, fontFace: theme.fontMono, color: layout.labelColor || theme.bodyColor,
                                align: 'center', charSpacing: 3,
                            });
                        });
                    }
                    break;

                case 'twoColumn':
                    slide.addText(s.title || '', {
                        x: 0.8, y: 0.4, w: 11.73, h: 0.7,
                        fontSize: 24, fontFace: theme.fontFace, color: layout.titleColor,
                        bold: true,
                    });
                    // Divider
                    slide.addShape(pptx.ShapeType.rect, {
                        x: 6.6, y: 1.5, w: 0.02, h: 4.5,
                        fill: { color: layout.dividerColor || '333333' }
                    });
                    // Left
                    if (s.left) {
                        if (s.left.heading) {
                            slide.addText(s.left.heading, {
                                x: 0.8, y: 1.5, w: 5.5, h: 0.5,
                                fontSize: 16, fontFace: theme.fontFace, color: theme.accentColor,
                                bold: true,
                            });
                        }
                        if (s.left.bullets) {
                            const rows = s.left.bullets.map(b => ({
                                text: b,
                                options: {
                                    fontSize: 14, fontFace: theme.fontFace, color: theme.bodyColor,
                                    bullet: { type: 'bullet', color: theme.accentColor },
                                    paraSpaceAfter: 6,
                                }
                            }));
                            slide.addText(rows, { x: 0.8, y: 2.2, w: 5.5, h: 4.0, valign: 'top' });
                        }
                    }
                    // Right
                    if (s.right) {
                        if (s.right.heading) {
                            slide.addText(s.right.heading, {
                                x: 7, y: 1.5, w: 5.5, h: 0.5,
                                fontSize: 16, fontFace: theme.fontFace, color: theme.accentColor,
                                bold: true,
                            });
                        }
                        if (s.right.bullets) {
                            const rows = s.right.bullets.map(b => ({
                                text: b,
                                options: {
                                    fontSize: 14, fontFace: theme.fontFace, color: theme.bodyColor,
                                    bullet: { type: 'bullet', color: theme.accentColor },
                                    paraSpaceAfter: 6,
                                }
                            }));
                            slide.addText(rows, { x: 7, y: 2.2, w: 5.5, h: 4.0, valign: 'top' });
                        }
                    }
                    break;

                case 'closing':
                    slide.addText(s.title || 'Thank You', {
                        x: 1, y: 2.5, w: 11.33, h: 1.2,
                        fontSize: 36, fontFace: theme.fontFace, color: layout.titleColor || theme.accentColor,
                        bold: true, align: 'center',
                    });
                    if (s.subtitle) {
                        slide.addText(s.subtitle, {
                            x: 1, y: 3.8, w: 11.33, h: 0.6,
                            fontSize: 16, fontFace: theme.fontFace, color: layout.subtitleColor || theme.bodyColor,
                            align: 'center',
                        });
                    }
                    break;

                default:
                    // Fallback: treat as content
                    slide.addText(s.title || '', {
                        x: 0.8, y: 0.4, w: 11.73, h: 0.7,
                        fontSize: 24, fontFace: theme.fontFace, color: theme.titleColor, bold: true,
                    });
                    if (s.bullets) {
                        const rows = s.bullets.map(b => ({
                            text: b,
                            options: { fontSize: 16, fontFace: theme.fontFace, color: theme.bodyColor, bullet: true, paraSpaceAfter: 8 }
                        }));
                        slide.addText(rows, { x: 0.8, y: 1.4, w: 11.73, h: 5.0, valign: 'top' });
                    }
            }
        });

        // Generate and download
        const filename = (slideData.title || 'presentation').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        pptx.writeFile({ fileName: `${filename}.pptx` });
    },

    // ============================================================
    // RESPONSE PARSER
    // Detects ```slides JSON blocks in AI responses and offers download.
    // Called by the workspace after each message renders.
    // ============================================================
    processMessage(messageElement) {
        if (!messageElement) return;

        const codeBlocks = messageElement.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            const text = block.textContent.trim();

            // --- Detect ```slides JSON blocks ---
            if (text.includes('"slides"') && text.includes('"layout"')) {
                try {
                    const data = JSON.parse(text);
                    if (data.slides && Array.isArray(data.slides)) {
                        const pre = block.closest('pre');
                        if (!pre) return;

                        const card = document.createElement('div');
                        card.style.cssText = 'margin:8px 0;padding:12px 16px;background:rgba(200,117,51,0.08);border:1px solid rgba(200,117,51,0.2);border-radius:12px;display:flex;flex-direction:column;gap:8px';

                        card.innerHTML = `
                            <div style="display:flex;align-items:center;justify-content:space-between">
                                <div>
                                    <div style="font-weight:700;font-size:14px;color:var(--text-primary)">${this.escapeHtml(data.title || 'Presentation')}</div>
                                    <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono)">${data.slides.length} slides</div>
                                </div>
                                <div style="display:flex;gap:6px;align-items:center">
                                    <select class="select template-select" style="font-size:10px">
                                        ${this.presentationTemplates.map(t =>
                                            `<option value="${t.id}" ${t.id === this.selectedTemplate ? 'selected' : ''}>${t.name}</option>`
                                        ).join('')}
                                    </select>
                                    <button class="btn btn-primary btn-sm download-pptx-btn" style="white-space:nowrap">
                                        ↓ Download .pptx
                                    </button>
                                </div>
                            </div>
                            <div style="display:flex;gap:6px;flex-wrap:wrap">
                                ${data.slides.map(s => `
                                    <span style="font-size:9px;font-family:var(--font-mono);padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.04);border:1px solid var(--border-default);color:var(--text-tertiary)">${s.layout}</span>
                                `).join('')}
                            </div>
                        `;

                        const downloadBtn = card.querySelector('.download-pptx-btn');
                        const templateSelect = card.querySelector('.template-select');

                        downloadBtn.addEventListener('click', () => {
                            const selectedTmpl = templateSelect.value;
                            this.generatePPTX(data, selectedTmpl);
                        });

                        pre.replaceWith(card);
                    }
                } catch (e) {
                    // Not valid JSON, leave as-is
                }
                return;
            }

            // --- Detect ```document blocks (markdown file generation) ---
            if (text.includes('---') && text.startsWith('{')) {
                try {
                    const separatorIdx = text.indexOf('\n---\n');
                    if (separatorIdx === -1) return;

                    const metaLine = text.slice(0, separatorIdx).trim();
                    const markdownBody = text.slice(separatorIdx + 5).trim();
                    const meta = JSON.parse(metaLine);

                    if (!meta.title || !meta.filename) return;
                    if (!meta.filename.endsWith('.md')) return;

                    const pre = block.closest('pre');
                    if (!pre) return;

                    // Count basic stats
                    const wordCount = markdownBody.split(/\s+/).filter(Boolean).length;
                    const headingCount = (markdownBody.match(/^#{1,6}\s/gm) || []).length;
                    const lineCount = markdownBody.split('\n').length;

                    // Build preview (first ~200 chars of content, skip the title heading)
                    const previewLines = markdownBody.split('\n').filter(l => !l.startsWith('# ')).slice(0, 6);
                    const previewText = previewLines.join('\n').slice(0, 200);

                    const card = document.createElement('div');
                    card.style.cssText = 'margin:8px 0;padding:16px;background:rgba(200,117,51,0.06);border:1px solid rgba(200,117,51,0.15);border-radius:12px;display:flex;flex-direction:column;gap:10px';

                    card.innerHTML = `
                        <div style="display:flex;align-items:center;justify-content:space-between">
                            <div style="display:flex;align-items:center;gap:10px">
                                <div style="width:36px;height:36px;border-radius:8px;background:rgba(200,117,51,0.12);border:1px solid rgba(200,117,51,0.2);display:flex;align-items:center;justify-content:center;font-size:18px">📄</div>
                                <div>
                                    <div style="font-weight:700;font-size:14px;color:var(--text-primary);letter-spacing:-0.02em">${this.escapeHtml(meta.title)}</div>
                                    <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);display:flex;gap:12px;margin-top:2px">
                                        <span>${meta.filename}</span>
                                        <span>${wordCount.toLocaleString()} words</span>
                                        <span>${headingCount} sections</span>
                                        <span>${lineCount} lines</span>
                                    </div>
                                </div>
                            </div>
                            <div style="display:flex;gap:6px;align-items:center">
                                <button class="btn btn-secondary btn-sm copy-md-btn" style="white-space:nowrap;font-size:11px">
                                    📋 Copy
                                </button>
                                <button class="btn btn-primary btn-sm download-md-btn" style="white-space:nowrap">
                                    ↓ Download .md
                                </button>
                            </div>
                        </div>
                        <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text-secondary);line-height:1.6;max-height:120px;overflow:hidden;position:relative;font-family:var(--font-mono)">
                            <div style="white-space:pre-wrap">${this.escapeHtml(previewText)}${previewText.length >= 200 ? '…' : ''}</div>
                            <div style="position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(transparent,rgba(10,10,15,0.9));pointer-events:none"></div>
                        </div>
                    `;

                    // Download handler
                    card.querySelector('.download-md-btn').addEventListener('click', () => {
                        this.downloadMarkdown(markdownBody, meta.filename, meta.title);
                    });

                    // Copy handler
                    card.querySelector('.copy-md-btn').addEventListener('click', (e) => {
                        navigator.clipboard.writeText(markdownBody).then(() => {
                            const btn = e.target.closest('.copy-md-btn');
                            btn.textContent = '✓ Copied';
                            btn.style.color = 'var(--status-success)';
                            setTimeout(() => { btn.textContent = '📋 Copy'; btn.style.color = ''; }, 2000);
                        });
                    });

                    pre.replaceWith(card);
                } catch (e) {
                    // Not valid document block, leave as-is
                }
            }
        });
    },

    // ============================================================
    // MARKDOWN FILE DOWNLOAD
    // Generates a .md file download from content
    // ============================================================
    downloadMarkdown(content, filename, title) {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `${(title || 'document').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // ============================================================
    // SAVE TO DISK (via Tauri)
    // Writes a file directly to the user's filesystem
    // ============================================================
    async saveFileToDisk(content, filename, directory) {
        if (!window.__TAURI__) {
            // Fallback to browser download
            this.downloadMarkdown(content, filename);
            return;
        }
        try {
            const dir = directory || await window.__TAURI__.core.invoke('get_documents_dir');
            const path = `${dir}/${filename}`;
            await window.__TAURI__.core.invoke('write_file', { path, content });
            return path;
        } catch (e) {
            console.error('[tools] saveFileToDisk failed:', e);
            this.downloadMarkdown(content, filename);
        }
    },

    // ============================================================
    // TEMPLATE PICKER UI
    // Shows template cards for the user to preview and select
    // ============================================================
    renderTemplatePicker() {
        return this.presentationTemplates.map(t => {
            const th = t.theme;
            const isSelected = t.id === this.selectedTemplate;
            return `
                <div class="template-pick-card ${isSelected ? 'selected' : ''}" data-template-id="${t.id}"
                     style="padding:12px;border-radius:var(--radius-lg);border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border-default)'};cursor:pointer;transition:all 150ms;background:${isSelected ? 'rgba(200,117,51,0.06)' : 'rgba(255,255,255,0.02)'}">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                        <div style="width:28px;height:18px;border-radius:3px;background:#${th.bgColor};border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center">
                            <div style="width:8px;height:2px;background:#${th.accentColor};border-radius:1px"></div>
                        </div>
                        <span style="font-weight:600;font-size:13px">${t.name}</span>
                    </div>
                    <div style="font-size:11px;color:var(--text-secondary);line-height:1.4">${t.description}</div>
                </div>
            `;
        }).join('');
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
