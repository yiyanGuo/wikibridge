use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use url::Url;

use crate::{frpc::ManagedProcess, local_service::LocalServiceProcess, sidecar::OpenCodeStack};

pub const FIXED_BASE_URL: &str = "https://frp.muleizh.ink";
const DEFAULT_BASE_URL: &str = FIXED_BASE_URL;
pub const DEFAULT_LLM_PROVIDER: &str = "deepseek";
pub const DEFAULT_LLM_MODEL: &str = "deepseek-chat";

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
    #[serde(default)]
    pub remote_knowledge_bases: BTreeMap<String, RemoteKnowledgeBase>,
    #[serde(default)]
    pub llm_settings: LlmSettings,
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
            remote_knowledge_bases: BTreeMap::new(),
            llm_settings: LlmSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LlmSettings {
    #[serde(default)]
    pub provider: String,
    #[serde(default = "default_llm_model")]
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
}

impl Default for LlmSettings {
    fn default() -> Self {
        Self {
            provider: DEFAULT_LLM_PROVIDER.to_string(),
            model: DEFAULT_LLM_MODEL.to_string(),
            api_key: None,
            base_url: None,
        }
    }
}

impl LlmSettings {
    pub fn normalized(mut self) -> Result<Self, String> {
        self.provider = self.provider.trim().to_ascii_lowercase();
        if self.provider.is_empty() {
            self.provider = DEFAULT_LLM_PROVIDER.to_string();
        }
        if !is_safe_provider_id(&self.provider) {
            return Err("模型供应商只能包含字母、数字、点、下划线和连字符".to_string());
        }
        self.model = self.model.trim().to_string();
        if self.model.is_empty() {
            self.model = DEFAULT_LLM_MODEL.to_string();
        }
        self.api_key = self
            .api_key
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty());
        self.base_url = self
            .base_url
            .map(|url| normalize_base_url(&url))
            .transpose()?
            .filter(|url| !url.is_empty());
        Ok(self)
    }

    pub fn normalized_or_default(self) -> Self {
        self.normalized().unwrap_or_default()
    }

    pub fn has_api_key(&self) -> bool {
        self.api_key
            .as_deref()
            .map(|key| !key.trim().is_empty())
            .unwrap_or(false)
    }
}

fn default_llm_model() -> String {
    DEFAULT_LLM_MODEL.to_string()
}

