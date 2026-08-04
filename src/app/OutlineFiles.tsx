import { useEffect, useState } from 'react';
import type { OutlineFile } from '../domain/types';

export function OutlineFiles({ files, busy, onCreate, onSave, onDelete }: { files: OutlineFile[]; busy: boolean; onCreate: (title: string) => void; onSave: (file: OutlineFile, input: { title: string; markdown: string }) => void; onDelete: (file: OutlineFile) => void }) {
  const [activeId, setActiveId] = useState<string>();
  const active = files.find((file) => file.id === activeId) ?? files[0];
  const [markdown, setMarkdown] = useState(active?.markdown ?? '');
  const [title, setTitle] = useState(active?.title ?? '');
  useEffect(() => { setMarkdown(active?.markdown ?? ''); setTitle(active?.title ?? ''); }, [active?.id, active?.markdown, active?.title]);
  const create = () => { const title = window.prompt('Outline file name'); if (title?.trim()) onCreate(title.trim()); };
  return <section className="outline-files" aria-label="Outline files">
    <header><div><p className="eyebrow">OUTLINE FILES</p><h2>Planning notes</h2></div><button type="button" className="secondary-button" disabled={busy} onClick={create}>New file</button></header>
    <div className="outline-files-grid"><nav aria-label="Outline files">{files.map((file) => <button type="button" key={file.id} className={active?.id === file.id ? 'selected' : ''} onClick={() => setActiveId(file.id)}>{file.title}</button>)}{!files.length && <p>No outline files yet.</p>}</nav>
      {active && <div className="outline-file-editor"><label>Title<input aria-label="Outline file title" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Markdown<textarea aria-label={`${active.title} Markdown`} value={markdown} onChange={(event) => setMarkdown(event.target.value)} /></label><div><button type="button" className="text-button" disabled={busy} onClick={() => onDelete(active)}>Delete</button><button type="button" className="primary-button" disabled={busy || !title.trim() || (markdown === active.markdown && title === active.title)} onClick={() => onSave(active, { title: title.trim(), markdown })}>Save outline</button></div></div>}
    </div>
  </section>;
}
