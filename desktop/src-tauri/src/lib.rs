use std::{
    collections::BTreeSet,
    fs,
    net::{TcpStream, ToSocketAddrs},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

mod api;
mod frpc;
mod local_service;
mod sidecar;
mod state;
mod wiki;

use api::{
    ApiClient, CreateHttpProxyInput, ProxyDto, ProxyListDto, ProxyScriptsDto, RechargeDto, UserDto,
};
use frpc::ProcessStateDto;
use state::{
    AppSnapshot, BuildStatus, DesktopRuntime, KnowledgeProject, LinkStatus, PersistedState,
    ProjectConnection, ProjectMaterial,
};

type SharedRuntime = Mutex<DesktopRuntime>;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub folder_path: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMaterialsInput {
    pub project_id: String,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConnectionInput {
    pub project_id: String,
    pub traffic_mb: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectConnectionDto {
    pub connection_id: String,
    pub project_id: String,
    pub project_name: String,
    pub proxy_id: u64,
    pub public_url: Option<String>,
    pub running: bool,
    pub enabled: bool,
    pub service_ready: bool,
    pub traffic_limit_mb: i64,
    pub traffic_used_bytes: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectDocumentContentDto {
    pub document_id: String,
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectAssetDto {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectTreeNodeDto {
    pub node_id: String,
    pub name: String,
    pub kind: String,
    pub document_id: Option<String>,
    pub readable: bool,
    pub children: Vec<ProjectTreeNodeDto>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreResult {
    pub proxy_id: u64,
    pub ok: bool,
    pub message: String,
    pub process: Option<ProcessStateDto>,
}

#[tauri::command]
fn get_state(runtime: State<'_, SharedRuntime>) -> Result<AppSnapshot, String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    Ok(runtime.snapshot())
}

#[tauri::command]
fn save_settings(
    runtime: State<'_, SharedRuntime>,
    base_url: String,
) -> Result<AppSnapshot, String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    frpc::stop_all(&mut runtime, true)?;
    stop_all_mask_services(&mut runtime);
    runtime.set_base_url(base_url)?;
    Ok(runtime.snapshot())
}

#[tauri::command]
fn get_desktop_services_state(
    runtime: State<'_, SharedRuntime>,
) -> Result<sidecar::DesktopServicesState, String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    Ok(sidecar::desktop_services_state(&mut runtime))
}

#[tauri::command]
fn set_bearfrp_backend_url(
    runtime: State<'_, SharedRuntime>,
    url: String,
) -> Result<AppSnapshot, String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    frpc::stop_all(&mut runtime, true)?;
    stop_all_mask_services(&mut runtime);
    runtime.set_base_url(url)?;
    Ok(runtime.snapshot())
}

#[tauri::command]
fn ensure_opencode_stack_running(
    app: AppHandle,
    runtime: State<'_, SharedRuntime>,
) -> Result<sidecar::OpenCodeStackDto, String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    sidecar::ensure_opencode_stack_running(&app, &mut runtime)
}

#[tauri::command]
fn stop_opencode_stack(runtime: State<'_, SharedRuntime>) -> Result<(), String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    sidecar::stop_opencode_stack(&mut runtime);
    Ok(())
}

#[tauri::command]
async fn register_user(
    runtime: State<'_, SharedRuntime>,
    username: String,
    password: String,
) -> Result<UserDto, String> {
    let client = client_from_runtime(&runtime)?;
    let result = client.register(username, password).await?;
    let mut runtime = runtime.lock().map_err(lock_error)?;
    runtime.update_cookies(result.user_session, result.uid_cookie);
    runtime.save()?;
    Ok(result.user)
}

#[tauri::command]
async fn login_user(
    runtime: State<'_, SharedRuntime>,
    username: String,
    password: String,
) -> Result<UserDto, String> {
    let client = client_from_runtime(&runtime)?;
    let result = client.login(username, password).await?;
    let mut runtime = runtime.lock().map_err(lock_error)?;
    runtime.update_cookies(result.user_session, result.uid_cookie);
    runtime.save()?;
    Ok(result.user)
}

#[tauri::command]
async fn logout_user(runtime: State<'_, SharedRuntime>) -> Result<(), String> {
    let client = client_from_runtime(&runtime)?;
    let _ = client.logout().await;
    let mut runtime = runtime.lock().map_err(lock_error)?;
    frpc::stop_all(&mut runtime, true)?;
    stop_all_mask_services(&mut runtime);
    runtime.clear_auth();
    runtime.save()
}

#[tauri::command]
async fn get_current_user(runtime: State<'_, SharedRuntime>) -> Result<UserDto, String> {
    let client = client_from_runtime(&runtime)?;
    client.me().await
}

#[tauri::command]
async fn recharge_user(runtime: State<'_, SharedRuntime>) -> Result<RechargeDto, String> {
    let client = client_from_runtime(&runtime)?;
    client.recharge().await
}

#[tauri::command]
async fn list_http_proxies(runtime: State<'_, SharedRuntime>) -> Result<ProxyListDto, String> {
    let client = client_from_runtime(&runtime)?;
    client.list_http_proxies().await
}

#[tauri::command]
async fn create_http_proxy(
    runtime: State<'_, SharedRuntime>,
    input: CreateHttpProxyInput,
) -> Result<ProxyScriptsDto, String> {
    let client = client_from_runtime(&runtime)?;
    let created = client.create_http_proxy(input).await?;
    let mut runtime = runtime.lock().map_err(lock_error)?;
    runtime
        .persisted
        .last_configs
        .insert(created.proxy.id, created.frpc_config.clone());
    runtime.save()?;
    Ok(created)
}

#[tauri::command]
fn list_projects(runtime: State<'_, SharedRuntime>) -> Result<Vec<KnowledgeProject>, String> {
    let runtime = runtime.lock().map_err(lock_error)?;
    Ok(runtime.persisted.projects.values().cloned().collect())
}

#[tauri::command]
fn create_project(
    runtime: State<'_, SharedRuntime>,
    input: CreateProjectInput,
) -> Result<KnowledgeProject, String> {
    let name = normalize_project_name(&input.name)?;
    let parent_folder = normalize_project_folder(&input.folder_path)?;
    let folder = project_root_for_create(&parent_folder, &name)?;
    if folder.exists() {
        return Err(format!("项目目录已存在: {}", folder.display()));
    }
    fs::create_dir_all(&parent_folder).map_err(|error| format!("无法创建保存位置: {error}"))?;
    fs::create_dir_all(&folder).map_err(|error| format!("无法创建项目文件夹: {error}"))?;
    wiki::ensure_wiki_layout(&folder)?;
    let raw_dir = folder.join("raw").join("sources");
    fs::create_dir_all(&raw_dir).map_err(|error| format!("无法创建 source 文件夹: {error}"))?;

    let project = KnowledgeProject {
        project_id: new_id("kb"),
        name,
        folder_path: folder.to_string_lossy().to_string(),
        raw_dir: raw_dir.to_string_lossy().to_string(),
        materials: Vec::new(),
        build_status: BuildStatus::NotBuilt,
        link_status: LinkStatus::NotLinked,
        created_at: unix_timestamp(),
    };
    write_project_manifest(&project)?;

    let mut runtime = runtime.lock().map_err(lock_error)?;
    runtime
        .persisted
        .projects
        .insert(project.project_id.clone(), project.clone());
    wiki::ensure_wiki_project(&mut runtime, &project.project_id)?;
    runtime.save()?;
    Ok(project)
}

#[tauri::command]
async fn delete_project(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
) -> Result<(), String> {
    let connection_ids = {
        let runtime = runtime.lock().map_err(lock_error)?;
        runtime
            .persisted
            .connections
            .values()
            .filter(|connection| connection.project_id == project_id)
            .map(|connection| connection.connection_id.clone())
            .collect::<Vec<_>>()
    };
    if !connection_ids.is_empty() {
        let client = client_from_runtime(&runtime)?;
        for connection_id in connection_ids {
            delete_connection_internal(&runtime, &client, &connection_id).await?;
        }
    }
    let mut runtime = runtime.lock().map_err(lock_error)?;
    runtime.persisted.projects.remove(&project_id);
    runtime.save()
}

#[tauri::command]
fn add_project_materials(
    runtime: State<'_, SharedRuntime>,
    input: AddMaterialsInput,
) -> Result<KnowledgeProject, String> {
    if input.file_paths.is_empty() {
        return Err("请选择素材文件".to_string());
    }
    let mut runtime = runtime.lock().map_err(lock_error)?;
    let project = runtime
        .persisted
        .projects
        .get_mut(&input.project_id)
        .ok_or_else(|| "项目不存在".to_string())?;
    let raw_dir = PathBuf::from(&project.raw_dir);
    fs::create_dir_all(&raw_dir).map_err(|error| format!("无法创建素材文件夹: {error}"))?;

    for file_path in input.file_paths {
        let source = PathBuf::from(file_path);
        if !source.is_file() {
            continue;
        }
        let original_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "素材文件名不合法".to_string())?
            .to_string();
        let target = unique_target_path(&raw_dir, &original_name);
        fs::copy(&source, &target).map_err(|error| format!("无法复制素材: {error}"))?;
        let size_bytes = target
            .metadata()
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        project.materials.push(ProjectMaterial {
            material_id: new_id("mat"),
            original_name,
            stored_name: target
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            stored_path: target.to_string_lossy().to_string(),
            size_bytes,
            added_at: unix_timestamp(),
        });
        project.build_status = BuildStatus::NotBuilt;
        project.link_status = LinkStatus::NotLinked;
    }
    let updated = project.clone();
    write_project_manifest(&updated)?;
    runtime.save()?;
    Ok(updated)
}

#[tauri::command]
fn build_project(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
) -> Result<KnowledgeProject, String> {
    update_project_status(runtime, project_id, Some(BuildStatus::Built), None)
}

#[tauri::command]
fn link_project(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
) -> Result<KnowledgeProject, String> {
    update_project_status(runtime, project_id, None, Some(LinkStatus::Linked))
}

#[tauri::command]
fn list_project_tree(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
) -> Result<ProjectTreeNodeDto, String> {
    let project = get_project(&runtime, &project_id)?;
    project_tree(&project)
}

#[tauri::command]
fn read_project_document(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
    material_id: String,
) -> Result<ProjectDocumentContentDto, String> {
    let project = get_project(&runtime, &project_id)?;
    let material = project
        .materials
        .iter()
        .find(|material| material.material_id == material_id)
        .ok_or_else(|| "文档不存在".to_string())?;
    let path = validate_project_document_path(&project, material)?;
    let content =
        fs::read_to_string(path).map_err(|error| format!("无法读取 Markdown 文档: {error}"))?;
    Ok(ProjectDocumentContentDto {
        document_id: material.material_id.clone(),
        title: document_title(material),
        content,
    })
}

#[tauri::command]
fn read_project_tree_document(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
    node_id: String,
) -> Result<ProjectDocumentContentDto, String> {
    let project = get_project(&runtime, &project_id)?;
    let project_root = project_root_path(&project)?;
    let document_path = validate_project_tree_document_path(&project_root, &node_id)?;
    let content = fs::read_to_string(&document_path)
        .map_err(|error| format!("无法读取 Markdown 文档: {error}"))?;
    Ok(ProjectDocumentContentDto {
        document_id: node_id,
        title: document_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Markdown 文档")
            .to_string(),
        content,
    })
}

#[tauri::command]
fn read_project_asset(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
    node_id: String,
) -> Result<ProjectAssetDto, String> {
    let project = get_project(&runtime, &project_id)?;
    let project_root = project_root_path(&project)?;
    let asset_path = validate_project_asset_path(&project_root, &node_id)?;
    let bytes = fs::read(&asset_path).map_err(|error| format!("无法读取图片资源: {error}"))?;
    Ok(ProjectAssetDto {
        mime_type: image_mime_type(&asset_path)
            .unwrap_or("application/octet-stream")
            .to_string(),
        bytes,
    })
}

#[tauri::command]
async fn list_connections(
    runtime: State<'_, SharedRuntime>,
) -> Result<Vec<ProjectConnectionDto>, String> {
    let client = client_from_runtime(&runtime)?;
    let connections = {
        let runtime = runtime.lock().map_err(lock_error)?;
        runtime
            .persisted
            .connections
            .values()
            .cloned()
            .collect::<Vec<_>>()
    };
    let mut items = Vec::new();
    for connection in connections {
        items.push(connection_dto(&runtime, &client, &connection).await?);
    }
    Ok(items)
}

#[tauri::command]
async fn create_connection(
    app: AppHandle,
    runtime: State<'_, SharedRuntime>,
    input: CreateConnectionInput,
) -> Result<ProjectConnectionDto, String> {
    let client = client_from_runtime(&runtime)?;
    let user = client.me().await?;
    let traffic_mb = normalize_traffic_mb(input.traffic_mb)?;
    let project = get_project(&runtime, &input.project_id)?;
    ensure_project_unbound(&runtime, &input.project_id)?;
    let connection_id = new_id("conn");
    let local_port = allocate_connection_port(&runtime)?;
    let draft_connection = ProjectConnection {
        connection_id: connection_id.clone(),
        project_id: input.project_id.clone(),
        proxy_id: 0,
        local_host: local_service::SERVICE_HOST.to_string(),
        local_port,
        created_at: unix_timestamp(),
    };
    ensure_mask_service(&runtime, &draft_connection, &project)?;
    let proxy = match create_connection_proxy(
        &client,
        &user,
        &project,
        &draft_connection,
        traffic_mb,
    )
    .await
    {
        Ok(proxy) => proxy,
        Err(error) => {
            stop_mask_service(&runtime, &connection_id)?;
            return Err(error);
        }
    };
    let connection = ProjectConnection {
        proxy_id: proxy.id,
        ..draft_connection
    };
    {
        let mut runtime = runtime.lock().map_err(lock_error)?;
        runtime
            .persisted
            .connections
            .insert(connection.connection_id.clone(), connection.clone());
        runtime.save()?;
    }
    let scripts = client.get_proxy_scripts(proxy.id).await?;
    {
        let mut runtime = runtime.lock().map_err(lock_error)?;
        frpc::start_frpc(&app, &mut runtime, proxy.id, &scripts.frpc_config)?;
    }
    connection_dto(&runtime, &client, &connection).await
}

#[tauri::command]
async fn start_connection(
    app: AppHandle,
    runtime: State<'_, SharedRuntime>,
    connection_id: String,
) -> Result<ProjectConnectionDto, String> {
    let client = client_from_runtime(&runtime)?;
    let connection = get_connection(&runtime, &connection_id)?;
    let project = get_project(&runtime, &connection.project_id)?;
    ensure_mask_service(&runtime, &connection, &project)?;
    let scripts = client.get_proxy_scripts(connection.proxy_id).await?;
    {
        let mut runtime = runtime.lock().map_err(lock_error)?;
        frpc::start_frpc(
            &app,
            &mut runtime,
            connection.proxy_id,
            &scripts.frpc_config,
        )?;
    }
    connection_dto(&runtime, &client, &connection).await
}

#[tauri::command]
async fn stop_connection(
    runtime: State<'_, SharedRuntime>,
    connection_id: String,
) -> Result<ProjectConnectionDto, String> {
    let client = client_from_runtime(&runtime)?;
    let connection = get_connection(&runtime, &connection_id)?;
    {
        let mut runtime = runtime.lock().map_err(lock_error)?;
        frpc::stop_frpc(&mut runtime, connection.proxy_id, true)?;
    }
    connection_dto(&runtime, &client, &connection).await
}

#[tauri::command]
async fn delete_connection(
    runtime: State<'_, SharedRuntime>,
    connection_id: String,
) -> Result<(), String> {
    let client = client_from_runtime(&runtime)?;
    delete_connection_internal(&runtime, &client, &connection_id).await
}

#[tauri::command]
async fn start_proxy(
    app: AppHandle,
    runtime: State<'_, SharedRuntime>,
    proxy_id: u64,
) -> Result<ProcessStateDto, String> {
    let client = client_from_runtime(&runtime)?;
    let scripts = client.get_proxy_scripts(proxy_id).await?;
    let mut runtime = runtime.lock().map_err(lock_error)?;
    frpc::start_frpc(&app, &mut runtime, proxy_id, &scripts.frpc_config)
}

#[tauri::command]
fn stop_proxy(runtime: State<'_, SharedRuntime>, proxy_id: u64) -> Result<ProcessStateDto, String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    frpc::stop_frpc(&mut runtime, proxy_id, true)
}

#[tauri::command]
fn proxy_process_state(
    runtime: State<'_, SharedRuntime>,
    proxy_id: u64,
) -> Result<ProcessStateDto, String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    frpc::process_state(&mut runtime, proxy_id)
}

#[tauri::command]
fn tail_proxy_log(runtime: State<'_, SharedRuntime>, proxy_id: u64) -> Result<String, String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    Ok(frpc::read_proxy_log(&mut runtime, proxy_id))
}

#[tauri::command]
fn check_local_port(host: String, port: u16) -> Result<bool, String> {
    let addrs = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|error| format!("本地地址解析失败: {error}"))?;
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(600)).is_ok() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn update_project_status(
    runtime: State<'_, SharedRuntime>,
    project_id: String,
    build_status: Option<BuildStatus>,
    link_status: Option<LinkStatus>,
) -> Result<KnowledgeProject, String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    let project = runtime
        .persisted
        .projects
        .get_mut(&project_id)
        .ok_or_else(|| "项目不存在".to_string())?;
    if let Some(status) = build_status {
        project.build_status = status;
    }
    if let Some(status) = link_status {
        project.link_status = status;
    }
    let updated = project.clone();
    write_project_manifest(&updated)?;
    runtime.save()?;
    Ok(updated)
}

