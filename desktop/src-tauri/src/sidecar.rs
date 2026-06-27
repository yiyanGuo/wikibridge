use std::{
    collections::hash_map::DefaultHasher,
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::state::{
    DesktopRuntime, KnowledgeProject, LlmSettings, RemoteKnowledgeBase, FIXED_BASE_URL,
};

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
    pub opencode_work_dir: Option<PathBuf>,
    pub project_id: Option<String>,
    pub opencode_config_hash: Option<u64>,
    pub llm_wiki_access_token: Option<String>,
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
        self.opencode_work_dir = None;
        self.project_id = None;
        self.opencode_config_hash = None;
        self.llm_wiki_access_token = None;
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
            self.opencode_work_dir = None;
            self.project_id = None;
            self.opencode_config_hash = None;
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
            self.llm_wiki_access_token = None;
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
    pub llm_wiki_port: Option<u16>,
    pub opencode_log_path: Option<String>,
    pub llm_wiki_log_path: Option<String>,
    pub project_id: Option<String>,
    pub mcp_server_name: Option<String>,
    pub mcp_status: Option<String>,
    pub session_id: Option<String>,
    pub session_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeSessionDto {
    pub session_id: String,
    pub directory: String,
    pub url: String,
}

#[derive(Debug, Clone)]
struct OpenCodeConfig {
    content: String,
    hash: u64,
}

pub fn desktop_services_state(runtime: &mut DesktopRuntime) -> DesktopServicesState {
    runtime.opencode_stack.reap_exited();
    let opencode_port = runtime.opencode_stack.opencode_port;
    let llm_wiki_port = runtime.opencode_stack.llm_wiki_port;
    DesktopServicesState {
        bearfrp_backend_url: FIXED_BASE_URL.to_string(),
        app_data_dir: runtime.paths.app_data_dir.to_string_lossy().to_string(),
        opencode: SidecarStateDto {
            running: runtime.opencode_stack.opencode.is_some(),
            healthy: opencode_port
                .map(|port| {
                    http_get_ok(port, "/global/health", Some("\"healthy\":true"))
                        && opencode_kb_chat_ready(port)
                })
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
    let work_dir = data_dir.join("users").join("default");
    fs::create_dir_all(data_dir.join("users").join("default"))
        .map_err(|error| format!("无法创建消费端用户数据目录: {error}"))?;
    fs::create_dir_all(data_dir.join("wiki"))
        .map_err(|error| format!("无法创建消费端公共 Wiki 目录: {error}"))?;
    fs::create_dir_all(&work_dir).map_err(|error| format!("无法创建消费端工作目录: {error}"))?;

    let opencode_port = ensure_opencode_running(
        app,
        runtime,
        OpenCodeLaunch {
            data_dir,
            work_dir,
            project_id: None,
            knowledge_base_name: Some("本地知识库".to_string()),
            llm_wiki_project_id: None,
            llm_wiki_base_url: format!("{}/api/v1", local_url(llm_wiki_port)),
            llm_wiki_token: None,
            preferred_port: None,
        },
    )?;

    let session = create_opencode_session(runtime)?;

    Ok(OpenCodeStackDto {
        opencode_url: local_url(opencode_port),
        llm_wiki_url: format!("{}/api/v1", local_url(llm_wiki_port)),
        opencode_port,
        llm_wiki_port: Some(llm_wiki_port),
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
        project_id: runtime.opencode_stack.project_id.clone(),
        mcp_server_name: None,
        mcp_status: None,
        session_id: Some(session.session_id),
        session_url: Some(session.url),
    })
}

pub fn stop_opencode_stack(runtime: &mut DesktopRuntime) {
    runtime.opencode_stack.stop();
}

pub fn create_opencode_session(runtime: &mut DesktopRuntime) -> Result<OpenCodeSessionDto, String> {
    runtime.opencode_stack.reap_exited();
    let port = runtime
        .opencode_stack
        .opencode_port
        .ok_or_else(|| "本地 OpenCode 尚未启动".to_string())?;
    if !http_get_ok(port, "/global/health", Some("\"healthy\":true")) {
        return Err("本地 OpenCode 尚未就绪".to_string());
    }
    if !opencode_kb_chat_ready(port) {
        return Err("本地 OpenCode KB 对话接口未就绪，请停止后重新启动 OpenCode。".to_string());
    }
    let work_dir = current_opencode_work_dir(runtime)?;
    let response = http_json_post(
        port,
        &format!("/session?directory={}", url_query_encode(&work_dir)),
        &json!({}),
        "创建 OpenCode 对话",
    )?;
    let session_id = response
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "OpenCode 创建会话响应缺少 session id".to_string())?
        .to_string();
    let directory = response
        .get("directory")
        .and_then(Value::as_str)
        .ok_or_else(|| "OpenCode 创建会话响应缺少 directory".to_string())?
        .to_string();
    let encoded = opencode_base64_encode(directory.as_bytes());
    Ok(OpenCodeSessionDto {
        session_id: session_id.clone(),
        directory,
        url: format!("{}/{}/session/{}", local_url(port), encoded, session_id),
    })
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
    let work_dir = data_dir.join("users").join("default");
    let opencode_port = ensure_opencode_running(
        app,
        runtime,
        OpenCodeLaunch {
            data_dir,
            work_dir,
            project_id: Some(project.project_id.clone()),
            knowledge_base_name: Some(project.name.clone()),
            llm_wiki_project_id: Some(llm_wiki_project_id.to_string()),
            llm_wiki_base_url: format!("{}/api/v1", local_url(llm_wiki_port)),
            llm_wiki_token: None,
            preferred_port: preferred_opencode_port,
        },
    )?;

    let session = create_opencode_session(runtime)?;
    Ok(OpenCodeStackDto {
        opencode_url: local_url(opencode_port),
        llm_wiki_url: format!("{}/api/v1", local_url(llm_wiki_port)),
        opencode_port,
        llm_wiki_port: Some(llm_wiki_port),
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
        mcp_server_name: None,
        mcp_status: None,
        session_id: Some(session.session_id),
        session_url: Some(session.url),
    })
}

pub fn ensure_opencode_for_remote(
    app: &AppHandle,
    runtime: &mut DesktopRuntime,
    remote: &RemoteKnowledgeBase,
) -> Result<OpenCodeStackDto, String> {
    runtime.opencode_stack.reap_exited();

    let data_dir = runtime
        .paths
        .app_data_dir
        .join("opencode-remotes")
        .join(&remote.remote_id);
    let work_dir = data_dir.join("users").join("default");
    fs::create_dir_all(data_dir.join("users").join("default"))
        .map_err(|error| format!("无法创建远程 OpenCode 用户数据目录: {error}"))?;
    fs::create_dir_all(data_dir.join("wiki"))
        .map_err(|error| format!("无法创建远程 OpenCode Wiki 目录: {error}"))?;
    fs::create_dir_all(&work_dir)
        .map_err(|error| format!("无法创建远程 OpenCode 工作目录: {error}"))?;

    let project_id = remote
        .current_project
        .as_ref()
        .map(|project| project.id.clone());
    let opencode_port = ensure_opencode_running(
        app,
        runtime,
        OpenCodeLaunch {
            data_dir,
            work_dir,
            project_id: Some(format!("remote-{}", remote.remote_id)),
            knowledge_base_name: Some(
                remote
                    .current_project
                    .as_ref()
                    .map(|project| format!("{} / {}", remote.name, project.name))
                    .unwrap_or_else(|| remote.name.clone()),
            ),
            llm_wiki_project_id: project_id,
            llm_wiki_base_url: remote_api_base(remote),
            llm_wiki_token: remote.token.clone(),
            preferred_port: None,
        },
    )?;
    let server_name = llm_wiki_mcp_server_name(remote);
    let mcp_status = register_llm_wiki_mcp(app, opencode_port, remote, &server_name)?;

    Ok(OpenCodeStackDto {
        opencode_url: local_url(opencode_port),
        llm_wiki_url: remote_api_base(remote),
        opencode_port,
        llm_wiki_port: None,
        opencode_log_path: runtime
            .opencode_stack
            .opencode
            .as_ref()
            .map(|process| process.log_path.to_string_lossy().to_string()),
        llm_wiki_log_path: None,
        project_id: runtime.opencode_stack.project_id.clone(),
        mcp_server_name: Some(server_name),
        mcp_status: Some(mcp_status),
        session_id: None,
        session_url: None,
    })
}

pub fn stop_project_chat(runtime: &mut DesktopRuntime, project_id: &str) {
    runtime.opencode_stack.reap_exited();
    if runtime.opencode_stack.project_id.as_deref() == Some(project_id) {
        runtime.opencode_stack.stop();
    }
}

pub fn stop_project_llm_wiki_server(runtime: &mut DesktopRuntime, project_id: &str) {
    runtime.opencode_stack.reap_exited();
    if runtime.opencode_stack.project_id.as_deref() == Some(project_id) {
        runtime.opencode_stack.llm_wiki.take();
        runtime.opencode_stack.llm_wiki_port = None;
        runtime.opencode_stack.llm_wiki_access_token = None;
        runtime.opencode_stack.project_id = None;
    }
}

pub fn ensure_llm_wiki_server_running(
    app: &AppHandle,
    runtime: &mut DesktopRuntime,
) -> Result<String, String> {
    let port = ensure_llm_wiki_running(app, runtime)?;
    Ok(format!("{}/api/v1", local_url(port)))
}

pub fn start_project_llm_wiki_server(
    app: &AppHandle,
    runtime: &mut DesktopRuntime,
    project: &KnowledgeProject,
    preferred_port: u16,
    access_token: Option<&str>,
) -> Result<String, String> {
    runtime.opencode_stack.reap_exited();
    let access_token = access_token
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned);

    if let Some(port) = runtime.opencode_stack.llm_wiki_port {
        let same_project =
            runtime.opencode_stack.project_id.as_deref() == Some(&project.project_id);
        let same_access = runtime.opencode_stack.llm_wiki_access_token == access_token;
        if port == preferred_port
            && same_project
            && same_access
            && runtime.opencode_stack.llm_wiki.is_some()
            && is_llm_wiki_server_ready(port)
        {
            return Ok(format!("{}/api/v1", local_url(port)));
        }
        runtime.opencode_stack.llm_wiki = None;
        runtime.opencode_stack.llm_wiki_port = None;
        runtime.opencode_stack.llm_wiki_access_token = None;
        stop_opencode_process(runtime);
    }

    let port = allocate_specific_port(preferred_port, "LLM Wiki")?;
    let data_dir = runtime.paths.app_data_dir.join("llm-wiki");
    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("无法创建 LLM Wiki 数据目录: {error}"))?;
    fs::create_dir_all(&runtime.paths.log_dir)
        .map_err(|error| format!("无法创建日志目录: {error}"))?;

    let binary = find_sidecar_binary(app, "llm-wiki-server", "llm-wiki-server")?;
    ensure_executable(&binary);
    let log_path = runtime
        .paths
        .log_dir
        .join(format!("llm-wiki-server-{}.log", project.project_id));
    let mut envs = vec![
        ("LLM_WIKI_DATA_DIR", data_dir.to_string_lossy().to_string()),
        ("LLM_WIKI_BIND", HOST.to_string()),
        ("LLM_WIKI_PORT", port.to_string()),
    ];
    if let Some(token) = &access_token {
        envs.push(("LLM_WIKI_TOKEN", token.clone()));
    }
    let process = spawn_logged(
        binary,
        &[],
        &runtime.paths.app_data_dir,
        &log_path,
        &envs,
        "llm-wiki-server",
    )?;

    runtime.opencode_stack.llm_wiki = Some(process);
    runtime.opencode_stack.llm_wiki_port = Some(port);
    runtime.opencode_stack.project_id = Some(project.project_id.clone());
    runtime.opencode_stack.llm_wiki_access_token = access_token;
    wait_for_health(port, "/api/v1/health", None, "LLM Wiki")?;
    Ok(format!("{}/api/v1", local_url(port)))
}

