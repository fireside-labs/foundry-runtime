# Foundry Runtime

> Local AI inference for the enterprise. Hardware-bound. Audit-friendly. Yours.

Foundry Runtime is a Tauri-based desktop application that runs large language models entirely on your hardware — no cloud round-trips, no data leaving your perimeter. Built and maintained by [Fireside Labs](https://firesidelabs.ai).

It is the open, inspectable complement to Fireside Labs' [calibration engagements](https://firesidelabs.ai/calibration): if you want to *feel* what local enterprise AI is like before talking to us about a custom build for your domain, this is the way to do it.

---

## What it is

- **Tauri 2 + Rust** desktop app — a single Windows installer (.msi) that wraps a llama.cpp inference server.
- **Cross-architecture GPU detection** — autoselects the right binary for NVIDIA Blackwell / Ada / Ampere, Apple Silicon, AMD ROCm. CPU fallback works too (slower, but works).
- **Curated model catalog** — 15 enterprise-vetted GGUF models. Llama, Qwen, Gemma, DeepSeek, Mistral, Phi. Pick one, hit download, model lands in `~/.foundry/models/` and the runtime serves it.
- **OpenAI-compatible API** — `/v1/completions` and `/v1/chat/completions` exposed locally on port 8080. Drop-in for any client expecting OpenAI semantics.
- **Auditable source** — every line of the launcher is in this repo. Read it, fork it, approve it like any other dependency before deploying.

## What it isn't

- A multi-tenant SaaS. The runtime serves one user on one machine. Mesh deployments are a Fireside Labs engagement, not a feature of this repo.
- A model trainer. We don't fine-tune from this UI. Calibration on your domain is what Fireside Labs does as a service.
- A drop-in replacement for ChatGPT. The free tier is a real local-inference workspace — if you want a polished consumer experience, it's not that.

---

## Free vs. Pro

| | Free | Pro ($249/yr) |
|---|---|---|
| Chat with any local model | ✓ | ✓ |
| Curated model catalog + download manager | ✓ | ✓ |
| GPU/CPU auto-detection | ✓ | ✓ |
| Live system metrics (VRAM, tok/s, temp) | ✓ | ✓ |
| Markdown export | ✓ | ✓ |
| **Roundtable mode** — multi-model panels with role assignment | — | ✓ |
| **Premium templates** — Strategy, Code Audit, Red/Blue Team, Research, Brainstorm | — | ✓ |
| **PowerPoint export** — branded .pptx generation from chat output | — | ✓ |
| **Persistent memory** — 5 cognitive memory types, cross-session | — | ✓ |
| Hardware-bound license, offline-validated | — | ✓ |

Pro keys are issued on a 20-minute intro call. We comp the key — the call is the qualification. **[Book one →](https://calendly.com/j-nguyen-firesidelabs?utm_source=foundry-runtime-readme)**

---

## Installation

> **v0.1.0 not yet released.** This repo is open for review while we cut the first signed binary. Releases will appear under [`/releases`](../../releases) when ready.

When v0.1.0 ships:

1. Download `Foundry-Runtime-v0.1.0-windows-x64.msi` from the latest release.
2. Run it. The MSI is signed via Microsoft's Trusted Signing — no SmartScreen warnings.
3. On first launch, pick a model from the catalog. Foundry downloads it (~4-30 GB depending on size) into `~/.foundry/models/`.
4. Click into a chat. You're running a local LLM on your hardware.

GPU acceleration requires CUDA Toolkit 12+ (NVIDIA), Metal (Apple Silicon — works out of box), or ROCm 6+ (AMD). CPU-only mode works on any modern x64 Windows machine — slower, but functional.

## Architecture

- `src-tauri/` — Rust backend. Tauri 2 app shell, llama-server lifecycle, license validation, persistent memory (sqlite via rusqlite), inference metrics polling.
- `frontend/` — HTML/CSS/JS workspace. No build step. Served directly by Tauri's webview. Copper & obsidian aesthetic, JetBrains Mono for telemetry.
- `bundled binaries` (not in this repo) — `llama-server.exe` and supporting llama.cpp utilities. Distributed via [GitHub Releases](../../releases). The runtime verifies bundled binaries against `src-tauri/binaries.json` before launch (SHA256, fail-closed on mismatch).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full breakdown.

## Building from source

Requires:
- Rust stable + cargo
- Tauri CLI 2: `cargo install tauri-cli --version "^2"`
- Node.js 20+ (only if you're modifying the frontend during dev)

```bash
git clone https://github.com/fireside-labs/foundry-runtime.git
cd foundry-runtime
cargo tauri dev          # runs the dev shell, hot-reloads the frontend
cargo tauri build        # produces .msi + .exe in src-tauri/target/release/bundle/
```

The build output does **not** include `llama-server.exe`. To run end-to-end locally during dev, drop a `llama-server.exe` (with its DLLs) into `~/.foundry/bin/` or set `FOUNDRY_BIN_PATH=/path/to/dir` before launching.

## Security & supply chain

- **Source code:** every Rust function and JS line is in this public repo. No closed components.
- **Binary verification:** bundled `llama-server.exe` is SHA256-checked against `src-tauri/binaries.json` at every launch. Tampered binaries refuse to start.
- **Code signing:** MSI installer is signed via [Microsoft Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/) — verifiable cert chain back to Microsoft's CA.
- **No telemetry:** zero outbound network calls except (a) the model download you explicitly trigger from the catalog, and (b) the optional license validation if you have a Pro key (fails open — runtime works without network).
- **License storage:** keys live in `~/.foundry/license.key`, hardware-bound to your machine via the device-specific HWID. Keys cannot be transferred without re-issuance.

## License

The Foundry Runtime launcher (Rust + frontend code in this repo) is dual-licensed under **MIT** and **Apache-2.0** at your option.

The bundled `llama-server.exe` is a build of [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT). Models you download are governed by their own licenses (Llama Community License for Llama-family, Apache for Qwen/Gemma/Mistral, etc.) — see each model's license terms in the catalog.

NVIDIA CUDA libraries are not redistributed by this project; install the [CUDA Toolkit](https://developer.nvidia.com/cuda-toolkit) directly from NVIDIA if you want GPU acceleration.

## Contact

- Calibration engagements & Pro keys: [calendly.com/j-nguyen-firesidelabs](https://calendly.com/j-nguyen-firesidelabs)
- Bugs & issues: [GitHub Issues](../../issues)
- Email: [j.nguyen@firesidelabs.ai](mailto:j.nguyen@firesidelabs.ai)

— Fireside Labs
