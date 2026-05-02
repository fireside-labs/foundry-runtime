// Sandbox — path validation for agentic file operations.
//
// Every file operation (read, write, edit, list, run) passes through
// validate_in_project() before touching the filesystem. The contract:
//
//   1. Resolve the user-provided relative path against the project root.
//   2. Canonicalize both paths (resolves symlinks, normalizes separators).
//   3. Reject if the resolved path escapes the project root.
//   4. Reject absolute paths, empty paths, and null bytes.
//
// This module is the sole authority on "is this path safe?" — tool_ops.rs
// and rag.rs call it but never do their own path math.

use std::path::{Path, PathBuf};

/// Errors that can occur during sandbox validation.
#[derive(Debug)]
pub enum SandboxError {
    /// The relative path is empty.
    EmptyPath,
    /// The path contains null bytes (injection attempt).
    NullByte,
    /// The path is absolute (must be relative to project root).
    AbsolutePath,
    /// The resolved path escapes the project root.
    Escape,
    /// The project root itself is invalid or does not exist.
    InvalidRoot(String),
    /// Filesystem error during canonicalization.
    IoError(std::io::Error),
}

impl std::fmt::Display for SandboxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SandboxError::EmptyPath => write!(f, "Path cannot be empty"),
            SandboxError::NullByte => write!(f, "Path contains invalid characters"),
            SandboxError::AbsolutePath => write!(f, "Absolute paths are not allowed; use a path relative to the project folder"),
            SandboxError::Escape => write!(f, "Path escapes the project folder boundary"),
            SandboxError::InvalidRoot(msg) => write!(f, "Project root is invalid: {}", msg),
            SandboxError::IoError(e) => write!(f, "Filesystem error: {}", e),
        }
    }
}

impl From<std::io::Error> for SandboxError {
    fn from(e: std::io::Error) -> Self {
        SandboxError::IoError(e)
    }
}

/// Validate that `rel_path` resolves to a location inside `project_root`.
///
/// Returns the canonicalized absolute path on success.
///
/// # Security guarantees
/// - Rejects empty paths, null bytes, absolute paths.
/// - Canonicalizes the project root and the target path independently.
/// - Uses starts_with() on canonicalized paths to prevent symlink escapes.
/// - Does NOT require the target to exist (for write/create operations);
///   instead, it canonicalizes the deepest existing ancestor and verifies
///   the remainder doesn't escape.
pub fn validate_in_project(project_root: &Path, rel_path: &str) -> Result<PathBuf, SandboxError> {
    // --- Pre-checks on the raw input ---
    let rel_path = rel_path.trim();

    if rel_path.is_empty() {
        return Err(SandboxError::EmptyPath);
    }

    if rel_path.bytes().any(|b| b == 0) {
        return Err(SandboxError::NullByte);
    }

    // Reject absolute paths (Windows drive letters, UNC, Unix root)
    let as_path = Path::new(rel_path);
    if as_path.is_absolute() {
        return Err(SandboxError::AbsolutePath);
    }

    // Reject paths that start with a Windows drive-letter pattern (e.g., "C:")
    // even if Path::is_absolute doesn't catch edge cases.
    if rel_path.len() >= 2 && rel_path.as_bytes()[1] == b':' {
        return Err(SandboxError::AbsolutePath);
    }

    // --- Canonicalize the project root (must exist) ---
    let canon_root = project_root.canonicalize().map_err(|e| {
        SandboxError::InvalidRoot(format!("{}: {}", project_root.display(), e))
    })?;

    // --- Build the candidate path ---
    let candidate = canon_root.join(rel_path);

    // --- Canonicalize the candidate ---
    // If the full path exists, canonicalize directly.
    // If it doesn't (write/create case), walk up to the deepest existing
    // ancestor, canonicalize that, then re-append the non-existent tail.
    let canon_candidate = if candidate.exists() {
        candidate.canonicalize()?
    } else {
        // Find the deepest existing ancestor
        let mut existing_part = candidate.clone();
        let mut tail_parts: Vec<std::ffi::OsString> = Vec::new();

        while !existing_part.exists() {
            if let Some(file_name) = existing_part.file_name() {
                tail_parts.push(file_name.to_os_string());
                if let Some(parent) = existing_part.parent() {
                    existing_part = parent.to_path_buf();
                } else {
                    return Err(SandboxError::Escape);
                }
            } else {
                return Err(SandboxError::Escape);
            }
        }

        let mut result = existing_part.canonicalize()?;
        // Re-append the non-existent parts (in reverse, since we popped them)
        for part in tail_parts.into_iter().rev() {
            // Each component must not be ".." after canonicalization of the ancestor
            let part_str = part.to_string_lossy();
            if part_str == ".." {
                return Err(SandboxError::Escape);
            }
            result.push(part);
        }
        result
    };

    // --- The critical check: is the resolved path inside the project root? ---
    if !canon_candidate.starts_with(&canon_root) {
        return Err(SandboxError::Escape);
    }

    Ok(canon_candidate)
}

/// Validate and return the project root path. The directory must exist.
pub fn validate_project_root(root: &str) -> Result<PathBuf, SandboxError> {
    let root = root.trim();
    if root.is_empty() {
        return Err(SandboxError::InvalidRoot("empty path".into()));
    }
    let path = PathBuf::from(root);
    if !path.exists() {
        return Err(SandboxError::InvalidRoot(format!("does not exist: {}", root)));
    }
    if !path.is_dir() {
        return Err(SandboxError::InvalidRoot(format!("not a directory: {}", root)));
    }
    path.canonicalize().map_err(|e| SandboxError::InvalidRoot(format!("{}: {}", root, e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_valid_subpath() {
        let tmp = std::env::temp_dir().join("sandbox_test_valid");
        let _ = fs::create_dir_all(tmp.join("sub"));
        let _ = fs::write(tmp.join("sub").join("file.txt"), "hello");

        let result = validate_in_project(&tmp, "sub/file.txt");
        assert!(result.is_ok());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_escape_rejected() {
        let tmp = std::env::temp_dir().join("sandbox_test_escape");
        let _ = fs::create_dir_all(&tmp);

        let result = validate_in_project(&tmp, "../../../etc/passwd");
        assert!(matches!(result, Err(SandboxError::Escape)));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_absolute_rejected() {
        let tmp = std::env::temp_dir().join("sandbox_test_abs");
        let _ = fs::create_dir_all(&tmp);

        let result = validate_in_project(&tmp, "C:\\Windows\\System32\\cmd.exe");
        assert!(matches!(result, Err(SandboxError::AbsolutePath)));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_empty_rejected() {
        let tmp = std::env::temp_dir().join("sandbox_test_empty");
        let _ = fs::create_dir_all(&tmp);

        let result = validate_in_project(&tmp, "");
        assert!(matches!(result, Err(SandboxError::EmptyPath)));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_nonexistent_write_target() {
        let tmp = std::env::temp_dir().join("sandbox_test_write");
        let _ = fs::create_dir_all(&tmp);

        // Path doesn't exist yet, but parent does — should be OK for writes
        let result = validate_in_project(&tmp, "new_file.txt");
        assert!(result.is_ok());

        let _ = fs::remove_dir_all(&tmp);
    }
}
