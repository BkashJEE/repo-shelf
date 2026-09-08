import { useShelf } from '../store';
import { api } from '../api';
import { ThemePicker } from './ThemePicker';
import { WindowControls } from './WindowControls';

export function Header() {
  const repos = useShelf((s) => s.repos.length);
  const shelves = useShelf((s) => s.shelves.length);
  const connected = useShelf((s) => s.connected);
  const loaded = useShelf((s) => s.loaded);
  const githubAvailable = useShelf((s) => s.githubAvailable);
  const githubLogin = useShelf((s) => s.githubLogin);
  const openDialog = useShelf((s) => s.openDialog);
  const rescan = () => {
    void useShelf.getState().runAction('Rescanned all shelves', async () => {
      await api.rescan();
      return {};
    });
  };

  return (
    <header className={`hdr ${window.desktop ? 'desktop' : ''}`}>
      <div className="hdr-brand">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="4" y="6" width="6" height="20" rx="1" fill="#3f5f4a" />
          <rect x="12" y="4" width="6" height="22" rx="1" fill="#a3452f" />
          <rect x="20" y="8" width="7" height="18" rx="1" fill="#c9a227" />
        </svg>
        <span className="wordmark">repo shelf.</span>
      </div>
      <nav className="hdr-nav">
        <span className={`status ${loaded && connected ? 'ok' : 'warn'}`} title={connected ? 'Live updates connected' : 'Reconnecting to server'}>
          <i />
          {loaded ? (connected ? 'Live' : 'Reconnecting…') : 'Loading…'}
        </span>
        <span className="status muted" title={githubAvailable ? `GitHub metadata via gh as ${githubLogin}` : 'GitHub data unavailable: run gh auth login'}>
          {githubAvailable ? 'GitHub · connected' : 'GitHub data unavailable'}
        </span>
        <button className="btn small primary" onClick={() => openDialog({ kind: 'create' })} title="git init a new repo on one of your shelves">
          + New repo
        </button>
        <ThemePicker />
        <button className="link" onClick={rescan}>
          Rescan
        </button>
        <button className="link" onClick={() => openDialog({ kind: 'shelves' })}>
          Shelves
        </button>
        <span className="hdr-stat">
          <b>{repos}</b> repos
        </span>
        <span className="hdr-stat">
          <b>{shelves}</b> shelves
        </span>
        <WindowControls />
      </nav>
    </header>
  );
}
