# Architecture

> How Foundry Runtime is built. Useful for security review, contribution, or curiosity.

## High-level shape

```
┌──────────────────────────────────────────────────────────────────────┐
│  User's machine — single process, single user                         │
│                                                                        │
│  ┌────────────────────┐         ┌─────────────────────────────────┐   │
│  │  Tauri WebView     │  IPC    │  Tauri Rust Backend             │   │
│  │  (HTML/CSS/JS)     │ ◄────►  │  (~/.foundry/* + llama-server)  │   │
│  │                    │         │                                  │   │
│  │  • Workspace UI    │         │  • System / GPU detection        │   │
│  │  • Settings        │         │  • Model catalog + downloader    │   │
│  │  • Memory dashboard│         │  • License validation            │   │
│  │  • Tools (PPT etc) │         │  • Persistent memory (sqlite)    │   │
│  └────────────────────┘         │  • llama-server lifecycle        │   │
│                                  └────────────┬─────────────────────┘   │
│                                               │ subprocess              │
│                                               ▼                          │
│                                  ┌─────────────────────────────┐        │
│                                  │  llama-server.exe           │        │
│                                  │  (bundled, SHA-verified)    │        │
│                                  │                             │        │
│                                  │  Listens on localhost:8080  │        │
│                                  │  /v1/completions            │        │
│                                  │  /v1/chat/completions       │        │
│                                  └─────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────┘
```

No outbound network calls except:
1. **Model download** — when you explicitly click "Download" in the catalog. Pulls GGUFs from HuggingFace.
2. **License validation** (Pro tier only, optional) — fails open if blocked. Runtime works without it.

That's it. Chat traffic stays inside `localhost`. There is no analytics endpoint, no usage telemetry, no crash reporting service.

---

## Layout

```
foundry-runtime/
├── README.md
├── ARCHITECTURE.md          ← this file
├── .gitignore
├── frontend/                ← HTML/CSS/JS, no build step, served by Tauri webview
│   ├── index.html
│   ├── css/foundry.css
│   └── js/
│       ├── app.js              router + license loader + Pro gating
│       ├── installer.js        first-run wizard
│       ├── workspace.js        chat UI, conversations, roundtable, dream cycle
│       ├── tools.js            PowerPoint export, theme picker
│       ├── memory.js           memory dashboard (Pro feature)
│       ├── models.js           model catalog UI
│       └── statusbar.js        live VRAM/tok/s/temp telemetry
└── src-tauri/               ← Rust backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/
    ├── icons/
    ├── binaries.json        ← (created at v0.1.0 cut) SHA256 manifest for bundled llama-server
    └── src/
        ├── main.rs             Tauri commands, app entry
        ├── helper.rs           helper-model lifecycle
        └── memory.rs           sqlite schema + CRUD for 5 memory types
```

## Frontend

No build step. The webview loads `frontend/index.html` directly; all CSS and JS are static. This is intentional:

- Anyone reviewing security can read source-as-served — no source-map gymnastics, no minification obscuring intent.
- No npm install during user-side build. The frontend ships as text.
- Hot iteration: edit a JS file, refresh the dev window. (Production users get the bundled snapshot inside the MSI.)

The trade-off: no React, no TypeScript, no module system. Each `<script>` tag in `index.html` populates a global namespace (`App`, `Workspace`, `Models`, `Tools`, `StatusBar`, `Installer`, plus the IIFE-scoped memory module). Communication is via direct global access (`App.hasPro()`, `Workspace.init()`, etc.).

The freemium gating system uses a class-based declarative gate: tag any element `class="pro-feature" data-pro-source="<label>"` and `App.applyProGates()` adds a "PRO" badge + capture-phase click handler that opens the upgrade modal. See `app.js`.

## Backend

Rust + Tauri 2. The full Tauri command surface is defined in `src-tauri/src/main.rs`. Major groupings:

| Group | Commands |
|---|---|
| System | `get_system_info`, `get_hardware_id`, `check_python`, `check_node`, `install_python`, `install_node` |
| License | `validate_license`, `bind_license`, `get_license_status` |
| Inference | `get_inference_metrics`, `get_gpu_metrics` |
| Server | `find_llama_server`, `start_llama_server`, `restart_backend`, `get_backend_status`, `check_server_running`, `test_connection` |
| Models | `download_brain` (GGUF download with progress events) |
| Memory | `mem_init`, `mem_save`, `mem_search`, `mem_build_context`, `mem_save_episodic`, `mem_save_procedural`, `mem_get_all_*`, `mem_stats`, `mem_changelog`, `mem_forget`, `mem_edit` |
| Config | `write_config` |

