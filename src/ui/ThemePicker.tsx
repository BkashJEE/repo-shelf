import { useEffect, useRef, useState } from 'react';
import { useShelf, CASE_STYLES } from '../store';
import { THEMES, themeById } from '../themes';

export function ThemePicker() {
  const themeId = useShelf((s) => s.themeId);
  const setTheme = useShelf((s) => s.setTheme);
  const caseStyle = useShelf((s) => s.caseStyle);
  const setCaseStyle = useShelf((s) => s.setCaseStyle);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = themeById(themeId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={ref}>
      <button className="theme-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title="Color theme">
        <span className="swatch" style={{ background: `linear-gradient(135deg, ${current.ui.page} 50%, ${current.scene.plank} 50%)` }} />
        {current.name}
      </button>
      {open && (
        <div className="theme-menu" role="listbox" aria-label="Color theme">
          <div className="theme-section">Colors</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="option"
              aria-selected={t.id === themeId}
              className={`theme-opt ${t.id === themeId ? 'on' : ''}`}
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
            >
              <span className="theme-preview" style={{ background: t.ui.page, borderColor: t.ui.line }}>
                <i style={{ background: t.scene.plank }} />
                <i style={{ background: t.scene.back[1] }} />
                <i style={{ background: t.ui.accent }} />
              </span>
              <span className="theme-text">
                <b>{t.name}</b>
                <small>{t.description}</small>
              </span>
            </button>
          ))}
          <div className="theme-section">Bookcase</div>
          <div className="case-row">
            {CASE_STYLES.map((c) => (
              <button key={c.id} className={`case-opt ${caseStyle === c.id ? 'on' : ''}`} onClick={() => setCaseStyle(c.id)} title={c.description}>
                <span className={`case-icon case-${c.id}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
