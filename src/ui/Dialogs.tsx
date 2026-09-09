import { useEffect, useState, type FormEvent } from 'react';
import { useShelf } from '../store';
import { api, ApiError } from '../api';
import { validName } from '../validate';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="panel-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MoveDialog() {
  const dialog = useShelf((s) => s.dialog)!;
  const repo = useShelf((s) => s.repos.find((r) => r.id === dialog.repoId));
  const shelves = useShelf((s) => s.shelves);
  const close = useShelf((s) => s.closeDialog);
  const busy = useShelf((s) => s.busy);
  const runAction = useShelf((s) => s.runAction);
  const diskShelves = shelves.filter((s) => s.kind === 'disk');
  const [target, setTarget] = useState(dialog.targetShelfId ?? diskShelves.find((s) => s.id !== repo?.shelfId)?.id ?? '');
  const [needForce, setNeedForce] = useState(false);
  if (!repo) return null;
  const from = shelves.find((s) => s.id === repo.shelfId);
  const to = shelves.find((s) => s.id === target);

  const submit = async (force: boolean) => {
    try {
      await runAction(`Moved ${repo.name} to ${to?.label}`, () => api.move(repo.id, target, force));
      close();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'dirty') setNeedForce(true);
    }
  };

  return (
    <Modal title="Move repo" onClose={close}>
      <p className="modal-lead">
        Move <b>{repo.name}</b> from <b>{from?.label}</b> to
      </p>
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="field" disabled={busy}>
        {diskShelves
          .filter((s) => s.id !== repo.shelfId)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.path}
            </option>
          ))}
      </select>
      <p className="modal-note">
        The folder is moved on disk to <code>{to ? `${to.path}\\${repo.name}` : '…'}</code>. Close editors and terminals using it first.
      </p>
      {repo.dirtyCount > 0 && (
        <p className="modal-warn">
          This repo has {repo.dirtyCount} uncommitted change{repo.dirtyCount === 1 ? '' : 's'}. Moving is safe for the files, but commit first if in doubt.
        </p>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
        {needForce || repo.dirtyCount > 0 ? (
          <button className="btn danger" onClick={() => submit(true)} disabled={busy || !target}>
            Move anyway
          </button>
        ) : (
          <button className="btn primary" onClick={() => submit(false)} disabled={busy || !target}>
            Move repo
          </button>
        )}
      </div>
    </Modal>
  );
}

function CloneDialog() {
  const dialog = useShelf((s) => s.dialog)!;
  const repo = useShelf((s) => s.repos.find((r) => r.id === dialog.repoId));
  const shelves = useShelf((s) => s.shelves.filter((sh) => sh.kind === 'disk'));
  const close = useShelf((s) => s.closeDialog);
  const busy = useShelf((s) => s.busy);
  const runAction = useShelf((s) => s.runAction);
  const [target, setTarget] = useState(shelves[0]?.id ?? '');
  if (!repo) return null;
  const to = shelves.find((s) => s.id === target);
  const submit = async () => {
    try {
      await runAction(`Cloned ${repo.name} to ${to?.label}`, () => api.clone(repo.id, target));
      close();
    } catch {
      /* toast shown */
    }
  };
  return (
    <Modal title="Clone to a shelf" onClose={close}>
      <p className="modal-lead">
        Clone <b>{repo.repoSlug ?? repo.name}</b> into
      </p>
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="field" disabled={busy}>
        {shelves.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label} · {s.path}
          </option>
        ))}
      </select>
      <p className="modal-note">
        Runs <code>git clone {repo.remoteUrl}</code> into <code>{to ? `${to.path}` : '…'}</code>. Big repos take a while; the book appears on the shelf when it is done.
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={busy || !target}>
          {busy ? 'Cloning…' : 'Clone'}
        </button>
      </div>
    </Modal>
  );
}