Persistence:
- `~/.foundry/models/` — downloaded GGUFs.
- `~/.foundry/bin/` — bundled llama-server + supporting DLLs (extracted from MSI on first run).
- `~/.foundry/memory.db` — sqlite database for the 5 cognitive memory types (Pro tier).
- `~/.foundry/license.key` — hardware-bound license key (Pro tier).
- `~/.foundry/config.json` — per-user settings.

Optional fallbacks via env vars:
- `FOUNDRY_BIN_PATH=/path/to/bin/` — alternate llama-server location (useful for shared deployments).
- `FOUNDRY_MODELS_PATH=/path1;/path2` — alternate model search dirs (semicolon-separated on Windows, colon on Unix).

## Binary verification

Bundled `llama-server.exe` is verified against `src-tauri/binaries.json` at every Tauri start.

```json
{
  "version": "0.1.0",
  "binaries": {
    "llama-server.exe": {
      "sha256": "<hex>",
      "size_bytes": 0,
      "platform": "windows-x64",
      "build_tag": "<llama.cpp build identifier>",
      "license": "MIT (llama.cpp upstream)"
    }
  }
}
```

`include_str!` at compile time bakes the manifest into the Rust binary. Runtime computes SHA256 of the bundled file and compares — mismatch → refuse to start with a clear error. Tamper-evident, supply-chain auditable.

The manifest is **public-safe** (no internal codenames, no build-host paths). Fireside Labs maintains a separate internal manifest for our mesh's preflight tooling that is not part of this repo.

## License layer

License keys are 5-segment dash-separated strings: `FDRY-<tier>-<hash1>-<hash2>-<hwid>`. Validation:

1. **Format check** — 5 segments, prefix `FDRY`, recognized tier.
2. **Hardware binding** — last segment is a 16-character truncated SHA256 of `(motherboard_uuid + cpu_id + primary_disk_serial)`. Re-derived at validation time, must match.
3. **Optional remote check** — if reachable, hits the license API to verify the key isn't revoked. Caches result for 24h. Fails open: a network failure leaves the cached state intact.

Hardware-bound means: a license issued for one machine cannot be moved to another. We can re-issue if your hardware genuinely changed (motherboard swap, primary disk replacement) — get in touch.

The license validation function names use `LICENSE_FLAG: &str = "--srht-key"` (see `main.rs:11`) — this is the CLI flag the bundled llama-server fork accepts. The flag name will be renamed to `--license-key` in the next llama-server fork rebuild; the const exists so the source code can update independently of the C++ side.

## Memory subsystem

Pro tier feature. Five cognitive types, all in sqlite:

- **Core memory** — single 2000-char text blob, always loaded into the model's system prompt.
- **Semantic memory** — key/value/category facts. Searchable by keyword.
- **Episodic memory** — conversation summaries. Generated by the "dream cycle" (auto-summarization triggered when a conversation reaches >4 messages and is left).
- **Procedural memory** — named workflows: "When user asks X, do Y, then Z."
- **Audit trail / changelog** — every write logged. Tamper-evident, exportable.

Free tier: `mem_build_context` and `maybeDreamCycle` are skipped — chat works without the memory layer. The Memory dashboard UI shows an upgrade callout instead of the database.

## Why Tauri (and not Electron)?

- **Smaller installers** — Tauri uses the OS's webview (Edge WebView2 on Windows, WKWebView on Mac, WebKitGTK on Linux). MSI is ~5 MB before bundled binaries. Electron MSI for the same UI surface would be ~150 MB.
- **Rust backend** — memory safety + the `tauri-plugin-shell` ecosystem for system integration. Fits the "audit my dependency" positioning.
- **No node_modules in production** — the shipped app has no Node.js runtime, no V8 footprint, no `__dirname` confusion.

The trade-off: Tauri's webview compatibility surface is narrower than Electron's. We test on WebView2 (Windows 10/11) only for v0.1.0. Mac + Linux releases will follow once Windows is stable.