async fn connection_dto(
    runtime: &State<'_, SharedRuntime>,
    client: &ApiClient,
    connection: &ProjectConnection,
) -> Result<ProjectConnectionDto, String> {
    let project = get_project(runtime, &connection.project_id)?;
    let proxy = client
        .list_http_proxies()
        .await?
        .proxies
        .into_iter()
        .find(|proxy| proxy.id == connection.proxy_id);
    let public_url = proxy.as_ref().and_then(proxy_public_url);
    let traffic_limit_mb = proxy
        .as_ref()
        .and_then(|proxy| proxy.traffic_limit_mb)
        .unwrap_or(0);
    let traffic_used_bytes = proxy
        .as_ref()
        .and_then(|proxy| proxy.traffic_used_bytes)
        .unwrap_or(0);
    let service_ready = local_service::is_ready(connection.local_port).unwrap_or(false);
    let (running, enabled) = {
        let mut runtime = runtime.lock().map_err(lock_error)?;
        runtime.reap_exited();
        (
            runtime.processes.contains_key(&connection.proxy_id),
            runtime
                .persisted
                .enabled_proxy_ids
                .contains(&connection.proxy_id),
        )
    };
    let status = if running {
        "running"
    } else if enabled && !service_ready {
        "service_not_ready"
    } else {
        "stopped"
    };
    Ok(ProjectConnectionDto {
        connection_id: connection.connection_id.clone(),
        project_id: connection.project_id.clone(),
        project_name: project.name,
        proxy_id: connection.proxy_id,
        public_url,
        running,
        enabled,
        service_ready,
        traffic_limit_mb,
        traffic_used_bytes,
        status: status.to_string(),
    })
}

