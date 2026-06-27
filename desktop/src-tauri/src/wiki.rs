use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use url::Url;

use crate::{
    sidecar, source_text, unix_millis, unix_timestamp, write_project_manifest, DesktopRuntime,
    SharedRuntime,
};

const MAX_SOURCE_BYTES: u64 = 100 * 1024 * 1024;
const INGEST_QUEUE_FILE: &str = ".llm-wiki/ingest-queue.json";
const DEEPSEEK_PRESET_ID: &str = "deepseek";
const DEFAULT_DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL: &str = "deepseek-v4-flash";
const DEFAULT_DEEPSEEK_CONTEXT_SIZE: u64 = 64_000;
const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";

const INCLUDE_EXTENSIONS: &[&str] = &[
    "md", "mdx", "txt", "pdf", "doc", "docx", "pptx", "xls", "xlsx", "odt", "odp", "ods", "rtf",
    "html", "htm", "csv",
];
const EXCLUDE_EXTENSIONS: &[&str] = &[
    "tmp",
    "temp",
    "bak",
    "swp",
    "part",
    "partial",
    "crdownload",
    "exe",
    "dll",
    "so",
    "dylib",
    "bin",
    "iso",
    "dmg",
];
const EXCLUDE_DIRS: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    ".obsidian",
    ".idea",
    ".vscode",
    "node_modules",
    ".cache",
    "__pycache__",
];
const EXCLUDE_GLOBS: &[&str] = &["~$*", ".~lock.*#", "*.draft.*", "draft-*", "*.private.*"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiProjectDto {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiProjectStateDto {
    pub project: WikiProjectDto,
    pub queue: WikiQueueSummaryDto,
    pub failed_tasks: Vec<WikiFailedTaskDto>,
    pub source_count: usize,
    pub wiki_count: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiQueueSummaryDto {
    pub pending: usize,
    pub processing: usize,
    pub failed: usize,
    pub completed: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiImportResultDto {
    pub project: WikiProjectDto,
    pub queue: WikiQueueSummaryDto,
    pub imported_paths: Vec<String>,
    pub skipped_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiFailedTaskDto {
    pub source_path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiBuildResultDto {
    pub project: WikiProjectDto,
    pub queue: WikiQueueSummaryDto,
    pub failed_tasks: Vec<WikiFailedTaskDto>,
    pub enqueued_count: usize,
    pub processed_count: usize,
    pub failed_count: usize,
    pub written_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiLlmConfigDto {
    pub provider: String,
    pub api_key: String,
    pub model: String,
    pub base_url: String,
    pub max_context_size: u64,
    pub configured: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmWikiLlmConfigInput {
    pub provider: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub max_context_size: Option<u64>,
    #[serde(default)]
    pub clear_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiGraphResultDto {
    pub project_id: String,
    pub nodes: Vec<WikiGraphNodeDto>,
    pub edges: Vec<WikiGraphEdgeDto>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiGraphNodeDto {
    pub id: String,
    pub label: String,
    pub node_type: String,
    pub path: String,
    pub link_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiGraphEdgeDto {
    pub source: String,
    pub target: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiImportInput {
    pub project_id: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IngestTask {
    id: String,
    project_id: String,
    source_path: String,
    folder_context: String,
    status: String,
    added_at: u128,
    error: Option<String>,
    retry_count: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerGraphResponse {
    project_id: String,
    nodes: Vec<WikiGraphNodeDto>,
    edges: Vec<WikiGraphEdgeDto>,
}

#[tauri::command]
pub fn get_llm_wiki_llm_config(
    runtime: State<'_, SharedRuntime>,
) -> Result<LlmWikiLlmConfigDto, String> {
    let runtime = runtime.lock().map_err(crate::lock_error)?;
    read_deepseek_llm_config(&runtime.paths.app_data_dir)
}

#[tauri::command]
pub fn set_llm_wiki_llm_config(
    runtime: State<'_, SharedRuntime>,
    input: LlmWikiLlmConfigInput,
) -> Result<LlmWikiLlmConfigDto, String> {
    let runtime = runtime.lock().map_err(crate::lock_error)?;
    write_deepseek_llm_config(&runtime.paths.app_data_dir, input)
}

#[tauri::command]
pub fn clear_llm_wiki_llm_config_key(
    runtime: State<'_, SharedRuntime>,
) -> Result<LlmWikiLlmConfigDto, String> {
    let runtime = runtime.lock().map_err(crate::lock_error)?;
    write_deepseek_llm_config(
        &runtime.paths.app_data_dir,
        LlmWikiLlmConfigInput {
            provider: Some(DEEPSEEK_PRESET_ID.to_string()),
            api_key: None,
            model: None,
            base_url: None,
            max_context_size: None,
            clear_api_key: true,
        },
    )
}

#[tauri::command]
pub fn get_wiki_project(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
) -> Result<WikiProjectStateDto, String> {
    let mut runtime = runtime.lock().map_err(crate::lock_error)?;
    let project = ensure_wiki_project(&mut runtime, &project_id)?;
    let root = PathBuf::from(&project.path);
    Ok(WikiProjectStateDto {
        queue: read_queue_summary(&root)?,
        failed_tasks: read_failed_tasks(&root, 8)?,
        source_count: count_ingestable_sources(&root)?,
        wiki_count: count_markdown_files(&root.join("wiki"))?,
        project,
    })
}

#[tauri::command]
pub fn import_wiki_sources(
    runtime: State<'_, SharedRuntime>,
    input: WikiImportInput,
) -> Result<WikiImportResultDto, String> {
    if input.paths.is_empty() {
        return Err("请选择要导入的 source 文件或文件夹".to_string());
    }

    let mut runtime = runtime.lock().map_err(crate::lock_error)?;
    let project = ensure_wiki_project(&mut runtime, &input.project_id)?;
    let root = PathBuf::from(&project.path);
    let sources_root = root.join("raw").join("sources");
    fs::create_dir_all(&sources_root).map_err(|error| format!("无法创建 raw/sources: {error}"))?;

    let mut imported = Vec::new();
    let mut skipped = Vec::new();

    for selected in input.paths {
        let source = PathBuf::from(&selected);
        if source.is_file() {
            match import_source_file(&root, &source, &sources_root) {
                Ok(Some(rel)) => imported.push(rel),
                Ok(None) => skipped.push(selected),
                Err(error) => return Err(error),
            }
        } else if source.is_dir() {
            reject_project_scoped_import(&root, &source)?;
            let folder_name = source
                .file_name()
                .and_then(|value| value.to_str())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("imported")
                .to_string();
            let dest_root = sources_root.join(&folder_name);
            for file in list_files_recursive(&source)? {
                let rel_inside_folder = relative_path(&source, &file)?;
                let import_rel = Path::new("raw")
                    .join("sources")
                    .join(&folder_name)
                    .join(&rel_inside_folder);
                if !is_allowed_source_rel(&import_rel, file.metadata().ok().map(|m| m.len())) {
                    skipped.push(file.to_string_lossy().to_string());
                    continue;
                }
                let target = unique_target_path(
                    &dest_root.join(rel_inside_folder.parent().unwrap_or_else(|| Path::new(""))),
                    rel_inside_folder
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("source"),
                );
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| format!("无法创建导入目录: {error}"))?;
                }
                fs::copy(&file, &target).map_err(|error| format!("无法复制 source: {error}"))?;
                imported.push(
                    relative_path(&root, &target)?
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        } else {
            skipped.push(selected);
        }
    }

    let queue_count = enqueue_ingest_tasks(&root, &project.id, &imported)?;
    let queue = read_queue_summary(&root)?;
    if queue_count > 0 {
        runtime.save()?;
    }
    Ok(WikiImportResultDto {
        project,
        queue,
        imported_paths: imported,
        skipped_paths: skipped,
    })
}

#[tauri::command]
pub async fn build_wiki_project(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
) -> Result<WikiBuildResultDto, String> {
    let (project, config, enqueued_count) = {
        let mut runtime = runtime.lock().map_err(crate::lock_error)?;
        let project = ensure_wiki_project(&mut runtime, &project_id)?;
        let config = read_deepseek_llm_config(&runtime.paths.app_data_dir)?;
        let root = PathBuf::from(&project.path);
        let sources = collect_ingestable_source_paths(&root)?;
        let enqueued_count = enqueue_ingest_tasks(&root, &project.id, &sources)?;
        if enqueued_count > 0 {
            runtime.save()?;
        }
        (project, config, enqueued_count)
    };
    if !config.configured {
        return Err("请先配置 DeepSeek API Key，再构建知识库。".to_string());
    }
    let root = PathBuf::from(&project.path);
    let build = process_ingest_queue_with_deepseek(&root, &project.id, &config).await?;
    let queue = read_queue_summary(&root)?;
    Ok(WikiBuildResultDto {
        project,
        queue,
        failed_tasks: read_failed_tasks(&root, 8)?,
        enqueued_count,
        processed_count: build.processed_count,
        failed_count: build.failed_count,
        written_paths: build.written_paths,
    })
}

#[tauri::command]
pub async fn refresh_wiki_graph(
    app: AppHandle,
    runtime: State<'_, SharedRuntime>,
    project_id: String,
) -> Result<WikiGraphResultDto, String> {
    let project = {
        let mut runtime = runtime.lock().map_err(crate::lock_error)?;
        ensure_wiki_project(&mut runtime, &project_id)?
    };

    let server_url = {
        let mut runtime = runtime.lock().map_err(crate::lock_error)?;
        sidecar::ensure_llm_wiki_server_running(&app, &mut runtime).ok()
    };

    if let Some(base_url) = server_url {
        let url = format!(
            "{}/projects/{}/graph",
            base_url.trim_end_matches('/'),
            project.id
        );
        if let Ok(response) = Client::new().get(url).send().await {
            if response.status().is_success() {
                if let Ok(body) = response.json::<ServerGraphResponse>().await {
                    return Ok(WikiGraphResultDto {
                        project_id: body.project_id,
                        nodes: body.nodes,
                        edges: body.edges,
                        source: "llm-wiki-server".to_string(),
                    });
                }
            }
        }
    }

    let (nodes, edges) = build_graph_from_wiki(&PathBuf::from(&project.path))?;
    Ok(WikiGraphResultDto {
        project_id: project.id,
        nodes,
        edges,
        source: "local-wikilinks".to_string(),
    })
}

pub(crate) fn ensure_wiki_layout(root: &Path) -> Result<(), String> {
    for dir in [
        "raw/sources",
        "raw/assets",
        "wiki/entities",
        "wiki/concepts",
        "wiki/sources",
        "wiki/queries",
        "wiki/comparisons",
        "wiki/synthesis",
        ".llm-wiki",
    ] {
        fs::create_dir_all(root.join(dir))
            .map_err(|error| format!("无法创建 LLM Wiki 项目目录 {dir}: {error}"))?;
    }
    write_if_missing(
        &root.join("purpose.md"),
        "# Project Purpose\n\n## Goal\n\n## Key Questions\n\n## Scope\n",
    )?;
    write_if_missing(
        &root.join("schema.md"),
        "# Wiki Schema\n\nUse `[[wikilinks]]` between generated wiki pages.\n",
    )?;
    write_if_missing(
        &root.join("wiki").join("index.md"),
        "# Wiki Index\n\n## Entities\n\n## Concepts\n\n## Sources\n",
    )?;
    write_if_missing(
        &root.join("wiki").join("log.md"),
        &format!(
            "# Research Log\n\n## {}\n\n- Project initialized\n",
            unix_timestamp()
        ),
    )?;
    write_if_missing(
        &root.join("wiki").join("overview.md"),
        "---\ntype: overview\ntitle: Project Overview\ntags: []\nrelated: []\n---\n\n# Overview\n",
    )?;
    Ok(())
}

pub(crate) fn ensure_wiki_project(
    runtime: &mut DesktopRuntime,
    project_id: &str,
) -> Result<WikiProjectDto, String> {
    let app_data_dir = runtime.paths.app_data_dir.clone();
    let (dto, updated_project) = {
        let project = runtime
            .persisted
            .projects
            .get_mut(project_id)
            .ok_or_else(|| "项目不存在".to_string())?;
        let root = PathBuf::from(&project.folder_path);
        fs::create_dir_all(&root).map_err(|error| format!("无法创建项目文件夹: {error}"))?;
        ensure_wiki_layout(&root)?;
        let wiki_id = ensure_project_identity(&root, &project.project_id)?;
        let raw_sources = root.join("raw").join("sources");
        project.raw_dir = raw_sources.to_string_lossy().to_string();
        let dto = WikiProjectDto {
            id: wiki_id,
            name: project.name.clone(),
            path: normalized_path(&root),
        };
        (dto, project.clone())
    };
    write_project_manifest(&updated_project)?;
    register_llm_wiki_project(&app_data_dir, &dto)?;
    runtime.save()?;
    Ok(dto)
}

fn ensure_project_identity(root: &Path, fallback_id: &str) -> Result<String, String> {
    let identity_path = root.join(".llm-wiki").join("project.json");
    if let Ok(raw) = fs::read_to_string(&identity_path) {
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            if let Some(id) = value.get("id").and_then(Value::as_str) {
                if !id.trim().is_empty() {
                    return Ok(id.to_string());
                }
            }
        }
    }
    let id = fallback_id.to_string();
    let body = json!({ "id": id, "createdAt": unix_millis() });
    fs::write(
        &identity_path,
        serde_json::to_string_pretty(&body).unwrap_or_else(|_| body.to_string()),
    )
    .map_err(|error| format!("无法写入 .llm-wiki/project.json: {error}"))?;
    Ok(id)
}

fn read_deepseek_llm_config(app_data_dir: &Path) -> Result<LlmWikiLlmConfigDto, String> {
    let state = read_llm_wiki_app_state(app_data_dir)?;
    let active_deepseek =
        state.get("activePresetId").and_then(Value::as_str) == Some(DEEPSEEK_PRESET_ID);
    let provider_config = state
        .get("providerConfigs")
        .and_then(Value::as_object)
        .and_then(|configs| configs.get(DEEPSEEK_PRESET_ID))
        .and_then(Value::as_object);
    let llm_config = state
        .get("llmConfig")
        .and_then(Value::as_object)
        .filter(|config| {
            active_deepseek && config.get("provider").and_then(Value::as_str) == Some("custom")
        });

    let api_key = provider_config
        .and_then(|config| config.get("apiKey"))
        .and_then(Value::as_str)
        .or_else(|| {
            llm_config
                .and_then(|config| config.get("apiKey"))
                .and_then(Value::as_str)
        })
        .unwrap_or("")
        .to_string();
    let model = provider_config
        .and_then(|config| config.get("model"))
        .and_then(Value::as_str)
        .or_else(|| {
            llm_config
                .and_then(|config| config.get("model"))
                .and_then(Value::as_str)
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_DEEPSEEK_MODEL)
        .to_string();
    let base_url = provider_config
        .and_then(|config| config.get("baseUrl"))
        .and_then(Value::as_str)
        .or_else(|| {
            llm_config
                .and_then(|config| config.get("customEndpoint"))
                .and_then(Value::as_str)
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_DEEPSEEK_BASE_URL)
        .to_string();
    let max_context_size = provider_config
        .and_then(|config| config.get("maxContextSize"))
        .and_then(Value::as_u64)
        .or_else(|| {
            llm_config
                .and_then(|config| config.get("maxContextSize"))
                .and_then(Value::as_u64)
        })
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_DEEPSEEK_CONTEXT_SIZE);

    Ok(LlmWikiLlmConfigDto {
        provider: DEEPSEEK_PRESET_ID.to_string(),
        configured: api_key.trim().len() > 0 && active_deepseek,
        api_key,
        model,
        base_url,
        max_context_size,
    })
}

fn write_deepseek_llm_config(
    app_data_dir: &Path,
    input: LlmWikiLlmConfigInput,
) -> Result<LlmWikiLlmConfigDto, String> {
    if let Some(provider) = input.provider.as_deref() {
        let provider = provider.trim();
        if !provider.is_empty() && provider != DEEPSEEK_PRESET_ID {
            return Err("当前只支持 DeepSeek 配置".to_string());
        }
    }

    let previous = read_deepseek_llm_config(app_data_dir)?;
    let api_key = if input.clear_api_key {
        String::new()
    } else {
        input
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|key| !key.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| previous.api_key.clone())
    };

    let model = input
        .model
        .as_deref()
        .unwrap_or(previous.model.as_str())
        .trim();
    let model = if model.is_empty() {
        DEFAULT_DEEPSEEK_MODEL.to_string()
    } else {
        model.to_string()
    };
    let base_url = input
        .base_url
        .as_deref()
        .unwrap_or(previous.base_url.as_str())
        .trim()
        .trim_end_matches('/')
        .to_string();
    let base_url = if base_url.is_empty() {
        DEFAULT_DEEPSEEK_BASE_URL.to_string()
    } else {
        validate_http_url(&base_url)?;
        base_url
    };
    let max_context_size = input
        .max_context_size
        .filter(|value| *value > 0)
        .unwrap_or(previous.max_context_size);

    let mut state = read_llm_wiki_app_state(app_data_dir)?;
    let object = llm_wiki_app_state_object_mut(&mut state)?;

    {
        let provider_configs = object
            .entry("providerConfigs".to_string())
            .or_insert_with(|| json!({}));
        if !provider_configs.is_object() {
            *provider_configs = json!({});
        }
        let provider_configs = provider_configs
            .as_object_mut()
            .ok_or_else(|| "LLM Wiki providerConfigs 格式错误".to_string())?;
        provider_configs.insert(
            DEEPSEEK_PRESET_ID.to_string(),
            json!({
                "apiKey": api_key,
                "model": model,
                "baseUrl": base_url,
                "apiMode": "chat_completions",
                "maxContextSize": max_context_size,
            }),
        );
    }

    let previous_llm_config = object.get("llmConfig").and_then(Value::as_object);
    let reasoning = previous_llm_config
        .and_then(|config| config.get("reasoning"))
        .cloned()
        .unwrap_or_else(|| json!({ "mode": "auto" }));
    let ollama_url = previous_llm_config
        .and_then(|config| config.get("ollamaUrl"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(DEFAULT_OLLAMA_URL);

    object.insert(
        "llmConfig".to_string(),
        json!({
            "provider": "custom",
            "apiKey": api_key,
            "model": model,
            "ollamaUrl": ollama_url,
            "customEndpoint": base_url,
            "apiMode": "chat_completions",
            "maxContextSize": max_context_size,
            "reasoning": reasoning,
            "localCliIsolation": false,
        }),
    );
    object.insert(
        "activePresetId".to_string(),
        Value::String(DEEPSEEK_PRESET_ID.to_string()),
    );

    write_llm_wiki_app_state(app_data_dir, &state)?;
    read_deepseek_llm_config(app_data_dir)
}

pub(crate) fn configure_llm_wiki_api_access(
    app_data_dir: &Path,
    token: Option<&str>,
) -> Result<(), String> {
    let token = token
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .unwrap_or("");
    let mut state = read_llm_wiki_app_state(app_data_dir)?;
    let object = llm_wiki_app_state_object_mut(&mut state)?;
    let api_config = object
        .entry("apiConfig".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "LLM Wiki apiConfig 格式错误".to_string())?;
    api_config.insert("enabled".to_string(), Value::Bool(true));
    api_config.insert("mcpEnabled".to_string(), Value::Bool(true));
    api_config.insert(
        "allowUnauthenticated".to_string(),
        Value::Bool(token.is_empty()),
    );
    api_config.insert("token".to_string(), Value::String(token.to_string()));
    write_llm_wiki_app_state(app_data_dir, &state)
}

fn register_llm_wiki_project(app_data_dir: &Path, project: &WikiProjectDto) -> Result<(), String> {
    let mut state = read_llm_wiki_app_state(app_data_dir)?;
    let object = llm_wiki_app_state_object_mut(&mut state)?;

    let api_config = object
        .entry("apiConfig".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "LLM Wiki apiConfig 格式错误".to_string())?;
    api_config
        .entry("enabled".to_string())
        .or_insert(Value::Bool(true));
    api_config
        .entry("allowUnauthenticated".to_string())
        .or_insert(Value::Bool(true));

    let registry = object
        .entry("projectRegistry".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "LLM Wiki projectRegistry 格式错误".to_string())?;
    registry.insert(
        project.id.clone(),
        json!({
            "id": project.id,
            "name": project.name,
            "path": project.path,
            "lastOpened": unix_millis(),
        }),
    );
    object.insert(
        "currentProject".to_string(),
        json!({ "id": project.id, "name": project.name, "path": project.path }),
    );
    let recent = object
        .entry("recentProjects".to_string())
        .or_insert_with(|| json!([]));
    let mut recent_projects = recent.as_array().cloned().unwrap_or_default();
    recent_projects
        .retain(|item| item.get("id").and_then(Value::as_str) != Some(project.id.as_str()));
    recent_projects.insert(
        0,
        json!({ "id": project.id, "name": project.name, "path": project.path }),
    );
    recent_projects.truncate(10);
    object.insert("recentProjects".to_string(), Value::Array(recent_projects));

    write_llm_wiki_app_state(app_data_dir, &state)
}

fn llm_wiki_app_state_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("llm-wiki").join("app-state.json")
}

fn read_llm_wiki_app_state(app_data_dir: &Path) -> Result<Value, String> {
    let state_path = llm_wiki_app_state_path(app_data_dir);
    if !state_path.exists() {
        return Ok(json!({}));
    }
    let raw = fs::read_to_string(&state_path)
        .map_err(|error| format!("无法读取 LLM Wiki app-state: {error}"))?;
    let parsed = serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("LLM Wiki app-state 格式错误: {error}"))?;
    if parsed.is_object() {
        Ok(parsed)
    } else {
        Ok(json!({}))
    }
}

fn write_llm_wiki_app_state(app_data_dir: &Path, state: &Value) -> Result<(), String> {
    let state_path = llm_wiki_app_state_path(app_data_dir);
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建 LLM Wiki 数据目录: {error}"))?;
    }
    let text = serde_json::to_string_pretty(state)
        .map_err(|error| format!("无法序列化 LLM Wiki app-state: {error}"))?;
    fs::write(&state_path, text)
        .map_err(|error| format!("无法写入 LLM Wiki app-state: {error}"))?;
    restrict_file_permissions(&state_path);
    Ok(())
}

fn llm_wiki_app_state_object_mut(
    state: &mut Value,
) -> Result<&mut serde_json::Map<String, Value>, String> {
    if !state.is_object() {
        *state = json!({});
    }
    state
        .as_object_mut()
        .ok_or_else(|| "LLM Wiki app-state 格式错误".to_string())
}

fn validate_http_url(value: &str) -> Result<(), String> {
    let parsed =
        Url::parse(value).map_err(|_| "DeepSeek Base URL 必须是完整的 http(s) URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("DeepSeek Base URL 只支持 http 或 https".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("DeepSeek Base URL 必须包含主机名".to_string());
    }
    Ok(())
}

fn restrict_file_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

fn import_source_file(
    root: &Path,
    source: &Path,
    sources_root: &Path,
) -> Result<Option<String>, String> {
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "source 文件名不合法".to_string())?;
    let import_rel = Path::new("raw").join("sources").join(file_name);
    if !is_allowed_source_rel(&import_rel, source.metadata().ok().map(|m| m.len())) {
        return Ok(None);
    }
    let target = unique_target_path(sources_root, file_name);
    fs::copy(source, &target).map_err(|error| format!("无法复制 source: {error}"))?;
    Ok(Some(
        relative_path(root, &target)?
            .to_string_lossy()
            .replace('\\', "/"),
    ))
}

fn reject_project_scoped_import(project_root: &Path, selected_folder: &Path) -> Result<(), String> {
    let project = project_root
        .canonicalize()
        .map_err(|error| format!("无法解析项目目录: {error}"))?;
    let selected = selected_folder
        .canonicalize()
        .map_err(|error| format!("无法解析导入目录: {error}"))?;
    if selected == project || selected.starts_with(&project) || project.starts_with(&selected) {
        return Err("不能导入当前 LLM Wiki 项目目录、其父目录或其子目录".to_string());
    }
    Ok(())
}

fn collect_ingestable_source_paths(root: &Path) -> Result<Vec<String>, String> {
    let sources_root = root.join("raw").join("sources");
    if !sources_root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for file in list_files_recursive(&sources_root)? {
        let rel = relative_path(root, &file)?;
        if is_allowed_source_rel(&rel, file.metadata().ok().map(|m| m.len())) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(out)
}

fn count_ingestable_sources(root: &Path) -> Result<usize, String> {
    Ok(collect_ingestable_source_paths(root)?.len())
}

fn count_markdown_files(root: &Path) -> Result<usize, String> {
    if !root.exists() {
        return Ok(0);
    }
    Ok(list_files_recursive(root)?
        .into_iter()
        .filter(|path| {
            path.extension()
                .and_then(|value| value.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown"))
                .unwrap_or(false)
        })
        .count())
}

fn enqueue_ingest_tasks(
    root: &Path,
    project_id: &str,
    source_paths: &[String],
) -> Result<usize, String> {
    fs::create_dir_all(root.join(".llm-wiki"))
        .map_err(|error| format!("无法创建 ingest queue 目录: {error}"))?;
    let queue_path = root.join(INGEST_QUEUE_FILE);
    let mut tasks = read_ingest_queue(&queue_path)?;
    let mut added = 0;
    for source_path in source_paths {
        if !is_ingestable_source_path(source_path) {
            continue;
        }
        if let Some(task) = tasks.iter_mut().find(|task| {
            task.project_id == project_id
                && normalize_rel_string(&task.source_path) == normalize_rel_string(source_path)
        }) {
            match task.status.as_str() {
                "done" | "processing" => {}
                _ => {
                    task.status = "pending".to_string();
                    task.error = None;
                    task.retry_count = 0;
                }
            }
            continue;
        }
        tasks.push(IngestTask {
            id: format!("ingest-{}-{}", unix_millis(), stable_path_hash(source_path)),
            project_id: project_id.to_string(),
            source_path: source_path.to_string(),
            folder_context: folder_context_for_source_path(source_path),
            status: "pending".to_string(),
            added_at: unix_millis(),
            error: None,
            retry_count: 0,
        });
        added += 1;
    }
    write_ingest_queue(&queue_path, &tasks)?;
    Ok(added)
}

fn read_queue_summary(root: &Path) -> Result<WikiQueueSummaryDto, String> {
    let tasks = read_ingest_queue(&root.join(INGEST_QUEUE_FILE))?;
    let mut summary = WikiQueueSummaryDto::default();
    for task in tasks {
        match task.status.as_str() {
            "pending" => summary.pending += 1,
            "processing" => summary.processing += 1,
            "failed" => summary.failed += 1,
            "done" => summary.completed += 1,
            _ => {}
        }
    }
    summary.total = summary.pending + summary.processing + summary.failed + summary.completed;
    Ok(summary)
}

fn read_failed_tasks(root: &Path, limit: usize) -> Result<Vec<WikiFailedTaskDto>, String> {
    let mut tasks = read_ingest_queue(&root.join(INGEST_QUEUE_FILE))?;
    tasks.retain(|task| task.status == "failed");
    tasks.sort_by(|left, right| right.added_at.cmp(&left.added_at));
    Ok(tasks
        .into_iter()
        .take(limit)
        .map(|task| WikiFailedTaskDto {
            source_path: task.source_path,
            error: task.error.unwrap_or_else(|| "未知错误".to_string()),
        })
        .collect())
}

fn read_ingest_queue(path: &Path) -> Result<Vec<IngestTask>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw =
        fs::read_to_string(path).map_err(|error| format!("无法读取 ingest queue: {error}"))?;
    serde_json::from_str::<Vec<IngestTask>>(&raw)
        .map_err(|error| format!("ingest queue 格式错误: {error}"))
}

fn write_ingest_queue(path: &Path, tasks: &[IngestTask]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(tasks)
        .map_err(|error| format!("无法序列化 ingest queue: {error}"))?;
    fs::write(path, text).map_err(|error| format!("无法写入 ingest queue: {error}"))
}

#[derive(Debug, Default)]
struct WikiBuildProcessingSummary {
    processed_count: usize,
    failed_count: usize,
    written_paths: Vec<String>,
}

async fn process_ingest_queue_with_deepseek(
    root: &Path,
    project_id: &str,
    config: &LlmWikiLlmConfigDto,
) -> Result<WikiBuildProcessingSummary, String> {
    let queue_path = root.join(INGEST_QUEUE_FILE);
    let client = Client::builder()
        .timeout(Duration::from_secs(10 * 60))
        .build()
        .map_err(|error| format!("无法初始化 DeepSeek HTTP 客户端: {error}"))?;
    let mut summary = WikiBuildProcessingSummary::default();

    loop {
        let mut tasks = read_ingest_queue(&queue_path)?;
        for task in tasks
            .iter_mut()
            .filter(|task| task.project_id == project_id && task.status == "processing")
        {
            task.status = "pending".to_string();
            task.error = None;
        }
        let Some(index) = tasks
            .iter()
            .position(|task| task.project_id == project_id && task.status == "pending")
        else {
            write_ingest_queue(&queue_path, &tasks)?;
            break;
        };

        tasks[index].status = "processing".to_string();
        tasks[index].error = None;
        let task = tasks[index].clone();
        write_ingest_queue(&queue_path, &tasks)?;

        match deepseek_ingest_source(root, &task, config, &client).await {
            Ok(written_paths) if !written_paths.is_empty() => {
                summary.processed_count += 1;
                summary.written_paths.extend(written_paths);
                let mut tasks = read_ingest_queue(&queue_path)?;
                if let Some(task) = tasks.iter_mut().find(|candidate| candidate.id == task.id) {
                    task.status = "done".to_string();
                    task.error = None;
                    task.retry_count = 0;
                }
                write_ingest_queue(&queue_path, &tasks)?;
            }
            Ok(_) => {
                summary.failed_count += 1;
                mark_ingest_task_failed(
                    &queue_path,
                    &task.id,
                    "DeepSeek 构建未生成任何 wiki 文件".to_string(),
                )?;
            }
            Err(error) => {
                summary.failed_count += 1;
                mark_ingest_task_failed(&queue_path, &task.id, error)?;
            }
        }
    }

    summary.written_paths.sort();
    summary.written_paths.dedup();
    Ok(summary)
}

fn mark_ingest_task_failed(queue_path: &Path, task_id: &str, error: String) -> Result<(), String> {
    let mut tasks = read_ingest_queue(queue_path)?;
    if let Some(task) = tasks.iter_mut().find(|task| task.id == task_id) {
        task.status = "failed".to_string();
        task.retry_count = task.retry_count.saturating_add(1);
        task.error = Some(trim_error_message(&error));
    }
    write_ingest_queue(queue_path, &tasks)
}

fn trim_error_message(value: &str) -> String {
    const MAX_ERROR_CHARS: usize = 800;
    if value.chars().count() <= MAX_ERROR_CHARS {
        return value.to_string();
    }
    format!(
        "{}...",
        value.chars().take(MAX_ERROR_CHARS).collect::<String>()
    )
}

async fn deepseek_ingest_source(
    root: &Path,
    task: &IngestTask,
    config: &LlmWikiLlmConfigDto,
    client: &Client,
) -> Result<Vec<String>, String> {
    let source_rel = normalize_rel_string(&task.source_path);
    if !is_ingestable_source_path(&source_rel) {
        return Err(format!("source 路径不允许构建: {source_rel}"));
    }
    let source_path = root.join(&source_rel);
    let source_content = source_text::read_source_text_for_ingest(&source_path)
        .map_err(|error| format!("无法读取 source {source_rel}: {error}"))?;
    let source_context = truncate_chars(&source_content, source_context_budget(config));
    let source_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(source_rel.as_str());
    let source_summary_path = format!("wiki/sources/{}.md", source_summary_slug(&source_rel));
    let prompt = build_headless_generation_prompt(
        root,
        source_name,
        &source_summary_path,
        &task.folder_context,
        &source_context,
    );
    let generation = call_deepseek_chat(client, config, prompt).await?;
    let mut written_paths = write_headless_file_blocks(root, &generation)?;

    if written_paths.is_empty() {
        return Err("DeepSeek 输出中没有可写入的 FILE block".to_string());
    }

    if !written_paths
        .iter()
        .any(|path| path == &source_summary_path)
    {
        write_fallback_source_summary(
            root,
            &source_summary_path,
            source_name,
            &source_rel,
            &source_context,
        )?;
        written_paths.push(source_summary_path);
    }

    Ok(written_paths)
}

fn source_context_budget(config: &LlmWikiLlmConfigDto) -> usize {
    let budget = (config.max_context_size as usize).saturating_sub(12_000);
    budget.clamp(4_000, 48_000)
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let head = value.chars().take(max_chars).collect::<String>();
    format!("{head}\n\n[Source truncated for Desktop headless build.]")
}

fn build_headless_generation_prompt(
    root: &Path,
    source_name: &str,
    source_summary_path: &str,
    folder_context: &str,
    source_content: &str,
) -> String {
    let purpose = fs::read_to_string(root.join("purpose.md")).unwrap_or_default();
    let schema = fs::read_to_string(root.join("schema.md")).unwrap_or_default();
    let index = fs::read_to_string(root.join("wiki/index.md")).unwrap_or_default();
    let overview = fs::read_to_string(root.join("wiki/overview.md")).unwrap_or_default();
    let today = "YYYY-MM-DD";

    let folder_context = if folder_context.trim().is_empty() {
        "(none)"
    } else {
        folder_context
    };

    vec![
        "你是 LLM Wiki 的 headless ingest worker。".to_string(),
        "阅读 source，并生成简洁、事实准确的中文 Markdown Wiki 页面。".to_string(),
        "必须使用简体中文产出 title、标题、正文、摘要和概念/实体说明；原文专有名词、代码标识符、文件名、URL 可以保留原文。"
            .to_string(),
        "只输出 FILE blocks。不要在 FILE blocks 外包裹代码围栏，不要添加前言。"
            .to_string(),
        String::new(),
        "必需 FILE block 格式：".to_string(),
        "---FILE: wiki/path/file-name.md---".to_string(),
        "---".to_string(),
        "type: concept".to_string(),
        "title: 中文页面标题".to_string(),
        format!("created: {today}"),
        format!("updated: {today}"),
        "tags: [generated]".to_string(),
        "related: []".to_string(),
        format!("sources: [\"{source_name}\"]"),
        "---".to_string(),
        "# 中文页面标题".to_string(),
        "正文使用中文，并用 [[wikilinks]] 连接相关生成页面。".to_string(),
        "---END FILE---".to_string(),
        String::new(),
        "至少生成两个页面：".to_string(),
        format!("1. 一个 source summary，路径必须精确为 {source_summary_path}。"),
        "2. 一个或多个重要主题的实体/概念页面，放在 wiki/entities/ 或 wiki/concepts/ 下。"
            .to_string(),
        String::new(),
        "规则：".to_string(),
        "- 每个路径必须位于 wiki/ 下，文件名尽量使用 kebab-case。".to_string(),
        "- 正文必须用中文书写，并使用 [[wikilinks]] 连接相关页面。".to_string(),
        "- 保留 source 中的具体事实、关系、日期和命名实体。".to_string(),
        "- 页面保持简洁但不能为空；不要编造 source 中不存在的信息。".to_string(),
        "- 不要写入 wiki/ 之外的路径。".to_string(),
        String::new(),
        "项目目标：".to_string(),
        purpose,
        String::new(),
        "项目 schema：".to_string(),
        schema,
        String::new(),
        "现有索引：".to_string(),
        index,
        String::new(),
        "现有概览：".to_string(),
        overview,
        String::new(),
        "Source 元数据：".to_string(),
        format!("文件：{source_name}"),
        format!("文件夹上下文：{folder_context}"),
        String::new(),
        "Source 内容：".to_string(),
        source_content.to_string(),
    ]
    .join("\n")
}

async fn call_deepseek_chat(
    client: &Client,
    config: &LlmWikiLlmConfigDto,
    prompt: String,
) -> Result<String, String> {
    let url = chat_completions_url(&config.base_url);
    let mut body = json!({
        "model": config.model,
        "stream": false,
        "temperature": 0.1,
        "max_tokens": 8192,
        "messages": [
            {
                "role": "system",
                "content": "你根据 source material 生成 LLM Wiki FILE blocks。除文件路径、frontmatter key、原文专名、代码标识符和 URL 外，生成的 Wiki 内容必须使用简体中文。只输出请求的 blocks。"
            },
            { "role": "user", "content": prompt }
        ],
    });
    if supports_deepseek_thinking_param(&config.model) {
        body["thinking"] = json!({ "type": "disabled" });
    }

    let response = client
        .post(url)
        .bearer_auth(config.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("DeepSeek 请求失败: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("无法读取 DeepSeek 响应: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "DeepSeek 调用失败 HTTP {}: {}",
            status.as_u16(),
            trim_error_message(&text)
        ));
    }

    let value = serde_json::from_str::<Value>(&text)
        .map_err(|error| format!("DeepSeek 响应不是有效 JSON: {error}"))?;
    let content = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("DeepSeek 响应为空".to_string());
    }
    Ok(content)
}

fn chat_completions_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.to_lowercase().ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

fn supports_deepseek_thinking_param(model: &str) -> bool {
    let normalized = model.to_ascii_lowercase();
    normalized.contains("deepseek-v4") || normalized.contains("deepseek_v4")
}

#[derive(Debug)]
struct FileBlock {
    path: String,
    content: String,
}

fn write_headless_file_blocks(root: &Path, text: &str) -> Result<Vec<String>, String> {
    let blocks = parse_headless_file_blocks(text);
    let mut written = Vec::new();
    for block in blocks {
        let Some(safe_path) = safe_ingest_file_path(&block.path) else {
            continue;
        };
        let target = root.join(&safe_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建 wiki 目录: {error}"))?;
        }
        fs::write(&target, block.content.trim_start())
            .map_err(|error| format!("无法写入 wiki 文件 {}: {error}", safe_path.display()))?;
        written.push(safe_path.to_string_lossy().replace('\\', "/"));
    }
    Ok(written)
}

fn parse_headless_file_blocks(text: &str) -> Vec<FileBlock> {
    let normalized = text.replace("\r\n", "\n");
    let lines = normalized.lines().collect::<Vec<_>>();
    let mut blocks = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index].trim();
        let Some(path) = parse_file_opener(line) else {
            index += 1;
            continue;
        };
        index += 1;
        let mut content = Vec::new();
        let mut closed = false;
        while index < lines.len() {
            if is_file_closer(lines[index].trim()) {
                closed = true;
                index += 1;
                break;
            }
            content.push(lines[index]);
            index += 1;
        }
        if closed {
            blocks.push(FileBlock {
                path,
                content: content.join("\n"),
            });
        }
    }
    blocks
}

fn parse_file_opener(line: &str) -> Option<String> {
    if !line.starts_with("---") || !line.ends_with("---") {
        return None;
    }
    let inner = line.trim_matches('-').trim();
    let lower = inner.to_ascii_lowercase();
    let rest = lower.strip_prefix("file:")?;
    let offset = inner.len().saturating_sub(rest.len());
    let path = inner[offset..].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

fn is_file_closer(line: &str) -> bool {
    line.eq_ignore_ascii_case("---END FILE---")
        || line
            .chars()
            .filter(|ch| !ch.is_whitespace())
            .collect::<String>()
            .eq_ignore_ascii_case("---ENDFILE---")
}

fn safe_ingest_file_path(raw: &str) -> Option<PathBuf> {
    if raw.trim().is_empty() || raw.contains('\0') || raw.chars().any(|ch| ch.is_control()) {
        return None;
    }
    if raw.starts_with('/') || raw.starts_with('\\') {
        return None;
    }
    let normalized = raw.replace('\\', "/");
    if !normalized.starts_with("wiki/") {
        return None;
    }
    let mut out = PathBuf::new();
    for segment in normalized.split('/') {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.ends_with(' ')
            || segment.ends_with('.')
            || segment.contains(':')
            || segment.contains('<')
            || segment.contains('>')
            || segment.contains('"')
            || segment.contains('|')
            || segment.contains('?')
            || segment.contains('*')
        {
            return None;
        }
        let stem = segment.split('.').next().unwrap_or("").to_ascii_uppercase();
        if matches!(
            stem.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        ) {
            return None;
        }
        out.push(segment);
    }
    if out.extension().and_then(|value| value.to_str()) != Some("md") {
        return None;
    }
    Some(out)
}

fn source_summary_slug(source_rel: &str) -> String {
    let rel = normalize_rel_string(source_rel)
        .trim_start_matches("raw/sources/")
        .to_string();
    let without_ext = rel.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(&rel);
    slugify_for_wiki_path(without_ext)
}

fn slugify_for_wiki_path(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() {
            Some(ch.to_ascii_lowercase())
        } else if ch.is_alphanumeric() {
            Some(ch)
        } else {
            None
        };
        if let Some(ch) = next {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        format!("source-{}", unix_millis())
    } else {
        slug
    }
}

fn write_fallback_source_summary(
    root: &Path,
    path: &str,
    source_name: &str,
    source_rel: &str,
    source_content: &str,
) -> Result<(), String> {
    let safe_path =
        safe_ingest_file_path(path).ok_or_else(|| format!("source summary 路径不安全: {path}"))?;
    let target = root.join(&safe_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("无法创建 source summary 目录: {error}"))?;
    }
    let excerpt = truncate_chars(source_content, 2_400);
    let title = source_name.trim_end_matches(".md").trim_end_matches(".txt");
    let content = format!(
        "---\ntype: source\ntitle: \"来源：{source_name}\"\ntags: [source]\nrelated: []\nsources: [\"{source_name}\"]\n---\n\n# 来源：{title}\n\n导入自 `{source_rel}`。\n\n## 原文摘录\n\n{excerpt}\n"
    );
    fs::write(&target, content)
        .map_err(|error| format!("无法写入 source summary {}: {error}", safe_path.display()))
}

fn build_graph_from_wiki(
    root: &Path,
) -> Result<(Vec<WikiGraphNodeDto>, Vec<WikiGraphEdgeDto>), String> {
    let wiki_root = root.join("wiki");
    if !wiki_root.exists() {
        return Ok((Vec::new(), Vec::new()));
    }
    let mut raw = BTreeMap::<String, (String, String, String, Vec<String>)>::new();
    for path in list_files_recursive(&wiki_root)? {
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let id = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("page.md");
        raw.insert(
            id,
            (
                extract_title(&content, file_name),
                extract_type(&content),
                relative_path(root, &path)?
                    .to_string_lossy()
                    .replace('\\', "/"),
                extract_wikilinks(&content),
            ),
        );
    }

    let hidden_types = BTreeSet::from(["query".to_string()]);
    raw.retain(|_, (_, node_type, _, _)| !hidden_types.contains(node_type));
    let ids = raw.keys().cloned().collect::<BTreeSet<_>>();
    let mut link_count = raw
        .keys()
        .map(|id| (id.clone(), 0_usize))
        .collect::<BTreeMap<_, _>>();
    let mut seen = BTreeSet::new();
    let mut edges = Vec::new();

    for (source, (_, _, _, links)) in &raw {
        for link in links {
            let Some(target) = resolve_link(link, &ids) else {
                continue;
            };
            if &target == source {
                continue;
            }
            let key = if source < &target {
                format!("{source}::{target}")
            } else {
                format!("{target}::{source}")
            };
            if seen.insert(key) {
                *link_count.entry(source.clone()).or_default() += 1;
                *link_count.entry(target.clone()).or_default() += 1;
                edges.push(WikiGraphEdgeDto {
                    source: source.clone(),
                    target,
                    weight: 1.0,
                });
            }
        }
    }

    let nodes = raw
        .into_iter()
        .map(|(id, (label, node_type, path, _))| WikiGraphNodeDto {
            link_count: *link_count.get(&id).unwrap_or(&0),
            id,
            label,
            node_type,
            path,
        })
        .collect();
    Ok((nodes, edges))
}

fn extract_title(content: &str, file_name: &str) -> String {
    let mut in_frontmatter = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            in_frontmatter = !in_frontmatter;
            continue;
        }
        if in_frontmatter {
            if let Some(value) = trimmed.strip_prefix("title:") {
                return value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string();
            }
        }
        if let Some(value) = trimmed.strip_prefix("# ") {
            return value.trim().to_string();
        }
    }
    file_name.trim_end_matches(".md").replace('-', " ")
}

fn extract_type(content: &str) -> String {
    for line in content.lines() {
        if let Some(value) = line.trim().strip_prefix("type:") {
            return value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_lowercase();
        }
    }
    "other".to_string()
}

fn extract_wikilinks(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else {
            break;
        };
        let inner = &rest[..end];
        let target = inner.split('|').next().unwrap_or("").trim();
        if !target.is_empty() {
            out.push(target.to_string());
        }
        rest = &rest[end + 2..];
    }
    out
}

fn resolve_link(raw: &str, ids: &BTreeSet<String>) -> Option<String> {
    if ids.contains(raw) {
        return Some(raw.to_string());
    }
    let normalized = raw.to_lowercase().replace(' ', "-");
    ids.iter()
        .find(|id| id.to_lowercase() == normalized || id.to_lowercase() == raw.to_lowercase())
        .cloned()
}

fn is_allowed_source_rel(rel: &Path, size: Option<u64>) -> bool {
    let rel = rel.to_string_lossy().replace('\\', "/");
    if !rel.starts_with("raw/sources/") {
        return false;
    }
    if size.map(|size| size > MAX_SOURCE_BYTES).unwrap_or(true) {
        return false;
    }
    is_ingestable_source_path(&rel)
}

fn is_ingestable_source_path(path: &str) -> bool {
    let normalized = normalize_rel_string(path);
    if normalized.split('/').any(|part| part.starts_with('.')) {
        return false;
    }
    let lower = normalized.to_lowercase();
    if lower.contains("/.llm-wiki/") || lower.starts_with(".llm-wiki/") {
        return false;
    }
    let parts = lower.split('/').collect::<Vec<_>>();
    if parts.iter().any(|part| EXCLUDE_DIRS.contains(part)) {
        return false;
    }
    let name = parts.last().copied().unwrap_or("");
    if name.is_empty() || name == "thumbs.db" || name == "desktop.ini" {
        return false;
    }
    if EXCLUDE_GLOBS
        .iter()
        .any(|pattern| wildcard_match(pattern, name))
    {
        return false;
    }
    let ext = name.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
    if ext.is_empty() || EXCLUDE_EXTENSIONS.contains(&ext) {
        return false;
    }
    INCLUDE_EXTENSIONS.contains(&ext)
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let parts = pattern.split('*').collect::<Vec<_>>();
    if parts.len() == 1 {
        return pattern == value;
    }
    let mut rest = value;
    if let Some(first) = parts.first() {
        if !first.is_empty() {
            let Some(next) = rest.strip_prefix(first) else {
                return false;
            };
            rest = next;
        }
    }
    for part in parts.iter().skip(1).take(parts.len().saturating_sub(2)) {
        if part.is_empty() {
            continue;
        }
        let Some(index) = rest.find(part) else {
            return false;
        };
        rest = &rest[index + part.len()..];
    }
    if let Some(last) = parts.last() {
        last.is_empty() || rest.ends_with(last)
    } else {
        true
    }
}

fn folder_context_for_source_path(source_path: &str) -> String {
    let rel = normalize_rel_string(source_path)
        .trim_start_matches("raw/sources/")
        .to_string();
    let mut parts = rel.split('/').collect::<Vec<_>>();
    parts.pop();
    parts.join(" > ")
}

fn unique_target_path(dir: &Path, original_name: &str) -> PathBuf {
    let original = Path::new(original_name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("source");
    let ext = original.extension().and_then(|value| value.to_str());
    for index in 0..10_000 {
        let candidate_name = if index == 0 {
            original_name.to_string()
        } else if let Some(ext) = ext {
            format!("{stem}-{index}.{ext}")
        } else {
            format!("{stem}-{index}")
        };
        let candidate = dir.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-{}", unix_millis()))
}

fn list_files_recursive(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    if !root.exists() {
        return Ok(out);
    }
    let entries = fs::read_dir(root).map_err(|error| format!("无法读取目录: {error}"))?;
    for entry in entries {
        let path = entry
            .map_err(|error| format!("无法读取目录项: {error}"))?
            .path();
        let metadata =
            fs::symlink_metadata(&path).map_err(|error| format!("无法读取文件元数据: {error}"))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            out.extend(list_files_recursive(&path)?);
        } else if metadata.is_file() {
            out.push(path);
        }
    }
    Ok(out)
}

fn relative_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "路径不属于当前项目".to_string())?;
    let mut out = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => out.push(value),
            _ => return Err("路径包含非法片段".to_string()),
        }
    }
    Ok(out)
}

fn normalized_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_rel_string(value: &str) -> String {
    value.replace('\\', "/").trim_matches('/').to_string()
}

fn stable_path_hash(value: &str) -> u64 {
    let mut hash = 1469598103934665603_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

fn write_if_missing(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建目录: {error}"))?;
    }
    fs::write(path, content).map_err(|error| format!("无法写入文件: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("wikibridge-{name}-{}", unix_millis()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn imports_file_to_raw_sources_and_enqueues_it() {
        let project = temp_root("import-project");
        let outside = temp_root("import-outside");
        ensure_wiki_layout(&project).unwrap();

        let source = outside.join("note.md");
        fs::write(&source, "# Note\n").unwrap();

        let imported = import_source_file(&project, &source, &project.join("raw/sources"))
            .unwrap()
            .expect("markdown source should be imported");
        assert_eq!(imported, "raw/sources/note.md");
        assert_eq!(
            fs::read_to_string(project.join("raw/sources/note.md")).unwrap(),
            "# Note\n"
        );

        let added = enqueue_ingest_tasks(&project, "project-1", &[imported]).unwrap();
        assert_eq!(added, 1);
        let summary = read_queue_summary(&project).unwrap();
        assert_eq!(summary.pending, 1);
        assert_eq!(summary.total, 1);

        let queue = read_ingest_queue(&project.join(INGEST_QUEUE_FILE)).unwrap();
        assert_eq!(queue[0].project_id, "project-1");
        assert_eq!(queue[0].source_path, "raw/sources/note.md");

        let _ = fs::remove_dir_all(project);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn skips_unsupported_source_extensions() {
        let project = temp_root("skip-project");
        let outside = temp_root("skip-outside");
        ensure_wiki_layout(&project).unwrap();

        let source = outside.join("tool.exe");
        fs::write(&source, "binary").unwrap();

        let imported = import_source_file(&project, &source, &project.join("raw/sources")).unwrap();
        assert!(imported.is_none());
        assert!(!project.join("raw/sources/tool.exe").exists());

        let _ = fs::remove_dir_all(project);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn successful_build_keeps_completed_queue_status() {
        let project = temp_root("completed-queue");
        ensure_wiki_layout(&project).unwrap();
        let source = project.join("raw/sources/note.md");
        fs::write(&source, "# Note\n\nBridge relay notes.").unwrap();
        let imported = "raw/sources/note.md".to_string();

        let added = enqueue_ingest_tasks(&project, "project-1", &[imported.clone()]).unwrap();
        assert_eq!(added, 1);

        let (base_url, server) = start_fake_deepseek_server();
        let config = LlmWikiLlmConfigDto {
            provider: "deepseek".to_string(),
            api_key: "test-key".to_string(),
            model: "deepseek-chat".to_string(),
            base_url,
            max_context_size: 16_000,
            configured: true,
        };
        let summary = tauri::async_runtime::block_on(process_ingest_queue_with_deepseek(
            &project,
            "project-1",
            &config,
        ))
        .unwrap();
        server.join().unwrap();

        assert_eq!(summary.processed_count, 1);
        let queue = read_queue_summary(&project).unwrap();
        assert_eq!(queue.pending, 0);
        assert_eq!(queue.completed, 1);
        assert_eq!(queue.total, 1);

        let added_again = enqueue_ingest_tasks(&project, "project-1", &[imported]).unwrap();
        assert_eq!(added_again, 0);
        let queue = read_queue_summary(&project).unwrap();
        assert_eq!(queue.completed, 1);
        assert_eq!(queue.total, 1);

        let _ = fs::remove_dir_all(project);
    }

    #[test]
    fn rejects_project_scoped_folder_imports() {
        let project = temp_root("scoped-project");
        ensure_wiki_layout(&project).unwrap();

        let err = reject_project_scoped_import(&project, &project.join("wiki")).unwrap_err();
        assert!(err.contains("不能导入当前 LLM Wiki 项目目录"));

        let _ = fs::remove_dir_all(project);
    }

    #[test]
    fn writes_deepseek_config_into_empty_llm_wiki_state() {
        let app_data = temp_root("deepseek-empty-state");

        let saved = write_deepseek_llm_config(
            &app_data,
            LlmWikiLlmConfigInput {
                provider: Some("deepseek".to_string()),
                api_key: Some(" sk-test ".to_string()),
                model: Some("deepseek-chat".to_string()),
                base_url: Some("https://api.deepseek.com/v1/".to_string()),
                max_context_size: Some(32_000),
                clear_api_key: false,
            },
        )
        .unwrap();

        assert!(saved.configured);
        assert_eq!(saved.api_key, "sk-test");
        assert_eq!(saved.model, "deepseek-chat");
        assert_eq!(saved.base_url, "https://api.deepseek.com/v1");
        assert_eq!(saved.max_context_size, 32_000);

        let state = read_llm_wiki_app_state(&app_data).unwrap();
        assert_eq!(
            state.get("activePresetId").and_then(Value::as_str),
            Some("deepseek")
        );
        assert_eq!(
            state
                .get("llmConfig")
                .and_then(|value| value.get("provider"))
                .and_then(Value::as_str),
            Some("custom")
        );
        assert_eq!(
            state
                .get("providerConfigs")
                .and_then(|value| value.get("deepseek"))
                .and_then(|value| value.get("apiKey"))
                .and_then(Value::as_str),
            Some("sk-test")
        );

        let _ = fs::remove_dir_all(app_data);
    }

    #[test]
    fn deepseek_config_preserves_existing_llm_wiki_state() {
        let app_data = temp_root("deepseek-preserve-state");
        let initial = json!({
            "apiConfig": { "enabled": true, "allowUnauthenticated": true },
            "projectRegistry": {
                "project-1": { "id": "project-1", "name": "One", "path": "/tmp/one" }
            },
            "recentProjects": [
                { "id": "project-1", "name": "One", "path": "/tmp/one" }
            ],
            "providerConfigs": {
                "openai": { "apiKey": "openai-key", "model": "gpt-4o" }
            }
        });
        write_llm_wiki_app_state(&app_data, &initial).unwrap();

        write_deepseek_llm_config(
            &app_data,
            LlmWikiLlmConfigInput {
                provider: None,
                api_key: Some("deepseek-key".to_string()),
                model: None,
                base_url: None,
                max_context_size: None,
                clear_api_key: false,
            },
        )
        .unwrap();

        let state = read_llm_wiki_app_state(&app_data).unwrap();
        assert_eq!(
            state
                .get("apiConfig")
                .and_then(|value| value.get("allowUnauthenticated"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert!(state
            .get("projectRegistry")
            .and_then(|value| value.get("project-1"))
            .is_some());
        assert_eq!(
            state
                .get("providerConfigs")
                .and_then(|value| value.get("openai"))
                .and_then(|value| value.get("apiKey"))
                .and_then(Value::as_str),
            Some("openai-key")
        );
        assert_eq!(
            state
                .get("providerConfigs")
                .and_then(|value| value.get("deepseek"))
                .and_then(|value| value.get("model"))
                .and_then(Value::as_str),
            Some(DEFAULT_DEEPSEEK_MODEL)
        );

        let _ = fs::remove_dir_all(app_data);
    }

    #[test]
    fn reads_existing_deepseek_config() {
        let app_data = temp_root("deepseek-read-state");
        write_llm_wiki_app_state(
            &app_data,
            &json!({
                "activePresetId": "deepseek",
                "providerConfigs": {
                    "deepseek": {
                        "apiKey": "deepseek-key",
                        "model": "deepseek-v4-pro",
                        "baseUrl": "https://api.deepseek.com/v1",
                        "maxContextSize": 128000
                    }
                }
            }),
        )
        .unwrap();

        let loaded = read_deepseek_llm_config(&app_data).unwrap();

        assert!(loaded.configured);
        assert_eq!(loaded.provider, "deepseek");
        assert_eq!(loaded.api_key, "deepseek-key");
        assert_eq!(loaded.model, "deepseek-v4-pro");
        assert_eq!(loaded.max_context_size, 128_000);

        let _ = fs::remove_dir_all(app_data);
    }

    #[test]
    fn parses_headless_file_blocks_and_rejects_unsafe_paths() {
        let parsed = parse_headless_file_blocks(
            "---FILE: wiki/concepts/atlas-protocol.md---\n# Atlas\n---END FILE---\n\
             --- FILE: ../escape.md ---\nnope\n--- END FILE ---\n",
        );

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].path, "wiki/concepts/atlas-protocol.md");
        assert_eq!(parsed[0].content, "# Atlas");
        assert!(safe_ingest_file_path(&parsed[0].path).is_some());
        assert!(safe_ingest_file_path(&parsed[1].path).is_none());
        assert!(safe_ingest_file_path("/tmp/wiki.md").is_none());
        assert!(safe_ingest_file_path("wiki/../escape.md").is_none());
        assert!(safe_ingest_file_path("raw/sources/nope.md").is_none());
    }

    #[test]
    fn writes_headless_blocks_only_under_wiki() {
        let project = temp_root("headless-block-write");
        ensure_wiki_layout(&project).unwrap();
        let written = write_headless_file_blocks(
            &project,
            "---FILE: wiki/concepts/bridge-relay.md---\n# Bridge Relay\n---END FILE---\n\
             ---FILE: ../../outside.md---\n# Outside\n---END FILE---\n",
        )
        .unwrap();

        assert_eq!(written, vec!["wiki/concepts/bridge-relay.md"]);
        assert_eq!(
            fs::read_to_string(project.join("wiki/concepts/bridge-relay.md")).unwrap(),
            "# Bridge Relay"
        );
        assert!(!project.join("outside.md").exists());

        let _ = fs::remove_dir_all(project);
    }

    #[test]
    #[ignore = "manual PDF import/build verification using a repository PDF fixture"]
    fn imports_repo_pdf_and_builds_with_fake_deepseek() {
        let project = temp_root("repo-pdf-build");
        ensure_wiki_layout(&project).unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../bearfrp/reference/wikibridge_spec.pdf")
            .canonicalize()
            .expect("repository PDF fixture should exist");

        let imported = import_source_file(&project, &source, &project.join("raw/sources"))
            .unwrap()
            .expect("PDF source should be imported");
        assert_eq!(imported, "raw/sources/wikibridge_spec.pdf");
        assert!(project.join("raw/sources/wikibridge_spec.pdf").exists());

        let added = enqueue_ingest_tasks(&project, "project-1", &[imported]).unwrap();
        assert_eq!(added, 1);

        let (base_url, server) = start_fake_deepseek_server();
        let config = LlmWikiLlmConfigDto {
            provider: "deepseek".to_string(),
            api_key: "test-key".to_string(),
            model: "deepseek-chat".to_string(),
            base_url,
            max_context_size: 16_000,
            configured: true,
        };
        let summary = tauri::async_runtime::block_on(process_ingest_queue_with_deepseek(
            &project,
            "project-1",
            &config,
        ))
        .unwrap();
        server.join().unwrap();

        assert_eq!(summary.processed_count, 1);
        assert_eq!(summary.failed_count, 0);
        assert!(summary
            .written_paths
            .contains(&"wiki/sources/wikibridge-spec.md".to_string()));
        assert!(summary
            .written_paths
            .contains(&"wiki/concepts/pdf-import-verification.md".to_string()));
        assert_eq!(read_queue_summary(&project).unwrap().failed, 0);
        assert!(project.join("wiki/sources/wikibridge-spec.md").exists());

        let _ = fs::remove_dir_all(project);
    }

    fn start_fake_deepseek_server() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            loop {
                let read = stream.read(&mut buffer).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let body = serde_json::json!({
                "choices": [
                    {
                        "message": {
                            "content": "---FILE: wiki/sources/wikibridge-spec.md---\n---\ntype: source\ntitle: WikiBridge Spec\ntags: [generated]\nrelated: []\nsources: [\"wikibridge_spec.pdf\"]\n---\n\n# WikiBridge Spec\n\nPDF import verification source summary.\n---END FILE---\n---FILE: wiki/concepts/pdf-import-verification.md---\n---\ntype: concept\ntitle: PDF Import Verification\ntags: [generated]\nrelated: []\nsources: [\"wikibridge_spec.pdf\"]\n---\n\n# PDF Import Verification\n\nThe build path handled extracted PDF text.\n---END FILE---"
                        }
                    }
                ]
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        (format!("http://{addr}/v1"), handle)
    }

    #[test]
    fn reads_recent_failed_tasks_in_descending_order() {
        let project = temp_root("failed-tasks");
        ensure_wiki_layout(&project).unwrap();
        write_ingest_queue(
            &project.join(INGEST_QUEUE_FILE),
            &[
                IngestTask {
                    id: "1".to_string(),
                    project_id: "project-1".to_string(),
                    source_path: "raw/sources/old.pdf".to_string(),
                    folder_context: String::new(),
                    status: "failed".to_string(),
                    added_at: 10,
                    error: Some("old".to_string()),
                    retry_count: 1,
                },
                IngestTask {
                    id: "2".to_string(),
                    project_id: "project-1".to_string(),
                    source_path: "raw/sources/new.pdf".to_string(),
                    folder_context: String::new(),
                    status: "failed".to_string(),
                    added_at: 20,
                    error: Some("new".to_string()),
                    retry_count: 1,
                },
                IngestTask {
                    id: "3".to_string(),
                    project_id: "project-1".to_string(),
                    source_path: "raw/sources/ok.pdf".to_string(),
                    folder_context: String::new(),
                    status: "done".to_string(),
                    added_at: 30,
                    error: None,
                    retry_count: 0,
                },
            ],
        )
        .unwrap();

        let failed = read_failed_tasks(&project, 8).unwrap();

        assert_eq!(failed.len(), 2);
        assert_eq!(failed[0].source_path, "raw/sources/new.pdf");
        assert_eq!(failed[0].error, "new");
        assert_eq!(failed[1].source_path, "raw/sources/old.pdf");

        let _ = fs::remove_dir_all(project);
    }
}
