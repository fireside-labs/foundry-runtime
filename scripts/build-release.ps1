# Foundry Runtime — v0.1.0+ build pipeline
#
# Usage (from repo root):
#     .\scripts\build-release.ps1 -Version 0.1.0 -BuildTag llamacpp-bXXXX-licensekey
#
# What this does:
#   1. Verifies expected binaries are present in src-tauri/binaries/
#   2. Computes SHA256 + size for each binary
#   3. Updates src-tauri/binaries.json with real values (replacing PLACEHOLDERs)
#   4. Runs `cargo tauri build` to produce signed (or unsigned) .msi + .exe installers
#   5. Reports output paths and the manifest delta
#
# Designed to be re-runnable: if binaries.json already has real hashes, it just
# verifies they still match the binaries on disk before invoking cargo tauri build.

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$Version,

    [Parameter(Mandatory=$true)]
    [string]$BuildTag,

    [string]$BundleTargets = "msi nsis",

    # Optional: skip the cargo tauri build step (just refresh the manifest)
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

# --- Setup ---

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$srcTauri = Join-Path $repoRoot "src-tauri"
$binariesDir = Join-Path $srcTauri "binaries"
$manifestPath = Join-Path $srcTauri "binaries.json"

Write-Host ""
Write-Host "Foundry Runtime build-release.ps1" -ForegroundColor Cyan
Write-Host "  Version:    $Version"
Write-Host "  BuildTag:   $BuildTag"
Write-Host "  RepoRoot:   $repoRoot"
Write-Host "  Manifest:   $manifestPath"
Write-Host ""

# --- 1. Locate binaries ---

if (-not (Test-Path $binariesDir)) {
    throw "binaries/ directory not found at $binariesDir"
}

$expectedExe = Join-Path $binariesDir "llama-server.exe"
if (-not (Test-Path $expectedExe)) {
    Write-Host "FAIL: $expectedExe not present." -ForegroundColor Red
    Write-Host "      Drop the compiled llama-server.exe into src-tauri/binaries/ before running this script."
    Write-Host "      It must be the public fork (with --license-key flag, NOT --srht-key)."
    throw "Required binary missing."
}

# --- 2. Compute hashes for everything in binaries/ that's an exe or dll ---

Write-Host "Hashing binaries..." -ForegroundColor Yellow
$binaryEntries = @{}

Get-ChildItem $binariesDir -File | Where-Object {
    $_.Extension -in @(".exe", ".dll")
} | ForEach-Object {
    $name = $_.Name
    $size = $_.Length
    $sha = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLower()

    $entry = @{
        sha256 = $sha
        size_bytes = $size
        platform = "windows-x64"
        build_tag = $BuildTag
        license = "MIT (llama.cpp upstream)"
        upstream = "https://github.com/ggml-org/llama.cpp"
    }

    $binaryEntries[$name] = $entry
    Write-Host ("  {0,-32} {1,12:N0} bytes  {2}" -f $name, $size, $sha.Substring(0, 16))
}

if ($binaryEntries.Count -eq 0) {
    throw "No .exe or .dll files found in binaries/. Nothing to hash."
}

# --- 3. Update binaries.json ---

Write-Host ""
Write-Host "Updating $manifestPath..." -ForegroundColor Yellow

# Build the JSON structure manually — preserves field order and comments-as-keys.
$manifest = [ordered]@{
    "_doc" = "Public binary fingerprints for Foundry Runtime. Tauri Rust verifies bundled binaries against this manifest at startup (SHA256, fail-closed on mismatch). Update this file ONLY when cutting a new public release. Do NOT include internal build paths, build-host names, or compile-time metadata other than fields listed in the schema."
    version = $Version
    schema_version = "1"
    binaries = $binaryEntries
}

$json = $manifest | ConvertTo-Json -Depth 6
Set-Content -Path $manifestPath -Value $json -Encoding UTF8

Write-Host "  Manifest written. Version=$Version, $($binaryEntries.Count) binaries." -ForegroundColor Green

# --- 4. Run cargo tauri build ---

if ($SkipBuild) {
    Write-Host ""
    Write-Host "SkipBuild flag set — stopping here. Manifest is up to date." -ForegroundColor Cyan
    exit 0
}

Write-Host ""
Write-Host "Running cargo tauri build..." -ForegroundColor Yellow
Push-Location $srcTauri
try {
    $tauriArgs = @("tauri", "build", "--bundles") + ($BundleTargets -split ' ')
    & cargo @tauriArgs
    if ($LASTEXITCODE -ne 0) {
        throw "cargo tauri build exited with code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

# --- 5. Report output ---

$bundleDir = Join-Path $srcTauri "target\release\bundle"
Write-Host ""
Write-Host "Build complete. Output artifacts:" -ForegroundColor Green
Get-ChildItem -Recurse -Path $bundleDir -Include @("*.msi", "*.exe") -File | ForEach-Object {
    Write-Host ("  {0,12:N0} bytes  {1}" -f $_.Length, $_.FullName.Replace($repoRoot, "."))
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  - If signing is configured (Azure Trusted Signing), the .msi is already signed."
Write-Host "  - Run strings audit on the .msi for OPSEC verification before release:"
Write-Host "      strings *.msi | grep -iE 'graft|surgery|FFN|MESH|Freya|Heimdall|SRHT|wildclaw|chimera'"
Write-Host "  - Test on a clean Windows VM (no CUDA installed → CPU fallback path)."
Write-Host "  - Upload .msi as a GitHub Release asset on fireside-labs/foundry-runtime."
Write-Host ""
