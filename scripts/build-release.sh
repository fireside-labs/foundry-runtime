#!/usr/bin/env bash
# Foundry Runtime — macOS arm64 release build pipeline (v0.2.0+).
#
# Usage (from repo root):
#     ./scripts/build-release.sh 0.2.0 llamacpp-b9093-stock-metal-arm64
#     ./scripts/build-release.sh 0.2.0 llamacpp-b9093-stock-metal-arm64 \
#         "Developer ID Application: Jordan Nguyen (8TAV5AV6U6)"
#
# What this does:
#   1. Verifies Mac sidecars are present in src-tauri/binaries/ (llama-server + *.dylib)
#   2. Codesigns each sidecar with hardened runtime + entitlements (Tauri does NOT
#      deep-sign embedded sidecars; this MUST run before cargo tauri build or
#      notarization will reject the bundle).
#   3. Merges Mac entries into src-tauri/binaries.json (preserves Windows entries
#      so a later Windows v0.2.0 rebuild doesn't fight this manifest).
#   4. Runs cargo tauri build --target aarch64-apple-darwin --bundles dmg,app
#   5. Reports output paths.
#
# Hashes are computed AFTER codesign so the manifest reflects the binary that
# actually ships (binary_verify.rs reads the on-disk file at runtime — that's
# the signed version).
#
# Designed to be re-runnable. Reruns re-sign + re-hash; that's harmless.

set -euo pipefail

VERSION="${1:-}"
BUILD_TAG="${2:-}"
SIGNING_IDENTITY="${3:-Developer ID Application: Jordan Nguyen (8TAV5AV6U6)}"

if [[ -z "$VERSION" || -z "$BUILD_TAG" ]]; then
  echo "usage: $0 VERSION BUILD_TAG [SIGNING_IDENTITY]" >&2
  echo "example: $0 0.2.0 llamacpp-b9093-stock-metal-arm64" >&2
  exit 64
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$REPO_ROOT/src-tauri/binaries"
MANIFEST="$REPO_ROOT/src-tauri/binaries.json"
ENTITLEMENTS="$REPO_ROOT/src-tauri/entitlements.plist"

echo
echo "Foundry Runtime build-release.sh (macOS arm64)"
echo "  Version:           $VERSION"
echo "  BuildTag:          $BUILD_TAG"
echo "  SigningIdentity:   $SIGNING_IDENTITY"
echo "  RepoRoot:          $REPO_ROOT"
echo "  Manifest:          $MANIFEST"
echo

# --- 1. Locate sidecars ------------------------------------------------------

if [[ ! -d "$BIN_DIR" ]]; then
  echo "FAIL: binaries/ directory not found at $BIN_DIR" >&2
  exit 1
fi

if [[ ! -f "$BIN_DIR/llama-server" ]]; then
  echo "FAIL: $BIN_DIR/llama-server not present." >&2
  echo "      Drop the compiled Mac llama-server into src-tauri/binaries/ first." >&2
  exit 1
fi

if [[ ! -f "$ENTITLEMENTS" ]]; then
  echo "FAIL: $ENTITLEMENTS not present." >&2
  exit 1
fi

# --- 2a. Rewrite rpaths to @loader_path -------------------------------------
#
# llama.cpp's cmake bakes the build-tree absolute path into LC_RPATH on every
# binary. Once we ship, that path won't exist on the user's machine and dylib
# resolution fails. @loader_path makes each binary look for its dylib
# dependencies in its own directory, which is exactly the layout we ship
# (everything flat in Resources/binaries/).
#
# Idempotent: if @loader_path is already the only rpath, this re-applies it
# (delete-then-add) with no net change. Safe to re-run.

