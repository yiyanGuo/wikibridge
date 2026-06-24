import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { ReaderMarkdown } from './ReaderMarkdown';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  FilePlus2,
  FolderOpen,
  Hammer,
  Link2,
  LogIn,
  LogOut,
  Play,
  Plus,
  Power,
  RefreshCcw,
  Server,
  Trash2,
  UserPlus
} from 'lucide-react';

type AppSnapshot = {
  is_authenticated: boolean;
};

type UserDto = {
  username: string;
  balance_mb: number;
};

type ProjectMaterial = {
  material_id: string;
  original_name: string;
  stored_name: string;
  size_bytes: number;
};

type KnowledgeProject = {
  project_id: string;
  name: string;
  folder_path: string;
  raw_dir: string;
  materials: ProjectMaterial[];
  build_status: 'not_built' | 'building' | 'built' | 'failed' | string;
  link_status: 'not_linked' | 'linking' | 'linked' | 'failed' | string;
};

type ProjectConnection = {
  connection_id: string;
  project_id: string;
  project_name: string;
  proxy_id: number;
  public_url?: string | null;
  running: boolean;
  enabled: boolean;
  service_ready: boolean;
  traffic_limit_mb: number;
  traffic_used_bytes: number;
  status: 'running' | 'stopped' | 'service_not_ready' | string;
};

type ProjectDocumentContent = {
  document_id: string;
  title: string;
  content: string;
};

type ProjectTreeNode = {
  node_id: string;
  name: string;
  kind: 'directory' | 'file' | string;
  document_id?: string | null;
  readable: boolean;
  children: ProjectTreeNode[];
};

