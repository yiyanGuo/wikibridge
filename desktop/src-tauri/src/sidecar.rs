use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::state::{DesktopRuntime, KnowledgeProject};

const HOST: &str = "127.0.0.1";
const OPENCODE_START_PORT: u16 = 4096;
const OPENCODE_END_PORT: u16 = 4196;
const LLM_WIKI_START_PORT: u16 = 19828;
const LLM_WIKI_END_PORT: u16 = 19928;

#[derive(Debug, Default)]
pub struct OpenCodeStack {
    pub opencode: Option<SidecarProcess>,
    pub llm_wiki: Option<SidecarProcess>,
    pub opencode_port: Option<u16>,
    pub llm_wiki_port: Option<u16>,
    pub project_id: Option<String>,
}

#[derive(Debug)]
pub struct SidecarProcess {
    pub child: Child,
    pub log_path: PathBuf,
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl OpenCodeStack {
    pub fn stop(&mut self) {
        self.opencode.take();
        self.llm_wiki.take();
        self.opencode_port = None;
        self.llm_wiki_port = None;
        self.project_id = None;
    }

    pub fn reap_exited(&mut self) {
        if self
            .opencode
            .as_mut()
            .and_then(|process| process.child.try_wait().ok())
            .flatten()
            .is_some()
        {
            self.opencode = None;
            self.opencode_port = None;
            self.project_id = None;
        }
        if self
            .llm_wiki
            .as_mut()
            .and_then(|process| process.child.try_wait().ok())
            .flatten()
            .is_some()
        {
            self.llm_wiki = None;
            self.llm_wiki_port = None;
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopServicesState {
    pub bearfrp_backend_url: String,
    pub app_data_dir: String,
    pub opencode: SidecarStateDto,
    pub llm_wiki: SidecarStateDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStateDto {
    pub running: bool,
    pub healthy: bool,
    pub url: Option<String>,
    pub port: Option<u16>,
    pub log_path: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeStackDto {
    pub opencode_url: String,
    pub llm_wiki_url: String,
    pub opencode_port: u16,
    pub llm_wiki_port: u16,
    pub opencode_log_path: Option<String>,
    pub llm_wiki_log_path: Option<String>,
    pub project_id: Option<String>,
}

pub fn desktop_services_state(runtime: &mut DesktopRuntime) -> DesktopServicesState {
    runtime.opencode_stack.reap_exited();
    let opencode_port = runtime.opencode_stack.opencode_port;
    let llm_wiki_port = runtime.opencode_stack.llm_wiki_port;
    DesktopServicesState {
        bearfrp_backend_url: runtime.persisted.base_url.clone(),
        app_data_dir: runtime.paths.app_data_dir.to_string_lossy().to_string(),
        opencode: SidecarStateDto {
            running: runtime.opencode_stack.opencode.is_some(),
            healthy: opencode_port
                .map(|port| http_get_ok(port, "/global/health", Some("\"healthy\":true")))
                .unwrap_or(false),
            url: opencode_port.map(local_url),
            port: opencode_port,
            log_path: runtime
                .opencode_stack
                .opencode
                .as_ref()
                .map(|process| process.log_path.to_string_lossy().to_string()),
            project_id: runtime.opencode_stack.project_id.clone(),
        },
        llm_wiki: SidecarStateDto {
            running: runtime.opencode_stack.llm_wiki.is_some(),
            healthy: llm_wiki_port
                .map(|port| http_get_ok(port, "/api/v1/health", None))
                .unwrap_or(false),
            url: llm_wiki_port.map(|port| format!("{}/api/v1", local_url(port))),
            port: llm_wiki_port,
            log_path: runtime
                .opencode_stack
                .llm_wiki
                .as_ref()
                .map(|process| process.log_path.to_string_lossy().to_string()),
            project_id: None,
        },
    }
}

pub fn ensure_opencode_stack_running(
    app: &AppHandle,
    runtime: &mut DesktopRuntime,
) -> Result<OpenCodeStackDto, String> {
    runtime.opencode_stack.reap_exited();

    let llm_wiki_port = ensure_llm_wiki_running(app, runtime)?;
    let data_dir = runtime.paths.app_data_dir.join("opencode-data");
    let work_dir = runtime.paths.app_data_dir.join("opencode-workspace");
    fs::create_dir_all(data_dir.join("users").join("default"))
        .map_err(|error| format!("无法创建 OpenCode 用户数据目录: {error}"))?;
    fs::create_dir_all(data_dir.join("wiki"))
        .map_err(|error| format!("无法创建 OpenCode 公共 Wiki 目录: {error}"))?;
    fs::create_dir_all(&work_dir)
        .map_err(|error| format!("无法创建 OpenCode 工作目录: {error}"))?;

    let opencode_port = ensure_opencode_running(
        app,
        runtime,
        llm_wiki_port,
        OpenCodeLaunch {
            data_dir,
            work_dir,
            project_id: None,
            llm_wiki_project_id: None,
            preferred_port: None,
        },
    )?;

    Ok(OpenCodeStackDto {
        opencode_url: local_url(opencode_port),
        llm_wiki_url: format!("{}/api/v1", local_url(llm_wiki_port)),
        opencode_port,
        llm_wiki_port,
        opencode_log_path: runtime
            .opencode_stack
            .opencode
            .as_ref()
            .map(|process| process.log_path.to_string_lossy().to_string()),
        llm_wiki_log_path: runtime
            .opencode_stack
            .llm_wiki
            .as_ref()
            .map(|process| process.log_path.to_string_lossy().to_string()),
        project_id: None,
    })
}

pub fn stop_opencode_stack(runtime: &mut DesktopRuntime) {
    runtime.opencode_stack.stop();
}

pub fn start_project_chat(
    app: &AppHandle,
    runtime: &mut DesktopRuntime,
    project: &KnowledgeProject,
    llm_wiki_project_id: &str,
    preferred_opencode_port: Option<u16>,
) -> Result<OpenCodeStackDto, String> {
    runtime.opencode_stack.reap_exited();

    let llm_wiki_port = ensure_llm_wiki_running(app, runtime)?;
    let data_dir = prepare_project_opencode_data(runtime, project)?;
    let work_dir = PathBuf::from(&project.folder_path)
        .canonicalize()
        .map_err(|error| format!("知识库项目目录不可用: {error}"))?;
    let opencode_port = ensure_opencode_running(
        app,
        runtime,
        llm_wiki_port,
        OpenCodeLaunch {
            data_dir,
            work_dir,
            project_id: Some(project.project_id.clone()),
            llm_wiki_project_id: Some(llm_wiki_project_id.to_string()),
            preferred_port: preferred_opencode_port,
        },
    )?;

    Ok(OpenCodeStackDto {
        opencode_url: local_url(opencode_port),
        llm_wiki_url: format!("{}/api/v1", local_url(llm_wiki_port)),
        opencode_port,
        llm_wiki_port,
        opencode_log_path: runtime
            .opencode_stack
            .opencode
            .as_ref()
            .map(|process| process.log_path.to_string_lossy().to_string()),
        llm_wiki_log_path: runtime
            .opencode_stack
            .llm_wiki
            .as_ref()
            .map(|process| process.log_path.to_string_lossy().to_string()),
        project_id: Some(project.project_id.clone()),
    })
}

pub fn stop_project_chat(runtime: &mut DesktopRuntime, project_id: &str) {
    runtime.opencode_stack.reap_exited();
    if runtime.opencode_stack.project_id.as_deref() == Some(project_id) {
        runtime.opencode_stack.stop();
    }
}

pub fn ensure_llm_wiki_server_running(
    app: &AppHandle,
    runtime: &mut DesktopRuntime,
) -> Result<String, String> {
    let port = ensure_llm_wiki_running(app, runtime)?;
    Ok(format!("{}/api/v1", local_url(port)))
}

fn ensure_llm_wiki_running(app: &AppHandle, runtime: &mut DesktopRuntime) -> Result<u16, String> {
    if let Some(port) = runtime.opencode_stack.llm_wiki_port {
        if runtime.opencode_stack.llm_wiki.is_some() && http_get_ok(port, "/api/v1/health", None) {
            return Ok(port);
        }
        runtime.opencode_stack.llm_wiki = None;
        runtime.opencode_stack.llm_wiki_port = None;
    }

    let port = allocate_port(LLM_WIKI_START_PORT, LLM_WIKI_END_PORT)?;
    let data_dir = runtime.paths.app_data_dir.join("llm-wiki");
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("无法创建 LLM Wiki 数据目录: {error}"))?;
    fs::create_dir_all(&runtime.paths.log_dir)
        .map_err(|error| format!("无法创建日志目录: {error}"))?;

    let binary = find_sidecar_binary(app, "llm-wiki-server", "llm-wiki-server")?;
    ensure_executable(&binary);
    let log_path = runtime.paths.log_dir.join("llm-wiki-server.log");
    let process = spawn_logged(
        binary,
        &[],
        &runtime.paths.app_data_dir,
        &log_path,
        &[
            ("LLM_WIKI_DATA_DIR", data_dir.to_string_lossy().to_string()),
            ("LLM_WIKI_BIND", HOST.to_string()),
            ("LLM_WIKI_PORT", port.to_string()),
        ],
        "llm-wiki-server",
    )?;

    runtime.opencode_stack.llm_wiki = Some(process);
    runtime.opencode_stack.llm_wiki_port = Some(port);
    wait_for_health(port, "/api/v1/health", None, "LLM Wiki")?;
    Ok(port)
}

struct OpenCodeLaunch {
    data_dir: PathBuf,
    work_dir: PathBuf,
    project_id: Option<String>,
    llm_wiki_project_id: Option<String>,
    preferred_port: Option<u16>,
}

fn ensure_opencode_running(
    app: &AppHandle,
    runtime: &mut DesktopRuntime,
    llm_wiki_port: u16,
    launch: OpenCodeLaunch,
) -> Result<u16, String> {
    if let Some(port) = runtime.opencode_stack.opencode_port {
        let same_project = runtime.opencode_stack.project_id == launch.project_id;
        let same_port = launch
            .preferred_port
            .map(|preferred| preferred == port)
            .unwrap_or(true);
        if runtime.opencode_stack.opencode.is_some()
            && http_get_ok(port, "/global/health", Some("\"healthy\":true"))
            && same_project
            && same_port
        {
            return Ok(port);
        }
        stop_opencode_process(runtime);
    }

    let port = allocate_opencode_port(launch.preferred_port)?;
    fs::create_dir_all(launch.data_dir.join("users").join("default"))
        .map_err(|error| format!("无法创建 OpenCode 用户数据目录: {error}"))?;
    fs::create_dir_all(&launch.work_dir)
        .map_err(|error| format!("无法创建 OpenCode 工作目录: {error}"))?;
    fs::create_dir_all(&runtime.paths.log_dir)
        .map_err(|error| format!("无法创建日志目录: {error}"))?;

    let binary = find_sidecar_binary(app, "opencode", "opencode")?;
    ensure_executable(&binary);
    let log_name = launch
        .project_id
        .as_ref()
        .map(|project_id| format!("opencode-{project_id}.log"))
        .unwrap_or_else(|| "opencode.log".to_string());
    let log_path = runtime.paths.log_dir.join(log_name);
    let mut envs = vec![
        ("OPENCODE_KB_MODE", "1".to_string()),
        (
            "OPENCODE_KB_DATA_DIR",
            launch.data_dir.to_string_lossy().to_string(),
        ),
        ("OPENCODE_KB_USER", "default".to_string()),
        (
            "LLM_WIKI_BASE_URL",
            format!("{}/api/v1", local_url(llm_wiki_port)),
        ),
    ];
    if let Some(project_id) = &launch.llm_wiki_project_id {
        envs.push(("LLM_WIKI_PROJECT_ID", project_id.clone()));
    }
    let process = spawn_logged(
        binary,
        &[
            "serve".to_string(),
            "--hostname".to_string(),
            HOST.to_string(),
            "--port".to_string(),
            port.to_string(),
        ],
        &launch.work_dir,
        &log_path,
        &envs,
        "opencode",
    )?;

    runtime.opencode_stack.opencode = Some(process);
    runtime.opencode_stack.opencode_port = Some(port);
    runtime.opencode_stack.project_id = launch.project_id;
    wait_for_health(port, "/global/health", Some("\"healthy\":true"), "OpenCode")?;
    Ok(port)
}

fn stop_opencode_process(runtime: &mut DesktopRuntime) {
    runtime.opencode_stack.opencode.take();
    runtime.opencode_stack.opencode_port = None;
    runtime.opencode_stack.project_id = None;
}

fn prepare_project_opencode_data(
    runtime: &DesktopRuntime,
    project: &KnowledgeProject,
) -> Result<PathBuf, String> {
    let data_dir = runtime
        .paths
        .app_data_dir
        .join("opencode-projects")
        .join(&project.project_id);
    let users_dir = data_dir.join("users").join("default");
    fs::create_dir_all(&users_dir)
        .map_err(|error| format!("无法创建 OpenCode 项目用户目录: {error}"))?;

    let wiki_target = PathBuf::from(&project.folder_path).join("wiki");
    fs::create_dir_all(&wiki_target).map_err(|error| format!("无法创建项目 wiki 目录: {error}"))?;
    mount_project_wiki(&data_dir.join("wiki"), &wiki_target)?;
    Ok(data_dir)
}

fn mount_project_wiki(link_path: &Path, target_path: &Path) -> Result<(), String> {
    let target = target_path
        .canonicalize()
        .map_err(|error| format!("项目 wiki 目录不可用: {error}"))?;
    if let Ok(existing_target) = link_path.canonicalize() {
        if existing_target == target {
            return Ok(());
        }
    }
    if let Ok(metadata) = fs::symlink_metadata(link_path) {
        if metadata.file_type().is_symlink() {
            fs::remove_file(link_path)
                .map_err(|error| format!("无法更新 OpenCode wiki 挂载: {error}"))?;
        } else if metadata.is_dir() {
            let mut entries = fs::read_dir(link_path)
                .map_err(|error| format!("无法检查 OpenCode wiki 目录: {error}"))?;
            if entries.next().is_some() {
                return Err(format!(
                    "OpenCode wiki 目录已存在且非空: {}",
                    link_path.display()
                ));
            }
            fs::remove_dir(link_path)
                .map_err(|error| format!("无法更新 OpenCode wiki 挂载: {error}"))?;
        } else {
            fs::remove_file(link_path)
                .map_err(|error| format!("无法更新 OpenCode wiki 挂载: {error}"))?;
        }
    }
    if let Some(parent) = link_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建 OpenCode 数据目录: {error}"))?;
    }
    symlink_dir(&target, link_path).map_err(|error| {
        format!(
            "无法挂载项目 wiki 到 OpenCode 数据目录: {error}。请确认当前系统允许创建目录符号链接"
        )
    })
}

#[cfg(unix)]
fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn symlink_dir(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

fn spawn_logged(
    binary: PathBuf,
    args: &[String],
    work_dir: &PathBuf,
    log_path: &PathBuf,
    envs: &[(&str, String)],
    label: &str,
) -> Result<SidecarProcess, String> {
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|error| format!("无法打开 {label} 日志: {error}"))?;
    writeln!(log, "\n=== {label} start {} ===", unix_timestamp()).ok();
    let stderr = log
        .try_clone()
        .map_err(|error| format!("无法复制 {label} 日志句柄: {error}"))?;

    let mut command = Command::new(binary);
    command
        .args(args)
        .current_dir(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr));

    for (key, value) in envs {
        command.env(key, value);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("无法启动 {label}: {error}"))?;

    Ok(SidecarProcess {
        child,
        log_path: log_path.clone(),
    })
}

fn wait_for_health(
    port: u16,
    path: &str,
    expected_body: Option<&str>,
    label: &str,
) -> Result<(), String> {
    for _ in 0..60 {
        if http_get_ok(port, path, expected_body) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!("{label} 启动超时"))
}

fn http_get_ok(port: u16, path: &str, expected_body: Option<&str>) -> bool {
    let Ok(mut stream) = TcpStream::connect((HOST, port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(700)));
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: {HOST}:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    let ok_status = response.starts_with("HTTP/1.1 2") || response.starts_with("HTTP/1.0 2");
    ok_status
        && expected_body
            .map(|text| response.contains(text))
            .unwrap_or(true)
}

fn allocate_port(start: u16, end: u16) -> Result<u16, String> {
    for port in start..=end {
        if TcpListener::bind((HOST, port)).is_ok() {
            return Ok(port);
        }
    }
    Err("没有可用的本地端口".to_string())
}

fn allocate_opencode_port(preferred: Option<u16>) -> Result<u16, String> {
    if let Some(port) = preferred {
        if TcpListener::bind((HOST, port)).is_ok() {
            return Ok(port);
        }
        return Err(format!("OpenCode 端口 {port} 已被占用"));
    }
    allocate_port(OPENCODE_START_PORT, OPENCODE_END_PORT)
}

fn find_sidecar_binary(app: &AppHandle, group: &str, name: &str) -> Result<PathBuf, String> {
    let executable = executable_name(name);
    let platform = platform_key();
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("binaries")
                .join(group)
                .join(platform)
                .join(&executable),
        );
        candidates.push(resource_dir.join(group).join(platform).join(&executable));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(
            current_dir
                .join("binaries")
                .join(group)
                .join(platform)
                .join(&executable),
        );
        candidates.push(
            current_dir
                .join("src-tauri")
                .join("binaries")
                .join(group)
                .join(platform)
                .join(&executable),
        );
    }
    candidates.push(
        manifest_dir
            .join("binaries")
            .join(group)
            .join(platform)
            .join(&executable),
    );

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "未找到 {name} 二进制，请放置到 desktop/src-tauri/binaries/{group}/{platform}/{executable}，或在 desktop/ 下运行 npm run sidecars 准备 sidecar"
    ))
}

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
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

fn local_url(port: u16) -> String {
    format!("http://{HOST}:{port}")
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn platform_key_uses_supported_packaging_names() {
        assert!(matches!(
            platform_key(),
            "darwin-arm64"
                | "darwin-amd64"
                | "linux-arm64"
                | "linux-amd64"
                | "windows-amd64"
        ));
    }

    #[test]
    fn executable_name_adds_windows_suffix_only_on_windows() {
        if cfg!(windows) {
            assert_eq!(executable_name("opencode"), "opencode.exe");
        } else {
            assert_eq!(executable_name("opencode"), "opencode");
        }
    }

    #[test]
    fn http_get_ok_checks_status_and_expected_body() {
        let listener = TcpListener::bind((HOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 512];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 16\r\nConnection: close\r\n\r\n{\"healthy\":true}",
            );
        });
        assert!(http_get_ok(port, "/global/health", Some("\"healthy\":true")));
    }

    #[test]
    fn allocate_port_skips_ports_that_are_already_bound() {
        let first = TcpListener::bind((HOST, 0)).unwrap();
        let occupied = first.local_addr().unwrap().port();
        assert!(allocate_port(occupied, occupied).is_err());
    }
}