async fn create_connection_proxy(
    client: &ApiClient,
    user: &UserDto,
    project: &KnowledgeProject,
    connection: &ProjectConnection,
    traffic_mb: i64,
) -> Result<ProxyDto, String> {
    for attempt in 0..4 {
        let input = CreateHttpProxyInput {
            name: backend_proxy_name(&project.name, &connection.connection_id, attempt),
            local_ip: connection.local_host.clone(),
            local_port: i64::from(connection.local_port),
            subdomain: connection_subdomain(user, &connection.connection_id, attempt),
            traffic_mb,
            speed_limit_kbps: 1024,
            advanced_config: None,
        };
        match client.create_http_proxy(input).await {
            Ok(created) => return Ok(created.proxy),
            Err(error) if error.contains("余额不足") => {
                return Err("可用额度不足，请先免费充值".to_string());
            }
            Err(error) if error.contains("子域名已被占用") || error.contains("名称重复") =>
                {}
            Err(_) => return Err("暂时无法创建访问连接".to_string()),
        }
    }
    Err("暂时无法创建访问连接".to_string())
}

async fn delete_connection_internal(
    runtime: &State<'_, SharedRuntime>,
    client: &ApiClient,
    connection_id: &str,
) -> Result<(), String> {
    let connection = get_connection(runtime, connection_id)?;
    let _ = client.delete_proxy(connection.proxy_id).await;
    let mut runtime = runtime.lock().map_err(lock_error)?;
    let _ = frpc::stop_frpc(&mut runtime, connection.proxy_id, true);
    stop_mask_service_locked(&mut runtime, connection_id);
    runtime.remove_proxy_files(connection.proxy_id);
    runtime.persisted.connections.remove(connection_id);
    runtime.save()
}

