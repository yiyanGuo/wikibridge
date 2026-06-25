import { FormEvent, useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Link2,
  Play,
  Power,
  RefreshCcw,
  Save,
  Server,
  TerminalSquare
} from 'lucide-react';
import BearFrpApp from './BearFrpApp';

type Entry = 'bearfrp' | 'opencode';
type OpenCodeStatus = 'idle' | 'starting' | 'ready' | 'failed';

type SidecarState = {
  running: boolean;
  healthy: boolean;
  url?: string | null;
  port?: number | null;
  logPath?: string | null;
};

type DesktopServicesState = {
  bearfrpBackendUrl: string;
  appDataDir: string;
  opencode: SidecarState;
  llmWiki: SidecarState;
};

type OpenCodeStack = {
  opencodeUrl: string;
  llmWikiUrl: string;
};

export default function App() {
  const [activeEntry, setActiveEntry] = useState<Entry>('bearfrp');
  const [services, setServices] = useState<DesktopServicesState | null>(null);
  const [backendDraft, setBackendDraft] = useState('');
  const [opencodeStatus, setOpenCodeStatus] = useState<OpenCodeStatus>('idle');
  const [opencodeUrl, setOpenCodeUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshServices = useCallback(async () => {
    const next = await invoke<DesktopServicesState>('get_desktop_services_state');
    setServices(next);
    setBackendDraft(next.bearfrpBackendUrl);
    if (next.opencode.running && next.opencode.url) {
      setOpenCodeUrl(next.opencode.url);
      setOpenCodeStatus(next.opencode.healthy ? 'ready' : 'starting');
    } else {
      setOpenCodeUrl('');
      setOpenCodeStatus('idle');
    }
    return next;
  }, []);

  useEffect(() => {
    refreshServices().catch((err) => setError(friendlyError(err)));
  }, [refreshServices]);

  useEffect(() => {
    if (opencodeStatus !== 'starting') return;
    const timer = window.setInterval(() => {
      refreshServices().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [opencodeStatus, refreshServices]);

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

  async function startOpenCode() {
    setBusy('opencode-start');
    setError('');
    setOpenCodeStatus('starting');
    setActiveEntry('opencode');
    try {
      const stack = await invoke<OpenCodeStack>('ensure_opencode_stack_running');
      setOpenCodeUrl(stack.opencodeUrl);
      setOpenCodeStatus('ready');
      await refreshServices();
    } catch (err) {
      setOpenCodeStatus('failed');
      setError(friendlyError(err));
    } finally {
      setBusy('');
    }
  }

  async function stopOpenCode() {
    setBusy('opencode-stop');
    setError('');
    try {
      await invoke('stop_opencode_stack');
      setOpenCodeUrl('');
      setOpenCodeStatus('idle');
      await refreshServices();
      setNotice('OpenCode 已停止');
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
          <StatusBadge label="LLM Wiki" state={services?.llmWiki} />
          <StatusBadge label="OpenCode" state={services?.opencode} />
          <button className="icon-button" title="刷新" onClick={() => refreshServices()} disabled={Boolean(busy)}>
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
          <div className="opencode-toolbar">
            <div className="status-row">
              <span>OpenCode：{statusText(opencodeStatus)}</span>
              <span>LLM Wiki：{services?.llmWiki.healthy ? 'ready' : services?.llmWiki.running ? 'starting' : 'stopped'}</span>
            </div>
            <div className="card-actions opencode-actions">
              {opencodeUrl && (
                <button className="secondary" onClick={() => window.open(opencodeUrl, '_blank')}>
                  <ExternalLink size={17} />
                  浏览器
                </button>
              )}
              {opencodeStatus === 'ready' || services?.opencode.running ? (
                <button className="secondary" onClick={stopOpenCode} disabled={busy === 'opencode-stop'}>
                  <Power size={17} />
                  停止
                </button>
              ) : (
                <button className="primary" onClick={startOpenCode} disabled={busy === 'opencode-start'}>
                  <Play size={17} />
                  启动
                </button>
              )}
            </div>
          </div>

          {opencodeUrl && opencodeStatus === 'ready' ? (
            <iframe className="opencode-frame" src={opencodeUrl} title="OpenCode" />
          ) : (
            <div className="opencode-start-panel">
              <TerminalSquare size={32} aria-hidden="true" />
              <h1>OpenCode</h1>
              <button className="primary" onClick={startOpenCode} disabled={busy === 'opencode-start'}>
                <Play size={17} />
                {opencodeStatus === 'starting' ? '启动中' : '启动'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function StatusBadge({ label, state }: { label: string; state?: SidecarState | null }) {
  const ready = Boolean(state?.running && state.healthy);
  return (
    <span className="desktop-status" data-ready={ready || undefined}>
      {ready ? <CheckCircle2 size={15} /> : <Link2 size={15} />}
      {label}
    </span>
  );
}

function statusText(status: OpenCodeStatus) {
  const labels: Record<OpenCodeStatus, string> = {
    idle: 'stopped',
    starting: 'starting',
    ready: 'ready',
    failed: 'failed'
  };
  return labels[status];
}

function friendlyError(error: unknown) {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '操作失败';
  if (text.includes('二进制') || text.includes('启动') || text.includes('端口')) return text;
  if (text.includes('后端地址') || text.includes('backend')) return text;
  return '操作未完成，请稍后重试';
}
