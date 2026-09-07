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

export function Dialogs() {
  const kind = useShelf((s) => s.dialog?.kind ?? null);
  if (kind === 'move') return <MoveDialog />;
  if (kind === 'rename') return <RenameDialog />;
  if (kind === 'mkdir') return <MkdirDialog />;
  if (kind === 'shelves') return <ShelvesDialog />;
  if (kind === 'clone') return <CloneDialog />;
  return null;
}