pub fn is_llm_wiki_server_ready(port: u16) -> bool {
    http_get_ok(port, "/api/v1/health", None)
}

fn ensure_llm_wiki_running(app: &AppHandle, runtime: &mut DesktopRuntime) -> Result<u16, String> {
    if let Some(port) = runtime.opencode_stack.llm_wiki_port {
        if runtime.opencode_stack.llm_wiki.is_some() && http_get_ok(port, "/api/v1/health", None) {
            return Ok(port);
        }
        runtime.opencode_stack.llm_wiki = None;
        runtime.opencode_stack.llm_wiki_port = None;
        runtime.opencode_stack.llm_wiki_access_token = None;
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
    runtime.opencode_stack.project_id = None;
    runtime.opencode_stack.llm_wiki_access_token = None;
    wait_for_health(port, "/api/v1/health", None, "LLM Wiki")?;
    Ok(port)
}

struct OpenCodeLaunch {
    data_dir: PathBuf,
    work_dir: PathBuf,
    project_id: Option<String>,
    knowledge_base_name: Option<String>,
    llm_wiki_project_id: Option<String>,
    llm_wiki_base_url: String,
    llm_wiki_token: Option<String>,
    preferred_port: Option<u16>,
}

fn ensure_opencode_running(
    app: &AppHandle,
    runtime: &mut DesktopRuntime,
    launch: OpenCodeLaunch,
) -> Result<u16, String> {
    if let Some(port) = runtime.opencode_stack.opencode_port {
        let same_project =
            launch.project_id.is_none() || runtime.opencode_stack.project_id == launch.project_id;
        let same_port = launch
            .preferred_port
            .map(|preferred| preferred == port)
            .unwrap_or(true);
        let config = opencode_config(&runtime.persisted.llm_settings)?;
        let launch_hash = opencode_launch_hash(
            config.hash,
            &launch.llm_wiki_base_url,
            launch.llm_wiki_token.as_deref(),
            launch.llm_wiki_project_id.as_deref(),
        );
        let same_config = runtime.opencode_stack.opencode_config_hash == Some(launch_hash);
        let same_work_dir = runtime
            .opencode_stack
            .opencode_work_dir
            .as_ref()
            .map(|work_dir| work_dir == &launch.work_dir)
            .unwrap_or(false);
        if runtime.opencode_stack.opencode.is_some()
            && http_get_ok(port, "/global/health", Some("\"healthy\":true"))
            && opencode_kb_chat_ready(port)
            && same_project
            && same_port
            && same_config
            && same_work_dir
        {
            return Ok(port);
        }
        stop_opencode_process(runtime);
    }

    let config = opencode_config(&runtime.persisted.llm_settings)?;
    let launch_hash = opencode_launch_hash(
        config.hash,
        &launch.llm_wiki_base_url,
        launch.llm_wiki_token.as_deref(),
        launch.llm_wiki_project_id.as_deref(),
    );
    let port = allocate_opencode_port(launch.preferred_port)?;
    fs::create_dir_all(launch.data_dir.join("users").join("default"))
        .map_err(|error| format!("无法创建消费端用户数据目录: {error}"))?;
    fs::create_dir_all(&launch.work_dir)
        .map_err(|error| format!("无法创建 OpenCode 工作目录: {error}"))?;
    write_kb_agent_instructions(&launch)?;
    let config_dir = launch.data_dir.join("config");
    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("无法创建 OpenCode 配置目录: {error}"))?;
    let xdg_config_dir = launch.data_dir.join("xdg-config");
    let xdg_data_dir = launch.data_dir.join("xdg-data");
    let xdg_state_dir = launch.data_dir.join("xdg-state");
    let xdg_cache_dir = launch.data_dir.join("xdg-cache");
    let isolated_home = launch.data_dir.join("home");
    for dir in [
        &xdg_config_dir,
        &xdg_data_dir,
        &xdg_state_dir,
        &xdg_cache_dir,
        &isolated_home,
    ] {
        fs::create_dir_all(dir).map_err(|error| format!("无法创建 OpenCode 运行目录: {error}"))?;
    }
    let db_path = launch.data_dir.join("opencode.db");
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
        ("OPENCODE_KB_READONLY", "1".to_string()),
        ("OPENCODE_DISABLE_PROJECT_CONFIG", "1".to_string()),
        (
            "OPENCODE_CONFIG_DIR",
            config_dir.to_string_lossy().to_string(),
        ),
        ("OPENCODE_DB", db_path.to_string_lossy().to_string()),
        (
            "XDG_CONFIG_HOME",
            xdg_config_dir.to_string_lossy().to_string(),
        ),
        ("XDG_DATA_HOME", xdg_data_dir.to_string_lossy().to_string()),
        (
            "XDG_STATE_HOME",
            xdg_state_dir.to_string_lossy().to_string(),
        ),
        (
            "XDG_CACHE_HOME",
            xdg_cache_dir.to_string_lossy().to_string(),
        ),
        (
            "OPENCODE_TEST_HOME",
            isolated_home.to_string_lossy().to_string(),
        ),
        ("HOME", isolated_home.to_string_lossy().to_string()),
        ("USERPROFILE", isolated_home.to_string_lossy().to_string()),
        ("LLM_WIKI_BASE_URL", launch.llm_wiki_base_url.clone()),
        ("OPENCODE_CONFIG_CONTENT", config.content.clone()),
    ];
    if let Some(project_id) = &launch.llm_wiki_project_id {
        envs.push(("LLM_WIKI_PROJECT_ID", project_id.clone()));
    }
    if let Some(token) = &launch.llm_wiki_token {
        envs.push(("LLM_WIKI_TOKEN", token.clone()));
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
    runtime.opencode_stack.opencode_work_dir = Some(launch.work_dir);
    runtime.opencode_stack.project_id = launch.project_id;
    runtime.opencode_stack.opencode_config_hash = Some(launch_hash);
    wait_for_health(port, "/global/health", Some("\"healthy\":true"), "OpenCode")?;
    wait_for_opencode_kb_chat_ready(port)?;
    Ok(port)
}

