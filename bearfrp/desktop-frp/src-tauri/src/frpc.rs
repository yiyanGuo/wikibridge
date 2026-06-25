use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::state::DesktopRuntime;

#[derive(Debug)]
pub struct ManagedProcess {
    pub child: Child,
    pub log_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessStateDto {
    pub proxy_id: u64,
    pub enabled: bool,
    pub running: bool,
    pub log_path: String,
    pub log_tail: String,
}

pub fn start_frpc(
    app: &AppHandle,
    runtime: &mut DesktopRuntime,
    proxy_id: u64,
    config: &str,
) -> Result<ProcessStateDto, String> {
    runtime.reap_exited();
    if runtime.processes.contains_key(&proxy_id) {
        runtime.persisted.enabled_proxy_ids.insert(proxy_id);
        runtime
            .persisted
            .last_configs
            .insert(proxy_id, config.to_string());
        runtime.save()?;
        return process_state(runtime, proxy_id);
    }

    let work_dir = runtime.proxy_work_dir(proxy_id);
    fs::create_dir_all(&work_dir).map_err(|error| format!("无法创建 frpc 工作目录: {error}"))?;
    let config_path = work_dir.join("frpc.toml");
    fs::write(&config_path, config).map_err(|error| format!("无法写入 frpc 配置: {error}"))?;
    restrict_file_permissions(&config_path);

    let log_path = runtime.proxy_log_path(proxy_id);
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("无法打开 frpc 日志: {error}"))?;
    writeln!(log, "\n=== frpc start {} ===", unix_timestamp()).ok();
    let stderr = log
        .try_clone()
        .map_err(|error| format!("无法复制日志句柄: {error}"))?;

    let frpc_path = find_frpc_binary(app)?;
    ensure_executable(&frpc_path);
    let mut command = Command::new(frpc_path);
    command
        .arg("-c")
        .arg(&config_path)
        .current_dir(&work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr));

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("无法启动 frpc: {error}"))?;

    runtime.persisted.enabled_proxy_ids.insert(proxy_id);
    runtime
        .persisted
        .last_configs
        .insert(proxy_id, config.to_string());
    runtime.processes.insert(
        proxy_id,
        ManagedProcess {
            child,
            log_path: log_path.clone(),
        },
    );
    runtime.save()?;
    process_state(runtime, proxy_id)
}

pub fn stop_frpc(
    runtime: &mut DesktopRuntime,
    proxy_id: u64,
    disable: bool,
) -> Result<ProcessStateDto, String> {
    if let Some(mut process) = runtime.processes.remove(&proxy_id) {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
    if disable {
        runtime.persisted.enabled_proxy_ids.remove(&proxy_id);
    }
    runtime.save()?;
    process_state(runtime, proxy_id)
}

pub fn stop_all(runtime: &mut DesktopRuntime, disable: bool) -> Result<(), String> {
    let proxy_ids: Vec<u64> = runtime.processes.keys().copied().collect();
    for proxy_id in proxy_ids {
        let _ = stop_frpc(runtime, proxy_id, disable);
    }
    if disable {
        runtime.persisted.enabled_proxy_ids.clear();
    }
    runtime.save()
}

pub fn process_state(
    runtime: &mut DesktopRuntime,
    proxy_id: u64,
) -> Result<ProcessStateDto, String> {
    runtime.reap_exited();
    let log_path = runtime
        .processes
        .get(&proxy_id)
        .map(|process| process.log_path.clone())
        .unwrap_or_else(|| runtime.proxy_log_path(proxy_id));
    Ok(ProcessStateDto {
        proxy_id,
        enabled: runtime.persisted.enabled_proxy_ids.contains(&proxy_id),
        running: runtime.processes.contains_key(&proxy_id),
        log_tail: read_log_tail(&log_path),
        log_path: log_path.to_string_lossy().to_string(),
    })
}

pub fn read_proxy_log(runtime: &mut DesktopRuntime, proxy_id: u64) -> String {
    runtime.reap_exited();
    read_log_tail(&runtime.proxy_log_path(proxy_id))
}

fn find_frpc_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = if cfg!(windows) { "frpc.exe" } else { "frpc" };
    let platform = platform_key();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("binaries")
                .join("frpc")
                .join(platform)
                .join(executable),
        );
        candidates.push(resource_dir.join("frpc").join(platform).join(executable));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(
            current_dir
                .join("binaries")
                .join("frpc")
                .join(platform)
                .join(executable),
        );
        candidates.push(
            current_dir
                .join("src-tauri")
                .join("binaries")
                .join("frpc")
                .join(platform)
                .join(executable),
        );
        candidates.push(current_dir.join("frpc"));
        candidates.push(current_dir.join("..").join("frpc"));
        candidates.push(current_dir.join("..").join("..").join("frpc"));
    }
    candidates.push(
        manifest_dir
            .join("binaries")
            .join("frpc")
            .join(platform)
            .join(executable),
    );
    candidates.push(manifest_dir.join("..").join("..").join("frpc"));

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "未找到 frpc 二进制，请放置到 desktop/src-tauri/binaries/frpc/{platform}/{executable}"
    ))
}

fn platform_key() -> &'static str {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "amd64"
    };
    match (os, arch) {
        ("darwin", "arm64") => "darwin-arm64",
        ("darwin", _) => "darwin-amd64",
        ("windows", _) => "windows-amd64",
        ("linux", "arm64") => "linux-arm64",
        _ => "linux-amd64",
    }
}

fn read_log_tail(path: &PathBuf) -> String {
    let Ok(text) = fs::read_to_string(path) else {
        return String::new();
    };
    const MAX_CHARS: usize = 12_000;
    if text.chars().count() <= MAX_CHARS {
        return text;
    }
    text.chars()
        .rev()
        .take(MAX_CHARS)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn restrict_file_permissions(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

fn ensure_executable(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(path) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(permissions.mode() | 0o755);
            let _ = fs::set_permissions(path, permissions);
        }
    }
}
