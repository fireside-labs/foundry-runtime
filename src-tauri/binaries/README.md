# Bundled binaries

At v0.1.0 build time, drop the following files into this directory before running `cargo tauri build`:

- `llama-server.exe` — the Foundry-Runtime fork of llama-server (with `--license-key` flag support, NOT `--srht-key`)
- supporting `.dll` files needed at runtime (`ggml-base.dll`, `ggml-cpu-*.dll`, `llama.dll`, `mtmd.dll`, etc.)

Then update `../binaries.json` with the real SHA256, size, and build_tag for each binary listed there.

**Don't commit binaries to git.** The `.gitignore` at the repo root excludes `*.exe` and `*.dll` — they ship via GitHub Releases, not source control. This README exists only to keep the directory tracked.
