use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{clip_server, commands};

pub(crate) trait ApiState: Send + Sync {
    fn app_data_dir(&self) -> Option<PathBuf>;
    fn bind_addr(&self) -> String;
    fn api_token_override(&self) -> Option<String>;
    fn current_project_path(&self) -> String;
    fn all_projects(&self) -> Vec<(String, String)>;
    fn rescan_project_files(
        &self,
        project_id: String,
        project_path: String,
        source_watch_config: Option<commands::file_sync::SourceWatchConfig>,
    ) -> Result<commands::file_sync::FileChangeRescanResult, String>;
}

pub(crate) struct TauriApiState {
    app: AppHandle,
}

impl TauriApiState {
    pub(crate) fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl ApiState for TauriApiState {
    fn app_data_dir(&self) -> Option<PathBuf> {
        self.app.path().app_data_dir().ok()
    }

    fn bind_addr(&self) -> String {
        "127.0.0.1:19828".to_string()
    }

    fn api_token_override(&self) -> Option<String> {
        std::env::var("LLM_WIKI_API_TOKEN")
            .ok()
            .map(|token| token.trim().to_string())
            .filter(|token| !token.is_empty())
    }

    fn current_project_path(&self) -> String {
        clip_server::current_project_path()
    }

    fn all_projects(&self) -> Vec<(String, String)> {
        clip_server::all_projects()
    }

    fn rescan_project_files(
        &self,
        project_id: String,
        project_path: String,
        source_watch_config: Option<commands::file_sync::SourceWatchConfig>,
    ) -> Result<commands::file_sync::FileChangeRescanResult, String> {
        commands::file_sync::rescan_project_files(
            self.app.clone(),
            project_id,
            project_path,
            source_watch_config,
        )
    }
}

#[derive(Debug, Clone)]
pub struct HeadlessConfig {
    pub data_dir: PathBuf,
    pub bind: String,
    pub port: u16,
    pub token: Option<String>,
}

impl HeadlessConfig {
    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.bind, self.port)
    }
}

pub(crate) struct HeadlessApiState {
    data_dir: PathBuf,
    bind_addr: String,
    token: Option<String>,
}

impl HeadlessApiState {
    pub(crate) fn new(config: HeadlessConfig) -> Self {
        Self {
            data_dir: config.data_dir,
            bind_addr: config.bind_addr(),
            token: config.token,
        }
    }

    fn ensure_data_dir(&self) -> Option<PathBuf> {
        if let Err(err) = std::fs::create_dir_all(&self.data_dir) {
            eprintln!(
                "[API Server] failed to create data dir '{}': {err}",
                self.data_dir.display()
            );
            return None;
        }
        Some(self.data_dir.clone())
    }

    fn load_app_state(&self) -> Option<Value> {
        let data_dir = self.ensure_data_dir()?;
        let raw = std::fs::read_to_string(data_dir.join("app-state.json")).ok()?;
        serde_json::from_str::<Value>(&raw).ok()
    }

    fn discover_projects(&self) -> Vec<(String, String)> {
        let data_dir = match self.ensure_data_dir() {
            Some(dir) => dir,
            None => return Vec::new(),
        };

        if let Some(state) = self.load_app_state() {
            let mut projects = Vec::new();
            if let Some(registry) = state.get("projectRegistry").and_then(Value::as_object) {
                for (id, value) in registry {
                    if let Some(path) = value.get("path").and_then(Value::as_str) {
                        let name = value
                            .get("name")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned)
                            .unwrap_or_else(|| project_name_from_path(path));
                        projects.push((name, path.to_string()));
                    }
                }
            }
            if let Some(recents) = state.get("recentProjects").and_then(Value::as_array) {
                for value in recents {
                    if let Some(path) = value.get("path").and_then(Value::as_str) {
                        let name = value
                            .get("name")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned)
                            .unwrap_or_else(|| project_name_from_path(path));
                        projects.push((name, path.to_string()));
                    }
                }
            }
            if !projects.is_empty() {
                return projects;
            }
        }

        discover_projects_in_dir(&data_dir)
    }
}

fn project_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Project")
        .to_string()
}

fn discover_projects_in_dir(dir: &Path) -> Vec<(String, String)> {
    let mut projects = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            eprintln!("[API Server] failed to read data dir '{}': {err}", dir.display());
            return projects;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                eprintln!("[API Server] failed to read dir entry: {err}");
                continue;
            }
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let marker = path.join(".llm-wiki").join("project.json");
        if !marker.exists() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Project")
            .to_string();
        projects.push((name, path.to_string_lossy().into_owned()));
    }
    projects
}

impl ApiState for HeadlessApiState {
    fn app_data_dir(&self) -> Option<PathBuf> {
        self.ensure_data_dir()
    }

    fn bind_addr(&self) -> String {
        self.bind_addr.clone()
    }

    fn api_token_override(&self) -> Option<String> {
        self.token.clone()
    }

    fn current_project_path(&self) -> String {
        if let Some(state) = self.load_app_state() {
            if let Some(current) = state.get("currentProject").and_then(Value::as_object) {
                if let Some(path) = current.get("path").and_then(Value::as_str) {
                    return path.to_string();
                }
            }
            if let Some(recents) = state.get("recentProjects").and_then(Value::as_array) {
                if let Some(first) = recents.first() {
                    if let Some(path) = first.get("path").and_then(Value::as_str) {
                        return path.to_string();
                    }
                }
            }
        }
        self.discover_projects()
            .first()
            .map(|(_, path)| path.clone())
            .unwrap_or_default()
    }

    fn all_projects(&self) -> Vec<(String, String)> {
        self.discover_projects()
    }

    fn rescan_project_files(
        &self,
        project_id: String,
        project_path: String,
        source_watch_config: Option<commands::file_sync::SourceWatchConfig>,
    ) -> Result<commands::file_sync::FileChangeRescanResult, String> {
        commands::file_sync::rescan_project_files_headless(
            project_id,
            project_path,
            source_watch_config,
        )
    }
}