fn stop_opencode_process(runtime: &mut DesktopRuntime) {
    runtime.opencode_stack.opencode.take();
    runtime.opencode_stack.opencode_port = None;
    runtime.opencode_stack.opencode_work_dir = None;
    runtime.opencode_stack.project_id = None;
    runtime.opencode_stack.opencode_config_hash = None;
}

fn opencode_config(settings: &LlmSettings) -> Result<OpenCodeConfig, String> {
    let settings = settings.clone().normalized()?;
    let api_key = settings
        .api_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
        .ok_or_else(|| "请先配置模型供应商和 API Key，再启动 OpenCode".to_string())?;
    let provider = settings.provider.as_str();
    let model = settings.model.trim();
    if model.is_empty() {
        return Err("请先配置 OpenCode 使用的模型名称".to_string());
    }

    let mut provider_options = serde_json::Map::new();
    provider_options.insert("apiKey".to_string(), json!(api_key));
    if let Some(base_url) = settings.base_url.as_deref() {
        provider_options.insert("baseURL".to_string(), json!(base_url));
    } else if provider == "deepseek" {
        provider_options.insert("baseURL".to_string(), json!("https://api.deepseek.com"));
    }
    let provider_config = json!({ "options": provider_options });
    let content = json!({
        "$schema": "https://opencode.ai/config.json",
        "model": format!("{provider}/{model}"),
        "provider": {
            provider: provider_config
        }
    })
    .to_string();
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    Ok(OpenCodeConfig {
        content,
        hash: hasher.finish(),
    })
}

