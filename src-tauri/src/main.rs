// Foundry Runtime — Tauri v2 entry point
// Local AI inference for the enterprise. Pro-tier license gating is enforced
// at the application layer (workspace UI features), not at the inference binary
// layer. v0.1.0 ships with stock upstream llama-server from ggml-org/llama.cpp;
// any future Fireside-built llama-server with a real license-key flag would
// add that flag-passing logic here.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod memory;
mod helper;
mod binary_verify;
mod embed;
mod sandbox;
mod tool_ops;

use serde::Serialize;
use tauri::Emitter;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Create a Command that won't show a console window on Windows.
fn silent_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct SystemInfo {
    ram_gb: f64,
    vram_gb: f64,
    gpu: String,
    os: String,
    arch: String,
}

#[derive(Serialize, Clone)]
struct LicenseInfo {
    valid: bool,
    tier: String,        // "starter", "professional", "enterprise"
    customer_id: String,
    hardware_bound: bool,
    hardware_match: bool,
    expiry: String,      // ISO date or "perpetual"
}

#[derive(Serialize, Clone)]
struct GpuMetrics {
    gpu_util_percent: f64,
    vram_used_mb: f64,
    vram_total_mb: f64,
    temperature_c: f64,
}

#[derive(Serialize, Clone)]
struct InferenceMetrics {
    running: bool,
    model: String,
    tokens_per_second: f64,
    uptime_seconds: u64,
    port: u16,
    endpoint: String,
}

#[derive(serde::Deserialize)]
struct FoundryConfig {
    license_key: String,
    model: String,
}

// ---------------------------------------------------------------------------
// System Detection (kept from Fireside — critical)
// ---------------------------------------------------------------------------

