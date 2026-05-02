// Binary verification — checks bundled binaries against `binaries.json` SHA256
// hashes at runtime. Fail-closed: if a bundled binary has been tampered with or
// is missing its expected hash from the manifest, the runtime refuses to launch
// that binary.
//
// The manifest is embedded at compile time via `include_str!`. Hash mismatches
// are surfaced through the Result return type so the calling code (typically
// start_llama_server in main.rs) can present a clear UI error.
//
// Public binaries only — Fireside Labs' internal mesh has its own preflight
// tooling at D:/foundry-runtime/bin/CANONICAL_HASHES.json, with metadata that
// is intentionally not in this public manifest.

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

const MANIFEST_JSON: &str = include_str!("../binaries.json");

#[derive(Debug, Deserialize)]
pub struct BinaryEntry {
    pub sha256: String,
    pub size_bytes: u64,
    pub platform: String,
    #[serde(default)]
    pub build_tag: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub upstream: String,
}

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub version: String,
    pub schema_version: String,
    pub binaries: std::collections::HashMap<String, BinaryEntry>,
}

#[derive(Debug)]
pub enum VerifyError {
    ManifestParse(String),
    NotInManifest(String),
    HashMismatch { name: String, expected: String, actual: String },
    SizeMismatch { name: String, expected: u64, actual: u64 },
    Io(String),
    PlaceholderManifest, // binaries.json still has PLACEHOLDER values from pre-v0.1.0 cut
}

impl std::fmt::Display for VerifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VerifyError::ManifestParse(e) => write!(f, "Failed to parse binaries.json: {}", e),
            VerifyError::NotInManifest(name) => write!(f, "Binary '{}' is not declared in binaries.json", name),
            VerifyError::HashMismatch { name, expected, actual } => write!(
                f,
                "Binary '{}' SHA256 mismatch: expected {}, got {}. Tampered or wrong file — refusing to launch.",
                name,
                &expected[..16],
                &actual[..16]
            ),
            VerifyError::SizeMismatch { name, expected, actual } => write!(
                f,
                "Binary '{}' size mismatch: expected {} bytes, got {} bytes",
                name, expected, actual
            ),
            VerifyError::Io(e) => write!(f, "I/O error reading binary: {}", e),
            VerifyError::PlaceholderManifest => write!(
                f,
                "binaries.json contains PLACEHOLDER values — runtime built before v0.1.0 binary cut. Fill in real SHA256 in binaries.json before shipping."
            ),
        }
    }
}

impl std::error::Error for VerifyError {}

/// Parse the embedded manifest. Cached on first call would be ideal, but JSON
/// parsing of a small static string is cheap enough that we don't bother for v0.1.0.
pub fn load_manifest() -> Result<Manifest, VerifyError> {
    serde_json::from_str(MANIFEST_JSON).map_err(|e| VerifyError::ManifestParse(e.to_string()))
}

/// Verify a single binary against the manifest. Returns Ok(()) if hash matches,
/// otherwise a VerifyError describing the problem. Fail-closed: the caller should
/// refuse to launch the binary on any error.
pub fn verify_binary(binary_path: &Path, expected_name: &str) -> Result<(), VerifyError> {
    let manifest = load_manifest()?;
    let entry = manifest
        .binaries
        .get(expected_name)
        .ok_or_else(|| VerifyError::NotInManifest(expected_name.to_string()))?;

    // Reject placeholder manifests — these indicate a build before v0.1.0 was cut.
    if entry.sha256.starts_with("PLACEHOLDER") {
        return Err(VerifyError::PlaceholderManifest);
    }

    let bytes = fs::read(binary_path).map_err(|e| VerifyError::Io(e.to_string()))?;

    // Cheap pre-check on file size before SHA computation.
    if entry.size_bytes != 0 && bytes.len() as u64 != entry.size_bytes {
        return Err(VerifyError::SizeMismatch {
            name: expected_name.to_string(),
            expected: entry.size_bytes,
            actual: bytes.len() as u64,
        });
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual_hex = hex::encode(hasher.finalize());

    if !actual_hex.eq_ignore_ascii_case(&entry.sha256) {
        return Err(VerifyError::HashMismatch {
            name: expected_name.to_string(),
            expected: entry.sha256.clone(),
            actual: actual_hex,
        });
    }

    Ok(())
}

/// Returns true if the manifest still contains placeholder values — i.e., this
/// build was produced before v0.1.0 was cut. Used to skip verification gracefully
/// during dev builds without crashing the runtime.
pub fn is_placeholder_manifest() -> bool {
    match load_manifest() {
        Ok(m) => m
            .binaries
            .values()
            .any(|b| b.sha256.starts_with("PLACEHOLDER")),
        Err(_) => true, // Unparseable manifest → treat as placeholder so we don't gate dev builds
    }
}