function VisibilityDialog() {
  const dialog = useShelf((s) => s.dialog)!;
  const repo = useShelf((s) => s.repos.find((r) => r.id === dialog.repoId));
  const close = useShelf((s) => s.closeDialog);
  const busy = useShelf((s) => s.busy);
  const runAction = useShelf((s) => s.runAction);
  if (!repo || !dialog.visibility) return null;
  const vis = dialog.visibility;
  const submit = async () => {
    try {
      await runAction(`${repo.name} is now ${vis}`, () => api.setVisibility(repo.id, vis));
      close();
    } catch {
      /* toast shown */
    }
  };
  return (
    <Modal title={vis === 'private' ? 'Make private' : 'Make public'} onClose={close}>
      <p className="modal-lead">
        Make <b>{repo.repoSlug}</b> {vis}?
      </p>
      {vis === 'public' ? (
        <p className="modal-warn">Everything in this repo, including its full history, becomes visible to anyone. Check for secrets first.</p>
      ) : (
        <p className="modal-note">Stars and watchers are lost, forks are detached, and GitHub Pages stops serving. Collaborators keep access.</p>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button className={`btn ${vis === 'public' ? 'danger' : 'primary'}`} onClick={submit} disabled={busy}>
          {busy ? 'Working…' : vis === 'public' ? 'Make public' : 'Make private'}
        </button>
      </div>
    </Modal>
  );
}

function DeleteDialog() {
  const dialog = useShelf((s) => s.dialog)!;
  const repo = useShelf((s) => s.repos.find((r) => r.id === dialog.repoId));
  const close = useShelf((s) => s.closeDialog);
  const busy = useShelf((s) => s.busy);
  const runAction = useShelf((s) => s.runAction);
  const [typed, setTyped] = useState('');
  if (!repo) return null;
  const ok = typed === repo.name;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    try {
      await runAction(`Deleted ${repo.repoSlug} on GitHub`, () => api.deleteOnGitHub(repo.id, typed));
      close();
    } catch {
      /* toast shown */
    }
  };
  return (
    <Modal title="Delete repository on GitHub" onClose={close}>
      <form onSubmit={submit}>
        <p className="modal-warn">
          This permanently deletes <b>{repo.repoSlug}</b> on GitHub: code, issues, pull requests, releases, stars. There is no undo.
          {repo.github?.isFork ? ' It is a fork: any open pull requests you sent from it will be closed.' : ''}
        </p>
        <label className="lbl">Type the repository name to confirm</label>
        <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={repo.name} autoFocus disabled={busy} spellCheck={false} />
        <p className="modal-note">Needs the <code>delete_repo</code> scope: <code>gh auth refresh -h github.com -s delete_repo</code></p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn danger" disabled={!ok || busy}>
            {busy ? 'Deleting…' : 'Delete forever'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RenameDialog() {
  const dialog = useShelf((s) => s.dialog)!;
  const repo = useShelf((s) => s.repos.find((r) => r.id === dialog.repoId));
  const close = useShelf((s) => s.closeDialog);
  const busy = useShelf((s) => s.busy);
  const runAction = useShelf((s) => s.runAction);
  const githubLogin = useShelf((s) => s.githubLogin);
  const [name, setName] = useState(repo?.name ?? '');
  const [alsoGitHub, setAlsoGitHub] = useState(false);
  if (!repo) return null;
  const ok = validName(name) && name !== repo.name;
  const canGitHub = Boolean(repo.github && repo.owner && githubLogin && repo.owner.toLowerCase() === githubLogin.toLowerCase());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    try {
      await runAction(`Renamed to ${name}`, () => api.rename(repo.id, name, alsoGitHub));
      close();
    } catch {
      /* toast shown by runAction; keep dialog open */
    }
  };

  return (
    <Modal title="Rename repo" onClose={close}>
      <form onSubmit={submit}>
        <label className="lbl">New name</label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus disabled={busy} spellCheck={false} />
        <p className={`modal-note ${name && !validName(name) ? 'bad' : ''}`}>Letters, numbers, dots, dashes and underscores. Max 100 characters.</p>
        {canGitHub && (
          <label className="check">
            <input type="checkbox" checked={alsoGitHub} onChange={(e) => setAlsoGitHub(e.target.checked)} disabled={busy} />
            Also rename <b>{repo.repoSlug}</b> on GitHub and update origin
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ok || busy}>
            Rename
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MkdirDialog() {
  const dialog = useShelf((s) => s.dialog)!;
  const repo = useShelf((s) => s.repos.find((r) => r.id === dialog.repoId));
  const close = useShelf((s) => s.closeDialog);
  const busy = useShelf((s) => s.busy);
  const runAction = useShelf((s) => s.runAction);
  const [rel, setRel] = useState('');
  const [gitkeep, setGitkeep] = useState(true);
  if (!repo) return null;
  const clean = rel.trim().replace(/^[\\/]+/, '');
  const ok = clean.length > 0 && !clean.split(/[\\/]/).some((seg) => seg === '..' || seg === '.');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    try {
      await runAction(`Created ${clean}`, () => api.mkdir(repo.id, clean, gitkeep));
      close();
    } catch {
      /* keep open */
    }
  };

  return (
    <Modal title="New folder" onClose={close}>
      <form onSubmit={submit}>
        <p className="modal-lead">
          Inside <b>{repo.name}</b>
        </p>
        <label className="lbl">Folder path (relative)</label>
        <input className="field" value={rel} onChange={(e) => setRel(e.target.value)} placeholder="src/features/login" autoFocus disabled={busy} spellCheck={false} />
        <label className="check">
          <input type="checkbox" checked={gitkeep} onChange={(e) => setGitkeep(e.target.checked)} disabled={busy} />
          Add an empty <code>.gitkeep</code> so git tracks it
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ok || busy}>
            Create folder
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ShelvesDialog() {
  const shelves = useShelf((s) => s.allShelves);
  const close = useShelf((s) => s.closeDialog);
  const busy = useShelf((s) => s.busy);
  const runAction = useShelf((s) => s.runAction);
  const [label, setLabel] = useState('');
  const [path, setPath] = useState('');

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    try {
      await runAction(`Added shelf ${label || path}`, async () => ({ state: await api.addShelf(label.trim(), path.trim()) }));
      setLabel('');
      setPath('');
    } catch {
      /* keep open */
    }
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove shelf "${name}" from the bookcase? Nothing on disk changes.`)) return;
    try {
      await runAction(`Removed shelf ${name}`, async () => ({ state: await api.removeShelf(id) }));
    } catch {
      /* toast */
    }
  };

  return (
    <Modal title="Shelves" onClose={close}>
      <ul className="shelf-list">
        {shelves.map((s, i) => (
          <li key={s.id}>
            <span className="shelf-no">{String(i + 1).padStart(2, '0')}</span>
            <span className="shelf-name">
              <b>
                {s.label}
                {s.hidden && <em className="shelf-secret"> secret</em>}
              </b>
              <small>{s.kind === 'links' ? 'Links · curated remote repos' : s.path}</small>
            </span>
            <span className="shelf-count">{s.repoCount}</span>
            <button className="link" onClick={() => remove(s.id, s.label)} disabled={busy}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="shelf-add">
        <label className="lbl">Add a folder as a shelf</label>
        <div className="row">
          <input className="field" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
          <input className="field grow" placeholder="C:\Users\you\Projects" value={path} onChange={(e) => setPath(e.target.value)} disabled={busy} spellCheck={false} />
          <button type="submit" className="btn primary" disabled={!path.trim() || busy}>
            Add
          </button>
        </div>
        <p className="modal-note">
          Every immediate sub-folder containing a .git becomes a book. Order here is shelf order, top to bottom. Link shelves (curated remote repos) are edited in <code>shelf.config.json</code>.
        </p>
      </form>
    </Modal>
  );
}

function CreateRepoDialog() {
  const dialog = useShelf((s) => s.dialog)!;
  const shelves = useShelf((s) => s.shelves.filter((sh) => sh.kind === 'disk'));
  const githubAvailable = useShelf((s) => s.githubAvailable);
  const githubLogin = useShelf((s) => s.githubLogin);
  const close = useShelf((s) => s.closeDialog);
  const busy = useShelf((s) => s.busy);
  const runAction = useShelf((s) => s.runAction);
  const toast = useShelf((s) => s.toast);
  const [shelf, setShelf] = useState(dialog.shelfId ?? shelves[0]?.id ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [github, setGithub] = useState<'none' | 'private' | 'public'>(githubAvailable ? 'private' : 'none');
  const ok = validName(name) && Boolean(shelf);
  const to = shelves.find((s) => s.id === shelf);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    try {
      await runAction(`Created ${name}`, async () => {
        const r = await api.create(shelf, name, description, github === 'none' ? null : github);
        if (r.warning) toast('error', r.warning);
        return r;
      });
      close();
    } catch {
      /* toast shown */
    }
  };

  return (
    <Modal title="New repo" onClose={close}>
      <form onSubmit={submit}>
        <label className="lbl">Shelf</label>
        <select value={shelf} onChange={(e) => setShelf(e.target.value)} className="field" disabled={busy}>
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.path}
            </option>
          ))}
        </select>
        <label className="lbl" style={{ marginTop: 12 }}>
          Name
        </label>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-next-thing" autoFocus disabled={busy} spellCheck={false} />
        <p className={`modal-note ${name && !validName(name) ? 'bad' : ''}`}>Letters, numbers, dots, dashes and underscores.</p>
        <label className="lbl" style={{ marginTop: 12 }}>
          Description (optional)
        </label>
        <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it for?" disabled={busy} />
        <label className="lbl" style={{ marginTop: 12 }}>
          GitHub
        </label>
        <div className="radio-row">
          <label className="check">
            <input type="radio" name="gh" checked={github === 'none'} onChange={() => setGithub('none')} disabled={busy} /> Local only
          </label>
          <label className="check" title={githubAvailable ? '' : 'Run gh auth login first'}>
            <input type="radio" name="gh" checked={github === 'private'} onChange={() => setGithub('private')} disabled={busy || !githubAvailable} /> Private on GitHub
          </label>
          <label className="check" title={githubAvailable ? '' : 'Run gh auth login first'}>
            <input type="radio" name="gh" checked={github === 'public'} onChange={() => setGithub('public')} disabled={busy || !githubAvailable} /> Public on GitHub
          </label>
        </div>
        <p className="modal-note">
          Runs <code>git init</code> in <code>{to ? `${to.path}` : '…'}</code> with a README and an initial commit
          {github !== 'none' && githubLogin ? (
            <>
              , then <code>gh repo create {githubLogin}/{name || '…'} --{github} --push</code>
            </>
          ) : null}
          .
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ok || busy}>
            {busy ? 'Creating…' : 'Create repo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PublishDialog() {
  const close = useShelf((s) => s.closeDialog);
  const busy = useShelf((s) => s.busy);
  const runAction = useShelf((s) => s.runAction);
  const githubAvailable = useShelf((s) => s.githubAvailable);
  const githubLogin = useShelf((s) => s.githubLogin);
  const repos = useShelf((s) => s.repos);
  const toast = useShelf((s) => s.toast);
  const [name, setName] = useState('my-repo-shelf');
  const [includePages, setIncludePages] = useState(true);
  const [done, setDone] = useState<{ pagesUrl: string; repoUrl: string; repos: number; created: boolean } | null>(null);
  const publicCount = repos.filter((r) => r.visibility === 'public' && !r.archived && (r.virtual || r.repoSlug)).length + repos.filter((r) => r.virtual && !r.repoSlug).length;
  const ok = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) && githubAvailable && publicCount > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    try {
      await runAction('Published your shelf', async () => {
        const r = await api.publish(name, includePages);
        setDone(r);
        return {};
      });
    } catch {
      /* toast */
    }
  };
  const exportOnly = async () => {
    try {
      await runAction('Exported the site folder', async () => {
        const r = await api.exportSite(includePages);
        toast('info', `${r.repos} repos → ${r.dir}`);
        return {};
      });
    } catch {
      /* toast */
    }
  };

  return (
    <Modal title="Publish my shelf" onClose={close}>
      {done ? (
        <div>
          <p className="modal-lead">
            Your shelf is live{done.created ? '' : ' (updated)'}. GitHub Pages takes a minute the first time.
          </p>
          <p>
            <a className="btn primary" href={done.pagesUrl} target="_blank" rel="noopener">
              {done.pagesUrl}
            </a>
          </p>
          <p className="modal-note">
            {done.repos} public repos. Source repo: <a href={done.repoUrl} target="_blank" rel="noopener">{done.repoUrl}</a>. Re-publish any time to refresh it; the same link stays.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(done.pagesUrl).then(() => toast('info', 'Link copied'))}>
              Copy link
            </button>
            <button className="btn primary" onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <p className="modal-lead">
            Turn your <b>{publicCount}</b> public repos into a 3D library site anyone can browse. Private repos, local-only repos, hidden shelves and file paths never leave this machine.
          </p>
          <label className="lbl">Repository name on GitHub</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} spellCheck={false} />
          <p className="modal-note">
            Creates (or updates) <code>{githubLogin ?? 'you'}/{name || '…'}</code> as a public repo with GitHub Pages on. Your link: <code>https://{(githubLogin ?? 'you').toLowerCase()}.github.io/{name || '…'}/</code>
          </p>
          <label className="check">
            <input type="checkbox" checked={includePages} onChange={(e) => setIncludePages(e.target.checked)} disabled={busy} /> Include README, commits and files for each book (slower, richer)
          </label>
          {!githubAvailable && <p className="modal-warn">GitHub CLI is not signed in. Run <code>gh auth login</code>, or export the folder and host it yourself.</p>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={exportOnly} disabled={busy || publicCount === 0}>
              Export folder only
            </button>
            <button type="submit" className="btn primary" disabled={!ok || busy}>
              {busy ? 'Publishing…' : 'Publish to GitHub Pages'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function Dialogs() {
  const kind = useShelf((s) => s.dialog?.kind ?? null);
  if (kind === 'move') return <MoveDialog />;
  if (kind === 'rename') return <RenameDialog />;
  if (kind === 'mkdir') return <MkdirDialog />;
  if (kind === 'shelves') return <ShelvesDialog />;
  if (kind === 'clone') return <CloneDialog />;
  if (kind === 'create') return <CreateRepoDialog />;
  if (kind === 'publish') return <PublishDialog />;
  if (kind === 'visibility') return <VisibilityDialog />;
  if (kind === 'delete') return <DeleteDialog />;
  return null;
}