type AuthMode = 'login' | 'register';
type AppPage = 'projects' | 'connections';

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [activePage, setActivePage] = useState<AppPage>('projects');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<UserDto | null>(null);
  const [projects, setProjects] = useState<KnowledgeProject[]>([]);
  const [connections, setConnections] = useState<ProjectConnection[]>([]);
  const [projectName, setProjectName] = useState('知识库');
  const [projectFolder, setProjectFolder] = useState('');
  const [connectionProjectId, setConnectionProjectId] = useState('');
  const [connectionTrafficMb, setConnectionTrafficMb] = useState(100);
  const [readerProjectId, setReaderProjectId] = useState('');
  const [readerTree, setReaderTree] = useState<ProjectTreeNode | null>(null);
  const [readerContent, setReaderContent] = useState<ProjectDocumentContent | null>(null);
  const [readerError, setReaderError] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isWorking = Boolean(busy);
  const connectedProjectIds = useMemo(
    () => new Set(connections.map((connection) => connection.project_id)),
    [connections]
  );
  const connectableProjects = projects.filter((project) => !connectedProjectIds.has(project.project_id));
  const readerProject = useMemo(
    () => projects.find((project) => project.project_id === readerProjectId) || null,
    [projects, readerProjectId]
  );
  const readableFileCount = useMemo(() => countReadableFiles(readerTree), [readerTree]);

  const refreshProjects = useCallback(async () => {
    const items = await invoke<KnowledgeProject[]>('list_projects');
    setProjects(items);
    return items;
  }, []);

  const refreshConnections = useCallback(async () => {
    const items = await invoke<ProjectConnection[]>('list_connections');
    setConnections(items);
    return items;
  }, []);

  const refreshWorkspace = useCallback(async () => {
    const [nextProjects, nextConnections] = await Promise.all([refreshProjects(), refreshConnections()]);
    const used = new Set(nextConnections.map((connection) => connection.project_id));
    const firstAvailable = nextProjects.find((project) => !used.has(project.project_id));
    setConnectionProjectId((current) => {
      if (current && nextProjects.some((project) => project.project_id === current) && !used.has(current)) return current;
      return firstAvailable?.project_id || '';
    });
  }, [refreshConnections, refreshProjects]);

  const loadSession = useCallback(async () => {
    setError('');
    const snapshot = await invoke<AppSnapshot>('get_state');
    if (!snapshot.is_authenticated) {
      setUser(null);
      setProjects([]);
      setConnections([]);
      return;
    }
    try {
      const current = await invoke<UserDto>('get_current_user');
      setUser(current);
      await refreshWorkspace();
    } catch (err) {
      setUser(null);
      setProjects([]);
      setConnections([]);
      setError(friendlyError(err));
    }
  }, [refreshWorkspace]);

  useEffect(() => {
    loadSession().catch((err) => setError(friendlyError(err)));
  }, [loadSession]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      refreshWorkspace().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshWorkspace, user]);

  useEffect(() => {
    if (readerProjectId && projects.length > 0 && !readerProject) {
      closeReader();
    }
  }, [projects, readerProject, readerProjectId]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setBusy('auth');
    setError('');
    try {
      const command = authMode === 'login' ? 'login_user' : 'register_user';
      const current = await invoke<UserDto>(command, { username, password });
      setUser(current);
      setActivePage('projects');
      setPassword('');
      await refreshWorkspace();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function logout() {
    setBusy('logout');
    setError('');
    try {
      await invoke('logout_user');
      setUser(null);
      setProjects([]);
      setConnections([]);
      setActivePage('projects');
      closeReader();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function recharge() {
    setBusy('recharge');
    setError('');
    try {
      await invoke('recharge_user');
      const current = await invoke<UserDto>('get_current_user');
      setUser(current);
      setNotice('免费额度已到账');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function chooseProjectFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') setProjectFolder(selected);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    setBusy('create-project');
    setError('');
    try {
      const project = await invoke<KnowledgeProject>('create_project', {
        input: { name: projectName, folderPath: projectFolder }
      });
      setProjects((current) => upsertProject(current, project));
      setConnectionProjectId((current) => current || project.project_id);
      setProjectName('知识库');
      setProjectFolder('');
      setNotice('项目已创建');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function addMaterials(project: KnowledgeProject) {
    const selected = await open({ multiple: true, directory: false });
    const filePaths = Array.isArray(selected) ? selected : typeof selected === 'string' ? [selected] : [];
    if (!filePaths.length) return;
    setBusy(`add-${project.project_id}`);
    setError('');
    try {
      const updated = await invoke<KnowledgeProject>('add_project_materials', {
        input: { projectId: project.project_id, filePaths }
      });
      setProjects((current) => upsertProject(current, updated));
      if (readerProjectId === project.project_id) {
        await refreshReaderDocuments(project.project_id, readerContent?.document_id);
      }
      setNotice('素材已添加');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function buildProject(project: KnowledgeProject) {
    setBusy(`build-${project.project_id}`);
    setError('');
    try {
      const updated = await invoke<KnowledgeProject>('build_project', { projectId: project.project_id });
      setProjects((current) => upsertProject(current, updated));
      if (readerProjectId === project.project_id) {
        await refreshReaderDocuments(project.project_id, readerContent?.document_id);
      }
      setNotice('构建状态已更新');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function linkProject(project: KnowledgeProject) {
    setBusy(`link-${project.project_id}`);
    setError('');
    try {
      const updated = await invoke<KnowledgeProject>('link_project', { projectId: project.project_id });
      setProjects((current) => upsertProject(current, updated));
      if (readerProjectId === project.project_id) {
        await refreshReaderDocuments(project.project_id, readerContent?.document_id);
      }
      setNotice('链接状态已更新');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function openReader(project: KnowledgeProject) {
    setBusy(`reader-${project.project_id}`);
    setError('');
    setReaderError('');
    setReaderProjectId(project.project_id);
    setReaderTree(null);
    setReaderContent(null);
    try {
      await refreshReaderDocuments(project.project_id);
    } catch (err) {
      setReaderError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function refreshReaderDocuments(projectId: string, preferredDocumentId?: string) {
    setReaderError('');
    const tree = await invoke<ProjectTreeNode>('list_project_tree', {
      projectId
    });
    setReaderTree(tree);
    const selectedDocumentId =
      findReadableFile(tree, preferredDocumentId)?.document_id || findReadableFile(tree)?.document_id;
    if (!selectedDocumentId) {
      setReaderContent(null);
      return;
    }
    const content = await invoke<ProjectDocumentContent>('read_project_tree_document', {
      projectId,
      nodeId: selectedDocumentId
    });
    setReaderContent(content);
  }

  async function readDocument(projectId: string, documentId: string) {
    setBusy(`read-${documentId}`);
    setReaderError('');
    try {
      const content = await invoke<ProjectDocumentContent>('read_project_tree_document', {
        projectId,
        nodeId: documentId
      });
      setReaderContent(content);
    } catch (err) {
      setReaderError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function refreshReaderProject(project: KnowledgeProject) {
    setBusy(`refresh-reader-${project.project_id}`);
    setReaderError('');
    try {
      await refreshProjects();
      await refreshReaderDocuments(project.project_id, readerContent?.document_id);
      setNotice('知识库已刷新');
    } catch (err) {
      setReaderError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  function closeReader() {
    setReaderProjectId('');
    setReaderTree(null);
    setReaderContent(null);
    setReaderError('');
  }

  async function deleteProject(project: KnowledgeProject) {
    if (!window.confirm(`删除项目 ${project.name}？`)) return;
    setBusy(`delete-project-${project.project_id}`);
    setError('');
    try {
      await invoke('delete_project', { projectId: project.project_id });
      setProjects((current) => current.filter((item) => item.project_id !== project.project_id));
      setConnections((current) => current.filter((item) => item.project_id !== project.project_id));
      if (readerProjectId === project.project_id) closeReader();
      setNotice('项目已删除');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function createConnection(event: FormEvent) {
    event.preventDefault();
    if (!connectionProjectId) return;
    setBusy('create-connection');
    setError('');
    try {
      const created = await invoke<ProjectConnection>('create_connection', {
        input: { projectId: connectionProjectId, trafficMb: connectionTrafficMb }
      });
      setConnections((current) => upsertConnection(current, created));
      setConnectionProjectId('');
      setNotice('访问连接已创建');
      await refreshWorkspace();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function startConnection(connection: ProjectConnection) {
    setBusy(`start-${connection.connection_id}`);
    setError('');
    try {
      const next = await invoke<ProjectConnection>('start_connection', { connectionId: connection.connection_id });
      setConnections((current) => upsertConnection(current, next));
      setNotice('访问已开启');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function stopConnection(connection: ProjectConnection) {
    setBusy(`stop-${connection.connection_id}`);
    setError('');
    try {
      const next = await invoke<ProjectConnection>('stop_connection', { connectionId: connection.connection_id });
      setConnections((current) => upsertConnection(current, next));
      setNotice('访问已关闭');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function deleteConnection(connection: ProjectConnection) {
    if (!window.confirm(`删除 ${connection.project_name} 的访问连接？`)) return;
    setBusy(`delete-connection-${connection.connection_id}`);
    setError('');
    try {
      await invoke('delete_connection', { connectionId: connection.connection_id });
      setConnections((current) => current.filter((item) => item.connection_id !== connection.connection_id));
      setNotice('访问连接已删除');
      await refreshWorkspace();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function copyUrl(connection: ProjectConnection) {
    if (!connection.public_url) return;
    await navigator.clipboard.writeText(connection.public_url);
    setNotice('访问地址已复制');
  }

  function switchPage(page: AppPage) {
    setActivePage(page);
    if (page === 'connections') closeReader();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Server size={22} aria-hidden="true" />
          <div>
            <strong>BearFrps</strong>
            <span>知识库访问</span>
          </div>
        </div>
        {user && (
          <nav className="main-nav" aria-label="主导航">
            <button className={activePage === 'projects' ? 'active' : ''} onClick={() => switchPage('projects')}>
              <BookOpen size={17} />
              知识库
            </button>
            <button className={activePage === 'connections' ? 'active' : ''} onClick={() => switchPage('connections')}>
              <Link2 size={17} />
              访问连接
            </button>
          </nav>
        )}
        {user && (
          <div className="account">
            <span>{user.username}</span>
            <span>可用额度：{user.balance_mb} MB</span>
            <button className="secondary compact" onClick={recharge} disabled={busy === 'recharge'}>
              <RefreshCcw size={16} />
              免费充值
            </button>
            <button className="icon-button" title="刷新" onClick={() => loadSession()} disabled={isWorking}>
              <RefreshCcw size={17} aria-hidden="true" />
            </button>
            <button className="icon-button" title="退出" onClick={logout} disabled={busy === 'logout'}>
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        )}
      </header>

      {error && <div className="alert error">{error}</div>}
      {notice && (
        <div className="alert notice" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}

      {!user ? (
        <main className="auth-layout">
          <section className="auth-panel">
            <div className="segmented">
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>
                <LogIn size={17} aria-hidden="true" />
                登录
              </button>
              <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>
                <UserPlus size={17} aria-hidden="true" />
                注册
              </button>
            </div>
            <form onSubmit={submitAuth} className="stack">
              <label>
                用户名
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
              </label>
              <label>
                密码
                <input
                  value={password}
                  type="password"
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                />
              </label>
              <button className="primary" disabled={busy === 'auth'}>
                {authMode === 'login' ? <LogIn size={17} /> : <UserPlus size={17} />}
                {authMode === 'login' ? '登录' : '注册并登录'}
              </button>
            </form>
          </section>
        </main>
      ) : readerProject && activePage === 'projects' ? (
        <main className="reader-layout">
          <section className="panel reader-panel">
            <div className="reader-header">
              <button className="secondary" onClick={closeReader}>
                <ArrowLeft size={17} />
                返回
              </button>
              <div>
                <h1>{readerProject.name}</h1>
                <p>{readerProject.folder_path}</p>
              </div>
              <span className="count-pill">{readableFileCount} 篇文档</span>
            </div>

            <div className="project-toolbar">
              <div className="status-row">
                <span>构建：{statusLabel(readerProject.build_status)}</span>
                <span>链接：{statusLabel(readerProject.link_status)}</span>
                <span>素材：{readerProject.materials.length}</span>
              </div>
              <div className="card-actions reader-actions">
                <button className="secondary" onClick={() => addMaterials(readerProject)} disabled={busy === `add-${readerProject.project_id}`}>
                  <FilePlus2 size={17} />
                  Add 素材
                </button>
                <button className="secondary" onClick={() => buildProject(readerProject)} disabled={busy === `build-${readerProject.project_id}`}>
                  <Hammer size={17} />
                  构建
                </button>
                <button className="secondary" onClick={() => linkProject(readerProject)} disabled={busy === `link-${readerProject.project_id}`}>
                  <Link2 size={17} />
                  Link
                </button>
                <button
                  className="secondary"
                  onClick={() => refreshReaderProject(readerProject)}
                  disabled={busy === `refresh-reader-${readerProject.project_id}`}
                >
                  <RefreshCcw size={17} />
                  刷新
                </button>
              </div>
            </div>

            <div className="reader-shell">
              <aside className="reader-sidebar">
                <div className="reader-sidebar-section">
                  <div className="reader-list-heading">
                    <BookOpen size={17} />
                    目录
                  </div>
                  {!readerTree || readerTree.children.length === 0 ? (
                    <div className="toc-empty">暂无素材</div>
                  ) : (
                    <div className="tree-list">
                      <TreeNodeView
                        activeDocumentId={readerContent?.document_id}
                        busy={busy}
                        node={readerTree}
                        onRead={(documentId) => readDocument(readerProject.project_id, documentId)}
                      />
                    </div>
                  )}
                </div>
              </aside>

              <article className="reader-content">
                {readerError && <div className="inline-alert">{readerError}</div>}
                {readableFileCount === 0 ? (
                  <div className="empty-state">暂无 Markdown 文档</div>
                ) : readerContent ? (
                  <>
                    <div className="reader-content-heading">
                      <h2>{readerContent.title}</h2>
                    </div>
                    <div className="markdown-body">
                      <ReaderMarkdown
                        content={readerContent.content}
                        currentDocumentId={readerContent.document_id}
                        onOpenDocument={(documentId) => readDocument(readerProject.project_id, documentId)}
                        projectFolder={readerProject.folder_path}
                        projectId={readerProject.project_id}
                        tree={readerTree}
                      />
                    </div>
                  </>
                ) : (
                  <div className="empty-state">正在加载文档</div>
                )}
              </article>
            </div>
          </section>
        </main>
      ) : (
        <main className="workspace">
          {activePage === 'projects' ? (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h1>知识库项目</h1>
                <p>项目和素材管理可独立进行。</p>
              </div>
              <span className="count-pill">{projects.length} 个项目</span>
            </div>

            <form className="project-form" onSubmit={createProject}>
              <input
                value={projectName}
                maxLength={30}
                onChange={(event) => setProjectName(event.target.value)}
                aria-label="项目名称"
                placeholder="项目名称"
              />
              <div className="folder-input">
                <input value={projectFolder} readOnly aria-label="项目文件夹" placeholder="选择项目文件夹" />
                <button className="secondary" type="button" onClick={chooseProjectFolder}>
                  <FolderOpen size={17} />
                  选择
                </button>
              </div>
              <button className="primary" disabled={busy === 'create-project'}>
                <Plus size={17} />
                创建项目
              </button>
            </form>

            <div className="project-list">
              {projects.length === 0 ? (
                <div className="empty-state">暂无知识库项目</div>
              ) : (
                projects.map((project) => (
                  <article className="project-card" key={project.project_id}>
                    <div className="card-heading">
                      <div>
                        <h2>{project.name}</h2>
                        <p>{project.folder_path}</p>
                      </div>
                      <button
                        className="icon-button danger"
                        title="删除项目"
                        onClick={() => deleteProject(project)}
                        disabled={busy === `delete-project-${project.project_id}`}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                    <div className="status-row">
                      <span>构建：{statusLabel(project.build_status)}</span>
                      <span>链接：{statusLabel(project.link_status)}</span>
                      <span>素材：{project.materials.length}</span>
                    </div>
                    <div className="card-actions">
                      <button className="primary" onClick={() => openReader(project)} disabled={busy === `reader-${project.project_id}`}>
                        <BookOpen size={17} />
                        进入项目
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
          ) : (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h1>访问连接</h1>
                <p>选择一个知识库项目创建访问连接。</p>
              </div>
              <span className="count-pill">{connections.length} 个连接</span>
            </div>

            <form className="connection-form" onSubmit={createConnection}>
              <select
                value={connectionProjectId}
                onChange={(event) => setConnectionProjectId(event.target.value)}
                aria-label="选择知识库项目"
              >
                <option value="">选择项目</option>
                {connectableProjects.map((project) => (
                  <option value={project.project_id} key={project.project_id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <div className="traffic-options" role="group" aria-label="选择流量额度">
                {[10, 50, 100, 500].map((value) => (
                  <button
                    type="button"
                    className={connectionTrafficMb === value ? 'active' : ''}
                    key={value}
                    onClick={() => setConnectionTrafficMb(value)}
                  >
                    {value} MB
                  </button>
                ))}
              </div>
              <button className="primary" disabled={busy === 'create-connection' || !connectionProjectId}>
                <Plus size={17} />
                创建连接
              </button>
            </form>

            <div className="connection-list">
              {connections.length === 0 ? (
                <div className="empty-state">暂无访问连接</div>
              ) : (
                connections.map((connection) => (
                  <article className="connection-card" key={connection.connection_id}>
                    <div className="card-heading">
                      <div>
                        <h2>{connection.project_name}</h2>
                        <p>{connectionStatusText(connection)}</p>
                      </div>
                      <span className="status-pill" data-running={connection.running || undefined}>
                        <CheckCircle2 size={16} />
                        {connection.running ? '可访问' : '已关闭'}
                      </span>
                    </div>
                    <div className="url-box" data-empty={!connection.public_url || undefined}>
                      <span>{connection.public_url || '正在生成访问地址'}</span>
                      <button className="icon-button" title="复制访问地址" onClick={() => copyUrl(connection)} disabled={!connection.public_url}>
                        <Copy size={17} />
                      </button>
                      <button
                        className="icon-button"
                        title="打开访问地址"
                        onClick={() => window.open(connection.public_url || '', '_blank')}
                        disabled={!connection.public_url}
                      >
                        <ExternalLink size={17} />
                      </button>
                    </div>
                    <div className="usage-block">
                      <div className="usage-meta">
                        <span>{usageText(connection)}</span>
                        <span>{usagePercent(connection).toFixed(0)}%</span>
                      </div>
                      <div className="usage-bar">
                        <span style={{ width: `${usagePercent(connection)}%` }} />
                      </div>
                    </div>
                    <div className="card-actions">
                      {connection.running ? (
                        <button
                          className="secondary"
                          onClick={() => stopConnection(connection)}
                          disabled={busy === `stop-${connection.connection_id}`}
                        >
                          <Power size={17} />
                          关闭访问
                        </button>
                      ) : (
                        <button
                          className="primary"
                          onClick={() => startConnection(connection)}
                          disabled={busy === `start-${connection.connection_id}`}
                        >
                          <Play size={17} />
                          开启访问
                        </button>
                      )}
                      <button
                        className="icon-button danger"
                        title="删除连接"
                        onClick={() => deleteConnection(connection)}
                        disabled={busy === `delete-connection-${connection.connection_id}`}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
          )}
        </main>
      )}
    </div>
  );
}

function upsertProject(items: KnowledgeProject[], next: KnowledgeProject) {
  return items.some((item) => item.project_id === next.project_id)
    ? items.map((item) => (item.project_id === next.project_id ? next : item))
    : [next, ...items];
}

function upsertConnection(items: ProjectConnection[], next: ProjectConnection) {
  return items.some((item) => item.connection_id === next.connection_id)
    ? items.map((item) => (item.connection_id === next.connection_id ? next : item))
    : [next, ...items];
}

function TreeNodeView({
  activeDocumentId,
  busy,
  node,
  onRead
}: {
  activeDocumentId?: string;
  busy: string;
  node: ProjectTreeNode;
  onRead: (documentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (node.kind === 'directory') {
    const isRoot = node.node_id === '';
    return (
      <div className={isRoot ? 'tree-root' : 'tree-node'}>
        {!isRoot && (
          <button className="tree-row directory" onClick={() => setExpanded((current) => !current)} type="button">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span>{node.name}</span>
          </button>
        )}
        {(expanded || isRoot) && (
          <div className={isRoot ? 'tree-children root' : 'tree-children'}>
            {node.children.map((child) => (
              <TreeNodeView activeDocumentId={activeDocumentId} busy={busy} key={child.node_id} node={child} onRead={onRead} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const documentId = node.document_id || '';
  return (
    <button
      className={`tree-row file ${activeDocumentId === documentId ? 'active' : ''}`}
      disabled={!node.readable || busy === `read-${documentId}`}
      onClick={() => documentId && onRead(documentId)}
      type="button"
    >
      <FileText size={16} />
      <span>{node.name}</span>
    </button>
  );
}

function findReadableFile(node: ProjectTreeNode | null, preferredDocumentId?: string): ProjectTreeNode | null {
  if (!node) return null;
  if (node.kind === 'file' && node.readable && (!preferredDocumentId || node.document_id === preferredDocumentId)) return node;
  for (const child of node.children) {
    const found = findReadableFile(child, preferredDocumentId);
    if (found) return found;
  }
  return null;
}

function countReadableFiles(node: ProjectTreeNode | null): number {
  if (!node) return 0;
  const current = node.kind === 'file' && node.readable ? 1 : 0;
  return current + node.children.reduce((total, child) => total + countReadableFiles(child), 0);
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    not_built: '未构建',
    building: '构建中',
    built: '已构建',
    not_linked: '未链接',
    linking: '链接中',
    linked: '已链接',
    failed: '失败'
  };
  return labels[value] || value;
}

function connectionStatusText(connection: ProjectConnection) {
  if (connection.traffic_limit_mb > 0 && usagePercent(connection) >= 100) return '额度已用完，请创建新的访问连接。';
  if (connection.running) return '访问已开启，可以通过访问地址查看知识库 mask。';
  if (connection.status === 'service_not_ready') return '本地知识库服务正在准备中。';
  return '访问已关闭，需要时可以重新开启。';
}

function usageText(connection: ProjectConnection) {
  const used = connection.traffic_used_bytes / 1024 / 1024;
  const limit = connection.traffic_limit_mb || 0;
  return `${used.toFixed(1)} / ${limit} MB`;
}

function usagePercent(connection: ProjectConnection) {
  if (!connection.traffic_limit_mb) return 0;
  const usedMb = connection.traffic_used_bytes / 1024 / 1024;
  return Math.max(0, Math.min(100, (usedMb / connection.traffic_limit_mb) * 100));
}

function formatSize(value: number) {
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024).toFixed(1)} KB`;
}

function friendlyError(error: unknown) {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '操作失败';
  if (text.includes('用户名') || text.includes('密码')) return text;
  if (text.includes('项目') || text.includes('素材') || text.includes('连接数量')) return text;
  if (text.includes('文档') || text.includes('Markdown')) return text;
  if (text.includes('可用额度') || text.includes('余额不足') || text.includes('流量额度')) return text;
  if (text.includes('无法连接') || text.includes('network') || text.includes('后端')) {
    return '服务暂时不可用，请稍后重试';
  }
  if (text.includes('frpc') || text.includes('通道')) return '访问启动失败，请重试';
  return '操作未完成，请稍后重试';
}