fn opencode_launch_hash(
    config_hash: u64,
    llm_wiki_base_url: &str,
    llm_wiki_token: Option<&str>,
    llm_wiki_project_id: Option<&str>,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    config_hash.hash(&mut hasher);
    llm_wiki_base_url.hash(&mut hasher);
    llm_wiki_token.unwrap_or_default().hash(&mut hasher);
    llm_wiki_project_id.unwrap_or_default().hash(&mut hasher);
    hasher.finish()
}

fn register_llm_wiki_mcp(
    app: &AppHandle,
    opencode_port: u16,
    remote: &RemoteKnowledgeBase,
    server_name: &str,
) -> Result<String, String> {
    if let Some(status) = current_mcp_status(opencode_port, server_name) {
        if status == "connected" {
            return Ok(status);
        }
    }

    let entry_path = find_mcp_server_entry(app)?;
    let api_base_url = remote_api_base(remote);
    let mut environment = serde_json::Map::new();
    environment.insert("LLM_WIKI_API_BASE_URL".to_string(), json!(api_base_url));
    if let Some(token) = remote
        .token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        environment.insert("LLM_WIKI_API_TOKEN".to_string(), json!(token));
    }
    if let Some(project_id) = remote
        .current_project
        .as_ref()
        .map(|project| project.id.as_str())
    {
        environment.insert("LLM_WIKI_PROJECT_ID".to_string(), json!(project_id));
    }

    let payload = json!({
        "name": server_name,
        "config": {
            "type": "local",
            "command": ["node", entry_path.to_string_lossy()],
            "environment": environment,
            "enabled": true,
            "timeout": 30000,
        }
    });
    let response = http_json_post(opencode_port, "/mcp", &payload, "注册知识库 MCP")?;
    let status = response
        .get(server_name)
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str)
        .or_else(|| response.get("status").and_then(Value::as_str))
        .unwrap_or("registered")
        .to_string();
    Ok(status)
}

