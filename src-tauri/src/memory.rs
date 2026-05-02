// Foundry Memory Engine — SQLite-backed persistent memory with 5 cognitive types.
// Zero external dependencies: SQLite + FTS5 bundled in binary.

use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SemanticMemory {
    pub id: i64,
    pub key: String,
    pub value: String,
    pub category: String,
    pub namespace: String,  // Hierarchical: "general.fact", "bakery.recipes", etc. See embed::namespace_validate.
    pub confidence: f64,
    pub supersedes: Option<String>,
    pub change_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub access_count: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EpisodicMemory {
    pub id: i64,
    pub conversation_id: String,
    pub date: String,
    pub summary: String,
    pub topics: String,
    pub entities: String,
    pub emotional_tone: String,
    pub turn_count: i64,
    pub namespace: String,  // e.g., "general", "roundtable.strategy", "client.acme-corp"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProceduralMemory {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub steps: String, // JSON array
    pub times_referenced: i64,
    pub created_at: String,
    pub namespace: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MemorySearchResult {
    pub memory_type: String,
    pub key: String,
    pub value: String,
    pub relevance: f64,
    pub updated_at: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct MemoryStats {
    pub core_length: usize,
    pub semantic_count: i64,
    pub episodic_count: i64,
    pub procedural_count: i64,
    pub changelog_count: i64,
    pub last_dream_cycle: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ChangelogEntry {
    pub id: i64,
    pub memory_type: String,
    pub memory_key: String,
    pub action: String,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub reason: Option<String>,
    pub timestamp: String,
}

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

pub fn db_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".foundry").join("memory.db")
}

pub fn open_db() -> Result<Connection, String> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Connection::open(&path).map_err(|e| format!("Cannot open memory DB: {}", e))
}

pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS core_memory (
            id INTEGER PRIMARY KEY,
            content TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            version INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS semantic_memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            value TEXT NOT NULL,
            category TEXT DEFAULT 'fact',
            confidence REAL DEFAULT 0.8,
            supersedes TEXT,
            change_reason TEXT,
            source_conversation_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_accessed_at TEXT,
            access_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS episodic_memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT UNIQUE,
            date TEXT NOT NULL,
            summary TEXT NOT NULL,
            topics TEXT DEFAULT '[]',
            entities TEXT DEFAULT '[]',
            emotional_tone TEXT DEFAULT '',
            turn_count INTEGER DEFAULT 0,
            duration_minutes INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS procedural_memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL,
            steps TEXT NOT NULL DEFAULT '[]',
            prerequisites TEXT DEFAULT '[]',
            learned_from TEXT,
            times_referenced INTEGER DEFAULT 0,
            last_used_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_changelog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_type TEXT NOT NULL,
            memory_key TEXT,
            action TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            reason TEXT,
            timestamp TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversation_archive (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            turns TEXT NOT NULL,
            model TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Seed core memory if empty
        INSERT OR IGNORE INTO core_memory (id, content, updated_at)
        VALUES (1, '', datetime('now'));
    ").map_err(|e| format!("Schema init failed: {}", e))?;

    // Create FTS5 tables (ignore error if already exists)
    let _ = conn.execute_batch("
        CREATE VIRTUAL TABLE IF NOT EXISTS semantic_fts USING fts5(
            key, value, category,
            content='semantic_memories', content_rowid='id'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
            summary, topics, entities,
            content='episodic_memories', content_rowid='id'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS procedural_fts USING fts5(
            name, description, steps,
            content='procedural_memories', content_rowid='id'
        );
    ");

    // ---- Migration: hierarchical namespacing (v0.1.0+) ----
    // Add `namespace` column to memory tables if not present. Backfill semantic
    // namespaces from existing `category` values so existing rows get a
    // sensible default ("general.fact", "general.preference", etc).
    add_column_if_missing(conn, "semantic_memories", "namespace",
        "TEXT NOT NULL DEFAULT 'general'")?;
    add_column_if_missing(conn, "episodic_memories", "namespace",
        "TEXT NOT NULL DEFAULT 'general'")?;
    add_column_if_missing(conn, "procedural_memories", "namespace",
        "TEXT NOT NULL DEFAULT 'general'")?;

    // One-time backfill: derive semantic namespaces from category if still default.
    // Idempotent — only updates rows still at the default 'general'.
    let _ = conn.execute(
        "UPDATE semantic_memories \
         SET namespace = 'general.' || COALESCE(category, 'fact') \
         WHERE namespace = 'general'",
        [],
    );

    // Indices for namespace prefix queries (tree view, scoped search).
    let _ = conn.execute_batch("
        CREATE INDEX IF NOT EXISTS idx_semantic_namespace ON semantic_memories(namespace);
        CREATE INDEX IF NOT EXISTS idx_episodic_namespace ON episodic_memories(namespace);
        CREATE INDEX IF NOT EXISTS idx_procedural_namespace ON procedural_memories(namespace);
    ");

    Ok(())
}

/// Add a column to a table if it doesn't already exist. Idempotent —
/// safe to call on every init_schema run.
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    column_def: &str,
) -> Result<(), String> {
    let existing: Vec<String> = {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .map_err(|e| format!("PRAGMA prep failed for {}: {}", table, e))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("PRAGMA query failed for {}: {}", table, e))?;
        rows.flatten().collect()
    };

    if existing.iter().any(|c| c == column) {
        return Ok(());
    }

    conn.execute(
        &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, column_def),
        [],
    )
    .map(|_| ())
    .map_err(|e| format!("ALTER TABLE {} ADD {} failed: {}", table, column, e))
}

// ---------------------------------------------------------------------------
// Core Memory
// ---------------------------------------------------------------------------

pub fn core_read(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT content FROM core_memory WHERE id = 1", [], |row| {
        row.get::<_, String>(0)
    }).map_err(|e| format!("Core read failed: {}", e))
}

