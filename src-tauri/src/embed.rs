// Foundry Embedding Service
//
// Shared infrastructure used by:
//   - Memory subsystem: embed semantic/episodic/procedural memories for cosine recall
//   - RAG document indexer: embed file chunks for knowledge-base queries
//
// Architecture: helper sidecar (managed by helper.rs) runs an embedding model
// (default: nomic-embed-text-v1.5.Q4_K_M.gguf, 768-dim) on http://127.0.0.1:8081
// in --embedding mode. This module is the HTTP client + similarity math layer.
//
// Public API:
//   #[tauri::command] embed_text(text: String) -> Result<Vec<f32>, String>
//   #[tauri::command] namespace_validate(namespace: String) -> bool
//   pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32
//   pub fn embedding_to_blob(emb: &[f32]) -> Vec<u8>
//   pub fn blob_to_embedding(blob: &[u8]) -> Vec<f32>
//
// Both consumers (memory.rs, rag.rs) should call this module — never embed
// against the helper sidecar directly. Centralizing keeps the model + URL +
// failure handling consistent.

use serde::{Deserialize, Serialize};

/// Embedding sidecar URL. llama-server in --embedding mode exposes this endpoint.
/// Currently hardcoded; if we ever support remote embedding services, pull from
/// config (~/.foundry/config.json) instead.
const EMBED_URL: &str = "http://127.0.0.1:8081/v1/embeddings";

/// HTTP timeout per embedding call. Most calls return in <500ms; 30s is generous.
const EMBED_TIMEOUT_SECS: u64 = 30;

/// Maximum text length to embed in a single call. Long inputs should be chunked
/// by the caller (RAG indexer does this); this is a guardrail, not the chunking
/// strategy.
const EMBED_MAX_INPUT_CHARS: usize = 8192;

#[derive(Serialize)]
struct OpenAIEmbedRequest<'a> {
    input: &'a str,
    // llama-server ignores model name but OpenAI clients require it.
    model: &'a str,
}

#[derive(Deserialize)]
struct OpenAIEmbedResponse {
    data: Vec<OpenAIEmbedData>,
}

#[derive(Deserialize)]
struct OpenAIEmbedData {
    embedding: Vec<f32>,
}

/// Generate an embedding for arbitrary text. Returns a Vec<f32> (typically 768-dim
/// for nomic-embed-text-v1.5).
///
/// Failure modes:
///   - Helper sidecar not running -> error guides user to start it
///   - Helper sidecar returns malformed response -> wrapped error
///   - Network/timeout -> error
///   - Input too long -> rejected (caller should chunk)
#[tauri::command]
pub async fn embed_text(text: String) -> Result<Vec<f32>, String> {
    if text.is_empty() {
        return Err("embed_text: empty input".into());
    }
    if text.len() > EMBED_MAX_INPUT_CHARS {
        return Err(format!(
            "embed_text: input too long ({} chars, max {}); chunk before calling",
            text.len(),
            EMBED_MAX_INPUT_CHARS
        ));
    }

    let body = OpenAIEmbedRequest {
        input: &text,
        model: "embedding",
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(EMBED_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("embed_text: client init failed: {}", e))?;

    let response = client
        .post(EMBED_URL)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            format!(
                "embed_text: request failed (is the helper sidecar running on port 8081?): {}",
                e
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "embed_text: helper returned {}: {}",
            status, body_text
        ));
    }

    let parsed: OpenAIEmbedResponse = response
        .json()
        .await
        .map_err(|e| format!("embed_text: response parse failed: {}", e))?;

    let embedding = parsed
        .data
        .into_iter()
        .next()
        .ok_or_else(|| "embed_text: response had no embedding data".to_string())?
        .embedding;

    if embedding.is_empty() {
        return Err("embed_text: helper returned empty embedding vector".into());
    }

    Ok(embedding)
}

