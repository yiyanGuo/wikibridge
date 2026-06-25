use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::{frpc::ManagedProcess, local_service::LocalServiceProcess, sidecar::OpenCodeStack};

const DEFAULT_BASE_URL: &str = "";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PersistedState {
    pub base_url: String,
    pub user_session: Option<String>,
    pub uid_cookie: Option<String>,
    pub enabled_proxy_ids: BTreeSet<u64>,
    pub last_configs: BTreeMap<u64, String>,
    #[serde(default)]
    pub projects: BTreeMap<String, KnowledgeProject>,
    #[serde(default)]
    pub connections: BTreeMap<String, ProjectConnection>,
}

impl Default for PersistedState {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.to_string(),
            user_session: None,
            uid_cookie: None,
            enabled_proxy_ids: BTreeSet::new(),
            last_configs: BTreeMap::new(),
            projects: BTreeMap::new(),
            connections: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KnowledgeProject {
    pub project_id: String,
    pub name: String,
    pub folder_path: String,
    pub raw_dir: String,
    pub materials: Vec<ProjectMaterial>,
    pub build_status: BuildStatus,
    pub link_status: LinkStatus,
    pub created_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProjectMaterial {
    pub material_id: String,
    pub original_name: String,
    pub stored_name: String,
    pub stored_path: String,
    pub size_bytes: u64,
    pub added_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BuildStatus {
    NotBuilt,
    Building,
    Built,
    Failed,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkStatus {
    NotLinked,
    Linking,
    Linked,
    Failed,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProjectConnection {
    pub connection_id: String,
    pub project_id: String,
    pub proxy_id: u64,
    pub local_host: String,
    pub local_port: u16,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppSnapshot {
    pub base_url: String,
    pub is_authenticated: bool,
    pub enabled_proxy_ids: Vec<u64>,
    pub running_proxy_ids: Vec<u64>,
    pub app_data_dir: String,
}

#[derive(Debug)]
pub struct AppPaths {
    pub app_data_dir: PathBuf,
    pub state_path: PathBuf,
    pub proxy_dir: PathBuf,
    pub log_dir: PathBuf,
}

#[derive(Debug)]
pub struct DesktopRuntime {
    pub paths: AppPaths,
    pub persisted: PersistedState,
    pub processes: HashMap<u64, ManagedProcess>,
    pub service_processes: HashMap<String, LocalServiceProcess>,
    pub opencode_stack: OpenCodeStack,
}

impl DesktopRuntime {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法定位应用数据目录: {error}"))?;
        let proxy_dir = app_data_dir.join("proxies");
        let log_dir = app_data_dir.join("logs");
        fs::create_dir_all(&proxy_dir).map_err(|error| format!("无法创建配置目录: {error}"))?;
        fs::create_dir_all(&log_dir).map_err(|error| format!("无法创建日志目录: {error}"))?;

        let state_path = app_data_dir.join("state.json");
        let persisted = load_persisted_state(&state_path)?;
        Ok(Self {
            paths: AppPaths {
                app_data_dir,
                state_path,
                proxy_dir,
                log_dir,
            },
            persisted,
            processes: HashMap::new(),
            service_processes: HashMap::new(),
            opencode_stack: OpenCodeStack::default(),
        })
    }

    pub fn snapshot(&mut self) -> AppSnapshot {
        self.reap_exited();
        AppSnapshot {
            base_url: self.persisted.base_url.clone(),
            is_authenticated: self.persisted.user_session.is_some(),
            enabled_proxy_ids: self.persisted.enabled_proxy_ids.iter().copied().collect(),
            running_proxy_ids: self.running_proxy_ids(),
            app_data_dir: self.paths.app_data_dir.to_string_lossy().to_string(),
        }
    }

    pub fn running_proxy_ids(&mut self) -> Vec<u64> {
        self.reap_exited();
        self.processes.keys().copied().collect()
    }

    pub fn reap_exited(&mut self) {
        self.opencode_stack.reap_exited();
        self.service_processes
            .retain(|_, process| !process.is_stopped());
        let mut exited = Vec::new();
        for (proxy_id, process) in &mut self.processes {
            if matches!(process.child.try_wait(), Ok(Some(_))) {
                exited.push(*proxy_id);
            }
        }
        for proxy_id in exited {
            self.processes.remove(&proxy_id);
        }
    }

    pub fn set_base_url(&mut self, base_url: String) -> Result<(), String> {
        let normalized = normalize_base_url(&base_url)?;
        if normalized != self.persisted.base_url {
            self.persisted.base_url = normalized;
            self.clear_auth();
            self.persisted.enabled_proxy_ids.clear();
            self.persisted.last_configs.clear();
            self.persisted.connections.clear();
        }
        self.save()
    }

    pub fn update_cookies(&mut self, user_session: Option<String>, uid_cookie: Option<String>) {
        if user_session.is_some() {
            self.persisted.user_session = user_session;
        }
        if uid_cookie.is_some() {
            self.persisted.uid_cookie = uid_cookie;
        }
    }

    pub fn clear_auth(&mut self) {
        self.persisted.user_session = None;
        self.persisted.uid_cookie = None;
    }

    pub fn proxy_work_dir(&self, proxy_id: u64) -> PathBuf {
        self.paths.proxy_dir.join(proxy_id.to_string())
    }

    pub fn proxy_log_path(&self, proxy_id: u64) -> PathBuf {
        self.paths.log_dir.join(format!("{proxy_id}.log"))
    }

    pub fn remove_proxy_files(&mut self, proxy_id: u64) {
        self.persisted.enabled_proxy_ids.remove(&proxy_id);
        self.persisted.last_configs.remove(&proxy_id);
        let _ = fs::remove_dir_all(self.proxy_work_dir(proxy_id));
        let _ = fs::remove_file(self.proxy_log_path(proxy_id));
    }

    pub fn save(&self) -> Result<(), String> {
        let text = serde_json::to_string_pretty(&self.persisted)
            .map_err(|error| format!("无法序列化本地状态: {error}"))?;
        fs::write(&self.paths.state_path, text)
            .map_err(|error| format!("无法保存本地状态: {error}"))?;
        restrict_file_permissions(&self.paths.state_path);
        Ok(())
    }
}

impl Drop for DesktopRuntime {
    fn drop(&mut self) {
        for (_, mut process) in self.processes.drain() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
        for (_, process) in self.service_processes.drain() {
            process.stop();
        }
        self.opencode_stack.stop();
    }
}

pub fn normalize_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "后端地址必须是完整的 http(s) URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("后端地址只支持 http 或 https".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("后端地址必须包含主机名".to_string());
    }
    Ok(trimmed.to_string())
}

fn load_persisted_state(path: &PathBuf) -> Result<PersistedState, String> {
    if !path.exists() {
        return Ok(PersistedState::default());
    }
    let text = fs::read_to_string(path).map_err(|error| format!("无法读取本地状态: {error}"))?;
    let mut state: PersistedState =
        serde_json::from_str(&text).map_err(|error| format!("本地状态文件格式错误: {error}"))?;
    state.base_url = normalize_base_url(&state.base_url)?;
    Ok(state)
}

fn restrict_file_permissions(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}