/// Return system hardware info for the install wizard.
#[tauri::command]
fn get_system_info() -> SystemInfo {
    let ram_gb = {
        #[cfg(target_os = "windows")]
        {
            let output = silent_cmd("powershell")
                .args(["-NoProfile", "-Command",
                    "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"])
                .output();
            match output {
                Ok(o) => {
                    let s = String::from_utf8_lossy(&o.stdout);
                    s.trim()
                        .parse::<f64>()
                        .map(|b| (b / 1_073_741_824.0 * 10.0).round() / 10.0)
                        .unwrap_or(0.0)
                }
                Err(_) => 0.0,
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            0.0
        }
    };

    let (gpu, vram_gb) = {
        #[cfg(target_os = "windows")]
        {
            // Try nvidia-smi first (most accurate for NVIDIA GPUs)
            let nvsmi_path = "C:\\Windows\\System32\\nvidia-smi.exe";
            let nvidia_data = silent_cmd(nvsmi_path)
                .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
                .output()
                .ok()
                .and_then(|o| {
                    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    if s.is_empty() { return None; }
                    let first_line = s.lines().next()?;
                    let parts: Vec<&str> = first_line.split(',').collect();
                    if parts.len() >= 2 {
                        let name = parts[0].trim().to_string();
                        let mb = parts[1].trim().parse::<f64>().ok()?;
                        let gb = (mb / 1024.0 * 10.0).round() / 10.0;
                        Some((name, gb))
                    } else {
                        None
                    }
                });

            if let Some(data) = nvidia_data {
                data
            } else {
                // Fallback to WMI
                let wmi_data = silent_cmd("powershell")
                    .args(["-NoProfile", "-Command",
                        "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json"])
                    .output()
                    .ok()
                    .and_then(|o| {
                        let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        if s.is_empty() { return None; }
                        if s.starts_with('[') {
                            let list: Vec<serde_json::Value> = serde_json::from_str(&s).ok()?;
                            list.into_iter().max_by_key(|v| v["AdapterRAM"].as_f64().unwrap_or(0.0) as u64)
                        } else {
                            serde_json::from_str(&s).ok()
                        }
                    });

                match wmi_data {
                    Some(v) => {
                        let name = v["Name"].as_str().unwrap_or("Unknown").to_string();
                        let b = v["AdapterRAM"].as_f64().unwrap_or(0.0);
                        let gb = (b / 1_073_741_824.0 * 10.0).round() / 10.0;
                        (name, gb)
                    }
                    None => ("Unknown".into(), 0.0)
                }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            ("Unknown".into(), 0.0)
        }
    };

    SystemInfo {
        ram_gb,
        vram_gb,
        gpu,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Hardware ID (for license binding)
// ---------------------------------------------------------------------------

/// Generate a deterministic hardware fingerprint.
/// Uses GPU name + motherboard serial + disk serial via WMI.
#[tauri::command]
fn get_hardware_id() -> String {
    use sha2::{Sha256, Digest};

    let mut components = Vec::new();

    // GPU info
    #[cfg(target_os = "windows")]
    {
        if let Ok(o) = silent_cmd("powershell")
            .args(["-NoProfile", "-Command",
                "(Get-CimInstance Win32_VideoController | Select-Object -First 1).PNPDeviceID"])
            .output()
        {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !s.is_empty() { components.push(s); }
        }

        // Motherboard serial
        if let Ok(o) = silent_cmd("powershell")
            .args(["-NoProfile", "-Command",
                "(Get-CimInstance Win32_BaseBoard).SerialNumber"])
            .output()
        {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !s.is_empty() && s != "Default string" { components.push(s); }
        }

        // System UUID
        if let Ok(o) = silent_cmd("powershell")
            .args(["-NoProfile", "-Command",
                "(Get-CimInstance Win32_ComputerSystemProduct).UUID"])
            .output()
        {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !s.is_empty() { components.push(s); }
        }
    }

    // Fallback if nothing was collected
    if components.is_empty() {
        components.push("unknown-hardware".to_string());
    }

    let combined = components.join("|");
    let mut hasher = Sha256::new();
    hasher.update(combined.as_bytes());
    let hash = hasher.finalize();
    hex::encode(&hash[..16]) // 32-char hex fingerprint
}

// ---------------------------------------------------------------------------
// License Management (hardware-bound encryption seed)
// ---------------------------------------------------------------------------

/// Validate a license key format and extract metadata.
/// Format: FDRY-{tier}-{seed_high}-{seed_low}-{hwid_hash}
#[tauri::command]
fn validate_license(key: String) -> Result<LicenseInfo, String> {
    let parts: Vec<&str> = key.split('-').collect();
    if parts.len() != 5 || parts[0] != "FDRY" {
        return Err("Invalid license key format. Expected: FDRY-TIER-XXXX-XXXX-XXXX".into());
    }

    let tier = match parts[1].to_uppercase().as_str() {
        "STR" => "starter",
        "PRO" => "professional",
        "ENT" => "enterprise",
        _ => return Err(format!("Unknown license tier: {}", parts[1])),
    };

    // Validate hex components
    let _seed_high = u32::from_str_radix(parts[2], 16)
        .map_err(|_| "Invalid seed component (high)")?;
    let _seed_low = u32::from_str_radix(parts[3], 16)
        .map_err(|_| "Invalid seed component (low)")?;

    let hwid_hash = parts[4];
    let current_hwid = get_hardware_id();
    let hardware_match = current_hwid.starts_with(hwid_hash);

    Ok(LicenseInfo {
        valid: true,
        tier: tier.to_string(),
        customer_id: format!("{}-{}", parts[2], parts[3]),
        hardware_bound: true,
        hardware_match,
        expiry: "perpetual".to_string(),
    })
}

/// Bind a license key to this hardware and persist it.
#[tauri::command]
fn bind_license(key: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let foundry_dir = home.join(".foundry");
    fs::create_dir_all(&foundry_dir).map_err(|e| e.to_string())?;

    // Validate first
    let info = validate_license(key.clone())?;
    if !info.hardware_match {
        return Err("License key is bound to different hardware. Contact support.".into());
    }

    // Write license key
    fs::write(foundry_dir.join("license.key"), &key).map_err(|e| e.to_string())?;

    // Write license metadata
    let meta = serde_json::json!({
        "tier": info.tier,
        "customer_id": info.customer_id,
        "hardware_id": get_hardware_id(),
        "bound_at": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    });
    fs::write(
        foundry_dir.join("license.json"),
        serde_json::to_string_pretty(&meta).unwrap_or_default(),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// Get current license status.
#[tauri::command]
fn get_license_status() -> LicenseInfo {
    let home = dirs::home_dir().unwrap_or_default();
    let key_path = home.join(".foundry").join("license.key");

    if !key_path.exists() {
        return LicenseInfo {
            valid: false,
            tier: "none".into(),
            customer_id: "".into(),
            hardware_bound: false,
            hardware_match: false,
            expiry: "".into(),
        };
    }

    match fs::read_to_string(&key_path) {
        Ok(key) => validate_license(key.trim().to_string()).unwrap_or(LicenseInfo {
            valid: false,
            tier: "invalid".into(),
            customer_id: "".into(),
            hardware_bound: false,
            hardware_match: false,
            expiry: "".into(),
        }),
        Err(_) => LicenseInfo {
            valid: false,
            tier: "read_error".into(),
            customer_id: "".into(),
            hardware_bound: false,
            hardware_match: false,
            expiry: "".into(),
        },
    }
}

// ---------------------------------------------------------------------------
// GPU Metrics (for status bar)
// ---------------------------------------------------------------------------

/// Get real-time GPU metrics via nvidia-smi.
#[tauri::command]
fn get_gpu_metrics() -> GpuMetrics {
    #[cfg(target_os = "windows")]
    {
        let nvsmi = "C:\\Windows\\System32\\nvidia-smi.exe";
        if let Ok(o) = silent_cmd(nvsmi)
            .args(["--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
                   "--format=csv,noheader,nounits"])
            .output()
        {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if let Some(line) = s.lines().next() {
                let parts: Vec<&str> = line.split(',').map(|p| p.trim()).collect();
                if parts.len() >= 4 {
                    return GpuMetrics {
                        gpu_util_percent: parts[0].parse().unwrap_or(0.0),
                        vram_used_mb: parts[1].parse().unwrap_or(0.0),
                        vram_total_mb: parts[2].parse().unwrap_or(0.0),
                        temperature_c: parts[3].parse().unwrap_or(0.0),
                    };
                }
            }
        }
    }
    GpuMetrics { gpu_util_percent: 0.0, vram_used_mb: 0.0, vram_total_mb: 0.0, temperature_c: 0.0 }
}

/// Get inference server metrics.
#[tauri::command]
async fn get_inference_metrics() -> InferenceMetrics {
    let port: u16 = 8080;
    let endpoint = format!("http://127.0.0.1:{}", port);

    // Check if server is running
    let running = std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        std::time::Duration::from_millis(300),
    ).is_ok();

    if !running {
        return InferenceMetrics {
            running: false,
            model: "None".into(),
            tokens_per_second: 0.0,
            uptime_seconds: 0,
            port,
            endpoint,
        };
    }

    // Try to get model info from /health
    let mut model = "Unknown".to_string();
    let mut tps = 0.0;

    if let Ok(o) = silent_cmd("powershell")
        .args(["-NoProfile", "-Command",
            &format!("(Invoke-WebRequest -Uri '{}/health' -TimeoutSec 2 -UseBasicParsing).Content", endpoint)])
        .output()
    {
        if o.status.success() {
            let body = String::from_utf8_lossy(&o.stdout).to_string();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(m) = v.get("model").and_then(|m| m.as_str()) {
                    // Extract just the filename from the full path
                    model = m.split(['/', '\\']).last().unwrap_or(m).to_string();
                }
            }
        }
    }

    // Try /metrics for tokens/sec
    if let Ok(o) = silent_cmd("powershell")
        .args(["-NoProfile", "-Command",
            &format!("(Invoke-WebRequest -Uri '{}/metrics' -TimeoutSec 2 -UseBasicParsing).Content", endpoint)])
        .output()
    {
        if o.status.success() {
            let body = String::from_utf8_lossy(&o.stdout).to_string();
            // Parse Prometheus-format metrics for tokens_predicted_per_second
            for line in body.lines() {
                if line.starts_with("llamacpp:tokens_predicted_per_second") ||
                   line.contains("tokens_second") {
                    if let Some(val) = line.split_whitespace().last() {
                        tps = val.parse().unwrap_or(0.0);
                    }
                }
            }
        }
    }

    InferenceMetrics {
        running: true,
        model,
        tokens_per_second: tps,
        uptime_seconds: 0, // TODO: track from launch timestamp
        port,
        endpoint,
    }
}

// ---------------------------------------------------------------------------
// Write Foundry config
// ---------------------------------------------------------------------------

#[tauri::command]
fn write_config(config: FoundryConfig) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let foundry_dir = home.join(".foundry");
    fs::create_dir_all(&foundry_dir).map_err(|e| e.to_string())?;

    let yaml = format!(
        r#"# Foundry Enterprise Runtime Configuration
runtime:
  model: {model}
  port: 8080
  host: "127.0.0.1"
  context_size: 8192
  gpu_layers: 99
  flash_attention: true

license:
  key_file: "license.key"
"#,
        model = config.model,
    );
    fs::write(foundry_dir.join("foundry.yaml"), &yaml).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let onboarding = format!(
        r#"{{
  "onboarded": true,
  "model": "{model}",
  "installed_at": "{now}"
}}"#,
        model = config.model,
        now = now,
    );
    fs::write(foundry_dir.join("onboarding.json"), &onboarding).map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// llama-server lifecycle (adapted from Fireside, stripped)
// ---------------------------------------------------------------------------

use std::sync::{Arc, Mutex};
use std::thread;
use std::process::Child;

struct BackendState {
    child: Option<Child>,
    restart_count: u32,
    running: bool,
    started_at: Option<std::time::Instant>,
}

#[tauri::command]
fn get_backend_status() -> serde_json::Value {
    let result = std::net::TcpStream::connect_timeout(
        &"127.0.0.1:8080".parse().unwrap(),
        std::time::Duration::from_millis(500),
    );
    serde_json::json!({
        "running": result.is_ok(),
        "port": 8080,
    })
}

/// Ensure the ~/.foundry directory structure exists (portable — works on any machine)
fn ensure_foundry_dirs() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let foundry = home.join(".foundry");
    for sub in &["bin", "models", "memory", "config"] {
        let _ = fs::create_dir_all(foundry.join(sub));
    }
    foundry
}

/// Returns all directories to search for GGUF models, in priority order.
/// ~/.foundry/models is ALWAYS first (portable). Optional fallbacks via env var.
fn model_search_dirs() -> Vec<PathBuf> {
    let foundry = ensure_foundry_dirs();
    let mut dirs = vec![foundry.join("models")];

    // Optional fallback: user can set FOUNDRY_MODELS_PATH env var (semicolon-separated on Windows)
    if let Ok(extra_paths) = std::env::var("FOUNDRY_MODELS_PATH") {
        let sep = if cfg!(target_os = "windows") { ';' } else { ':' };
        for p in extra_paths.split(sep) {
            let pb = PathBuf::from(p.trim());
            if pb.exists() {
                dirs.push(pb);
            }
        }
    }
    dirs
}

fn find_llama_server() -> Option<String> {
    let exe = if cfg!(target_os = "windows") { "llama-server.exe" } else { "llama-server" };
    let foundry = ensure_foundry_dirs();

    // 1. PRIMARY: ~/.foundry/bin/ (portable — always works)
    let bundled = foundry.join("bin").join(exe);
    if bundled.exists() {
        return Some(bundled.to_string_lossy().to_string());
    }

    // 2. Check nested dirs inside bin (zip extraction artifacts)
    let bin_dir = foundry.join("bin");
    if bin_dir.exists() {
        for entry in walkdir_find_exe(&bin_dir, exe) {
            return Some(entry);
        }
    }

    // 3. Optional fallback: user can set FOUNDRY_BIN_PATH env var to a directory
    //    containing llama-server. Useful for shared-binary deployments.
    if let Ok(custom_dir) = std::env::var("FOUNDRY_BIN_PATH") {
        let custom_path = PathBuf::from(custom_dir).join(exe);
        if custom_path.exists() {
            return Some(custom_path.to_string_lossy().to_string());
        }
    }

    // 5. System PATH
    if let Ok(output) = silent_cmd(if cfg!(target_os = "windows") { "where" } else { "which" })
        .arg("llama-server")
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines().next().unwrap_or("").trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }

    None
}

