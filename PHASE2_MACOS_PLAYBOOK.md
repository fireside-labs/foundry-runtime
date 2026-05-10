# Phase 2 — macOS arm64 Build Playbook (v0.2.0)

> Internal playbook. Execute on a real Mac M-series (M2 or newer).
> Cross-compile + notarize from Windows is not a workable path; do this Mac-side.

This is a delta-from-current-state plan, capturing what Phase 1 (v0.1.1) does *not* set up. Pair with the founder brief that originated this work for high-level rationale.

## Current state going into Phase 2 (post v0.1.1)

- llama.cpp pinned at upstream **b9093** for Windows. macOS will use the same upstream version (no fork).
- `src-tauri/binaries.json` is single-platform — every entry has `"platform": "windows-x64"`. Schema is flat (binary-name → fields), not platform-keyed.
- `src-tauri/binaries/` is gitignored except for README. Binaries are dropped fresh per release.
- `scripts/build-release.ps1` is Windows-only — assumes `*.exe`/`*.dll`, hard-codes `platform = "windows-x64"`, expects `cargo tauri build --bundles msi nsis`.
- `src-tauri/tauri.conf.json` has `bundle.windows.signCommand` (Azure Trusted Signing) but **no `bundle.macOS` block**. `bundle.targets` is `"all"`.
- No `entitlements.plist` in repo.
- The Rust binary-verification module (`binary_verify.rs`) is platform-agnostic at the file-hash level — should work on Mac without changes, but the hash-lookup keys come from `binaries.json`, so the manifest schema decision matters.

## Schema decision: single vs. split manifest

Two options for accommodating Windows + macOS in the same release:

**Option A — single manifest, platform field per entry.** Add Mac entries (with their actual Mac filenames, e.g. `llama-server`, `libllama.dylib`) alongside Windows entries (`llama-server.exe`, etc.). Verification routes by filename, so collision is impossible. **No Rust loader change required** — the verifier already operates this way (verified during Phase 1).

**Option B — split manifests** (`binaries.windows.json`, `binaries.macos.json`). Cleaner per-platform release cuts but requires picking the right manifest at compile time via `include_str!` macro tricks.

Recommend **Option A** for v0.2.0 — strictly smaller diff, no Rust changes.

## Concrete file changes required

### 1. `src-tauri/tauri.conf.json`

Add a `bundle.macOS` block alongside `bundle.windows`:

```json
"macOS": {
  "minimumSystemVersion": "12.0",
  "entitlements": "entitlements.plist",
  "signingIdentity": "Developer ID Application: <Team Name> (<TEAMID>)",
  "providerShortName": "<TEAMID>"
}
```

`bundle.targets` can stay `"all"` — Tauri will skip platforms it can't bundle on the current host.

### 2. New file: `src-tauri/entitlements.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.cs.allow-jit</key>
    <false/>
</dict>
</plist>
```

- `disable-library-validation` is **required** for embedded Metal kernels loaded at runtime via `dlopen` paths inside llama.cpp.
- `network.server` is required because llama-server listens on `127.0.0.1:8080`. Without this, hardened-runtime kills the listener.
- `allow-jit` is `false` — we don't need it. Tighter is better.

### 3. `src-tauri/binaries.json` schema bump

Add `aarch64-apple-darwin` entries; mark each existing entry as Windows. Approximate Mac binary set (will be confirmed by the build, see step 2.1 of brief — typically 3-5 files):

- `llama-server` (no extension, embedded `default.metallib` via `GGML_METAL_EMBED_LIBRARY=ON`)
- `libllama.dylib`
- `libggml*.dylib` (count depends on cmake config)

**Critical:** if `GGML_METAL_EMBED_LIBRARY=ON` is missed, you'll also need to ship `default.metallib` separately and codesign it. Embed unless there's a reason not to.

### 4. `scripts/build-release.sh` (new)

PowerShell script doesn't translate cleanly. Easiest is a bash sibling that mirrors logic:

```bash
#!/usr/bin/env bash
set -euo pipefail
VERSION="$1"
BUILD_TAG="$2"
PLATFORM="${3:-aarch64-apple-darwin}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$REPO_ROOT/src-tauri/binaries"
MANIFEST="$REPO_ROOT/src-tauri/binaries.json"

