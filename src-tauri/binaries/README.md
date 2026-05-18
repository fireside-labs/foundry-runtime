# Bundled binaries

At release build time, drop the platform-appropriate binaries into this directory before running the release build script.

## Windows (`scripts/build-release.ps1`)

- `llama-server.exe` — stock upstream llama.cpp llama-server
- supporting `.dll` files (`ggml-base.dll`, `ggml-cpu-*.dll`, `llama.dll`, `mtmd.dll`, `libomp140.x86_64.dll`, etc.)

The .ps1 script hashes every `.exe`/`.dll`, writes their SHA256 + size into `../binaries.json`, then runs `cargo tauri build --bundles msi nsis`. Non-Windows entries in the manifest are preserved on rebuild.

## macOS (`scripts/build-release.sh`)

- `llama-server` — stock upstream llama.cpp llama-server (no extension)
- supporting `.dylib` files, named by their SONAME (`libllama.0.dylib`, `libggml.0.dylib`, `libggml-base.0.dylib`, `libggml-cpu.0.dylib`, `libggml-metal.0.dylib`, `libggml-blas.0.dylib`, `libllama-common.0.dylib`, `libmtmd.0.dylib`)

The .sh script rewrites each binary's `LC_RPATH` to `@loader_path` (so dylibs resolve from the binary's own directory at runtime), codesigns each with hardened runtime + the entitlements at `../entitlements.plist`, hashes them into `../binaries.json`, and runs `cargo tauri build --target aarch64-apple-darwin --bundles dmg,app`. Notarization + staple are separate steps.

## Don't commit binaries to git

`.gitignore` at the repo root excludes `*.exe`, `*.dll`, `*.dylib`, and the bare `llama-server` executable. Binaries ship via GitHub Releases, not source control. This README exists only to keep the directory tracked in git.

The compiled binaries are reproducible from upstream — the version is captured by the `build_tag` field in `../binaries.json` (e.g., `llamacpp-b9093-stock-cpu-x64` for Windows, `llamacpp-b9093-stock-metal-arm64` for Mac) and the upstream URL for traceability.