fn walkdir_find_exe(dir: &PathBuf, exe_name: &str) -> Vec<String> {
    let mut results = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() && path.file_name().map_or(false, |n| n == exe_name) {
                results.push(path.to_string_lossy().to_string());
            } else if path.is_dir() {
                results.extend(walkdir_find_exe(&path, exe_name));
            }
        }
    }
    results
}

/// Start llama-server with the specified or newest GGUF model.
#[tauri::command]
fn start_llama_server(state: tauri::State<'_, Arc<Mutex<BackendState>>>) -> Result<String, String> {
    // Use portable model discovery (primary: ~/.foundry/models)
    let dirs = model_search_dirs();

    // Find the newest GGUF across all directories
    let mut ggufs: Vec<_> = dirs.iter()
        .filter(|d| d.exists())
        .flat_map(|d| fs::read_dir(d).into_iter().flatten())
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "gguf"))
        .collect();

    ggufs.sort_by_key(|e| std::cmp::Reverse(
        e.metadata().map(|m| m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH))
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    ));

    let gguf = ggufs.first().ok_or(
        "No GGUF models found. Drop a .gguf file into ~/.foundry/models/ to get started."
    )?;
    let model_path = gguf.path();

    let binary = find_llama_server()
        .ok_or("llama-server not found. Place llama-server.exe in ~/.foundry/bin/ to get started.")?;

    // Verify bundled binary against the public manifest (binaries.json).
    // Fail-closed on hash mismatch; skip silently in dev builds where the manifest still
    // contains placeholder SHAs (we don't gate developers on a not-yet-cut release manifest).
    if !binary_verify::is_placeholder_manifest() {
        let exe_name = if cfg!(target_os = "windows") { "llama-server.exe" } else { "llama-server" };
        if let Err(e) = binary_verify::verify_binary(std::path::Path::new(&binary), exe_name) {
            return Err(format!(
                "Binary verification failed: {}. Refusing to launch a tampered or unrecognized binary.",
                e
            ));
        }
    }

    // Kill existing server
    {
        let mut s = state.lock().map_err(|e| format!("Lock error: {}", e))?;
        if let Some(ref mut child) = s.child {
            let _ = child.kill();
            let _ = child.wait();
        }
        s.child = None;
        s.running = false;
    }

    thread::sleep(std::time::Duration::from_millis(300));

    // v0.1.0 ships with stock upstream llama-server (no license-key flag support).
    // Pro-tier gating happens at the workspace UI layer; the inference binary
    // is feature-equivalent across tiers. If a future Fireside-built llama-server
    // adds a license-key CLI flag, append it to cmd_args here when license.key exists.
    let cmd_args = vec![
        "--model".to_string(), model_path.to_string_lossy().to_string(),
        "--port".to_string(), "8080".to_string(),
        "--host".to_string(), "127.0.0.1".to_string(),
        "--ctx-size".to_string(), "8192".to_string(),
        "--n-gpu-layers".to_string(), "99".to_string(),
        "--flash-attn".to_string(), "on".to_string(),
    ];

    println!("[foundry] Starting llama-server: {} {}", binary, cmd_args.join(" "));

    match silent_cmd(&binary)
        .args(&cmd_args)
        .spawn()
    {
        Ok(child) => {
            let pid = child.id();
            let mut s = state.lock().map_err(|e| format!("Lock error: {}", e))?;
            s.child = Some(child);
            s.running = true;
            s.started_at = Some(std::time::Instant::now());
            let msg = format!("Foundry Runtime started (pid={:?}) with {}",
                pid, model_path.file_name().unwrap_or_default().to_string_lossy());
            println!("[foundry] {}", msg);
            Ok(msg)
        }
        Err(e) => Err(format!("Failed to start Foundry Runtime: {}", e)),
    }
}