echo "Rewriting rpaths to @loader_path..."
shopt -s nullglob
for f in "$BIN_DIR"/llama-server "$BIN_DIR"/*.dylib; do
  [[ -f "$f" ]] || continue
  echo "  $(basename "$f"):"
  # Walk existing LC_RPATH entries and delete each one.
  otool -l "$f" \
    | awk '/LC_RPATH/{found=1} found && /^[[:space:]]*path /{sub(/^[[:space:]]*path /, ""); sub(/ \(offset.*$/, ""); print; found=0}' \
    | while read -r rp; do
        [[ -z "$rp" ]] && continue
        install_name_tool -delete_rpath "$rp" "$f" 2>/dev/null || true
        echo "    deleted rpath: $rp"
      done
  install_name_tool -add_rpath @loader_path "$f" 2>/dev/null || true
done
shopt -u nullglob

# --- 2b. Codesign each sidecar ----------------------------------------------

echo
echo "Codesigning Mac sidecars (hardened runtime + entitlements)..."
shopt -s nullglob
for f in "$BIN_DIR"/llama-server "$BIN_DIR"/*.dylib; do
  [[ -f "$f" ]] || continue
  echo "  signing $(basename "$f")"
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$SIGNING_IDENTITY" "$f"
  codesign --verify --strict --verbose=4 "$f" 2>&1 | sed 's/^/    /'
done
shopt -u nullglob

# --- 3. Hash + merge into binaries.json --------------------------------------

echo
echo "Hashing Mac binaries and merging into manifest..."
python3 - "$VERSION" "$BUILD_TAG" "$BIN_DIR" "$MANIFEST" <<'PY'
import hashlib, json, os, sys

version, build_tag, bin_dir, manifest_path = sys.argv[1:5]

with open(manifest_path) as f:
    manifest = json.load(f)

# Identify Mac sidecars in binaries/: llama-server (no extension) + *.dylib.
# Windows sidecars (.exe / .dll) are left untouched.
mac_names = []
for name in sorted(os.listdir(bin_dir)):
    full = os.path.join(bin_dir, name)
    if not os.path.isfile(full):
        continue
    if name == "llama-server" or name.endswith(".dylib"):
        mac_names.append(name)

if not mac_names:
    print("  WARN: no Mac sidecars (llama-server or *.dylib) found in binaries/.")

for name in mac_names:
    path = os.path.join(bin_dir, name)
    with open(path, "rb") as fh:
        data = fh.read()
    sha = hashlib.sha256(data).hexdigest()
    manifest["binaries"][name] = {
        "build_tag":   build_tag,
        "upstream":    "https://github.com/ggml-org/llama.cpp",
        "sha256":      sha,
        "size_bytes":  len(data),
        "platform":    "aarch64-apple-darwin",
        "license":     "MIT (llama.cpp upstream)",
    }
    print(f"  {name:<28} {len(data):>12,} bytes  {sha[:16]}")

manifest["version"] = version

with open(manifest_path, "w") as fh:
    json.dump(manifest, fh, indent=2)
    fh.write("\n")
print(f"  Manifest written. Version={version}, Mac entries={len(mac_names)}.")
PY

# --- 4. cargo tauri build ----------------------------------------------------

echo
echo "Running cargo tauri build --target aarch64-apple-darwin --bundles dmg,app..."
cd "$REPO_ROOT/src-tauri"
cargo tauri build --target aarch64-apple-darwin --bundles dmg,app

# --- 5. Report output --------------------------------------------------------

BUNDLE_DIR="$REPO_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle"
echo
echo "Build complete. Artifacts:"
if [[ -d "$BUNDLE_DIR" ]]; then
  find "$BUNDLE_DIR" -type f \( -name "*.dmg" -o -name "*.app" \) \
    -exec ls -lhd {} \; | awk '{print "  " $0}'
  find "$BUNDLE_DIR" -type d -name "*.app" \
    -exec ls -lhd {} \; | awk '{print "  " $0}'
fi

cat <<EOF

Next steps:
  - xcrun notarytool submit "$BUNDLE_DIR/dmg/Foundry Runtime_${VERSION}_aarch64.dmg" \\
      --keychain-profile AC_NOTARY --wait
  - xcrun stapler staple "$BUNDLE_DIR/dmg/Foundry Runtime_${VERSION}_aarch64.dmg"
  - spctl --assess --verbose=4 --type install "$BUNDLE_DIR/dmg/Foundry Runtime_${VERSION}_aarch64.dmg"

EOF
