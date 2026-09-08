/** Minimize / maximize / close for the frameless desktop window. Renders nothing in a browser. */
export function WindowControls() {
  const d = window.desktop;
  if (!d) return null;
  const mac = d.platform === 'darwin';
  if (mac) return null; // macOS shows its own traffic lights with titleBarStyle hiddenInset
  return (
    <div className="winctl" aria-label="Window controls">
      <button onClick={() => d.minimize()} aria-label="Minimize" title="Minimize">
        &#x2013;
      </button>
      <button onClick={() => d.maximize()} aria-label="Maximize" title="Maximize">
        &#x25A1;
      </button>
      <button className="close" onClick={() => d.close()} aria-label="Close to the door" title="Back to the library door">
        &#x2715;
      </button>
    </div>
  );
}