// ---------------------------------------------------------------------------
// Model download with streaming progress
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct DownloadProgress {
    percent: f64,
    downloaded_mb: f64,
    total_mb: f64,
    speed_mbps: f64,
    status: String,
}

#[tauri::command]
async fn download_brain(
    app: tauri::AppHandle,
    model: String,
    quant: String,
    dest: String,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    if quant == "API" || model.starts_with("cloud-") {
        return Ok("cloud_model:no_download_needed".to_string());
    }

    let suffix = match quant.as_str() {
        "4-bit" => "Q4_K_M",
        "6-bit" => "Q6_K",
        "8-bit" => "Q8_0",
        _ => "Q6_K",
    };

    // Curated enterprise model registry
    let models = std::collections::HashMap::from([
        ("qwen3-8b", ("unsloth/Qwen3-8B-GGUF", "Qwen3-8B")),
        ("qwen-2.5-14b", ("bartowski/Qwen2.5-14B-Instruct-GGUF", "Qwen2.5-14B-Instruct")),
        ("qwen3-14b", ("unsloth/Qwen3-14B-GGUF", "Qwen3-14B")),
        ("qwen3-32b", ("unsloth/Qwen3-32B-GGUF", "Qwen3-32B")),
        ("qwen-2.5-coder-14b", ("bartowski/Qwen2.5-Coder-14B-Instruct-GGUF", "Qwen2.5-Coder-14B-Instruct")),
        ("qwen-2.5-coder-32b", ("bartowski/Qwen2.5-Coder-32B-Instruct-GGUF", "Qwen2.5-Coder-32B-Instruct")),
        ("deepseek-r1-14b", ("bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF", "DeepSeek-R1-Distill-Qwen-14B")),
        ("deepseek-r1-32b", ("bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF", "DeepSeek-R1-Distill-Qwen-32B")),
        ("gemma-3-12b", ("bartowski/gemma-3-12b-it-GGUF", "gemma-3-12b-it")),
        ("gemma-3-27b", ("bartowski/gemma-3-27b-it-GGUF", "gemma-3-27b-it")),
        ("llama-3.1-8b", ("bartowski/Meta-Llama-3.1-8B-Instruct-GGUF", "Meta-Llama-3.1-8B-Instruct")),
        ("mistral-small-24b", ("bartowski/Mistral-Small-24B-Instruct-2501-GGUF", "Mistral-Small-24B-Instruct-2501")),
        ("phi-4-14b", ("bartowski/phi-4-GGUF", "phi-4")),
        ("qwen-3.5-35b", ("unsloth/Qwen3.5-35B-GGUF", "Qwen3.5-35B")),
        ("llama-3.3-70b", ("bartowski/Llama-3.3-70B-Instruct-GGUF", "Llama-3.3-70B-Instruct")),
    ]);

    let (repo, base) = models.get(model.as_str())
        .ok_or_else(|| format!("Unknown model: {}", model))?;

    let filename = format!("{}-{}.gguf", base, suffix);
    let url = format!("https://huggingface.co/{}/resolve/main/{}", repo, filename);

    let dest_expanded = if dest.starts_with("~/") || dest.starts_with("~\\") {
        let home = dirs::home_dir().ok_or("Cannot find home directory")?;
        home.join(&dest[2..])
    } else {
        PathBuf::from(&dest)
    };
    let dest_dir = dest_expanded;
    fs::create_dir_all(&dest_dir).map_err(|e| format!("Cannot create dir {}: {}", dest_dir.display(), e))?;
    let target = dest_dir.join(&filename);
    let part_file = dest_dir.join(format!("{}.part", filename));

    // Already fully downloaded?
    if target.exists() {
        let size = fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        if size > 100_000_000 {
            let _ = app.emit("download-progress", DownloadProgress {
                percent: 100.0, downloaded_mb: size as f64 / 1_048_576.0,
                total_mb: size as f64 / 1_048_576.0, speed_mbps: 0.0,
                status: "complete".to_string(),
            });
            return Ok(format!("already_installed:{}", filename));
        }
    }

    // Resume support
    let existing_bytes = if part_file.exists() {
        fs::metadata(&part_file).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    let client = reqwest::Client::builder()
        .user_agent("FoundryRuntime/1.0")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    let mut request = client.get(&url);
    if existing_bytes > 0 {
        request = request.header("Range", format!("bytes={}-", existing_bytes));
        let _ = app.emit("download-progress", DownloadProgress {
            percent: 0.0, downloaded_mb: existing_bytes as f64 / 1_048_576.0,
            total_mb: 0.0, speed_mbps: 0.0,
            status: "resuming".to_string(),
        });
    }

    let response = request.send().await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() && response.status().as_u16() != 206 {
        return Err(format!("HuggingFace returned HTTP {}", response.status()));
    }

    let content_length = response.content_length().unwrap_or(0);
    let total_bytes = if existing_bytes > 0 && response.status().as_u16() == 206 {
        content_length + existing_bytes
    } else {
        content_length
    };
    let total_mb = total_bytes as f64 / 1_048_576.0;

    let mut file = if existing_bytes > 0 && response.status().as_u16() == 206 {
        std::fs::OpenOptions::new().append(true).open(&part_file)
    } else {
        std::fs::File::create(&part_file).map(|f| f)
    }.map_err(|e| format!("Cannot open file for writing: {}", e))?;

    let mut downloaded = existing_bytes;
    let mut last_emit = std::time::Instant::now();
    let start_time = std::time::Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Download stream error: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() > 500 || downloaded == total_bytes {
            let elapsed = start_time.elapsed().as_secs_f64().max(0.1);
            let dl_since_start = (downloaded - existing_bytes) as f64;
            let speed_mbps = (dl_since_start / 1_048_576.0) / elapsed;
            let percent = if total_bytes > 0 {
                (downloaded as f64 / total_bytes as f64) * 100.0
            } else {
                0.0
            };

            let _ = app.emit("download-progress", DownloadProgress {
                percent, downloaded_mb: downloaded as f64 / 1_048_576.0,
                total_mb, speed_mbps,
                status: "downloading".to_string(),
            });
            last_emit = std::time::Instant::now();
        }
    }

    file.flush().map_err(|e| format!("Flush error: {}", e))?;
    drop(file);

    // Verify GGUF magic
    let _ = app.emit("download-progress", DownloadProgress {
        percent: 99.5, downloaded_mb: total_mb, total_mb,
        speed_mbps: 0.0, status: "verifying".to_string(),
    });

    let magic_ok = std::fs::File::open(&part_file)
        .and_then(|mut f| {
            use std::io::Read;
            let mut buf = [0u8; 4];
            f.read_exact(&mut buf)?;
            Ok(buf)
        })
        .map(|buf| &buf == b"GGUF")
        .unwrap_or(false);

    if !magic_ok {
        let _ = fs::remove_file(&part_file);
        return Err("Downloaded file is not a valid GGUF model.".to_string());
    }

    fs::rename(&part_file, &target)
        .map_err(|e| format!("Cannot rename .part file: {}", e))?;

    let _ = app.emit("download-progress", DownloadProgress {
        percent: 100.0, downloaded_mb: total_mb, total_mb,
        speed_mbps: 0.0, status: "complete".to_string(),
    });

    Ok(format!("downloaded:{}", filename))
}