fn current_mcp_status(opencode_port: u16, server_name: &str) -> Option<String> {
    http_json_get(opencode_port, "/mcp", "查询知识库 MCP")
        .ok()
        .and_then(|response| {
            response
                .get(server_name)
                .and_then(|value| value.get("status"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn write_kb_agent_instructions(launch: &OpenCodeLaunch) -> Result<(), String> {
    let kb_name = launch
        .knowledge_base_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("当前知识库");
    let project_hint = launch
        .llm_wiki_project_id
        .as_deref()
        .map(str::trim)
        .filter(|project| !project.is_empty())
        .map(|project| {
            format!(
                "- 当前 LLM Wiki project_id 是 `{}`。\n",
                markdown_inline(project)
            )
        })
        .unwrap_or_default();
    let content = format!(
        "# WikiBridge Knowledge Base Chat\n\n\
You are running inside WikiBridge visitor mode for the selected knowledge base: **{}**.\n\n\
Rules:\n\
- Answer the user's questions using this selected knowledge base first.\n\
- Before answering factual questions about the knowledge base, call `llm_wiki_search` or `llm_wiki_read_file` when those MCP tools are available.\n\
- If search results are insufficient, say what is missing instead of inventing details.\n\
- Keep answers concise and in the user's language.\n\
{}\
- Do not use shell, terminal, file mutation, git, or VCS features in this mode.\n",
        markdown_inline(kb_name),
        project_hint,
    );
    fs::write(launch.work_dir.join("AGENTS.md"), content)
        .map_err(|error| format!("无法写入 OpenCode 知识库指令: {error}"))
}

fn markdown_inline(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace('*', "\\*")
}

pub fn llm_wiki_mcp_server_name(remote: &RemoteKnowledgeBase) -> String {
    let suffix = remote
        .remote_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    format!("llm-wiki-{suffix}")
}

fn remote_api_base(remote: &RemoteKnowledgeBase) -> String {
    let value = if remote.api_url.trim().is_empty() {
        remote.url.as_str()
    } else {
        remote.api_url.as_str()
    };
    normalize_api_base(value)
}

fn normalize_api_base(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.ends_with("/api/v1") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/api/v1")
    }
}

fn http_json_post(port: u16, path: &str, payload: &Value, label: &str) -> Result<Value, String> {
    let body = payload.to_string();
    http_json_request(port, "POST", path, Some(&body), label)
}

fn http_json_get(port: u16, path: &str, label: &str) -> Result<Value, String> {
    http_json_request(port, "GET", path, None, label)
}

fn http_json_request(
    port: u16,
    method: &str,
    path: &str,
    body: Option<&str>,
    label: &str,
) -> Result<Value, String> {
    let Ok(mut stream) = TcpStream::connect((HOST, port)) else {
        return Err(format!("本地 OpenCode 还未就绪，无法{label}"));
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(8)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(8)));
    let request = match body {
        Some(body) => format!(
            "{method} {path} HTTP/1.1\r\nHost: {HOST}:{port}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.as_bytes().len(),
            body
        ),
        None => format!(
            "{method} {path} HTTP/1.1\r\nHost: {HOST}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
        ),
    };
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("{label}请求发送失败: {error}"))?;
    let response = read_http_response_with_retry(&mut stream, label)?;
    let (header, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| format!("{label}响应格式错误"))?;
    let ok_status = header.starts_with("HTTP/1.1 2") || header.starts_with("HTTP/1.0 2");
    let json = serde_json::from_str::<Value>(body)
        .map_err(|error| format!("{label}返回非 JSON 响应: {error}"))?;
    if !ok_status {
        let message = json
            .get("message")
            .or_else(|| json.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("OpenCode 拒绝请求");
        return Err(message.to_string());
    }
    Ok(json)
}

fn read_http_response_with_retry(stream: &mut TcpStream, label: &str) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut response = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => response.extend_from_slice(&buffer[..size]),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(format!("{label}响应读取超时"));
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(format!("{label}响应读取失败: {error}")),
        }
    }
    String::from_utf8(response).map_err(|error| format!("{label}返回非 UTF-8 响应: {error}"))
}

