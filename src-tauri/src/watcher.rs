// File Watcher — monitors knowledge base folders for changes.
//
// When a file is created, modified, or deleted inside a KB root directory,
// the watcher triggers a re-index of that specific knowledge base.
//
// Uses the `notify` crate (cross-platform filesystem events).
// Debounces rapid file changes (e.g., git checkout) to avoid redundant re-indexes.

use notify::{Watcher, RecursiveMode, Event, EventKind};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::thread;
use std::path::PathBuf;
use std::collections::HashMap;

/// Minimum time between re-indexes for the same KB (debounce).
const DEBOUNCE_SECS: u64 = 5;

/// Shared state for the watcher system.
pub struct WatcherState {
    /// Currently watched KB IDs → their root paths
    pub watched: HashMap<String, PathBuf>,
    /// Last re-index timestamp per KB
    pub last_indexed: HashMap<String, Instant>,
    /// Flag to stop the watcher thread
    pub running: bool,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watched: HashMap::new(),
            last_indexed: HashMap::new(),
            running: false,
        }
    }
}

/// Start watching a knowledge base folder for changes.
/// Spawns a background thread that monitors the filesystem.
pub fn start_watcher(state: Arc<Mutex<WatcherState>>) {
    let state_clone = state.clone();

    thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[foundry-watcher] Cannot create watcher: {}", e);
                return;
            }
        };

        // Mark as running
        if let Ok(mut s) = state_clone.lock() {
            s.running = true;
        }

        println!("[foundry-watcher] File watcher thread started");

        // Watch all currently registered KB paths
        if let Ok(s) = state_clone.lock() {
            for (kb_id, path) in &s.watched {
                if path.exists() {
                    match watcher.watch(path, RecursiveMode::Recursive) {
                        Ok(_) => println!("[foundry-watcher] Watching: {} ({})", kb_id, path.display()),
                        Err(e) => eprintln!("[foundry-watcher] Cannot watch {}: {}", path.display(), e),
                    }
                }
            }
        }

        // Event loop
        loop {
            // Check if we should stop
            if let Ok(s) = state_clone.lock() {
                if !s.running {
                    println!("[foundry-watcher] Shutting down");
                    break;
                }
            }

            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(Ok(event)) => {
                    // Only react to file content changes
                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                            handle_file_event(&state_clone, &event);
                        }
                        _ => {}
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("[foundry-watcher] Watch error: {}", e);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // Normal timeout — check for new KBs to watch
                    if let Ok(s) = state_clone.lock() {
                        for (kb_id, path) in &s.watched {
                            if path.exists() {
                                // Re-watch is idempotent in notify
                                let _ = watcher.watch(path, RecursiveMode::Recursive);
                            }
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    println!("[foundry-watcher] Channel disconnected, shutting down");
                    break;
                }
            }
        }
    });
}

/// Handle a filesystem event by finding which KB it belongs to and
/// scheduling a re-index (with debounce).
fn handle_file_event(state: &Arc<Mutex<WatcherState>>, event: &Event) {
    let changed_paths = &event.paths;
    if changed_paths.is_empty() {
        return;
    }

    let changed = &changed_paths[0];

    // Skip hidden files, .git, etc.
    let path_str = changed.to_string_lossy();
    if path_str.contains(".git") || path_str.contains("node_modules") || path_str.contains("__pycache__") {
        return;
    }

    let mut s = match state.lock() {
        Ok(s) => s,
        Err(_) => return,
    };

    // Find which KB this file belongs to
    let mut target_kb: Option<String> = None;
    for (kb_id, root) in &s.watched {
        if changed.starts_with(root) {
            target_kb = Some(kb_id.clone());
            break;
        }
    }

    let kb_id = match target_kb {
        Some(id) => id,
        None => return,
    };

    // Debounce: skip if we re-indexed this KB recently
    if let Some(last) = s.last_indexed.get(&kb_id) {
        if last.elapsed() < Duration::from_secs(DEBOUNCE_SECS) {
            return;
        }
    }

    // Schedule re-index
    s.last_indexed.insert(kb_id.clone(), Instant::now());
    drop(s); // Release lock before re-indexing

    println!("[foundry-watcher] Change detected in KB {}, scheduling re-index", kb_id);

    // Spawn a separate thread for re-indexing (don't block the watcher)
    let kb_id_clone = kb_id.clone();
    thread::spawn(move || {
        // Small delay to batch rapid changes
        thread::sleep(Duration::from_secs(2));

        match crate::rag::kb_index(kb_id_clone.clone()) {
            Ok(progress) => {
                println!(
                    "[foundry-watcher] Re-indexed KB {}: {} files, {} chunks",
                    kb_id_clone, progress.files_processed, progress.chunks_created
                );
            }
            Err(e) => {
                eprintln!("[foundry-watcher] Re-index failed for {}: {}", kb_id_clone, e);
            }
        }
    });
}

/// Register a KB for watching.
pub fn watch_kb(state: &Arc<Mutex<WatcherState>>, kb_id: &str, root: PathBuf) {
    if let Ok(mut s) = state.lock() {
        s.watched.insert(kb_id.to_string(), root);
    }
}

/// Unregister a KB from watching.
pub fn unwatch_kb(state: &Arc<Mutex<WatcherState>>, kb_id: &str) {
    if let Ok(mut s) = state.lock() {
        s.watched.remove(kb_id);
    }
}