/// Health check on inference server.
#[tauri::command]
async fn test_connection() -> Result<String, String> {
    let max_attempts = 10;
    for attempt in 1..=max_attempts {
        match std::net::TcpStream::connect("127.0.0.1:8080") {
            Ok(_) => {
                let output = silent_cmd("powershell")
                    .args(["-NoProfile", "-Command",
                        "(Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -UseBasicParsing -TimeoutSec 3).Content"])
                    .output();

                match output {
                    Ok(o) if o.status.success() => {
                        let body = String::from_utf8_lossy(&o.stdout).to_string();
                        return Ok(format!("connected:{}", body.trim()));
                    }
                    _ => {}
                }
            }
            Err(_) => {}
        }

        if attempt < max_attempts {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }

    Err("Foundry Runtime did not respond after 10 seconds".into())
}

// ---------------------------------------------------------------------------
// Memory Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn mem_init() -> Result<String, String> {
    let conn = memory::open_db()?;
    memory::init_schema(&conn)?;
    Ok("Memory initialized".into())
}

#[tauri::command]
fn mem_core_read() -> Result<String, String> {
    let conn = memory::open_db()?;
    memory::init_schema(&conn)?;
    memory::core_read(&conn)
}

#[tauri::command]
fn mem_core_update(old_text: String, new_text: String) -> Result<(), String> {
    let conn = memory::open_db()?;
    memory::core_update(&conn, &old_text, &new_text)
}