fn ensure_mask_service(
    runtime: &State<'_, SharedRuntime>,
    connection: &ProjectConnection,
    project: &KnowledgeProject,
) -> Result<(), String> {
    write_project_manifest(project)?;
    let mut runtime = runtime.lock().map_err(lock_error)?;
    let manifest_path = project_manifest_path(project);
    let mut process = runtime.service_processes.remove(&connection.connection_id);
    let ready = local_service::ensure_knowledge_mask_running(
        &mut process,
        connection.local_port,
        manifest_path,
    )?;
    if let Some(process) = process {
        runtime
            .service_processes
            .insert(connection.connection_id.clone(), process);
    }
    if ready {
        Ok(())
    } else {
        Err("知识库服务启动失败".to_string())
    }
}

fn stop_mask_service(
    runtime: &State<'_, SharedRuntime>,
    connection_id: &str,
) -> Result<(), String> {
    let mut runtime = runtime.lock().map_err(lock_error)?;
    stop_mask_service_locked(&mut runtime, connection_id);
    Ok(())
}

fn stop_mask_service_locked(runtime: &mut DesktopRuntime, connection_id: &str) {
    if let Some(process) = runtime.service_processes.remove(connection_id) {
        process.stop();
    }
}

fn stop_all_mask_services(runtime: &mut DesktopRuntime) {
    for (_, process) in runtime.service_processes.drain() {
        process.stop();
    }
}

