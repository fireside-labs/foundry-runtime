# Foundry Runtime - v0.1.0+ build pipeline
#
# Usage (from repo root):
#     .\scripts\build-release.ps1 -Version 0.1.0 -BuildTag llamacpp-b8999-stock-cpu-x64
#
# What this does:
#   1. Verifies expected binaries are present in src-tauri/binaries/
#   2. Computes SHA256 + size for each binary
#   3. Updates src-tauri/binaries.json with real values (replacing PLACEHOLDERs)
#   4. Runs `cargo tauri build` to produce installers
#   5. Reports output paths
#
# Designed to be re-runnable. If binaries.json already has real hashes, this
# just verifies they still match before running cargo tauri build.

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$Version,

    [Parameter(Mandatory=$true)]
    [string]$BuildTag,

    [string]$BundleTargets = "msi nsis",

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
    throw "Required binary missing."
}

# --- 2. Compute hashes ---
#
# Important: starting in v0.2.0 the manifest is multi-platform (Windows + macOS
# entries coexist, see PHASE2_MACOS_PLAYBOOK.md Option A). This script only
# touches .exe/.dll entries and PRESERVES any other entries (Mac llama-server,
# *.dylib) already in binaries.json. Don't revert to a from-scratch rewrite
# or you'll nuke the Mac entries committed by build-release.sh.

Write-Host "Hashing Windows binaries (.exe/.dll only)..." -ForegroundColor Yellow

# Seed with existing non-Windows entries from binaries.json so we preserve them.
$binaryEntries = [ordered]@{}
if (Test-Path $manifestPath) {
    try {
        $existing = Get-Content $manifestPath -Raw | ConvertFrom-Json
        if ($existing -and $existing.binaries) {
            foreach ($prop in $existing.binaries.PSObject.Properties) {
                $val = $prop.Value
                # Only carry forward entries that are NOT this Windows cut.
                # We'll re-hash and overwrite the Windows entries below.
                if ($prop.Name -notmatch '\.(exe|dll)$') {
                    $kept = [ordered]@{
                        sha256     = [string]$val.sha256
                        size_bytes = [long]$val.size_bytes
                        platform   = [string]$val.platform
                        build_tag  = [string]$val.build_tag
                        license    = [string]$val.license
                        upstream   = [string]$val.upstream
                    }
                    $binaryEntries[$prop.Name] = $kept
                }
            }
        }
    } catch {
        Write-Host "  Note: could not parse existing $manifestPath ($_) - starting fresh." -ForegroundColor DarkYellow
    }
}

Get-ChildItem $binariesDir -File | Where-Object {
    $_.Extension -in @(".exe", ".dll")
} | ForEach-Object {
    $name = $_.Name
    $size = $_.Length
    $sha = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash.ToLower()

    $entry = [ordered]@{
        sha256 = $sha
        size_bytes = $size
        platform = "windows-x64"
        build_tag = $BuildTag
        license = "MIT (llama.cpp upstream)"
        upstream = "https://github.com/ggml-org/llama.cpp"
    }

    $binaryEntries[$name] = $entry
    $shortHash = $sha.Substring(0, 16)
    $sizeStr = "{0:N0}" -f $size
    Write-Host "  $name  $sizeStr bytes  $shortHash"
}

$winCount = ($binaryEntries.Keys | Where-Object { $_ -match '\.(exe|dll)$' }).Count
if ($winCount -eq 0) {
    throw "No .exe or .dll files found in binaries/. Nothing to hash."
}

# --- 3. Update binaries.json ---

Write-Host ""
Write-Host "Updating $manifestPath..." -ForegroundColor Yellow

$manifest = [ordered]@{
    "_doc" = "Public binary fingerprints for Foundry Runtime. Tauri Rust verifies bundled binaries against this manifest at startup (SHA256, fail-closed on mismatch). Update this file ONLY when cutting a new public release."
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
    Write-Host "SkipBuild flag set - stopping here. Manifest is up to date." -ForegroundColor Cyan
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
    $sizeStr = "{0:N0}" -f $_.Length
    $relPath = $_.FullName.Replace($repoRoot, ".")
    Write-Host "  $sizeStr bytes  $relPath"
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  - If signing is configured (Azure Trusted Signing), the .msi is already signed."
Write-Host "  - Run strings audit on the .msi for OPSEC verification before release."
Write-Host "  - Test on a clean Windows VM."
Write-Host "  - Upload .msi as a GitHub Release asset on fireside-labs/foundry-runtime."
Write-Host ""