#[tauri::command]
fn mem_core_set(content: String) -> Result<(), String> {
    let conn = memory::open_db()?;
    memory::core_set(&conn, &content)
}

#[tauri::command]
fn mem_save(key: String, value: String, category: String) -> Result<String, String> {
    let conn = memory::open_db()?;
    memory::init_schema(&conn)?;
    memory::semantic_save(&conn, &key, &value, &category)
}

#[tauri::command]
fn mem_search(query: String, limit: Option<u32>) -> Result<Vec<memory::SemanticMemory>, String> {
    let conn = memory::open_db()?;
    memory::semantic_search(&conn, &query, limit.unwrap_or(10))
}

// ---- Namespace-aware memory API (Phase 1) ----

/// Save a semantic memory with an explicit hierarchical namespace.
/// Validates namespace via embed::namespace_validate before insert.
#[tauri::command]
fn mem_save_ns(
    key: String,
    value: String,
    category: String,
    namespace: String,
) -> Result<String, String> {
    if !embed::namespace_validate(namespace.clone()) {
        return Err(format!(
            "Invalid namespace: '{}'. Must be dot-separated [a-z0-9_-]+ segments, 1-256 chars total.",
            namespace
        ));
    }
    let conn = memory::open_db()?;
    memory::init_schema(&conn)?;
    memory::semantic_save_with_namespace(&conn, &key, &value, &category, &namespace)
}

/// Search semantic memories filtered by namespace prefix.
/// `namespace_prefix = "bakery"` matches `bakery`, `bakery.recipes`, `bakery.recipes.sourdough`, etc.
/// Pass empty string or null to search across all namespaces.
#[tauri::command]
fn mem_search_ns(
    query: String,
    namespace_prefix: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<memory::SemanticMemory>, String> {
    let conn = memory::open_db()?;
    let ns_ref = namespace_prefix.as_deref().filter(|s| !s.is_empty());
    memory::semantic_search_ns(&conn, &query, ns_ref, limit.unwrap_or(10))
}

/// List distinct namespaces in semantic memory, optionally under a prefix.
/// Used by the memory dashboard tree view.
#[tauri::command]
fn mem_list_namespaces(prefix: Option<String>) -> Result<Vec<String>, String> {
    let conn = memory::open_db()?;
    let prefix_ref = prefix.as_deref().filter(|s| !s.is_empty());
    memory::semantic_list_namespaces(&conn, prefix_ref)
}

#[tauri::command]
fn mem_forget(key: String) -> Result<(), String> {
    let conn = memory::open_db()?;
    memory::semantic_delete(&conn, &key)
}

#[tauri::command]
fn mem_edit(key: String, new_value: String) -> Result<(), String> {
    let conn = memory::open_db()?;
    memory::semantic_edit(&conn, &key, &new_value)
}

#[tauri::command]
fn mem_get_all_semantic() -> Result<Vec<memory::SemanticMemory>, String> {
    let conn = memory::open_db()?;
    memory::init_schema(&conn)?;
    memory::semantic_get_all(&conn)
}

#[tauri::command]
fn mem_get_all_episodic() -> Result<Vec<memory::EpisodicMemory>, String> {
    let conn = memory::open_db()?;
    memory::init_schema(&conn)?;
    memory::episodic_get_recent(&conn, 50)
}

#[tauri::command]
fn mem_get_all_procedural() -> Result<Vec<memory::ProceduralMemory>, String> {
    let conn = memory::open_db()?;
    memory::init_schema(&conn)?;
    memory::procedural_get_all(&conn)
}

#[tauri::command]
fn mem_save_episodic(conversation_id: String, summary: String, topics: String,
                     entities: String, tone: String, turns: i64) -> Result<(), String> {
    let conn = memory::open_db()?;
    memory::episodic_save(&conn, &conversation_id, &summary, &topics, &entities, &tone, turns)
}

#[tauri::command]
fn mem_save_procedural(name: String, description: String, steps: String) -> Result<(), String> {
    let conn = memory::open_db()?;
    memory::procedural_save(&conn, &name, &description, &steps)
}

#[tauri::command]
fn mem_search_episodic(query: String) -> Result<Vec<memory::EpisodicMemory>, String> {
    let conn = memory::open_db()?;
    memory::episodic_search(&conn, &query, 10)
}

#[tauri::command]
fn mem_stats() -> Result<memory::MemoryStats, String> {
    let conn = memory::open_db()?;
    memory::init_schema(&conn)?;
    memory::get_stats(&conn)
}

#[tauri::command]
fn mem_changelog(limit: Option<u32>) -> Result<Vec<memory::ChangelogEntry>, String> {
    let conn = memory::open_db()?;
    memory::get_changelog(&conn, limit.unwrap_or(50))
}

#[tauri::command]
fn mem_build_context() -> Result<String, String> {
    let conn = memory::open_db()?;
    memory::init_schema(&conn)?;
    memory::build_memory_context(&conn)
}

// ---------------------------------------------------------------------------
// Helper Model Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn helper_start(helper_state: tauri::State<'_, Arc<Mutex<helper::HelperState>>>) -> Result<String, String> {
    let binary = find_llama_server()
        .ok_or("llama-server not found")?;
    helper::start_helper(&helper_state, &binary)
}