fn allocate_connection_port(runtime: &State<'_, SharedRuntime>) -> Result<u16, String> {
    let used_ports = {
        let runtime = runtime.lock().map_err(lock_error)?;
        runtime
            .persisted
            .connections
            .values()
            .map(|connection| connection.local_port)
            .collect::<BTreeSet<_>>()
    };
    for port in local_service::PORT_RANGE_START..=local_service::PORT_RANGE_END {
        if used_ports.contains(&port) {
            continue;
        }
        if !local_service::is_ready(port).unwrap_or(false) {
            return Ok(port);
        }
    }
    Err("连接数量已达上限".to_string())
}

fn ensure_project_unbound(
    runtime: &State<'_, SharedRuntime>,
    project_id: &str,
) -> Result<(), String> {
    let runtime = runtime.lock().map_err(lock_error)?;
    if runtime
        .persisted
        .connections
        .values()
        .any(|connection| connection.project_id == project_id)
    {
        Err("该项目已经创建访问连接".to_string())
    } else {
        Ok(())
    }
}

fn get_project(
    runtime: &State<'_, SharedRuntime>,
    project_id: &str,
) -> Result<KnowledgeProject, String> {
    let runtime = runtime.lock().map_err(lock_error)?;
    runtime
        .persisted
        .projects
        .get(project_id)
        .cloned()
        .ok_or_else(|| "项目不存在".to_string())
}