# 1. Codesign each sidecar BEFORE Tauri bundles it
for f in "$BIN_DIR"/llama-server "$BIN_DIR"/*.dylib; do
  [ -f "$f" ] || continue
  codesign --force --options runtime --timestamp \
    --entitlements "$REPO_ROOT/src-tauri/entitlements.plist" \
    --sign "Developer ID Application: <NAME> (<TEAMID>)" "$f"
  codesign --verify --strict --verbose=4 "$f"
done

# 2. Hash + update manifest (Python or jq for cross-platform JSON edit)
# 3. cargo tauri build --target aarch64-apple-darwin
# 4. xcrun notarytool submit + staple
```

Write the full script when you sit down at the Mac — don't pre-write it, since binary names and signing-identity exact string need to be discovered there.

### 5. `src-tauri/src/binary_verify.rs`

Confirmed during v0.1.1 work: the verifier uses `verify_binary(path, expected_name)` lookups against a flat `HashMap<String, BinaryEntry>`. The `platform` field is informational only — never used as a filter. So adding Mac entries to the same flat manifest with their actual filenames (`llama-server`, `libllama.dylib`, etc.) works without Rust changes. The caller (`start_llama_server` in `main.rs`) is the side that picks the right name per platform, which it already does via `cfg!(target_os)`-style branching.

**One-line confirmation step on the Mac:** grep `start_llama_server` in `main.rs` and verify there's a `cfg!(target_os = "macos")` (or equivalent) branch that resolves to `llama-server` (no `.exe`). If not, add it.

## Pre-flight on the Mac (one-time setup)

```bash
# Verify Apple Developer ID cert is in keychain
security find-identity -p codesigning -v | grep "Developer ID Application"

# Set up notarytool keychain profile (one-time; replace placeholders)
xcrun notarytool store-credentials AC_NOTARY \
  --apple-id "j.nguyen@firesidelabs.ai" \
  --team-id "<TEAMID>" \
  --password "<app-specific-password-from-appleid.apple.com>"

# Verify it works
xcrun notarytool history --keychain-profile AC_NOTARY
```

## Build sequence on Mac

Follow the founder brief Phase 2 steps 2.1 → 2.8 verbatim. Key gotchas to keep in mind:

1. **`GGML_METAL_EMBED_LIBRARY=ON`** in cmake. Forgetting this is the #1 cause of "metallib not found" runtime errors.
2. **Codesign sidecar BEFORE Tauri bundles it.** Tauri signs the `.app` wrapper, but it doesn't deeply re-sign embedded sidecars. If llama-server isn't pre-signed with hardened runtime + entitlements, notarization will reject the whole `.app`.
3. **Notarization rejection diagnostic:**
   ```bash
   xcrun notarytool log <submission-id> --keychain-profile AC_NOTARY
   ```
   99% of failures: unsigned nested binary, or missing hardened runtime flag on a sidecar.
4. **Stapling matters.** `xcrun stapler staple <dmg>` after notarization succeeds. Without staple, Gatekeeper has to round-trip Apple servers on first run; with staple, fully offline-friendly.
5. **`spctl --assess`** to confirm Gatekeeper accepts the stapled DMG.

## Test pass on a clean Mac (target: never-run-Foundry M-series)

Per founder brief step 2.7. Ad-hoc additions:

- **Activity Monitor → GPU History** should show a `llama-server` row with non-zero GPU time during inference. If it's CPU-only there, Metal isn't actually being used (likely embed-library issue).
- **`sample llama-server <pid>`** during inference — should show Metal kernel symbols if Metal is engaged.
- **`launchctl list | grep foundry`** — there shouldn't be any LaunchDaemons / LaunchAgents installed by Foundry. If there are, that's a regression / unintended persistence.

## Release packaging

For v0.2.0 the GitHub release attaches **both**:
- `Foundry Runtime_0.2.0_x64_en-US.msi` (rebuilt from same release branch on Windows)
- `Foundry Runtime_0.2.0_aarch64.dmg` (built + signed + notarized + stapled on Mac)

So Phase 2 actually has a Windows leg too — the rebuild step. Same `build-release.ps1` workflow, just bumped version.

## Marketing site update

Add a separate `DOWNLOAD_URL_MAC` constant in `firesidelabs_web/src/pages/FoundryPage.tsx`. Render conditionally based on `navigator.userAgent` or platform-detection — show the Mac DMG to Mac visitors, MSI to Windows visitors, both behind a "see all downloads" link.

## Deferred / explicitly NOT in scope for v0.2.0

- MLX, mistral.rs, SwiftLM. Decision logged in founder brief: revisit in v0.3.0 with fresh benchmarks.
- macOS x86_64 (Intel Mac). Apple Silicon only.
- Linux. Queued behind Mac.
- License-key flag rename. Still future work — v0.2.0 ships stock upstream like v0.1.x.