/// Validate a hierarchical namespace string.
///
/// Rules:
///   - Total length 1..=256 chars
///   - Dot-separated segments
///   - Each segment 1..=64 chars
///   - Each segment matches [a-z0-9_-]+ (ASCII lowercase, digits, hyphen, underscore)
///   - No empty segments (no leading/trailing/consecutive dots)
///
/// Examples:
///   "bakery.recipes"            -> true
///   "legal.contracts.2026.q1"   -> true
///   "ai.preferences.user"       -> true
///   "Bakery Recipes!"           -> false (uppercase + space + punctuation)
///   "bakery..recipes"           -> false (empty segment)
///   ".bakery.recipes"           -> false (leading dot)
#[tauri::command]
pub fn namespace_validate(namespace: String) -> bool {
    if namespace.is_empty() || namespace.len() > 256 {
        return false;
    }
    namespace.split('.').all(|seg| {
        !seg.is_empty()
            && seg.len() <= 64
            && seg.chars().all(|c| {
                c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_'
            })
    })
}

/// Cosine similarity between two embedding vectors. Returns a score in [-1, 1]
/// where 1 means identical direction (most similar). Vectors of different
/// lengths return 0.0 (we don't panic on mismatched-dim vectors at runtime).
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut mag_a = 0.0f32;
    let mut mag_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        mag_a += a[i] * a[i];
        mag_b += b[i] * b[i];
    }
    let denom = mag_a.sqrt() * mag_b.sqrt();
    if denom == 0.0 {
        return 0.0;
    }
    dot / denom
}

/// Serialize an embedding vector to bytes for SQLite BLOB storage.
/// Format: little-endian f32 sequence. No header, no version byte — the
/// dimensionality is inferred from blob length / 4.
pub fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(embedding.len() * 4);
    for v in embedding {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Deserialize a SQLite BLOB back into an embedding vector. Returns empty Vec
/// if the blob length isn't a multiple of 4 (corrupted).
pub fn blob_to_embedding(blob: &[u8]) -> Vec<f32> {
    if blob.len() % 4 != 0 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(blob.len() / 4);
    for chunk in blob.chunks_exact(4) {
        let arr: [u8; 4] = [chunk[0], chunk[1], chunk[2], chunk[3]];
        out.push(f32::from_le_bytes(arr));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_identical_vectors_returns_one() {
        let a = vec![1.0, 0.5, -0.25];
        let b = a.clone();
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 1e-6, "expected ~1.0, got {}", sim);
    }

    #[test]
    fn cosine_orthogonal_vectors_returns_zero() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn cosine_mismatched_dim_returns_zero() {
        assert_eq!(cosine_similarity(&[1.0, 2.0], &[1.0, 2.0, 3.0]), 0.0);
    }

    #[test]
    fn blob_roundtrip_preserves_values() {
        let original = vec![0.1, -0.5, 1.234, -0.0, 1e-6];
        let blob = embedding_to_blob(&original);
        let restored = blob_to_embedding(&blob);
        assert_eq!(restored.len(), original.len());
        for (a, b) in original.iter().zip(restored.iter()) {
            assert!((a - b).abs() < 1e-7);
        }
    }

    #[test]
    fn namespace_validation() {
        // Valid
        assert!(namespace_validate("bakery.recipes".into()));
        assert!(namespace_validate("legal.contracts.2026.q1".into()));
        assert!(namespace_validate("ai.preferences.user".into()));
        assert!(namespace_validate("a".into()));
        assert!(namespace_validate("kebab-case.snake_case".into()));

        // Invalid
        assert!(!namespace_validate("".into()));
        assert!(!namespace_validate("Bakery.Recipes".into())); // uppercase
        assert!(!namespace_validate("bakery recipes".into())); // space
        assert!(!namespace_validate("bakery..recipes".into())); // empty segment
        assert!(!namespace_validate(".bakery".into())); // leading dot
        assert!(!namespace_validate("bakery.".into())); // trailing dot
        assert!(!namespace_validate("bakery!".into())); // punctuation
    }
}
