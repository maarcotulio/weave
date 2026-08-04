import { useEffect, useRef } from 'react';

export function ImportChoiceDialog({ busy, folderAvailable, onCancel, onChooseFolder, onChooseMarkdown, trigger }: { busy: boolean; folderAvailable: boolean; onCancel: () => void; onChooseFolder: () => void; onChooseMarkdown: () => void; trigger?: HTMLElement | null }) {
  const dialogRef = useRef<HTMLElement>(null);
  const folderRef = useRef<HTMLButtonElement>(null);
  const markdownRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const controls = () => [folderAvailable ? folderRef.current : undefined, markdownRef.current, cancelRef.current].filter((control): control is HTMLButtonElement => Boolean(control) && !control!.disabled);

  useEffect(() => () => { if (trigger?.isConnected) trigger.focus(); }, [trigger]);
  useEffect(() => {
    if (busy) dialogRef.current?.focus();
    else controls()[0]?.focus();
  }, [busy, folderAvailable]);

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}><section ref={dialogRef} className="modal import-choice-dialog" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby="import-choice-title" aria-describedby="import-choice-description" tabIndex={busy ? 0 : -1} onKeyDown={(event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    if (busy) { event.preventDefault(); dialogRef.current?.focus(); return; }
    const focusable = controls();
    const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
    if (focusable.length && ((event.shiftKey && current === 0) || (!event.shiftKey && current === focusable.length - 1))) {
      event.preventDefault();
      focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
    }
  }}>
    <div className="modal-heading"><p className="eyebrow">IMPORT</p><h2 id="import-choice-title">What would you like to import?</h2></div>
    <div className="modal-content"><p id="import-choice-description">Choose the source first. Weave keeps every import local and shows the existing destination choices before any content is saved.</p>{busy && <p className="modal-help" role="status" aria-live="polite">Preparing import options…</p>}<div className="import-choice-grid"><button ref={folderRef} type="button" disabled={busy || !folderAvailable} title={folderAvailable ? undefined : 'Available in the desktop app only'} onClick={onChooseFolder}><strong>Project folder</strong><span>Bring in a folder with <code>manuscript</code>, <code>outline</code>, and <code>worldbuilding</code>{!folderAvailable && ' (desktop app only)'}.</span></button><button ref={markdownRef} type="button" disabled={busy} onClick={onChooseMarkdown}><strong>Markdown file</strong><span>Import one Markdown document into the selected manuscript destination.</span></button></div></div>
    <div className="modal-actions"><button ref={cancelRef} type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </section></div>;
}
