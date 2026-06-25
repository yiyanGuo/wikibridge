import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  BookOpen,
  ExternalLink,
  Globe2,
  Plus,
  RefreshCcw,
  Save,
  Server,
  TerminalSquare,
  Trash2
} from 'lucide-react';
import BearFrpApp from './BearFrpApp';

type Entry = 'bearfrp' | 'opencode';

type DesktopServicesState = {
  bearfrpBackendUrl: string;
};

type RemoteKnowledgeBase = {
  remoteId: string;
  name: string;
  url: string;
  status: string;
  addedAt: number;
  lastOpenedAt?: number | null;
};

type RemoteKnowledgeBaseCheck = {
  url: string;
  ok: boolean;
  status: string;
  message: string;
  opencodeHealthy: boolean;
  llmWikiHealthy: boolean;
  kbMode?: boolean | null;
};

export default function App() {
  const [activeEntry, setActiveEntry] = useState<Entry>('bearfrp');
  const [services, setServices] = useState<DesktopServicesState | null>(null);
  const [backendDraft, setBackendDraft] = useState('');
  const [remoteKnowledgeBases, setRemoteKnowledgeBases] = useState<RemoteKnowledgeBase[]>([]);
  const [remoteName, setRemoteName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [activeRemoteId, setActiveRemoteId] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeRemote = useMemo(
    () => remoteKnowledgeBases.find((item) => item.remoteId === activeRemoteId) || null,
    [activeRemoteId, remoteKnowledgeBases]
  );
  const viewerUrl = openCodeKnowledgeUrl(activeRemote?.url || '');
  const viewerTitle = activeRemote?.name || '远程知识库';

  const refreshServices = useCallback(async () => {
    const next = await invoke<DesktopServicesState>('get_desktop_services_state');
    setServices(next);
    setBackendDraft(next.bearfrpBackendUrl);
    return next;
  }, []);

  const refreshRemoteKnowledgeBases = useCallback(async () => {
    const items = await invoke<RemoteKnowledgeBase[]>('list_remote_knowledge_bases');
    setRemoteKnowledgeBases(sortRemoteKnowledgeBases(items));
    return items;
  }, []);

  useEffect(() => {
    Promise.all([refreshServices(), refreshRemoteKnowledgeBases()]).catch((err) => setError(friendlyError(err)));
  }, [refreshRemoteKnowledgeBases, refreshServices]);

  async function saveBackendUrl(event: FormEvent) {
    event.preventDefault();
    setBusy('backend');
    setError('');
    try {
      await invoke('set_bearfrp_backend_url', { url: backendDraft });
      await refreshServices();
      setNotice('BearFRP backend 已保存');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function addRemoteKnowledgeBase(event: FormEvent) {
    event.preventDefault();
    setBusy('remote-add');
    setError('');
    try {
      const remote = await invoke<RemoteKnowledgeBase>('add_remote_knowledge_base', {
        input: { name: remoteName || null, url: remoteUrl }
      });
      setRemoteKnowledgeBases((items) => sortRemoteKnowledgeBases(upsertRemoteKnowledgeBase(items, remote)));
      setRemoteName('');
      setRemoteUrl('');
      setActiveRemoteId(remote.remoteId);
      setNotice(remote.status === 'ready' ? '远程知识库已添加' : `远程知识库已添加：${remoteStatusLabel(remote.status)}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function openRemoteKnowledgeBase(remote: RemoteKnowledgeBase) {
    setActiveRemoteId(remote.remoteId);
    setActiveEntry('opencode');
    setFrameKey((key) => key + 1);
    try {
      const updated = await invoke<RemoteKnowledgeBase>('touch_remote_knowledge_base', { remoteId: remote.remoteId });
      setRemoteKnowledgeBases((items) => sortRemoteKnowledgeBases(upsertRemoteKnowledgeBase(items, updated)));
    } catch {
      // The viewer can still open even if the timestamp update fails.
    }
  }

  async function removeRemoteKnowledgeBase(remote: RemoteKnowledgeBase) {
    if (!window.confirm(`删除远程知识库“${remote.name}”？`)) return;
    setBusy(`remote-remove-${remote.remoteId}`);
    setError('');
    try {
      await invoke('remove_remote_knowledge_base', { remoteId: remote.remoteId });
      setRemoteKnowledgeBases((items) => items.filter((item) => item.remoteId !== remote.remoteId));
      if (activeRemoteId === remote.remoteId) {
        setActiveRemoteId('');
      }
      setNotice('远程知识库已删除');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function checkRemoteKnowledgeBase(remote: RemoteKnowledgeBase) {
    setBusy(`remote-check-${remote.remoteId}`);
    setError('');
    try {
      const check = await invoke<RemoteKnowledgeBaseCheck>('check_remote_knowledge_base', { url: remote.url });
      setRemoteKnowledgeBases((items) =>
        sortRemoteKnowledgeBases(
          items.map((item) => (item.remoteId === remote.remoteId ? { ...item, url: check.url, status: check.status } : item))
        )
      );
      if (check.ok) {
        setNotice(check.message);
      } else {
        setError(check.message);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="desktop-root">
      <header className="desktop-topbar">
        <div className="desktop-brand">
          <BookOpen size={22} aria-hidden="true" />
          <div>
            <strong>WikiBridge</strong>
            <span>Desktop</span>
          </div>
        </div>

        <nav className="entry-nav" aria-label="入口">
          <button className={activeEntry === 'bearfrp' ? 'active' : ''} onClick={() => setActiveEntry('bearfrp')}>
            <Server size={17} />
            BearFRP
          </button>
          <button className={activeEntry === 'opencode' ? 'active' : ''} onClick={() => setActiveEntry('opencode')}>
            <TerminalSquare size={17} />
            OpenCode
          </button>
        </nav>

        <div className="desktop-actions">
          <button
            className="icon-button"
            title="刷新"
            onClick={() => {
              refreshServices().catch((err) => setError(friendlyError(err)));
              refreshRemoteKnowledgeBases().catch((err) => setError(friendlyError(err)));
            }}
            disabled={Boolean(busy)}
          >
            <RefreshCcw size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {notice && (
        <div className="alert notice" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}

      {activeEntry === 'bearfrp' ? (
        <section className="entry-pane">
          <form className="backend-strip" onSubmit={saveBackendUrl}>
            <label>
              BearFRP backend
              <input
                value={backendDraft}
                onChange={(event) => setBackendDraft(event.target.value)}
                placeholder="https://bearfrp.example.com"
              />
            </label>
            <button className="secondary" disabled={busy === 'backend'}>
              <Save size={17} />
              保存
            </button>
          </form>
          {!services?.bearfrpBackendUrl && (
            <div className="inline-alert desktop-inline-alert">请先配置远端 BearFRP backend URL。</div>
          )}
          <BearFrpApp />
        </section>
      ) : (
        <section className="entry-pane opencode-pane">
          <div className="opencode-workspace">
            <aside className="opencode-sidebar">
              <section className="opencode-section">
                <div className="section-heading compact">
                  <div>
                    <h2>添加远程知识库</h2>
                    <p>粘贴别人分享的 OpenCode 公网地址。</p>
                  </div>
                </div>
                <form className="remote-form" onSubmit={addRemoteKnowledgeBase}>
                  <label>
                    名称
                    <input value={remoteName} onChange={(event) => setRemoteName(event.target.value)} placeholder="可留空" />
                  </label>
                  <label>
                    分享链接
                    <input
                      value={remoteUrl}
                      onChange={(event) => setRemoteUrl(event.target.value)}
                      placeholder="https://wiki.example.com"
                    />
                  </label>
                  <button className="primary" disabled={busy === 'remote-add' || !remoteUrl.trim()}>
                    <Plus size={17} />
                    添加
                  </button>
                </form>
              </section>

              <section className="opencode-section remote-section">
                <div className="section-heading compact">
                  <div>
                    <h2>远程知识库</h2>
                    <p>{remoteKnowledgeBases.length ? `${remoteKnowledgeBases.length} 个分享链接` : '还没有添加远程链接'}</p>
                  </div>
                  <button className="icon-button" title="刷新列表" onClick={() => refreshRemoteKnowledgeBases()} disabled={Boolean(busy)}>
                    <RefreshCcw size={17} aria-hidden="true" />
                  </button>
                </div>
                {remoteKnowledgeBases.length ? (
                  <div className="remote-list">
                    {remoteKnowledgeBases.map((remote) => (
                      <article
                        className={activeRemoteId === remote.remoteId ? 'remote-card active' : 'remote-card'}
                        key={remote.remoteId}
                      >
                        <div className="remote-card-heading">
                          <div>
                            <strong>{remote.name}</strong>
                            <span>{remote.url}</span>
                          </div>
                          <span className="remote-status" data-status={remote.status}>
                            {remoteStatusLabel(remote.status)}
                          </span>
                        </div>
                        <div className="card-actions">
                          <button className="secondary compact" onClick={() => openRemoteKnowledgeBase(remote)}>
                            <Globe2 size={15} />
                            打开
                          </button>
                          <button
                            className="secondary compact"
                            onClick={() => checkRemoteKnowledgeBase(remote)}
                            disabled={busy === `remote-check-${remote.remoteId}`}
                          >
                            <RefreshCcw size={15} />
                            检测
                          </button>
                          <button
                            className="icon-button danger"
                            title="删除"
                            onClick={() => removeRemoteKnowledgeBase(remote)}
                            disabled={busy === `remote-remove-${remote.remoteId}`}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state compact">添加 OpenCode 公网地址后可在 App 内查看。</div>
                )}
              </section>
            </aside>

            <div className="opencode-viewer">
              <div className="viewer-toolbar">
                <div>
                  <strong>{viewerTitle}</strong>
                  <span>{viewerUrl || '请选择或添加别人分享的 OpenCode 公网地址'}</span>
                </div>
                <div className="card-actions">
                  {viewerUrl && (
                    <button className="secondary" onClick={() => setFrameKey((key) => key + 1)}>
                      <RefreshCcw size={17} />
                      刷新
                    </button>
                  )}
                  {viewerUrl && (
                    <button className="secondary" onClick={() => window.open(viewerUrl, '_blank')}>
                      <ExternalLink size={17} />
                      浏览器
                    </button>
                  )}
                </div>
              </div>
              {viewerUrl ? (
                <iframe className="opencode-frame" src={viewerUrl} title={viewerTitle} key={`${viewerUrl}-${frameKey}`} />
              ) : (
                <div className="remote-empty-panel">
                  <Globe2 size={32} aria-hidden="true" />
                  <h1>远程知识库</h1>
                  <p>添加别人分享的 OpenCode 公网地址后，就可以在这里向对方的知识库提问。</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function openCodeKnowledgeUrl(url: string) {
  const base = url.trim().replace(/\/+$/, '');
  return base;
}

function sortRemoteKnowledgeBases(items: RemoteKnowledgeBase[]) {
  return [...items].sort((left, right) => {
    const leftTime = left.lastOpenedAt || left.addedAt;
    const rightTime = right.lastOpenedAt || right.addedAt;
    return rightTime - leftTime || left.name.localeCompare(right.name);
  });
}

function upsertRemoteKnowledgeBase(items: RemoteKnowledgeBase[], next: RemoteKnowledgeBase) {
  return items.some((item) => item.remoteId === next.remoteId)
    ? items.map((item) => (item.remoteId === next.remoteId ? next : item))
    : [next, ...items];
}

function remoteStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: '可用',
    llm_wiki_unavailable: '知识库异常',
    auth_required: '需登录',
    unreachable: '不可达',
    not_opencode: '非 OpenCode'
  };
  return labels[status] || status;
}

function friendlyError(error: unknown) {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '操作失败';
  if (text.includes('二进制') || text.includes('启动') || text.includes('端口')) return text;
  if (text.includes('后端地址') || text.includes('backend')) return text;
  if (text.includes('OpenCode') || text.includes('分享链接') || text.includes('远程知识库')) return text;
  return '操作未完成，请稍后重试';
}
