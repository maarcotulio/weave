import { useEffect, useRef } from 'react';

export function ProjectFolderImportDialog({ busy, error, onCancel, onChoose, trigger }: { busy: boolean; error?: string; onCancel: () => void; onChoose: () => void; trigger?: HTMLElement | null }) {
  const chooseRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { chooseRef.current?.focus(); return () => { if (trigger?.isConnected) trigger.focus(); }; }, [trigger]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}><section className="modal" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby="project-folder-import-title" aria-describedby="project-folder-import-description" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); } if (event.key === 'Tab') { const first = cancelRef.current; const last = chooseRef.current; if (!first || !last) return; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }}>
    <div className="modal-heading"><p className="eyebrow">PROJECT FOLDER IMPORT</p><h2 id="project-folder-import-title">Import a local project folder</h2></div>
    <div className="modal-content"><p id="project-folder-import-description">Choose a local folder containing exactly these three top-level folders. Weave validates everything before creating its local <code>.weave</code> project store.</p>
      <ul className="project-folder-import-folders" aria-label="Required project folders"><li><strong>manuscript</strong><span>Markdown becomes structured chapter scenes.</span></li><li><strong>outline</strong><span>Markdown remains editable Outline files.</span></li><li><strong>worldbuilding</strong><span>Folders and Markdown notes are preserved.</span></li></ul><p className="modal-help">Only regular UTF-8 .md files are read. Original Markdown files are never modified.</p>{error && <p className="error-message" role="alert">{error}</p>}
    </div><div className="modal-actions"><button ref={cancelRef} type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button ref={chooseRef} type="button" className="primary-button" disabled={busy} onClick={onChoose}>Choose folder…</button></div>
  </section></div>;
}
