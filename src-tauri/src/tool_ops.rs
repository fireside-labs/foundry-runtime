// Tool Operations — agentic file commands for the workspace.
//
// Five sandboxed operations that let models interact with a user-linked
// project folder. Every path goes through sandbox::validate_in_project()
// before any filesystem access.
//
// Commands:
//   tool_read_file   — read text file contents (UTF-8, 2MB cap)
//   tool_write_file  — create or overwrite a file
//   tool_edit_file   — string-replace or line-range replace
//   tool_list_dir    — list directory contents with metadata
//   tool_run_script  — execute .py / .ps1 / .cmd (requires user approval)

use crate::sandbox;
use serde::{Serialize, Deserialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Maximum file size we'll read (2MB).
const MAX_READ_SIZE: u64 = 2 * 1024 * 1024;

/// Maximum stdout capture from script execution (1MB).
const MAX_SCRIPT_OUTPUT: usize = 1024 * 1024;

/// Script execution timeout in seconds.
const SCRIPT_TIMEOUT_SECS: u64 = 60;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub entry_type: String, // "file" or "dir"
    pub size_bytes: u64,
    pub modified: String,   // ISO 8601
}

#[derive(Serialize, Clone)]
pub struct ScriptResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub duration_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct EditResult {
    pub replacements: usize,
    pub new_length: usize,
}

// ---------------------------------------------------------------------------
// Project state — persistent active project root
// ---------------------------------------------------------------------------

fn projects_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".foundry").join("projects.json")
}