fn is_safe_provider_id(value: &str) -> bool {
    value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmSettingsInput {
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettingsDto {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub has_api_key: bool,
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
    #[serde(default = "default_connection_traffic_mb")]
    pub traffic_mb: i64,
    pub created_at: u64,
}

fn default_connection_traffic_mb() -> i64 {
    100
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteKnowledgeBase {
    pub remote_id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub api_url: String,
    pub status: String,
    #[serde(default)]
    pub project_count: usize,
    #[serde(default)]
    pub projects: Vec<RemoteKnowledgeBaseProject>,
    #[serde(default)]
    pub current_project: Option<RemoteKnowledgeBaseProject>,
    #[serde(default)]
    pub auth_required: bool,
    #[serde(default = "default_mcp_status")]
    pub mcp_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    pub added_at: u64,
    pub last_opened_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteKnowledgeBaseProject {
    pub id: String,
    pub name: String,
    pub path: String,
    pub current: bool,
}

fn default_mcp_status() -> String {
    "not_registered".to_string()
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
        let app_data_dir = app_data_dir
            .canonicalize()
            .map_err(|error| format!("无法解析应用数据目录: {error}"))?;
        let proxy_dir = app_data_dir.join("proxies");
        let log_dir = app_data_dir.join("logs");

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

    pub fn set_base_url(&mut self, _base_url: String) -> Result<(), String> {
        let normalized = fixed_base_url()?;
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

    pub fn llm_settings_dto(&self) -> LlmSettingsDto {
        LlmSettingsDto {
            provider: self.persisted.llm_settings.provider.clone(),
            model: self.persisted.llm_settings.model.clone(),
            base_url: self.persisted.llm_settings.base_url.clone(),
            has_api_key: self.persisted.llm_settings.has_api_key(),
        }
    }

    pub fn set_llm_settings(
        &mut self,
        input: SaveLlmSettingsInput,
    ) -> Result<LlmSettingsDto, String> {
        let previous = self.persisted.llm_settings.clone();
        let mut settings = LlmSettings {
            provider: input.provider,
            model: input.model,
            api_key: input.api_key,
            base_url: input.base_url,
        }
        .normalized()?;
        if settings.api_key.is_none() {
            settings.api_key = previous.api_key;
        }
        self.persisted.llm_settings = settings;
        self.save()?;
        Ok(self.llm_settings_dto())
    }

    pub fn clear_llm_settings(&mut self) -> Result<LlmSettingsDto, String> {
        self.persisted.llm_settings.api_key = None;
        self.save()?;
        Ok(self.llm_settings_dto())
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

pub fn fixed_base_url() -> Result<String, String> {
    normalize_base_url(FIXED_BASE_URL)
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
    apply_fixed_base_url(&mut state)?;
    state.llm_settings = state.llm_settings.normalized_or_default();
    Ok(state)
}

fn apply_fixed_base_url(state: &mut PersistedState) -> Result<(), String> {
    let fixed = fixed_base_url()?;
    let already_fixed = normalize_base_url(&state.base_url)
        .map(|base_url| base_url == fixed)
        .unwrap_or(false);
    state.base_url = fixed;
    if !already_fixed {
        state.user_session = None;
        state.uid_cookie = None;
        state.enabled_proxy_ids.clear();
        state.last_configs.clear();
        state.connections.clear();
    }
    Ok(())
}

fn restrict_file_permissions(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_state_path(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "wikibridge-state-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        fs::create_dir_all(&root).unwrap();
        root.join("state.json")
    }

    #[test]
    fn normalize_base_url_trims_slash_and_rejects_bad_schemes() {
        assert_eq!(
            normalize_base_url(" https://bearfrp.example.test/ ").unwrap(),
            "https://bearfrp.example.test"
        );
        assert_eq!(normalize_base_url("  ").unwrap(), "");
        assert!(normalize_base_url("ftp://bearfrp.example.test").is_err());
        assert!(normalize_base_url("bearfrp.example.test").is_err());
    }

    #[test]
    fn load_persisted_state_returns_default_when_missing() {
        let path = temp_state_path("missing");
        let state = load_persisted_state(&path).unwrap();
        assert_eq!(state.base_url, FIXED_BASE_URL);
        assert!(state.projects.is_empty());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn load_persisted_state_forces_fixed_base_url_and_clears_old_backend_state() {
        let path = temp_state_path("fixed-backend");
        fs::write(
            &path,
            r#"{"base_url":"https://bearfrp.example.test/","user_session":"session-1","uid_cookie":"uid-1","enabled_proxy_ids":[1],"last_configs":{"1":"config"},"connections":{"connection-1":{"connection_id":"connection-1","project_id":"project-1","proxy_id":1,"local_host":"127.0.0.1","local_port":9010,"traffic_mb":100,"created_at":1}},"llm_settings":{"provider":"deepseek","model":"deepseek-chat","api_key":"sk-test","base_url":null}}"#,
        )
        .unwrap();
        let state = load_persisted_state(&path).unwrap();
        assert_eq!(state.base_url, FIXED_BASE_URL);
        assert!(state.user_session.is_none());
        assert!(state.uid_cookie.is_none());
        assert!(state.enabled_proxy_ids.is_empty());
        assert!(state.last_configs.is_empty());
        assert!(state.connections.is_empty());
        assert_eq!(state.llm_settings.provider, "deepseek");
        assert!(state.llm_settings.has_api_key());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn load_persisted_state_rejects_corrupt_json() {
        let path = temp_state_path("corrupt-json");
        fs::write(&path, "{not-json").unwrap();
        let err = load_persisted_state(&path).unwrap_err();
        assert!(err.contains("本地状态文件格式错误"));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
