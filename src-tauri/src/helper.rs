// Foundry Helper Model — Manages a second llama-server instance for memory operations.
// Runs on a separate port (8081), auto-detects VRAM to pick CPU vs GPU mode.

use std::process::{Command, Child};
use std::sync::{Arc, Mutex};
use serde::Serialize;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Serialize, Clone, Debug)]
pub struct HelperStatus {
    pub running: bool,
    pub model: String,
    pub port: u16,
    pub mode: String, // "gpu" or "cpu"
}

pub struct HelperState {
    pub child: Option<Child>,
    pub model_name: String,
    pub port: u16,
    pub mode: String,
}

impl Default for HelperState {
    fn default() -> Self {
        Self {
            child: None,
            model_name: String::new(),
            port: 8081,
            mode: "cpu".into(),
        }
    }
}

fn silent_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd
}

/// Find a small helper GGUF in ~/.foundry/helpers/
pub fn find_helper_model() -> Option<std::path::PathBuf> {
    let home = dirs::home_dir()?;
    let helpers_dir = home.join(".foundry").join("helpers");

    if !helpers_dir.exists() {
        return None;
    }

    let mut ggufs: Vec<_> = std::fs::read_dir(&helpers_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "gguf"))
        .collect();

    ggufs.sort_by_key(|e| std::cmp::Reverse(
        e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    ));

    ggufs.first().map(|e| e.path())
}

/// Detect available VRAM and decide GPU vs CPU mode for helper.
fn detect_helper_mode(main_model_vram_mb: f64, total_vram_mb: f64) -> String {
    let free_vram = total_vram_mb - main_model_vram_mb;
    // If >2GB free VRAM, run helper on GPU; otherwise CPU
    if free_vram > 2000.0 {
        "gpu".into()
    } else {
        "cpu".into()
    }
}

/// Start the helper model on port 8081.
pub fn start_helper(
    state: &Arc<Mutex<HelperState>>,
    llama_server_path: &str,
) -> Result<String, String> {
    let model_path = find_helper_model()
        .ok_or("No helper model found in ~/.foundry/helpers/. Download a small GGUF (e.g., Qwen2.5-0.5B) there.")?;

    let model_name = model_path.file_name()
        .unwrap_or_default().to_string_lossy().to_string();

    // Kill existing
    {
        let mut s = state.lock().map_err(|e| format!("Lock: {}", e))?;
        if let Some(ref mut child) = s.child {
            let _ = child.kill();
            let _ = child.wait();
        }
        s.child = None;
    }

    std::thread::sleep(std::time::Duration::from_millis(300));

    // For now, default to CPU mode (safe for all configs)
    let mode = "cpu".to_string();
    let port: u16 = 8081;

    let mut args = vec![
        "--model".to_string(), model_path.to_string_lossy().to_string(),
        "--port".to_string(), port.to_string(),
        "--host".to_string(), "127.0.0.1".to_string(),
        "--ctx-size".to_string(), "4096".to_string(),
        "--threads".to_string(), "4".to_string(),
    ];

    if mode == "gpu" {
        args.push("--n-gpu-layers".to_string());
        args.push("99".to_string());
    } else {
        args.push("--n-gpu-layers".to_string());
        args.push("0".to_string());
    }

    println!("[foundry-helper] Starting: {} {}", llama_server_path, args.join(" "));

    match silent_cmd(llama_server_path).args(&args).spawn() {
        Ok(child) => {
            let pid = child.id();
            let mut s = state.lock().map_err(|e| format!("Lock: {}", e))?;
            s.child = Some(child);
            s.model_name = model_name.clone();
            s.port = port;
            s.mode = mode;
            let msg = format!("Helper started (pid={:?}) — {}", pid, model_name);
            println!("[foundry-helper] {}", msg);
            Ok(msg)
        }
        Err(e) => Err(format!("Failed to start helper: {}", e)),
    }
}

pub fn stop_helper(state: &Arc<Mutex<HelperState>>) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| format!("Lock: {}", e))?;
    if let Some(ref mut child) = s.child {
        let _ = child.kill();
        let _ = child.wait();
        println!("[foundry-helper] Stopped");
    }
    s.child = None;
    s.model_name.clear();
    Ok(())
}

pub fn get_status(state: &Arc<Mutex<HelperState>>) -> HelperStatus {
    let s = state.lock().unwrap();
    let running = s.child.is_some() && std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", s.port).parse().unwrap(),
        std::time::Duration::from_millis(300),
    ).is_ok();

    HelperStatus {
        running,
        model: s.model_name.clone(),
        port: s.port,
        mode: s.mode.clone(),
    }
}

/// Call the helper model to summarize a conversation and extract memories.
/// Returns JSON with: summary, facts[], procedures[]
pub fn run_dream_cycle(
    state: &Arc<Mutex<HelperState>>,
    conversation_json: &str,
) -> Result<String, String> {
    let status = get_status(state);
    if !status.running {
        return Err("Helper model is not running. Start it first.".into());
    }

    let endpoint = format!("http://127.0.0.1:{}/v1/chat/completions", status.port);

    let prompt = format!(r#"You are a memory extraction assistant. Analyze this conversation and output JSON with:
1. "summary": A 2-3 sentence summary of what was discussed.
2. "facts": Array of {{"key": "dot.notation.key", "value": "fact text", "category": "preference|fact|relationship|project|technical"}} for any new facts learned about the user.
3. "procedures": Array of {{"name": "short_name", "description": "what it does", "steps": ["step1", "step2"]}} for any multi-step workflows discussed.
4. "tone": The emotional tone of the conversation (e.g., "productive", "frustrated", "excited").

Conversation:
{}

Respond with ONLY valid JSON, no markdown."#, conversation_json);

    let body = serde_json::json!({
        "model": "helper",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 2048,
    });

    // Use powershell to call the helper (keeps it cross-platform via existing pattern)
    let body_str = serde_json::to_string(&body).unwrap_or_default();
    let ps_cmd = format!(
        "$body = '{}'; (Invoke-WebRequest -Uri '{}' -Method POST -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 60).Content",
        body_str.replace("'", "''"),
        endpoint,
    );

    let output = silent_cmd("powershell")
        .args(["-NoProfile", "-Command", &ps_cmd])
        .output()
        .map_err(|e| format!("Helper call failed: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Helper returned error: {}", err));
    }

    let response = String::from_utf8_lossy(&output.stdout).to_string();

    // Extract the content from the chat completion response
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&response) {
        if let Some(content) = v["choices"][0]["message"]["content"].as_str() {
            return Ok(content.to_string());
        }
    }

    Ok(response)
}