fn opencode_base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    let mut index = 0;
    while index < input.len() {
        let b0 = input[index];
        let b1 = input.get(index + 1).copied();
        let b2 = input.get(index + 2).copied();
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1.unwrap_or(0) >> 4)) as usize] as char);
        if let Some(b1) = b1 {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2.unwrap_or(0) >> 6)) as usize] as char);
        }
        if let Some(b2) = b2 {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        }
        index += 3;
    }
    out
}

fn current_opencode_work_dir(runtime: &DesktopRuntime) -> Result<String, String> {
    let path = runtime
        .opencode_stack
        .opencode_work_dir
        .clone()
        .ok_or_else(|| "OpenCode 工作目录尚未记录，请重新启动本地 OpenCode".to_string())?;
    path.canonicalize()
        .or_else(|_| Ok(path.clone()))
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error: std::io::Error| format!("无法解析 OpenCode 工作目录: {error}"))
}

fn url_query_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn find_mcp_server_entry(app: &AppHandle) -> Result<PathBuf, String> {
    let relative = Path::new("mcp-server")
        .join("dist")
        .join("src")
        .join("index.js");
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();

    let mut push_repo_candidates = |base: PathBuf| {
        candidates.push(base.join(&relative));
        candidates.push(base.join("..").join(&relative));
        candidates.push(base.join("..").join("..").join("llm_wiki").join(&relative));
        candidates.push(base.join("..").join("llm_wiki").join(&relative));
    };

    push_repo_candidates(manifest_dir);
    if let Ok(current_dir) = std::env::current_dir() {
        push_repo_candidates(current_dir);
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(&relative));
        candidates.push(resource_dir.join("llm_wiki").join(&relative));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join(&relative));
            candidates.push(exe_dir.join("..").join("Resources").join(&relative));
            candidates.push(
                exe_dir
                    .join("..")
                    .join("Resources")
                    .join("llm_wiki")
                    .join(&relative),
            );
        }
    }

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate.canonicalize().unwrap_or(candidate));
        }
    }

    Err("未找到 LLM Wiki MCP server 入口。请先在 llm_wiki 目录执行 npm run mcp:build，或将 mcp-server/dist 打包进应用资源。".to_string())
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
        .map_err(|error| format!("无法创建消费端项目用户目录: {error}"))?;

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
                .map_err(|error| format!("无法更新消费端 wiki 挂载: {error}"))?;
        } else if metadata.is_dir() {
            let mut entries = fs::read_dir(link_path)
                .map_err(|error| format!("无法检查消费端 wiki 目录: {error}"))?;
            if entries.next().is_some() {
                return Err(format!(
                    "消费端 wiki 目录已存在且非空: {}",
                    link_path.display()
                ));
            }
            fs::remove_dir(link_path)
                .map_err(|error| format!("无法更新消费端 wiki 挂载: {error}"))?;
        } else {
            fs::remove_file(link_path)
                .map_err(|error| format!("无法更新消费端 wiki 挂载: {error}"))?;
        }
    }
    if let Some(parent) = link_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建消费端数据目录: {error}"))?;
    }
    symlink_dir(&target, link_path).map_err(|error| {
        format!("无法挂载项目 wiki 到消费端数据目录: {error}。请确认当前系统允许创建目录符号链接")
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

fn wait_for_opencode_kb_chat_ready(port: u16) -> Result<(), String> {
    for _ in 0..60 {
        if opencode_kb_chat_ready(port) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err("OpenCode 已启动，但 KB 对话接口未就绪：/vcs 仍返回 403，请重启桌面端或更新 OpenCode sidecar".to_string())
}

fn opencode_kb_chat_ready(port: u16) -> bool {
    http_request_ok(
        port,
        "GET",
        "/vcs?directory=%2Fusers%2Fdefault",
        "",
        Some("{}"),
    ) && http_request_ok(
        port,
        "GET",
        "/vcs/diff?mode=git&directory=%2Fusers%2Fdefault",
        "",
        Some("[]"),
    )
}

fn http_get_ok(port: u16, path: &str, expected_body: Option<&str>) -> bool {
    http_request_ok(port, "GET", path, "", expected_body)
}

fn http_request_ok(
    port: u16,
    method: &str,
    path: &str,
    body: &str,
    expected_body: Option<&str>,
) -> bool {
    let Ok(mut stream) = TcpStream::connect((HOST, port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(700)));
    let request = if body.is_empty() {
        format!("{method} {path} HTTP/1.1\r\nHost: {HOST}:{port}\r\nConnection: close\r\n\r\n")
    } else {
        format!(
            "{method} {path} HTTP/1.1\r\nHost: {HOST}:{port}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.as_bytes().len(),
            body
        )
    };
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

fn allocate_specific_port(port: u16, label: &str) -> Result<u16, String> {
    if TcpListener::bind((HOST, port)).is_ok() {
        Ok(port)
    } else {
        Err(format!("{label} 端口 {port} 已被占用"))
    }
}

fn allocate_opencode_port(preferred: Option<u16>) -> Result<u16, String> {
    if let Some(port) = preferred {
        if TcpListener::bind((HOST, port)).is_ok() {
            return Ok(port);
        }
        return Err(format!("消费端端口 {port} 已被占用"));
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
            "darwin-arm64" | "darwin-amd64" | "linux-arm64" | "linux-amd64" | "windows-amd64"
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
        assert!(http_get_ok(
            port,
            "/global/health",
            Some("\"healthy\":true")
        ));
    }

    #[test]
    fn allocate_port_skips_ports_that_are_already_bound() {
        let first = TcpListener::bind((HOST, 0)).unwrap();
        let occupied = first.local_addr().unwrap().port();
        assert!(allocate_port(occupied, occupied).is_err());
    }
}