fn get_connection(
    runtime: &State<'_, SharedRuntime>,
    connection_id: &str,
) -> Result<ProjectConnection, String> {
    let runtime = runtime.lock().map_err(lock_error)?;
    runtime
        .persisted
        .connections
        .get(connection_id)
        .cloned()
        .ok_or_else(|| "连接不存在".to_string())
}

fn project_tree(project: &KnowledgeProject) -> Result<ProjectTreeNodeDto, String> {
    let project_root = project_root_path(project)?;
    let wiki_root = project_root.join("wiki");
    fs::create_dir_all(&wiki_root).map_err(|error| format!("无法创建 wiki 目录: {error}"))?;
    let mut root = build_tree_node(&project_root, &wiki_root)?;
    root.node_id.clear();
    root.name = "wiki".to_string();
    Ok(root)
}

fn build_tree_node(project_root: &Path, path: &Path) -> Result<ProjectTreeNodeDto, String> {
    let metadata = path
        .metadata()
        .map_err(|error| format!("无法读取知识库目录: {error}"))?;
    let name = if path == project_root {
        project_root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("知识库")
            .to_string()
    } else {
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("未命名")
            .to_string()
    };
    if metadata.is_dir() {
        let mut children = fs::read_dir(path)
            .map_err(|error| format!("无法读取知识库目录: {error}"))?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|entry_path| !is_internal_project_path(entry_path))
            .filter_map(|entry_path| build_tree_node(project_root, &entry_path).ok())
            .collect::<Vec<_>>();
        children.sort_by(|left, right| {
            let left_rank = if left.kind == "directory" { 0 } else { 1 };
            let right_rank = if right.kind == "directory" { 0 } else { 1 };
            left_rank
                .cmp(&right_rank)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(ProjectTreeNodeDto {
            node_id: tree_node_id(project_root, path),
            name,
            kind: "directory".to_string(),
            document_id: None,
            readable: false,
            children,
        })
    } else {
        let readable = is_markdown_path(path);
        let node_id = tree_node_id(project_root, path);
        Ok(ProjectTreeNodeDto {
            node_id: node_id.clone(),
            name,
            kind: "file".to_string(),
            document_id: readable.then_some(node_id),
            readable,
            children: Vec::new(),
        })
    }
}

fn project_root_path(project: &KnowledgeProject) -> Result<PathBuf, String> {
    fs::create_dir_all(&project.folder_path)
        .map_err(|error| format!("无法创建项目文件夹: {error}"))?;
    PathBuf::from(&project.folder_path)
        .canonicalize()
        .map_err(|error| format!("知识库项目目录不可用: {error}"))
}

fn tree_node_id(project_root: &Path, path: &Path) -> String {
    let relative = path
        .strip_prefix(project_root)
        .unwrap_or(path)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>();
    relative.join("/")
}

fn is_internal_project_path(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|name| name == ".bearfrps")
            .unwrap_or(false)
    })
}

