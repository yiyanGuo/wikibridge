use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::{
    sidecar, unix_millis, unix_timestamp, write_project_manifest, DesktopRuntime,
    SharedRuntime,
};

const MAX_SOURCE_BYTES: u64 = 100 * 1024 * 1024;
const INGEST_QUEUE_FILE: &str = ".llm-wiki/ingest-queue.json";

const INCLUDE_EXTENSIONS: &[&str] = &[
    "md", "mdx", "txt", "pdf", "doc", "docx", "pptx", "xls", "xlsx", "odt", "odp",
    "ods", "rtf", "html", "htm", "csv",
];
const EXCLUDE_EXTENSIONS: &[&str] = &[
    "tmp", "temp", "bak", "swp", "part", "partial", "crdownload", "exe", "dll", "so",
    "dylib", "bin", "iso", "dmg",
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
pub struct WikiBuildResultDto {
    pub project: WikiProjectDto,
    pub queue: WikiQueueSummaryDto,
    pub enqueued_count: usize,
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
pub fn get_wiki_project(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
) -> Result<WikiProjectStateDto, String> {
    let mut runtime = runtime.lock().map_err(crate::lock_error)?;
    let project = ensure_wiki_project(&mut runtime, &project_id)?;
    let root = PathBuf::from(&project.path);
    Ok(WikiProjectStateDto {
        queue: read_queue_summary(&root)?,
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
                    &dest_root.join(
                        rel_inside_folder
                            .parent()
                            .unwrap_or_else(|| Path::new("")),
                    ),
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
                imported.push(relative_path(&root, &target)?.to_string_lossy().replace('\\', "/"));
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
pub fn build_wiki_project(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
) -> Result<WikiBuildResultDto, String> {
    let mut runtime = runtime.lock().map_err(crate::lock_error)?;
    let project = ensure_wiki_project(&mut runtime, &project_id)?;
    let root = PathBuf::from(&project.path);
    let sources = collect_ingestable_source_paths(&root)?;
    let enqueued_count = enqueue_ingest_tasks(&root, &project.id, &sources)?;
    let queue = read_queue_summary(&root)?;
    if enqueued_count > 0 {
        runtime.save()?;
    }
    Ok(WikiBuildResultDto {
        project,
        queue,
        enqueued_count,
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
        let url = format!("{}/projects/{}/graph", base_url.trim_end_matches('/'), project.id);
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
        &format!("# Research Log\n\n## {}\n\n- Project initialized\n", unix_timestamp()),
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
    fs::write(&identity_path, serde_json::to_string_pretty(&body).unwrap_or_else(|_| body.to_string()))
        .map_err(|error| format!("无法写入 .llm-wiki/project.json: {error}"))?;
    Ok(id)
}

fn register_llm_wiki_project(app_data_dir: &Path, project: &WikiProjectDto) -> Result<(), String> {
    let data_dir = app_data_dir.join("llm-wiki");
    fs::create_dir_all(&data_dir).map_err(|error| format!("无法创建 LLM Wiki 数据目录: {error}"))?;
    let state_path = data_dir.join("app-state.json");
    let mut state = fs::read_to_string(&state_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| json!({}));

    if !state.is_object() {
        state = json!({});
    }
    let object = state
        .as_object_mut()
        .ok_or_else(|| "LLM Wiki app-state 格式错误".to_string())?;

    let api_config = object
        .entry("apiConfig".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "LLM Wiki apiConfig 格式错误".to_string())?;
    api_config
        .entry("enabled".to_string())
        .or_insert(Value::Bool(true));
    api_config.insert("allowUnauthenticated".to_string(), Value::Bool(true));

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
    recent_projects.retain(|item| item.get("id").and_then(Value::as_str) != Some(project.id.as_str()));
    recent_projects.insert(
        0,
        json!({ "id": project.id, "name": project.name, "path": project.path }),
    );
    recent_projects.truncate(10);
    object.insert("recentProjects".to_string(), Value::Array(recent_projects));

    let text = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("无法序列化 LLM Wiki app-state: {error}"))?;
    fs::write(state_path, text).map_err(|error| format!("无法写入 LLM Wiki app-state: {error}"))
}

fn import_source_file(root: &Path, source: &Path, sources_root: &Path) -> Result<Option<String>, String> {
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
    Ok(Some(relative_path(root, &target)?.to_string_lossy().replace('\\', "/")))
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

fn enqueue_ingest_tasks(root: &Path, project_id: &str, source_paths: &[String]) -> Result<usize, String> {
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
                && matches!(task.status.as_str(), "pending" | "processing" | "failed")
        }) {
            if task.status != "processing" {
                task.status = "pending".to_string();
                task.error = None;
                task.retry_count = 0;
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

fn read_ingest_queue(path: &Path) -> Result<Vec<IngestTask>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|error| format!("无法读取 ingest queue: {error}"))?;
    serde_json::from_str::<Vec<IngestTask>>(&raw)
        .map_err(|error| format!("ingest queue 格式错误: {error}"))
}

fn write_ingest_queue(path: &Path, tasks: &[IngestTask]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(tasks)
        .map_err(|error| format!("无法序列化 ingest queue: {error}"))?;
    fs::write(path, text).map_err(|error| format!("无法写入 ingest queue: {error}"))
}

fn build_graph_from_wiki(root: &Path) -> Result<(Vec<WikiGraphNodeDto>, Vec<WikiGraphEdgeDto>), String> {
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
        let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("page.md");
        raw.insert(
            id,
            (
                extract_title(&content, file_name),
                extract_type(&content),
                relative_path(root, &path)?.to_string_lossy().replace('\\', "/"),
                extract_wikilinks(&content),
            ),
        );
    }

    let hidden_types = BTreeSet::from(["query".to_string()]);
    raw.retain(|_, (_, node_type, _, _)| !hidden_types.contains(node_type));
    let ids = raw.keys().cloned().collect::<BTreeSet<_>>();
    let mut link_count = raw.keys().map(|id| (id.clone(), 0_usize)).collect::<BTreeMap<_, _>>();
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
                return value.trim().trim_matches('"').trim_matches('\'').to_string();
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
            return value.trim().trim_matches('"').trim_matches('\'').to_lowercase();
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
    if EXCLUDE_GLOBS.iter().any(|pattern| wildcard_match(pattern, name)) {
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
        let path = entry.map_err(|error| format!("无法读取目录项: {error}"))?.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("无法读取文件元数据: {error}"))?;
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
    fn rejects_project_scoped_folder_imports() {
        let project = temp_root("scoped-project");
        ensure_wiki_layout(&project).unwrap();

        let err = reject_project_scoped_import(&project, &project.join("wiki")).unwrap_err();
        assert!(err.contains("不能导入当前 LLM Wiki 项目目录"));

        let _ = fs::remove_dir_all(project);
    }
}
