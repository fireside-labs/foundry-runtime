# Foundry Runtime v0.1.1

> Patch release. llama.cpp bumped to upstream b9093. Same install, slightly faster, smaller KV-cache footprint.

[**Download `Foundry Runtime_0.1.1_x64_en-US.msi`**](https://github.com/fireside-labs/foundry-runtime/releases/download/v0.1.1/Foundry.Runtime_0.1.1_x64_en-US.msi) — Windows x64, signed.

---

## What changed

- **llama.cpp bumped from b8999 → b9093** ([upstream release](https://github.com/ggml-org/llama.cpp/releases/tag/b9093)). Multi-arch CPU x64 build, same variant as v0.1.0.
- **Q8_KV cache quantization** lands upstream — KV cache memory drops noticeably on long contexts. Most relevant for users running 8k+ context windows on tight RAM.
- **General CPU-side improvements** rolled forward from ~94 upstream builds. No measured regression vs b8999 on a 7B-Q4 baseline.
- **Updated `binaries.json` fingerprints** — all 22 bundled binaries (`llama-server.exe`, `ggml-cpu-*.dll` variants for Alderlake / Sapphire Rapids / Zen 4 / Skylake-X / etc., `llama.dll`, `ggml.dll`, `mtmd.dll`, `llama-common.dll`, `libomp140`, etc.) re-hashed against the b9093 zip. Runtime SHA-256 verification (fail-closed on mismatch) is unchanged.

## What didn't change

- Feature surface, pricing, OPSEC posture, or Pro license flow. v0.1.1 is binary-update-only.
- The macOS / Linux story: still Windows-only. Mac arm64 is queued for v0.2.0 — same upstream version, plus Metal.
- CUDA / Vulkan GPU paths: still queued for v0.2.0+.

## Install / upgrade

- **New install:** download the MSI, double-click. Verified Publisher: **Jordan Nguyen** (Microsoft Trusted Signing chain).
- **Upgrading from v0.1.0:** install over the top — Tauri NSIS / MSI handles the in-place upgrade. User config in `~/.foundry/` is preserved (models, license, conversations, knowledge bases).
- System requirements unchanged: Windows 10 1809+ or Windows 11 (x64), 8 GB RAM minimum.

## Verification

- MSI signed via Azure Trusted Signing. Chain: `Jordan Nguyen → Microsoft ID Verified CS AOC CA 03 → Microsoft ID Verified Code Signing PCA 2021 → Microsoft Identity Verification Root CA 2020`. Microsoft Public RSA timestamp. (Same chain as v0.1.0; the v0.1.0 release notes incorrectly wrote "EOC" — the actual cert was always AOC.)
- Bundled llama-server fingerprints in [`src-tauri/binaries.json`](https://github.com/fireside-labs/foundry-runtime/blob/main/src-tauri/binaries.json) — all 22 entries tagged `llamacpp-b9093-stock-cpu-x64`.

## What's next

- **v0.2.0** — macOS arm64 (Metal), CUDA / Vulkan on Windows, file-watcher live re-index.
- See [v0.1.0 release notes](https://github.com/fireside-labs/foundry-runtime/releases/tag/v0.1.0) for the full feature breakdown.

---

— Fireside Labs · [cal.com/firesidelabs](https://cal.com/firesidelabs) · [j.nguyen@firesidelabs.ai](mailto:j.nguyen@firesidelabs.ai)