fn validate_project_tree_document_path(
    project_root: &Path,
    node_id: &str,
) -> Result<PathBuf, String> {
    let document_path = project_root
        .join(node_id)
        .canonicalize()
        .map_err(|error| format!("Markdown 文档不存在: {error}"))?;
    if !document_path.starts_with(project_root) || is_internal_project_path(&document_path) {
        return Err("文档路径不属于当前知识库".to_string());
    }
    if !document_path.is_file() || !is_markdown_path(&document_path) {
        return Err("当前只支持阅读 Markdown 文档".to_string());
    }
    Ok(document_path)
}

fn validate_project_asset_path(project_root: &Path, node_id: &str) -> Result<PathBuf, String> {
    let asset_path = project_root
        .join(node_id)
        .canonicalize()
        .map_err(|error| format!("图片资源不存在: {error}"))?;
    if !asset_path.starts_with(project_root) || is_internal_project_path(&asset_path) {
        return Err("图片路径不属于当前知识库".to_string());
    }
    if !asset_path.is_file() || !is_image_path(&asset_path) {
        return Err("当前只支持读取知识库内的图片资源".to_string());
    }
    Ok(asset_path)
}

fn validate_project_document_path(
    project: &KnowledgeProject,
    material: &ProjectMaterial,
) -> Result<PathBuf, String> {
    let stored_path = PathBuf::from(&material.stored_path);
    if !is_markdown_path(&stored_path) {
        return Err("当前只支持阅读 Markdown 文档".to_string());
    }
    let project_root = project_root_path(project)?;
    let document_path = stored_path
        .canonicalize()
        .map_err(|error| format!("Markdown 文档不存在: {error}"))?;
    if !document_path.starts_with(&project_root) || is_internal_project_path(&document_path) {
        return Err("文档路径不属于当前知识库".to_string());
    }
    Ok(document_path)
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| {
            let extension = extension.to_ascii_lowercase();
            extension == "md" || extension == "markdown"
        })
        .unwrap_or(false)
}

fn is_image_path(path: &Path) -> bool {
    image_mime_type(path).is_some()
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("avif") => Some("image/avif"),
        Some("bmp") => Some("image/bmp"),
        Some("gif") => Some("image/gif"),
        Some("jpeg") | Some("jpg") => Some("image/jpeg"),
        Some("png") => Some("image/png"),
        Some("svg") => Some("image/svg+xml"),
        Some("webp") => Some("image/webp"),
        _ => None,
    }
}

fn document_title(material: &ProjectMaterial) -> String {
    Path::new(&material.original_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&material.original_name)
        .to_string()
}

fn normalize_project_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err("请输入项目名称".to_string());
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("项目名称不能包含路径分隔符".to_string());
    }
    if name.chars().count() > 30 {
        return Err("项目名称不能超过 30 个字".to_string());
    }
    Ok(name.to_string())
}