#[tauri::command]
fn helper_stop(helper_state: tauri::State<'_, Arc<Mutex<helper::HelperState>>>) -> Result<(), String> {
    helper::stop_helper(&helper_state)
}

#[tauri::command]
fn helper_status(helper_state: tauri::State<'_, Arc<Mutex<helper::HelperState>>>) -> helper::HelperStatus {
    helper::get_status(&helper_state)
}

#[tauri::command]
fn helper_dream_cycle(
    helper_state: tauri::State<'_, Arc<Mutex<helper::HelperState>>>,
    conversation_json: String,
) -> Result<String, String> {
    let result = helper::run_dream_cycle(&helper_state, &conversation_json)?;

    // Parse the helper's response and save memories
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&result) {
        let conn = memory::open_db().ok();
        if let Some(conn) = &conn {
            // Save episodic summary
            if let Some(summary) = v["summary"].as_str() {
                let topics = v["topics"].to_string();
                let tone = v["tone"].as_str().unwrap_or("");
                let conv_id = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
                let _ = memory::episodic_save(conn, &conv_id, summary, &topics, "[]", tone, 0);
            }

            // Save semantic facts
            if let Some(facts) = v["facts"].as_array() {
                for fact in facts {
                    if let (Some(key), Some(value), Some(cat)) = (
                        fact["key"].as_str(),
                        fact["value"].as_str(),
                        fact["category"].as_str(),
                    ) {
                        let _ = memory::semantic_save(conn, key, value, cat);
                    }
                }
            }

            // Save procedures
            if let Some(procs) = v["procedures"].as_array() {
                for proc in procs {
                    if let (Some(name), Some(desc), Some(steps)) = (
                        proc["name"].as_str(),
                        proc["description"].as_str(),
                        Some(proc["steps"].to_string()),
                    ) {
                        let _ = memory::procedural_save(conn, name, desc, &steps);
                    }
                }
            }

            // Mark dream cycle timestamp
            let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
            let _ = conn.execute(
                "INSERT OR REPLACE INTO memory_meta (key, value) VALUES ('last_dream_cycle', ?1)",
                rusqlite::params![now],
            );
        }
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// File Generation — write files to disk from frontend
// ---------------------------------------------------------------------------

#[tauri::command]
fn write_file(path: String, content: String) -> Result<String, String> {
    let filepath = PathBuf::from(&path);
    if let Some(parent) = filepath.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create directory: {}", e))?;
    }
    fs::write(&filepath, &content).map_err(|e| format!("Cannot write file: {}", e))?;
    Ok(format!("Written: {}", filepath.display()))
}

#[tauri::command]
fn get_documents_dir() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let docs = home.join("Documents").join("Foundry");
    fs::create_dir_all(&docs).map_err(|e| e.to_string())?;
    Ok(docs.to_string_lossy().to_string())
}

