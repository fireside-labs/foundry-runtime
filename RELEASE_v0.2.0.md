# Foundry Runtime v0.2.0

> Apple Silicon lands. Same llama.cpp version as v0.1.1, now with native Metal acceleration on macOS arm64. Windows MSI is rebuilt from the same release branch.

[**Download `Foundry Runtime_0.2.0_aarch64.dmg`**](https://github.com/fireside-labs/foundry-runtime/releases/download/v0.2.0/Foundry.Runtime_0.2.0_aarch64.dmg) — macOS arm64 (Apple Silicon), signed + notarized + stapled.
[**Download `Foundry Runtime_0.2.0_x64_en-US.msi`**](https://github.com/fireside-labs/foundry-runtime/releases/download/v0.2.0/Foundry.Runtime_0.2.0_x64_en-US.msi) — Windows x64, signed.

---

## What changed

- **macOS arm64 build** — Foundry Runtime now runs natively on Apple Silicon (M1/M2/M3/M4). Inference uses Metal via llama.cpp's GPU backend; the embedded shader library (`GGML_METAL_EMBED_LIBRARY=ON`) means no separate `default.metallib` to ship. Tested on M4 Pro / macOS 26.3.
- **Same llama.cpp version (upstream b9093) on both platforms** — Mac and Windows ship the exact same llama.cpp release, just built for their respective target. Inference behavior is identical across platforms; only the acceleration backend differs (Metal on Mac, multi-arch CPU on Windows).
- **Signed + notarized macOS build** — DMG and embedded `.app` are signed with Developer ID Application, notarized through Apple's notary service, and stapled so Gatekeeper acceptance works offline. Verified Publisher: **Jordan Nguyen**.
- **Hardened runtime + minimal entitlements** — `disable-library-validation` (required for Metal kernels loaded via `dlopen`), `network.server` (required for the `127.0.0.1:8080` listener), and `allow-jit=false`. No other entitlements.
- **Multi-platform `binaries.json`** — schema unchanged (flat filename-keyed), now contains both Windows entries (`*.exe`, `*.dll`) and macOS entries (`llama-server`, `libllama.dylib`, etc.). The Rust verifier (`binary_verify.rs`) is platform-agnostic; the caller picks the right filename per platform via `cfg!(target_os)`.

## What didn't change

- Feature surface, pricing, OPSEC posture, or Pro license flow. v0.2.0 is a platform-expansion release.
- Windows users: this is a stock rebuild of v0.1.1 on the v0.2.0 release branch. No Windows-side regressions or feature changes. Same Azure Trusted Signing chain.
- The macOS DMG ships *only* on Apple Silicon (`aarch64-apple-darwin`). Intel Mac (x86_64) is not part of v0.2.0; if there's demand it'll follow in v0.3.x.
- CUDA / Vulkan GPU paths on Windows: still queued, now targeted for v0.3.0.

## Install

### macOS

1. Download `Foundry Runtime_0.2.0_aarch64.dmg` from the [Releases page](https://github.com/fireside-labs/foundry-runtime/releases/tag/v0.2.0).
2. Double-click the DMG → drag **Foundry Runtime** into **Applications**.
3. First launch: macOS verifies the notarization staple. No "unidentified developer" prompt — the app is signed under "Developer ID Application: Jordan Nguyen (8TAV5AV6U6)" and notarized.
4. Pick a model from the catalog. Models land in `~/.foundry/models/`.

**System requirements (macOS):**
- macOS 12.0 (Monterey) or newer
- Apple Silicon (M1 or later). Intel Macs not supported in this release.
- 8 GB RAM minimum (16 GB recommended for mid-class models). Apple Silicon shared memory means VRAM = system RAM — large models work directly without a separate GPU memory budget.
- ~200 MB disk for the runtime + model storage as needed.

### Windows

Same as v0.1.1 — download MSI, double-click, Verified Publisher chain through Microsoft Trusted Signing. System requirements unchanged: Windows 10 1809+ or Windows 11 (x64), 8 GB RAM minimum.

## What's verified

- **macOS signed + notarized + stapled:** DMG, embedded `.app`, `llama-server`, and each `lib*.dylib` are signed with hardened runtime + entitlements. `xcrun stapler validate` and `spctl --assess --type install` both accept. Verified Publisher: **Jordan Nguyen** (`Developer ID Application: Jordan Nguyen (8TAV5AV6U6)`, Apple Worldwide Developer Relations CA chain).
- **Windows signed:** MSI signed via Azure Trusted Signing. Chain: `Jordan Nguyen → Microsoft ID Verified CS AOC CA 03 → Microsoft ID Verified Code Signing PCA 2021 → Microsoft Identity Verification Root CA 2020`. Microsoft Public RSA timestamp. Unchanged from v0.1.1.
- **Binary integrity:** Every bundled binary on both platforms is SHA-256 verified at runtime against [`src-tauri/binaries.json`](https://github.com/fireside-labs/foundry-runtime/blob/main/src-tauri/binaries.json). Build tag `llamacpp-b9093-stock-metal-arm64` for the Mac set, `llamacpp-b9093-stock-cpu-x64` for the Windows set. Tampered binaries refuse to launch.
- **No telemetry.** Zero outbound network calls except (a) model downloads you explicitly trigger, (b) optional license validation if you have a Pro key (fails open).

## Architecture notes (macOS specifics)

- **Metal acceleration:** llama-server uses the Metal backend with `--n-gpu-layers 99` by default — offloading all layers to GPU is correct for unified-memory Apple Silicon. On M-series Macs the GPU shares the same physical RAM as the CPU, so there's no copy cost between layers and no VRAM ceiling distinct from system RAM.
- **Embedded shader library:** `default.metallib` is compiled into `llama-server` at build time (`GGML_METAL_EMBED_LIBRARY=ON`). No external `.metallib` to ship, sign, or get out-of-sync with the binary.
- **Hardened runtime:** Required by Apple for notarization. The entitlements file ships in the repo at [`src-tauri/entitlements.plist`](https://github.com/fireside-labs/foundry-runtime/blob/main/src-tauri/entitlements.plist) — three keys total, three lines each are obvious-on-inspection.
- **No LaunchAgents or LaunchDaemons.** The runtime is a foreground app — quitting it kills `llama-server`. No persistence, no background reactivation, no auto-launch. `launchctl list | grep foundry` returns nothing.

## Known limitations

- **Intel Mac (x86_64) not supported.** Apple Silicon only for v0.2.0. If you need x86_64 macOS, file an issue and we'll gauge demand for v0.3.x.
- **CPU-only on Windows.** CUDA/Vulkan GPU paths still queued for v0.3.0.
- **English UI.** Localization will follow once we know which markets care most.

## What's next

- **v0.3.0** — CUDA + Vulkan GPU acceleration on Windows, file-watcher live re-indexing, memory subsystem upgrades.
- **Org cert migration** — currently signed under "Jordan Nguyen" (Individual) on both platforms. Migrating to "Fireside Labs" (Organization) on both chains once D-U-N-S + Apple Org review + Microsoft Org validation land.

## License

The Foundry Runtime launcher (Rust + frontend code in this repo) is dual-licensed under **MIT** and **Apache-2.0** at your option.

The bundled `llama-server` (Mac and Windows builds) is [llama.cpp](https://github.com/ggml-org/llama.cpp) at upstream tag [`b9093`](https://github.com/ggml-org/llama.cpp/releases/tag/b9093) (MIT). Models you download are governed by their own licenses (Llama Community License, Apache-2.0, etc.).

Apple Metal is a system framework — no Apple libraries are redistributed by this project. macOS 12+ provides Metal natively.

NVIDIA CUDA libraries are not redistributed; install [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-toolkit) directly from NVIDIA for GPU acceleration in v0.3.0+ on Windows.

---

## Contact

- Calibration engagements & Pro keys: [cal.com/firesidelabs](https://cal.com/firesidelabs)
- Bugs & issues: [github.com/fireside-labs/foundry-runtime/issues](https://github.com/fireside-labs/foundry-runtime/issues)
- Email: [j.nguyen@firesidelabs.ai](mailto:j.nguyen@firesidelabs.ai)

— Fireside Labs