fn normalize_project_folder(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("请选择项目文件夹".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

fn project_root_for_create(parent_folder: &Path, name: &str) -> Result<PathBuf, String> {
    let candidate = parent_folder.join(name);
    for component in candidate.components() {
        if matches!(component, Component::ParentDir) {
            return Err("项目目录不能包含上级路径".to_string());
        }
    }
    Ok(candidate)
}

fn normalize_traffic_mb(value: i64) -> Result<i64, String> {
    match value {
        10 | 50 | 100 | 500 => Ok(value),
        _ => Err("请选择有效的流量额度".to_string()),
    }
}

fn unique_target_path(raw_dir: &Path, original_name: &str) -> PathBuf {
    let original = Path::new(original_name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("material");
    let ext = original.extension().and_then(|value| value.to_str());
    for index in 0..10_000 {
        let candidate_name = if index == 0 {
            original_name.to_string()
        } else if let Some(ext) = ext {
            format!("{stem}-{index}.{ext}")
        } else {
            format!("{stem}-{index}")
        };
        let candidate = raw_dir.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    raw_dir.join(format!("{stem}-{}", unix_millis()))
}

fn write_project_manifest(project: &KnowledgeProject) -> Result<(), String> {
    let manifest_path = project_manifest_path(project);
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建项目元数据目录: {error}"))?;
    }
    let text = serde_json::to_string_pretty(project)
        .map_err(|error| format!("无法序列化项目元数据: {error}"))?;
    fs::write(manifest_path, text).map_err(|error| format!("无法写入项目元数据: {error}"))
}

fn project_manifest_path(project: &KnowledgeProject) -> PathBuf {
    PathBuf::from(&project.folder_path)
        .join(".bearfrps")
        .join("project.json")
}

fn proxy_public_url(proxy: &ProxyDto) -> Option<String> {
    proxy
        .public_url
        .clone()
        .or_else(|| proxy.public_urls.first().cloned())
}

fn backend_proxy_name(project_name: &str, connection_id: &str, attempt: u32) -> String {
    let suffix: String = connection_id.chars().rev().take(6).collect();
    format!("{project_name}-{suffix}-{attempt}")
        .chars()
        .take(30)
        .collect()
}

fn connection_subdomain(user: &UserDto, connection_id: &str, attempt: u32) -> String {
    let uid = user
        .uid
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(10)
        .collect::<String>()
        .to_ascii_lowercase();
    let uid = if uid.len() >= 3 {
        uid
    } else {
        "user".to_string()
    };
    let suffix = connection_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(12)
        .collect::<String>();
    format!("kb-{uid}-{suffix}-{attempt}")
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}{}", unix_millis())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let runtime = DesktopRuntime::new(app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            app.manage(Mutex::new(runtime));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            save_settings,
            get_desktop_services_state,
            set_bearfrp_backend_url,
            ensure_opencode_stack_running,
            stop_opencode_stack,
            register_user,
            login_user,
            logout_user,
            get_current_user,
            recharge_user,
            list_http_proxies,
            create_http_proxy,
            list_projects,
            create_project,
            delete_project,
            add_project_materials,
            build_project,
            link_project,
            wiki::get_wiki_project,
            wiki::import_wiki_sources,
            wiki::build_wiki_project,
            wiki::refresh_wiki_graph,
            list_project_tree,
            read_project_document,
            read_project_tree_document,
            read_project_asset,
            list_connections,
            create_connection,
            start_connection,
            stop_connection,
            delete_connection,
            start_proxy,
            stop_proxy,
            proxy_process_state,
            tail_proxy_log,
            check_local_port
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WikiBridge desktop app");
}

fn client_from_runtime(runtime: &State<'_, SharedRuntime>) -> Result<ApiClient, String> {
    let persisted = {
        let runtime = runtime.lock().map_err(lock_error)?;
        runtime.persisted.clone()
    };
    client_from_persisted(&persisted)
}

fn client_from_persisted(persisted: &PersistedState) -> Result<ApiClient, String> {
    if persisted.base_url.trim().is_empty() {
        return Err("请先配置 BearFRP backend URL".to_string());
    }
    Ok(ApiClient::from_state(persisted))
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    format!("桌面端内部状态锁定失败: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_project_root_uses_name_under_selected_parent() {
        let parent = PathBuf::from("/tmp/wiki-parent");
        let name = normalize_project_name("知识库").unwrap();
        let root = project_root_for_create(&parent, &name).unwrap();
        assert_eq!(root, parent.join("知识库"));
    }

    #[test]
    fn project_name_rejects_path_separators() {
        assert!(normalize_project_name("foo/bar").is_err());
        assert!(normalize_project_name("foo\\bar").is_err());
    }
}