#[tauri::command]
fn get_setup_status() -> Result<String, String> {
    let foundry = ensure_foundry_dirs();
    let has_binary = find_llama_server().is_some();

    let dirs = model_search_dirs();
    let models: Vec<String> = dirs.iter()
        .filter(|d| d.exists())
        .flat_map(|d| fs::read_dir(d).into_iter().flatten())
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "gguf"))
        .map(|e| {
            let p = e.path();
            let size_mb = e.metadata().map(|m| m.len() / 1_048_576).unwrap_or(0);
            format!("{} ({}MB)", p.file_name().unwrap_or_default().to_string_lossy(), size_mb)
        })
        .collect();

    let license_ok = foundry.join("license.key").exists();

    let status = format!(
        r#"{{"foundry_dir":"{}","has_binary":{},"has_models":{},"model_count":{},"models":[{}],"has_license":{},"models_dir":"{}"}}"#,
        foundry.to_string_lossy().replace('\\', "\\\\"),
        has_binary,
        !models.is_empty(),
        models.len(),
        models.iter().map(|m| format!("\"{}\" ", m)).collect::<Vec<_>>().join(","),
        license_ok,
        foundry.join("models").to_string_lossy().replace('\\', "\\\\")
    );
    Ok(status)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let backend_state = Arc::new(Mutex::new(BackendState {
        child: None,
        restart_count: 0,
        running: false,
        started_at: None,
    }));

    let helper_state = Arc::new(Mutex::new(helper::HelperState::default()));

    let state_for_setup = backend_state.clone();
    let state_for_exit = backend_state.clone();
    let helper_for_exit = helper_state.clone();

    // Init memory DB on startup
    if let Ok(conn) = memory::open_db() {
        if let Err(e) = memory::init_schema(&conn) {
            eprintln!("[foundry] Memory DB init failed: {}", e);
        } else {
            println!("[foundry] Memory engine ready");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            get_hardware_id,
            validate_license,
            bind_license,
            get_license_status,
            get_gpu_metrics,
            get_inference_metrics,
            write_config,
            get_backend_status,
            download_brain,
            test_connection,
            start_llama_server,
            // Memory commands
            mem_init,
            mem_core_read,
            mem_core_update,
            mem_core_set,
            mem_save,
            mem_search,
            mem_forget,
            mem_edit,
            mem_get_all_semantic,
            mem_get_all_episodic,
            mem_get_all_procedural,
            mem_save_episodic,
            mem_save_procedural,
            mem_search_episodic,
            mem_stats,
            mem_changelog,
            mem_build_context,
            // Helper commands
            helper_start,
            helper_stop,
            helper_status,
            helper_dream_cycle,
            // File generation commands
            write_file,
            get_documents_dir,
            // Setup / status
            get_setup_status,
            // === DIRECTORY WORKSTREAM ===
            tool_ops::project_link,
            tool_ops::project_unlink,
            tool_ops::project_get_active,
            tool_ops::project_list,
            tool_ops::tool_read_file,
            tool_ops::tool_write_file,
            tool_ops::tool_edit_file,
            tool_ops::tool_list_dir,
            tool_ops::tool_run_script,
            // === MEMORY WORKSTREAM (shared infrastructure) ===
            // Embedding service — used by memory subsystem AND RAG indexer.
            // Calls helper sidecar on port 8081 in --embedding mode.
            embed::embed_text,
            embed::namespace_validate,
            // === MEMORY WORKSTREAM (Phase 1: hierarchical namespacing) ===
            mem_save_ns,
            mem_search_ns,
            mem_list_namespaces,
        ])
        .manage(backend_state.clone())
        .manage(helper_state.clone())
        .setup(move |_app| {
            // Always ensure ~/.foundry/ directory structure exists
            let foundry = ensure_foundry_dirs();
            println!("[foundry] Initialized {}", foundry.display());

            // Use portable model discovery (primary: ~/.foundry/models)
            let model_dirs = model_search_dirs();
            let has_models = model_dirs.iter().any(|d| d.exists());

            // Auto-start the server if any models are present. Free-tier users
            // get full chat — license gating only applies to Pro features in the UI.
            if has_models {
                let state = state_for_setup.clone();

                thread::spawn(move || {
                    thread::sleep(std::time::Duration::from_millis(2000));

                    let mut ggufs: Vec<_> = model_dirs.iter()
                        .filter(|d| d.exists())
                        .flat_map(|d| fs::read_dir(d).into_iter().flatten())
                        .filter_map(|e| e.ok())
                        .filter(|e| e.path().extension().map_or(false, |ext| ext == "gguf"))
                        .collect();

                    if ggufs.is_empty() {
                        println!("[foundry] No GGUF models found, skipping auto-start");
                        return;
                    }

                    ggufs.sort_by_key(|e| std::cmp::Reverse(
                        e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                    ));

                    let model_path = ggufs[0].path();
                    println!("[foundry] Auto-starting with {}", model_path.display());

                    let binary = match find_llama_server() {
                        Some(b) => b,
                        None => {
                            eprintln!("[foundry] llama-server not found, cannot auto-start");
                            return;
                        }
                    };

                    // Stock upstream llama-server invocation. Pro-tier gating is
                    // enforced at the workspace UI layer, not here.
                    let args: Vec<String> = vec![
                        "--model".into(), model_path.to_string_lossy().to_string(),
                        "--port".into(), "8080".into(),
                        "--host".into(), "127.0.0.1".into(),
                        "--ctx-size".into(), "8192".into(),
                        "--n-gpu-layers".into(), "99".into(),
                        "--flash-attn".into(), "on".into(),
                    ];

                    match silent_cmd(&binary).args(&args).spawn() {
                        Ok(child) => {
                            let pid = child.id();
                            let mut s = state.lock().unwrap();
                            s.child = Some(child);
                            s.running = true;
                            s.started_at = Some(std::time::Instant::now());
                            println!("[foundry] Foundry Runtime started (pid={:?})", pid);
                        }
                        Err(e) => {
                            eprintln!("[foundry] Failed to start: {}", e);
                        }
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Foundry Runtime")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                println!("[foundry] App exiting, cleaning up...");
                if let Ok(mut s) = state_for_exit.lock() {
                    if let Some(ref mut child) = s.child {
                        let _ = child.kill();
                        println!("[foundry] Runtime process killed");
                    }
                    s.running = false;
                }
                // Kill helper model too
                if let Ok(mut h) = helper_for_exit.lock() {
                    if let Some(ref mut child) = h.child {
                        let _ = child.kill();
                        println!("[foundry] Helper process killed");
                    }
                    h.child = None;
                }
            }
        });
}
