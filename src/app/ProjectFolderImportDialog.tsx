export function ProjectFolderImportDialog({ busy, onCancel, onChoose }: { busy: boolean; onCancel: () => void; onChoose: () => void; trigger?: HTMLElement | null }) {
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby="project-folder-import-title" aria-describedby="project-folder-import-description">
    <div className="modal-heading"><p className="eyebrow">PROJECT FOLDER IMPORT</p><h2 id="project-folder-import-title">Import a local project folder</h2></div>
    <div className="modal-content"><p id="project-folder-import-description">Choose a new local folder containing exactly these three top-level folders. Weave validates everything before creating local project data.</p>
      <ul className="project-folder-import-folders" aria-label="Required project folders"><li><strong>manuscript</strong><span>Markdown becomes structured chapter scenes.</span></li><li><strong>outline</strong><span>Markdown remains editable Outline files.</span></li><li><strong>worldbuilding</strong><span>Folders and Markdown notes are preserved.</span></li></ul><p className="modal-help">Only regular UTF-8 .md files are read. The original folder is never modified.</p>
    </div><div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={onChoose}>Choose folder…</button></div>
  </section></div>;
}