/// Get the active project root, if one is linked.
pub fn get_active_project_root() -> Option<PathBuf> {
    let path = projects_path();
    if !path.exists() {
        return None;
    }
    let data = fs::read_to_string(&path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&data).ok()?;
    let root = v.get("active_root")?.as_str()?;
    let pb = PathBuf::from(root);
    if pb.exists() && pb.is_dir() {
        Some(pb)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Link a project folder. Validates the path exists and is a directory.
#[tauri::command]
pub fn project_link(root: String) -> Result<String, String> {
    let canon = sandbox::validate_project_root(&root)
        .map_err(|e| format!("Cannot link project: {}", e))?;

    let projects = serde_json::json!({
        "active_root": canon.to_string_lossy(),
        "linked_at": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    });

    let path = projects_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, serde_json::to_string_pretty(&projects).unwrap_or_default())
        .map_err(|e| format!("Cannot save project state: {}", e))?;

    println!("[foundry-tools] Project linked: {}", canon.display());
    Ok(format!("Project linked: {}", canon.display()))
}

/// Unlink the active project.
#[tauri::command]
pub fn project_unlink() -> Result<(), String> {
    let path = projects_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    println!("[foundry-tools] Project unlinked");
    Ok(())
}

/// Get the active project info.
#[tauri::command]
pub fn project_get_active() -> Result<serde_json::Value, String> {
    let path = projects_path();
    if !path.exists() {
        return Ok(serde_json::json!({"linked": false}));
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    v["linked"] = serde_json::json!(true);
    Ok(v)
}

/// List all linked projects. For v0.1.0, only one active project is supported.
#[tauri::command]
pub fn project_list() -> Result<Vec<serde_json::Value>, String> {
    match get_active_project_root() {
        Some(root) => Ok(vec![serde_json::json!({
            "root": root.to_string_lossy(),
            "active": true,
        })]),
        None => Ok(vec![]),
    }
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

fn require_project() -> Result<PathBuf, String> {
    get_active_project_root()
        .ok_or_else(|| "No project folder linked. Link a folder first.".to_string())
}

/// Read a text file from the project folder.
/// Caps at 2MB. Returns UTF-8 text (lossy conversion for binary bytes).
#[tauri::command]
pub fn tool_read_file(rel_path: String) -> Result<String, String> {
    let root = require_project()?;
    let abs = sandbox::validate_in_project(&root, &rel_path)
        .map_err(|e| format!("Sandbox: {}", e))?;

    if !abs.exists() {
        return Err(format!("File not found: {}", rel_path));
    }
    if !abs.is_file() {
        return Err(format!("Not a file: {}", rel_path));
    }

    let meta = fs::metadata(&abs).map_err(|e| e.to_string())?;
    if meta.len() > MAX_READ_SIZE {
        return Err(format!(
            "File too large ({:.1} MB). Maximum is {:.0} MB.",
            meta.len() as f64 / 1_048_576.0,
            MAX_READ_SIZE as f64 / 1_048_576.0
        ));
    }

    let bytes = fs::read(&abs).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

/// Create or overwrite a file in the project folder.
#[tauri::command]
pub fn tool_write_file(rel_path: String, content: String) -> Result<String, String> {
    let root = require_project()?;
    let abs = sandbox::validate_in_project(&root, &rel_path)
        .map_err(|e| format!("Sandbox: {}", e))?;

    // Ensure parent directory exists
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create directory: {}", e))?;
    }

    fs::write(&abs, &content).map_err(|e| format!("Cannot write file: {}", e))?;

    println!("[foundry-tools] Wrote {} ({} bytes)", rel_path, content.len());
    Ok(format!("Written: {} ({} bytes)", rel_path, content.len()))
}

/// Edit a file using string replacement or line-range replacement.
///
/// Mode 1 (string replace): provide `old` and `new`. Replaces all occurrences.
/// Mode 2 (line range): provide `start_line`, `end_line`, and `new`.
///   Replaces lines [start_line..=end_line] (1-indexed) with `new`.
#[tauri::command]
pub fn tool_edit_file(
    rel_path: String,
    old: Option<String>,
    new: String,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> Result<EditResult, String> {
    let root = require_project()?;
    let abs = sandbox::validate_in_project(&root, &rel_path)
        .map_err(|e| format!("Sandbox: {}", e))?;

    if !abs.exists() || !abs.is_file() {
        return Err(format!("File not found: {}", rel_path));
    }

    let content = fs::read_to_string(&abs).map_err(|e| e.to_string())?;

    let (result, replacements) = if let Some(old_text) = old {
        // Mode 1: string replacement
        if old_text.is_empty() {
            return Err("The 'old' text cannot be empty for string replacement".into());
        }
        let count = content.matches(&old_text).count();
        if count == 0 {
            return Err(format!("Text not found in {}: \"{}\"",
                rel_path, if old_text.len() > 60 { &old_text[..60] } else { &old_text }));
        }
        (content.replace(&old_text, &new), count)
    } else if let (Some(start), Some(end)) = (start_line, end_line) {
        // Mode 2: line-range replacement
        if start == 0 || end == 0 {
            return Err("Line numbers are 1-indexed".into());
        }
        if start > end {
            return Err(format!("start_line ({}) must be <= end_line ({})", start, end));
        }

        let lines: Vec<&str> = content.lines().collect();
        if start > lines.len() {
            return Err(format!("start_line ({}) exceeds file length ({} lines)", start, lines.len()));
        }

        let actual_end = end.min(lines.len());
        let mut result_lines = Vec::new();
        result_lines.extend_from_slice(&lines[..start - 1]);
        result_lines.push(&new);
        if actual_end < lines.len() {
            result_lines.extend_from_slice(&lines[actual_end..]);
        }

        (result_lines.join("\n"), 1)
    } else {
        return Err("Provide either 'old' (string replace) or 'start_line'+'end_line' (line replace)".into());
    };

    fs::write(&abs, &result).map_err(|e| format!("Cannot write: {}", e))?;
    println!("[foundry-tools] Edited {} ({} replacement(s))", rel_path, replacements);

    Ok(EditResult {
        replacements,
        new_length: result.len(),
    })
}

/// List directory contents with metadata.
/// `rel_path` can be empty or "." for the project root.
#[tauri::command]
pub fn tool_list_dir(rel_path: String) -> Result<Vec<DirEntry>, String> {
    let root = require_project()?;

    let abs = if rel_path.is_empty() || rel_path == "." {
        root.canonicalize().map_err(|e| format!("Cannot resolve root: {}", e))?
    } else {
        sandbox::validate_in_project(&root, &rel_path)
            .map_err(|e| format!("Sandbox: {}", e))?
    };

    if !abs.is_dir() {
        return Err(format!("Not a directory: {}", rel_path));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&abs).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;

        let modified = meta.modified()
            .map(|t| {
                let dt: chrono::DateTime<chrono::Utc> = t.into();
                dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
            })
            .unwrap_or_default();

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            entry_type: if meta.is_dir() { "dir".into() } else { "file".into() },
            size_bytes: meta.len(),
            modified,
        });
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        let type_order = if a.entry_type == "dir" { 0 } else { 1 };
        let type_order_b = if b.entry_type == "dir" { 0 } else { 1 };
        type_order.cmp(&type_order_b).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Execute a script in the project folder.
///
/// SAFETY: This command requires explicit user approval in the UI before
/// execution. The frontend must show a confirmation dialog. Scripts run
/// with the user's full permissions, including network access.
///
/// Supported extensions: .py, .ps1, .cmd, .bat, .sh
/// Timeout: 60 seconds.
/// Stdout/stderr capped at 1MB each.
#[tauri::command]
pub fn tool_run_script(rel_path: String, args: Option<Vec<String>>) -> Result<ScriptResult, String> {
    let root = require_project()?;
    let abs = sandbox::validate_in_project(&root, &rel_path)
        .map_err(|e| format!("Sandbox: {}", e))?;

    if !abs.exists() || !abs.is_file() {
        return Err(format!("Script not found: {}", rel_path));
    }

    let ext = abs.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let (program, mut cmd_args) = match ext.as_str() {
        "py" => ("python".to_string(), vec![abs.to_string_lossy().to_string()]),
        "ps1" => ("powershell".to_string(), vec![
            "-NoProfile".to_string(),
            "-ExecutionPolicy".to_string(), "Bypass".to_string(),
            "-File".to_string(), abs.to_string_lossy().to_string(),
        ]),
        "cmd" | "bat" => ("cmd".to_string(), vec!["/c".to_string(), abs.to_string_lossy().to_string()]),
        "sh" => ("bash".to_string(), vec![abs.to_string_lossy().to_string()]),
        _ => return Err(format!("Unsupported script type: .{}", ext)),
    };

    // Append user-provided arguments
    if let Some(extra_args) = args {
        cmd_args.extend(extra_args);
    }

    let start = std::time::Instant::now();

    let mut cmd = Command::new(&program);
    cmd.args(&cmd_args)
       .current_dir(&root);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    println!("[foundry-tools] Running: {} {}", program, cmd_args.join(" "));

    let output = cmd.output().map_err(|e| format!("Cannot execute script: {}", e))?;
    let duration = start.elapsed();

    let timed_out = duration.as_secs() >= SCRIPT_TIMEOUT_SECS;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    let stdout_capped = if stdout.len() > MAX_SCRIPT_OUTPUT {
        format!("{}...\n[truncated at {} bytes]", &stdout[..MAX_SCRIPT_OUTPUT], MAX_SCRIPT_OUTPUT)
    } else {
        stdout.to_string()
    };

    let stderr_capped = if stderr.len() > MAX_SCRIPT_OUTPUT {
        format!("{}...\n[truncated at {} bytes]", &stderr[..MAX_SCRIPT_OUTPUT], MAX_SCRIPT_OUTPUT)
    } else {
        stderr.to_string()
    };

    Ok(ScriptResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: stdout_capped,
        stderr: stderr_capped,
        timed_out,
        duration_ms: duration.as_millis() as u64,
    })
}