pub fn core_update(conn: &Connection, old_text: &str, new_text: &str) -> Result<(), String> {
    let current = core_read(conn)?;
    let updated = if old_text.is_empty() {
        // Append mode
        if current.is_empty() {
            new_text.to_string()
        } else {
            format!("{}\n{}", current, new_text)
        }
    } else {
        current.replace(old_text, new_text)
    };

    // Enforce character limit (2000 chars ≈ 500 tokens)
    if updated.len() > 2000 {
        return Err(format!("Core memory would exceed 2000 char limit ({} chars)", updated.len()));
    }

    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    conn.execute(
        "UPDATE core_memory SET content = ?1, updated_at = ?2, version = version + 1 WHERE id = 1",
        params![updated, now],
    ).map_err(|e| format!("Core update failed: {}", e))?;

    log_change(conn, "core", "core_memory", "UPDATE", Some(&current), Some(&updated), Some("model self-edit"));
    Ok(())
}

pub fn core_set(conn: &Connection, content: &str) -> Result<(), String> {
    if content.len() > 2000 {
        return Err(format!("Core memory exceeds 2000 char limit ({} chars)", content.len()));
    }
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    conn.execute(
        "UPDATE core_memory SET content = ?1, updated_at = ?2, version = version + 1 WHERE id = 1",
        params![content, now],
    ).map_err(|e| format!("Core set failed: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Semantic Memory
// ---------------------------------------------------------------------------

pub fn semantic_save(conn: &Connection, key: &str, value: &str, category: &str) -> Result<String, String> {
    // Backwards-compat wrapper: derive namespace from category for legacy callers.
    let ns = format!("general.{}", category);
    semantic_save_with_namespace(conn, key, value, category, &ns)
}

/// Namespace-aware save. Use this for new code; semantic_save() is the legacy
/// wrapper. Caller should validate namespace via embed::namespace_validate first.
pub fn semantic_save_with_namespace(
    conn: &Connection,
    key: &str,
    value: &str,
    category: &str,
    namespace: &str,
) -> Result<String, String> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    // Check for existing
    let existing: Option<(i64, String)> = conn.query_row(
        "SELECT id, value FROM semantic_memories WHERE key = ?1",
        params![key],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).ok();

    let action;
    if let Some((id, old_value)) = existing {
        // UPDATE — conflict resolution
        action = "UPDATE";
        conn.execute(
            "UPDATE semantic_memories SET value = ?1, confidence = 1.0, supersedes = ?2, \
             change_reason = 'updated by model', updated_at = ?3, access_count = access_count + 1, \
             namespace = ?4 \
             WHERE id = ?5",
            params![value, old_value, now, namespace, id],
        ).map_err(|e| format!("Semantic update failed: {}", e))?;

        // Update FTS
        let _ = conn.execute(
            "INSERT INTO semantic_fts(semantic_fts, rowid, key, value, category) VALUES('delete', ?1, ?2, ?3, ?4)",
            params![id, key, old_value, category],
        );
        let _ = conn.execute(
            "INSERT INTO semantic_fts(rowid, key, value, category) VALUES(?1, ?2, ?3, ?4)",
            params![id, key, value, category],
        );

        log_change(conn, "semantic", key, "UPDATE", Some(&old_value), Some(value), Some("model update"));
    } else {
        // ADD — new memory
        action = "ADD";
        conn.execute(
            "INSERT INTO semantic_memories (key, value, category, namespace, confidence, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, 0.8, ?5, ?5)",
            params![key, value, category, namespace, now],
        ).map_err(|e| format!("Semantic insert failed: {}", e))?;

        let id = conn.last_insert_rowid();
        let _ = conn.execute(
            "INSERT INTO semantic_fts(rowid, key, value, category) VALUES(?1, ?2, ?3, ?4)",
            params![id, key, value, category],
        );

        log_change(conn, "semantic", key, "ADD", None, Some(value), Some("new memory"));
    }

    Ok(action.to_string())
}

pub fn semantic_search(conn: &Connection, query: &str, limit: u32) -> Result<Vec<SemanticMemory>, String> {
    semantic_search_ns(conn, query, None, limit)
}

/// Search semantic memories filtered by namespace prefix.
/// `namespace_prefix = Some("bakery")` matches `bakery`, `bakery.recipes`, `bakery.recipes.sourdough`, etc.
/// `namespace_prefix = None` searches all namespaces (back-compat with semantic_search).
pub fn semantic_search_ns(
    conn: &Connection,
    query: &str,
    namespace_prefix: Option<&str>,
    limit: u32,
) -> Result<Vec<SemanticMemory>, String> {
    let fts_query = query.split_whitespace()
        .map(|w| format!("\"{}\"", w.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ");

    let mut results = Vec::new();

    // Build the namespace WHERE clause once. SQLite's `||` does string concat;
    // we match exact namespace OR any namespace starting with `prefix.`.
    let ns_clause = if namespace_prefix.is_some() {
        " AND (sm.namespace = ?3 OR sm.namespace LIKE ?3 || '.%')"
    } else {
        ""
    };

    // FTS search with optional namespace filter
    let fts_sql = format!(
        "SELECT sm.id, sm.key, sm.value, sm.category, sm.namespace, sm.confidence, \
         sm.supersedes, sm.change_reason, sm.created_at, sm.updated_at, sm.access_count \
         FROM semantic_fts fts JOIN semantic_memories sm ON fts.rowid = sm.id \
         WHERE semantic_fts MATCH ?1{} ORDER BY rank LIMIT ?2",
        ns_clause
    );

    if let Ok(mut stmt) = conn.prepare(&fts_sql) {
        let row_mapper = |row: &rusqlite::Row| -> rusqlite::Result<SemanticMemory> {
            Ok(SemanticMemory {
                id: row.get(0)?,
                key: row.get(1)?,
                value: row.get(2)?,
                category: row.get(3)?,
                namespace: row.get(4)?,
                confidence: row.get(5)?,
                supersedes: row.get(6)?,
                change_reason: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                access_count: row.get(10)?,
            })
        };

        let rows_result = if let Some(ns) = namespace_prefix {
            stmt.query_map(params![fts_query, limit, ns], row_mapper)
        } else {
            stmt.query_map(params![fts_query, limit], row_mapper)
        };

        if let Ok(rows) = rows_result {
            for row in rows.flatten() {
                results.push(row);
            }
        }
    }

    // Fallback to LIKE if FTS returned nothing
    if results.is_empty() {
        let pattern = format!("%{}%", query);
        let like_sql = format!(
            "SELECT id, key, value, category, namespace, confidence, supersedes, change_reason, \
             created_at, updated_at, access_count FROM semantic_memories \
             WHERE (key LIKE ?1 OR value LIKE ?1){} ORDER BY updated_at DESC LIMIT ?2",
            if namespace_prefix.is_some() {
                " AND (namespace = ?3 OR namespace LIKE ?3 || '.%')"
            } else {
                ""
            }
        );

        let mut stmt = conn.prepare(&like_sql).map_err(|e| e.to_string())?;
        let row_mapper = |row: &rusqlite::Row| -> rusqlite::Result<SemanticMemory> {
            Ok(SemanticMemory {
                id: row.get(0)?,
                key: row.get(1)?,
                value: row.get(2)?,
                category: row.get(3)?,
                namespace: row.get(4)?,
                confidence: row.get(5)?,
                supersedes: row.get(6)?,
                change_reason: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                access_count: row.get(10)?,
            })
        };

        let rows_result = if let Some(ns) = namespace_prefix {
            stmt.query_map(params![pattern, limit, ns], row_mapper)
        } else {
            stmt.query_map(params![pattern, limit], row_mapper)
        };

        for row in rows_result.map_err(|e| e.to_string())?.flatten() {
            results.push(row);
        }
    }

    // Update access counts
    for mem in &results {
        let _ = conn.execute(
            "UPDATE semantic_memories SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?1",
            params![mem.id],
        );
    }

    Ok(results)
}

pub fn semantic_get_all(conn: &Connection) -> Result<Vec<SemanticMemory>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, key, value, category, namespace, confidence, supersedes, change_reason, \
         created_at, updated_at, access_count FROM semantic_memories ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(SemanticMemory {
            id: row.get(0)?,
            key: row.get(1)?,
            value: row.get(2)?,
            category: row.get(3)?,
            namespace: row.get(4)?,
            confidence: row.get(5)?,
            supersedes: row.get(6)?,
            change_reason: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            access_count: row.get(10)?,
        })
    }).map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

/// List distinct namespaces under an optional prefix.
/// `prefix = None` returns all namespaces. `prefix = Some("bakery")` returns
/// `bakery`, `bakery.recipes`, etc. Used by the memory dashboard tree view.
pub fn semantic_list_namespaces(conn: &Connection, prefix: Option<&str>) -> Result<Vec<String>, String> {
    let (sql, has_param) = match prefix {
        Some(_) => (
            "SELECT DISTINCT namespace FROM semantic_memories \
             WHERE namespace = ?1 OR namespace LIKE ?1 || '.%' \
             ORDER BY namespace",
            true,
        ),
        None => (
            "SELECT DISTINCT namespace FROM semantic_memories ORDER BY namespace",
            false,
        ),
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows: Vec<String> = if has_param {
        stmt.query_map(params![prefix.unwrap()], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect()
    } else {
        stmt.query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect()
    };

    Ok(rows)
}

pub fn semantic_delete(conn: &Connection, key: &str) -> Result<(), String> {
    let old: Option<String> = conn.query_row(
        "SELECT value FROM semantic_memories WHERE key = ?1", params![key], |r| r.get(0)
    ).ok();

    conn.execute("DELETE FROM semantic_memories WHERE key = ?1", params![key])
        .map_err(|e| format!("Delete failed: {}", e))?;

    log_change(conn, "semantic", key, "DELETE", old.as_deref(), None, Some("user or model delete"));
    Ok(())
}

pub fn semantic_edit(conn: &Connection, key: &str, new_value: &str) -> Result<(), String> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    conn.execute(
        "UPDATE semantic_memories SET value = ?1, updated_at = ?2 WHERE key = ?3",
        params![new_value, now, key],
    ).map_err(|e| format!("Edit failed: {}", e))?;
    log_change(conn, "semantic", key, "EDIT", None, Some(new_value), Some("user manual edit"));
    Ok(())
}

// ---------------------------------------------------------------------------
// Episodic Memory
// ---------------------------------------------------------------------------

pub fn episodic_save(conn: &Connection, conv_id: &str, summary: &str,
                     topics: &str, entities: &str, tone: &str, turns: i64) -> Result<(), String> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();

    conn.execute(
        "INSERT OR REPLACE INTO episodic_memories \
         (conversation_id, date, summary, topics, entities, emotional_tone, turn_count, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![conv_id, date, summary, topics, entities, tone, turns, now],
    ).map_err(|e| format!("Episodic save failed: {}", e))?;

    log_change(conn, "episodic", conv_id, "ADD", None, Some(summary), Some("dream cycle"));
    Ok(())
}

pub fn episodic_search(conn: &Connection, query: &str, limit: u32) -> Result<Vec<EpisodicMemory>, String> {
    let pattern = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, date, summary, topics, entities, emotional_tone, turn_count, namespace \
         FROM episodic_memories WHERE summary LIKE ?1 OR topics LIKE ?1 \
         ORDER BY date DESC LIMIT ?2"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![pattern, limit], |row| {
        Ok(EpisodicMemory {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            date: row.get(2)?,
            summary: row.get(3)?,
            topics: row.get(4)?,
            entities: row.get(5)?,
            emotional_tone: row.get(6)?,
            turn_count: row.get(7)?,
            namespace: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

pub fn episodic_get_recent(conn: &Connection, limit: u32) -> Result<Vec<EpisodicMemory>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, date, summary, topics, entities, emotional_tone, turn_count, namespace \
         FROM episodic_memories ORDER BY date DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![limit], |row| {
        Ok(EpisodicMemory {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            date: row.get(2)?,
            summary: row.get(3)?,
            topics: row.get(4)?,
            entities: row.get(5)?,
            emotional_tone: row.get(6)?,
            turn_count: row.get(7)?,
            namespace: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

// ---------------------------------------------------------------------------
// Procedural Memory
// ---------------------------------------------------------------------------

pub fn procedural_save(conn: &Connection, name: &str, description: &str, steps: &str) -> Result<(), String> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    conn.execute(
        "INSERT OR REPLACE INTO procedural_memories \
         (name, description, steps, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![name, description, steps, now],
    ).map_err(|e| format!("Procedural save failed: {}", e))?;

    log_change(conn, "procedural", name, "ADD", None, Some(description), Some("learned from conversation"));
    Ok(())
}

pub fn procedural_get_all(conn: &Connection) -> Result<Vec<ProceduralMemory>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, steps, times_referenced, created_at, namespace \
         FROM procedural_memories ORDER BY times_referenced DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(ProceduralMemory {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            steps: row.get(3)?,
            times_referenced: row.get(4)?,
            created_at: row.get(5)?,
            namespace: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

// ---------------------------------------------------------------------------
// Stats & Changelog
// ---------------------------------------------------------------------------

pub fn get_stats(conn: &Connection) -> Result<MemoryStats, String> {
    let core = core_read(conn).unwrap_or_default();
    let semantic: i64 = conn.query_row("SELECT COUNT(*) FROM semantic_memories", [], |r| r.get(0)).unwrap_or(0);
    let episodic: i64 = conn.query_row("SELECT COUNT(*) FROM episodic_memories", [], |r| r.get(0)).unwrap_or(0);
    let procedural: i64 = conn.query_row("SELECT COUNT(*) FROM procedural_memories", [], |r| r.get(0)).unwrap_or(0);
    let changelog: i64 = conn.query_row("SELECT COUNT(*) FROM memory_changelog", [], |r| r.get(0)).unwrap_or(0);
    let last_dream: Option<String> = conn.query_row(
        "SELECT value FROM memory_meta WHERE key = 'last_dream_cycle'", [], |r| r.get(0)
    ).ok();

    Ok(MemoryStats {
        core_length: core.len(),
        semantic_count: semantic,
        episodic_count: episodic,
        procedural_count: procedural,
        changelog_count: changelog,
        last_dream_cycle: last_dream,
    })
}

pub fn get_changelog(conn: &Connection, limit: u32) -> Result<Vec<ChangelogEntry>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, memory_type, memory_key, action, old_value, new_value, reason, timestamp \
         FROM memory_changelog ORDER BY id DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![limit], |row| {
        Ok(ChangelogEntry {
            id: row.get(0)?,
            memory_type: row.get(1)?,
            memory_key: row.get(2)?,
            action: row.get(3)?,
            old_value: row.get(4)?,
            new_value: row.get(5)?,
            reason: row.get(6)?,
            timestamp: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;

    Ok(rows.flatten().collect())
}

// ---------------------------------------------------------------------------
// Memory context builder (for system prompt injection)
// ---------------------------------------------------------------------------

pub fn build_memory_context(conn: &Connection) -> Result<String, String> {
    let mut ctx = String::new();

    // 1. Core memory
    let core = core_read(conn)?;
    if !core.is_empty() {
        ctx.push_str("[MEMORY — About the user]\n");
        ctx.push_str(&core);
        ctx.push_str("\n\n");
    }

    // 2. Recent sessions (last 3)
    let episodes = episodic_get_recent(conn, 3)?;
    if !episodes.is_empty() {
        ctx.push_str("[MEMORY — Recent sessions]\n");
        for ep in &episodes {
            ctx.push_str(&format!("{}: {}\n", ep.date, ep.summary));
        }
        ctx.push('\n');
    }

    // 3. High-confidence semantic facts (top 10 by access + recency)
    if let Ok(mut stmt) = conn.prepare(
        "SELECT key, value FROM semantic_memories WHERE confidence >= 0.5 \
         ORDER BY access_count DESC, updated_at DESC LIMIT 10"
    ) {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) {
            let facts: Vec<(String, String)> = rows.flatten().collect();
            if !facts.is_empty() {
                ctx.push_str("[MEMORY — Known facts]\n");
                for (k, v) in &facts {
                    ctx.push_str(&format!("{}: {}\n", k, v));
                }
                ctx.push('\n');
            }
        }
    }

    Ok(ctx)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn log_change(conn: &Connection, mem_type: &str, key: &str, action: &str,
              old_val: Option<&str>, new_val: Option<&str>, reason: Option<&str>) {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let _ = conn.execute(
        "INSERT INTO memory_changelog (memory_type, memory_key, action, old_value, new_value, reason, timestamp) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![mem_type, key, action, old_val, new_val, reason, now],
    );
}
