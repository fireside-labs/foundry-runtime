# Foundry Runtime v0.1.0

> First public release. Local AI inference for the enterprise — signed, OPSEC-clean, ready to install.

[**Download `Foundry Runtime_0.1.0_x64_en-US.msi`**](https://github.com/fireside-labs/foundry-runtime/releases/download/v0.1.0/Foundry.Runtime_0.1.0_x64_en-US.msi) — 20 MB, Windows x64, signed.

---

## What's in the box

A polished Tauri 2 desktop app that runs large language models entirely on your hardware, with workspace UX designed for real work.

### Free tier
- **Chat** with any local GGUF model. OpenAI-compatible API on `localhost:8080`.
- **Curated model catalog** — 15 enterprise-vetted models. Llama, Qwen, Gemma, DeepSeek, Mistral, Phi. Pick, hit download, model lands in `~/.foundry/models/`.
- **GPU/CPU auto-detection** — if you have CUDA Toolkit 12.x installed, GPU mode lights up automatically. Otherwise CPU fallback works on any modern x64 Windows machine (slower, but works).
- **Live status bar** — VRAM, tokens/sec, GPU temp, endpoint URL.
- **Markdown export** — save conversations as `.md`.
- **Single project folder** — link a folder and the AI can read files in it via tool calls (read_file, write_file, edit_file, list_dir, run_script).

### Pro tier ($249/year)
- **Roundtable mode** — multiple models in one conversation with role assignment, `@directives`, smart context windowing. Adversarial panels, code reviews, strategy sessions.
- **5 premium templates** — Strategy Session, Code Audit, Red/Blue Team, Research Panel, Brainstorm.
- **PowerPoint export** — branded `.pptx` from chat output, 5 styled templates.
- **Persistent memory** — five cognitive memory types (core identity, semantic facts, episodic conversations, procedural workflows, audit trail) compound across every session.
- **Knowledge bases** — point at any folder, get a queryable knowledge base with vector search. Multiple KBs supported.
- **Multiple project folders** — switch between projects without re-linking.

[**Book a 20-minute Fireside call →**](https://cal.com/firesidelabs?utm_source=foundry-runtime-v010-release) for a comp'd Pro key.

---

## Install

1. Download `Foundry Runtime_0.1.0_x64_en-US.msi` from the [Releases page](https://github.com/fireside-labs/foundry-runtime/releases/tag/v0.1.0)
2. Double-click to install. Verified Publisher: **Jordan Nguyen** (Microsoft Trusted Signing Public Trust chain — no SmartScreen warning).
3. On first launch, pick a model from the catalog. Foundry downloads it into `~/.foundry/models/` (typical sizes 4–30 GB).
4. Click into a chat. You're running a local LLM on your hardware.

**System requirements:**
- Windows 10 1809+ or Windows 11 (x64)
- 8 GB RAM minimum (16 GB recommended for mid-class models)
- Optional: NVIDIA GPU with CUDA Toolkit 12.x for GPU acceleration (any RTX 2000 series or newer)
- ~200 MB disk for the runtime + model storage as needed

---

## What's verified

- **Signed:** Both `foundry-runtime.exe` and `Foundry Runtime_0.1.0_x64_en-US.msi` are code-signed via Azure Trusted Signing. Cert chain: `Jordan Nguyen → Microsoft ID Verified CS EOC CA 03 → Microsoft ID Verified Code Signing PCA 2021 → Microsoft Identity Verification Root CA 2020`. Timestamped by Microsoft Public RSA Time Stamping Authority.
- **Binary integrity:** The bundled llama-server binaries (from [ggml-org/llama.cpp b8999](https://github.com/ggml-org/llama.cpp/releases/tag/b8999)) are SHA-256 verified at runtime startup against `src-tauri/binaries.json`. Tampered binaries refuse to launch.
- **No telemetry.** Zero outbound network calls except (a) model downloads you explicitly trigger, and (b) optional license validation if you have a Pro key (fails open — runtime works without network).

---

## Architecture

- **Tauri 2 + Rust backend** — single 20 MB MSI, no Electron bloat. WebView2 for the UI.
- **HTML/CSS/JS frontend** — no build step, no minification, no source-map gymnastics. Read source-as-served. Copper & obsidian aesthetic, JetBrains Mono telemetry.
- **Bundled llama-server (b8999, CPU-only build)** — multi-arch CPU support via runtime CPU-feature detection (Alderlake, Sapphire Rapids, Zen 4, Skylake-X, etc.). CUDA + Vulkan paths land in v0.2.0.
- **Local SQLite** for persistent memory + knowledge base chunk storage.
- **OpenAI-compatible API** on `localhost:8080`. Drop-in for any client expecting OpenAI semantics.

See [ARCHITECTURE.md](https://github.com/fireside-labs/foundry-runtime/blob/main/ARCHITECTURE.md) for the full breakdown.

---

## Known limitations

- **CPU-only inference** in this release. CUDA/Vulkan GPU paths queued for v0.2.0 (~2-3 weeks). Inference speed on CPU is functional but slower than GPU; sufficient for the workspace experience, not for high-throughput production.
- **Windows-only.** macOS + Linux builds in v0.2.0+.
- **English UI.** Localization will follow once we know which markets care most.
- **Pro-tier license validation** is online-required on first activation, then cached for 24h. License fails open if Azure is unreachable (per design — IT firewalls don't kill the demo).

---

## What's next

- **v0.1.x patches** as needed based on real-world feedback
- **v0.2.0** — CUDA + Vulkan GPU acceleration, file-watcher live re-indexing, macOS build
- **v0.3.0** — Memory subsystem upgrades (verbatim conversation archive + memory embeddings for cosine recall)
- **Org cert** — currently signed under "Jordan Nguyen" (Individual). Migrating to "Fireside Labs" (Organization, via DBA) once D-U-N-S + Microsoft Org validation lands.

---

## License

The Foundry Runtime launcher (Rust + frontend code in this repo) is dual-licensed under **MIT** and **Apache-2.0** at your option.

The bundled `llama-server.exe` is a build of [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT). Models you download are governed by their own licenses (Llama Community License for Llama-family, Apache for Qwen/Gemma/Mistral, etc.).

NVIDIA CUDA libraries are not redistributed by this project; install [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-toolkit) directly from NVIDIA for GPU acceleration in v0.2.0+.

---

## Contact

- Calibration engagements & Pro keys: [cal.com/firesidelabs](https://cal.com/firesidelabs)
- Bugs & issues: [github.com/fireside-labs/foundry-runtime/issues](https://github.com/fireside-labs/foundry-runtime/issues)
- Email: [j.nguyen@firesidelabs.ai](mailto:j.nguyen@firesidelabs.ai)

— Fireside Labs
