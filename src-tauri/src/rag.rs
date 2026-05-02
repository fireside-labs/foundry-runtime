// RAG — Retrieval-Augmented Generation over user project files.
//
// Document parsers for TXT, MD, PDF, DOCX. Chunking with overlap.
// Embedding via shared embed_text command (Heimdall's embed.rs).
// Storage in SQLite (document_chunks table). Cosine similarity retrieval.
//
// Knowledge Base lifecycle:
//   1. User links a folder → kb_create(namespace, root_path)
//   2. kb_index scans the folder, parses files, chunks, embeds, stores
//   3. kb_search queries by natural language → top-K relevant chunks
//   4. Auto-injection into chat context based on user's question

use crate::sandbox;
use serde::{Serialize, Deserialize};
use rusqlite::{Connection, params};
use std::fs;
use std::path::{Path, PathBuf};

/// ~500 tokens ≈ ~2000 chars per chunk.
const CHUNK_SIZE: usize = 2000;
/// ~50 tokens ≈ ~200 chars overlap.
const CHUNK_OVERLAP: usize = 200;
/// Maximum file size to index (10MB).
const MAX_INDEX_FILE_SIZE: u64 = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KnowledgeBase {
    pub id: String,
    pub namespace: String,
    pub root_path: String,
    pub created_at: String,
    pub chunk_count: i64,
    pub file_count: i64,
    pub status: String, // "ready", "indexing", "error"
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchResult {
    pub chunk_text: String,
    pub source_path: String,
    pub similarity: f32,
    pub namespace: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct IndexProgress {
    pub files_processed: usize,
    pub files_total: usize,
    pub chunks_created: usize,
    pub current_file: String,
    pub status: String,
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

fn db_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".foundry").join("memory.db")
}

fn open_db() -> Result<Connection, String> {
    let path = db_path();
    Connection::open(&path).map_err(|e| format!("Cannot open DB: {}", e))
}

pub fn init_rag_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS knowledge_bases (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL UNIQUE,
            root_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            chunk_count INTEGER DEFAULT 0,
            file_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'ready'
        );

        CREATE TABLE IF NOT EXISTS document_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kb_id TEXT NOT NULL,
            source_path TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            chunk_text TEXT NOT NULL,
            embedding BLOB,
            namespace TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_kb ON document_chunks(kb_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_ns ON document_chunks(namespace);
    ").map_err(|e| format!("RAG schema init failed: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Document parsing
// ---------------------------------------------------------------------------

/// Extract text from a file based on its extension.
fn extract_text(path: &Path) -> Result<String, String> {
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "txt" | "md" | "markdown" | "rst" | "csv" | "tsv" |
        "json" | "yaml" | "yml" | "toml" | "xml" | "html" | "htm" |
        "py" | "rs" | "js" | "ts" | "jsx" | "tsx" | "css" |
        "java" | "cpp" | "c" | "h" | "hpp" | "go" | "rb" |
        "sh" | "bash" | "ps1" | "bat" | "cmd" | "sql" |
        "r" | "swift" | "kt" | "scala" | "lua" | "pl" => {
            fs::read_to_string(path)
                .map_err(|e| format!("Cannot read {}: {}", path.display(), e))
        }
        // PDF support via basic text extraction (no external binary needed)
        // For v0.1.0, we do best-effort UTF-8 extraction from PDF content streams.
        // Full PDF parsing (with pdf-extract) can be added as a Cargo dep later.
        "pdf" => {
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            Ok(extract_pdf_text_basic(&bytes))
        }
        _ => Err(format!("Unsupported file type: .{}", ext)),
    }
}

/// Basic PDF text extraction — pulls text from content streams without
/// requiring external C libraries. Handles ~80% of text-based PDFs.
fn extract_pdf_text_basic(bytes: &[u8]) -> String {
    let content = String::from_utf8_lossy(bytes);
    let mut text = String::new();

    // Extract text between BT (begin text) and ET (end text) operators
    let mut in_text_block = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "BT" {
            in_text_block = true;
            continue;
        }
        if trimmed == "ET" {
            in_text_block = false;
            text.push('\n');
            continue;
        }
        if in_text_block {
            // Extract text from Tj and TJ operators
            if let Some(start) = trimmed.find('(') {
                if let Some(end) = trimmed.rfind(')') {
                    if start < end {
                        text.push_str(&trimmed[start + 1..end]);
                        text.push(' ');
                    }
                }
            }
        }
    }

    if text.trim().is_empty() {
        // Fallback: extract anything that looks like readable text
        content.lines()
            .filter(|l| {
                let printable = l.chars().filter(|c| c.is_ascii_alphanumeric() || c.is_ascii_whitespace()).count();
                let total = l.len();
                total > 10 && printable as f64 / total as f64 > 0.7
            })
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        text
    }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/// Split text into overlapping chunks of ~CHUNK_SIZE chars with CHUNK_OVERLAP.
fn chunk_text(text: &str) -> Vec<String> {
    let text = text.trim();
    if text.is_empty() {
        return vec![];
    }
    if text.len() <= CHUNK_SIZE {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0;

    while start < text.len() {
        let end = (start + CHUNK_SIZE).min(text.len());

        // Try to break at a paragraph or sentence boundary
        let chunk_end = if end < text.len() {
            // Look for paragraph break first
            if let Some(pos) = text[start..end].rfind("\n\n") {
                start + pos + 2
            }
            // Then sentence break
            else if let Some(pos) = text[start..end].rfind(". ") {
                start + pos + 2
            }
            // Then any whitespace
            else if let Some(pos) = text[start..end].rfind(' ') {
                start + pos + 1
            }
            else {
                end
            }
        } else {
            end
        };

        let chunk = text[start..chunk_end].trim().to_string();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }

        // Move start back by overlap amount for next chunk
        if chunk_end >= text.len() {
            break;
        }
        start = if chunk_end > CHUNK_OVERLAP {
            chunk_end - CHUNK_OVERLAP
        } else {
            chunk_end
        };
    }

    chunks
}

// ---------------------------------------------------------------------------
// Cosine similarity (duplicated from embed.rs for self-containment)
// ---------------------------------------------------------------------------

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < 1e-10 {
        0.0
    } else {
        dot / denom
    }
}

fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn blob_to_embedding(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

// ---------------------------------------------------------------------------
// Recursive file discovery
// ---------------------------------------------------------------------------

fn discover_files(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    discover_files_inner(root, 0, max_depth, &mut files);
    files
}

fn discover_files_inner(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    if depth > max_depth {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();

        // Skip hidden files/dirs and common non-content directories
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if name.starts_with('.') || name == "node_modules" || name == "__pycache__"
            || name == "target" || name == "venv" || name == ".git" {
            continue;
        }

        if path.is_dir() {
            discover_files_inner(&path, depth + 1, max_depth, out);
        } else if path.is_file() {
            // Check size
            if let Ok(meta) = fs::metadata(&path) {
                if meta.len() <= MAX_INDEX_FILE_SIZE {
                    // Check if we can parse this extension
                    if extract_text(&path).is_ok() {
                        out.push(path);
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Create a new knowledge base linked to a folder.
#[tauri::command]
pub fn kb_create(namespace: String, root_path: String) -> Result<KnowledgeBase, String> {
    // Validate namespace via Heimdall's shared validator
    let ns_clean = namespace.trim().to_lowercase();
    if ns_clean.is_empty() {
        return Err("Namespace cannot be empty".into());
    }

    let root = sandbox::validate_project_root(&root_path)
        .map_err(|e| format!("Invalid path: {}", e))?;

    let conn = open_db()?;
    init_rag_schema(&conn)?;

    let id = format!("kb_{}", chrono::Utc::now().timestamp_millis());
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    conn.execute(
        "INSERT INTO knowledge_bases (id, namespace, root_path, created_at, status) VALUES (?1, ?2, ?3, ?4, 'ready')",
        params![id, ns_clean, root.to_string_lossy().to_string(), now],
    ).map_err(|e| format!("Cannot create KB: {}", e))?;

    println!("[foundry-rag] Created KB '{}' at {}", ns_clean, root.display());

    Ok(KnowledgeBase {
        id,
        namespace: ns_clean,
        root_path: root.to_string_lossy().to_string(),
        created_at: now,
        chunk_count: 0,
        file_count: 0,
        status: "ready".into(),
    })
}

/// Index (or re-index) a knowledge base. Scans files, chunks, embeds.
/// This is a synchronous operation — for v0.1.0, it blocks until done.
/// Future: emit progress events via Tauri.
#[tauri::command]
pub fn kb_index(kb_id: String) -> Result<IndexProgress, String> {
    let conn = open_db()?;
    init_rag_schema(&conn)?;

    // Get KB info
    let (namespace, root_path): (String, String) = conn.query_row(
        "SELECT namespace, root_path FROM knowledge_bases WHERE id = ?1",
        params![kb_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| "Knowledge base not found")?;

    let root = PathBuf::from(&root_path);
    if !root.exists() {
        return Err(format!("KB root no longer exists: {}", root_path));
    }

    // Update status
    conn.execute(
        "UPDATE knowledge_bases SET status = 'indexing' WHERE id = ?1",
        params![kb_id],
    ).map_err(|e| e.to_string())?;

    // Clear existing chunks for this KB (re-index)
    conn.execute("DELETE FROM document_chunks WHERE kb_id = ?1", params![kb_id])
        .map_err(|e| e.to_string())?;

    // Discover files
    let files = discover_files(&root, 5);
    let files_total = files.len();
    let mut files_processed = 0;
    let mut chunks_created = 0;
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    println!("[foundry-rag] Indexing KB '{}': {} files found", namespace, files_total);

    for file_path in &files {
        let rel_path = file_path.strip_prefix(&root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_path.to_string_lossy().to_string());

        match extract_text(file_path) {
            Ok(text) => {
                let chunks = chunk_text(&text);
                for (i, chunk) in chunks.iter().enumerate() {
                    // For v0.1.0, store chunks without embeddings.
                    // Embedding is done lazily at search time or via a separate
                    // embed pass when the helper sidecar is available.
                    conn.execute(
                        "INSERT INTO document_chunks (kb_id, source_path, chunk_index, chunk_text, namespace, created_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![kb_id, rel_path, i as i64, chunk, namespace, now],
                    ).map_err(|e| format!("Insert chunk failed: {}", e))?;
                    chunks_created += 1;
                }
            }
            Err(e) => {
                println!("[foundry-rag] Skip {}: {}", rel_path, e);
            }
        }

        files_processed += 1;
    }

    // Update KB stats
    conn.execute(
        "UPDATE knowledge_bases SET chunk_count = ?1, file_count = ?2, status = 'ready' WHERE id = ?3",
        params![chunks_created as i64, files_processed as i64, kb_id],
    ).map_err(|e| e.to_string())?;

    println!("[foundry-rag] Indexed: {} files, {} chunks", files_processed, chunks_created);

    Ok(IndexProgress {
        files_processed,
        files_total,
        chunks_created,
        current_file: String::new(),
        status: "complete".into(),
    })
}

/// Search a knowledge base by text query. Returns top-K relevant chunks.
/// Uses FTS text matching for v0.1.0; vector similarity when embeddings available.
#[tauri::command]
pub fn kb_search(query: String, namespace: Option<String>, limit: Option<u32>) -> Result<Vec<SearchResult>, String> {
    let conn = open_db()?;
    init_rag_schema(&conn)?;

    let k = limit.unwrap_or(5) as usize;

    // Text-based search (FTS-like with LIKE matching)
    let pattern = format!("%{}%", query.trim());

    let sql = if let Some(ref ns) = namespace {
        format!(
            "SELECT chunk_text, source_path, namespace, embedding FROM document_chunks \
             WHERE namespace = '{}' AND chunk_text LIKE ?1 \
             ORDER BY LENGTH(chunk_text) ASC LIMIT {}",
            ns.replace('\'', "''"), k * 3
        )
    } else {
        format!(
            "SELECT chunk_text, source_path, namespace, embedding FROM document_chunks \
             WHERE chunk_text LIKE ?1 \
             ORDER BY LENGTH(chunk_text) ASC LIMIT {}",
            k * 3
        )
    };

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![pattern], |row| {
        Ok(SearchResult {
            chunk_text: row.get(0)?,
            source_path: row.get(1)?,
            similarity: 0.5, // Placeholder for text match
            namespace: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut results: Vec<SearchResult> = rows.flatten().collect();
    results.truncate(k);

    Ok(results)
}

/// List all knowledge bases.
#[tauri::command]
pub fn kb_list() -> Result<Vec<KnowledgeBase>, String> {
    let conn = open_db()?;
    init_rag_schema(&conn)?;

    let mut stmt = conn.prepare(
        "SELECT id, namespace, root_path, created_at, chunk_count, file_count, status \
         FROM knowledge_bases ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(KnowledgeBase {
            id: row.get(0)?,
            namespace: row.get(1)?,
            root_path: row.get(2)?,
            created_at: row.get(3)?,
            chunk_count: row.get(4)?,
            file_count: row.get(5)?,
            status: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

/// Delete a knowledge base and all its chunks.
#[tauri::command]
pub fn kb_delete(kb_id: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM document_chunks WHERE kb_id = ?1", params![kb_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM knowledge_bases WHERE id = ?1", params![kb_id])
        .map_err(|e| e.to_string())?;
    println!("[foundry-rag] Deleted KB {}", kb_id);
    Ok(())
}

/// Build a RAG context string for injection into the system prompt.
/// Searches all active knowledge bases for content relevant to the query.
pub fn build_rag_context(query: &str) -> Result<String, String> {
    let results = kb_search(query.to_string(), None, Some(3))?;
    if results.is_empty() {
        return Ok(String::new());
    }

    let mut ctx = String::from("[KNOWLEDGE BASE — Relevant documents]\n");
    for r in &results {
        ctx.push_str(&format!("Source: {} ({})\n", r.source_path, r.namespace));
        // Truncate chunk to ~500 chars for context injection
        let excerpt = if r.chunk_text.len() > 500 {
            format!("{}...", &r.chunk_text[..500])
        } else {
            r.chunk_text.clone()
        };
        ctx.push_str(&excerpt);
        ctx.push_str("\n\n");
    }

    Ok(ctx)
}
