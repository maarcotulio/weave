import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { AutosaveController, type AutosaveStatus } from '../domain/autosave';
import { blockText, documentFromText, replaceBlockText, toggleMarks } from '../domain/document';
import { DEFAULT_EDITOR_STYLE, FONT_FAMILY_OPTIONS, FONT_SIZE_OPTIONS, LINE_SPACING_OPTIONS, PAGE_SIZE_OPTIONS, type CanvasEngine, type Chapter, type ContinuousDraft, type EditorStyleProfile, type ExportFormat, type MarkdownNote, type ProjectSnapshot, type Scene, type SemanticMark, type StructuredDocument, type WritingStats } from '../domain/types';
import { canonicalOffsetToPage, mergePaginatedDocument, pageDimensions, pageOffsetToCanonical, paginateDocumentWithSources, type PaginatedBlock, type PaginatedPage } from '../domain/pagination';
import { InMemoryProjectRepository, type DocumentHead, type ProjectRepository } from '../domain/repository';
import { exportCapturedRevision } from '../export/editorial';
import { TauriProjectRepository } from '../infrastructure/tauri-repository';
import { WorldbuildingWorkspace, type WorldbuildingTab, worldbuildingTabKey } from './Worldbuilding';
import { applyTheme, persistTheme, readStoredTheme, toggleTheme, type Theme } from './theme';

const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const formats: ExportFormat[] = ['pdf', 'docx', 'markdown', 'text'];
const lineHeight: Record<EditorStyleProfile['lineSpacing'], number> = { single: 1, '1.15': 1.15, '1.5': 1.5, double: 2 };
type NoteActionState =
  | { kind: 'rename'; noteId: string; title: string }
  | { kind: 'delete'; noteId: string; title: string; phase: 'confirm' | 'references'; referenceMessage?: string };

function initialDocument(): StructuredDocument { return documentFromText(''); }

function StatusBar({ status }: { status: AutosaveStatus }) {
  return <div className={`status status-${status.state}`} role="status"><span className="status-dot" />{status.message}</div>;
}

function ThemeControl({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const nextTheme = toggleTheme(theme);
  return <button type="button" className="theme-toggle" aria-label={`Switch to ${nextTheme} theme`} aria-pressed={theme === 'dark'} title={`Theme: ${theme}. Switch to ${nextTheme} theme`} onClick={onToggle}>
    <span aria-hidden="true">{theme === 'dark' ? '☀' : '◐'}</span><span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
  </button>;
}

function StyleControls({ profile, onChange, disabled }: { profile: EditorStyleProfile; onChange: (profile: EditorStyleProfile) => void; disabled?: boolean }) {
  return <div className="style-controls" aria-label="Writing style controls">
    <label>Font<select aria-label="Font family" value={profile.fontFamily} disabled={disabled} onChange={(event) => onChange({ ...profile, fontFamily: event.target.value })}>{FONT_FAMILY_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}</select></label>
    <label>Size<select aria-label="Font size" value={profile.fontSizePt} disabled={disabled} onChange={(event) => onChange({ ...profile, fontSizePt: Number(event.target.value) })}>{FONT_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} pt</option>)}</select></label>
    <label>Spacing<select aria-label="Line spacing" value={profile.lineSpacing} disabled={disabled} onChange={(event) => onChange({ ...profile, lineSpacing: event.target.value as EditorStyleProfile['lineSpacing'] })}>{LINE_SPACING_OPTIONS.map((spacing) => <option key={spacing} value={spacing}>{spacing === '1.15' ? '1.15' : spacing === '1.5' ? '1.5' : spacing[0].toUpperCase() + spacing.slice(1)}</option>)}</select></label>
    <label>Page<select aria-label="Page size" value={profile.pageSize ?? 'letter'} disabled={disabled} onChange={(event) => onChange({ ...profile, pageSize: event.target.value as NonNullable<EditorStyleProfile['pageSize']> })}>{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size === 'a4' ? 'A4' : size === 'legal' ? 'US Legal' : 'US Letter'}</option>)}</select></label>
  </div>;
}

type SelectionDirection = 'forward' | 'backward' | 'none';
interface SelectionInfo { start: number; end: number; direction: SelectionDirection; focused: boolean; }
interface CanonicalSelection { sourceBlockId: string; start: number; end: number; startAffinity: 'forward' | 'backward'; endAffinity: 'forward' | 'backward'; direction: SelectionDirection; }

function AutoSizeTextArea({ value, onChange, onSelectionChange, readOnly, className, ariaLabel, pageBlockId, sourceBlockId }: { value: string; onChange: (value: string, selection: SelectionInfo) => void; onSelectionChange?: (selection: SelectionInfo) => void; readOnly: boolean; className: string; ariaLabel?: string; pageBlockId: string; sourceBlockId: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const reportSelection = (focused: boolean) => {
    const element = ref.current;
    if (!element) return;
    onSelectionChange?.({ start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, focused });
  };
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} data-page-block-id={pageBlockId} data-source-block-id={sourceBlockId} className={className} aria-label={ariaLabel} value={value} readOnly={readOnly} rows={1} onChange={(event) => { const element = event.currentTarget; onChange(element.value, { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, focused: true }); }} onSelect={() => reportSelection(true)} onKeyUp={() => reportSelection(true)} onMouseUp={() => reportSelection(true)} onBlur={() => reportSelection(false)} />;
}

function GoalPanel({ stats, onSaveTarget }: { stats: WritingStats; onSaveTarget: (target: number) => void }) {
  const [target, setTarget] = useState(String(stats.dailyTarget));
  useEffect(() => setTarget(String(stats.dailyTarget)), [stats.dailyTarget]);
  const progress = stats.dailyTarget > 0 ? Math.min(100, Math.round((stats.dailyWords / stats.dailyTarget) * 100)) : 0;
  return <section className="goal-panel" aria-label="Writing goals">
    <div className="goal-stat"><span className="goal-label">TODAY · {stats.date}</span><strong>{stats.dailyWords.toLocaleString()} <small>/ {stats.dailyTarget.toLocaleString()} words</small></strong><div className="goal-track"><span style={{ width: `${progress}%` }} /></div></div>
    <div className="goal-stat project-total"><span className="goal-label">PROJECT TOTAL</span><strong>{stats.projectWords.toLocaleString()} <small>words</small></strong></div>
    <label className="goal-editor">Daily target<input type="number" min="0" step="1" value={target} onChange={(event) => setTarget(event.target.value)} onBlur={() => onSaveTarget(Math.max(0, Number(target) || 0))} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } }} /></label>
  </section>;
}

function Editor({ document, styleProfile, onChange, onSelectionChange, readOnly = false }: { document: StructuredDocument; styleProfile: EditorStyleProfile; onChange: (value: StructuredDocument) => void; onSelectionChange?: (block: StructuredDocument['blocks'][number], selection: SelectionInfo) => void; readOnly?: boolean }) {
  const updateBlock = (index: number, value: StructuredDocument['blocks'][number], selection?: SelectionInfo) => {
    const blocks = document.blocks.map((block, blockIndex) => blockIndex === index ? value : block);
    onChange({ ...document, blocks });
    if (selection) onSelectionChange?.(value, selection);
  };
  const style = { '--editor-font-family': styleProfile.fontFamily, '--editor-font-size': `${styleProfile.fontSizePt}pt`, '--editor-line-height': lineHeight[styleProfile.lineSpacing] } as React.CSSProperties;
  return <div className="editor" style={style} aria-label={readOnly ? 'Composed chapter' : 'Manuscript editor'}>
    {document.blocks.map((block, index) => block.kind === 'scene-break' ?
      <div className="scene-break" key={block.id}><span>scene break · composed view</span></div> :
      <div className="block" key={block.id}>
        <div className="block-tools">
          <select aria-label="Block style" value={block.kind === 'heading' ? `heading-${block.headingLevel ?? 1}` : 'paragraph'} disabled={readOnly} onChange={(event) => {
            const value = event.target.value;
            updateBlock(index, { ...block, kind: value === 'paragraph' ? 'paragraph' : 'heading', headingLevel: value === 'paragraph' ? undefined : Number(value.split('-')[1]) as 1 | 2 | 3 });
          }}>
            <option value="paragraph">Paragraph</option><option value="heading-1">Heading 1</option><option value="heading-2">Heading 2</option><option value="heading-3">Heading 3</option>
          </select>
          {(['bold', 'italic', 'underline'] as SemanticMark[]).map((mark) => <button type="button" key={mark} className="format-button" disabled={readOnly} onClick={() => updateBlock(index, toggleMarks(block, [mark]))} aria-label={`Toggle ${mark}`}><strong className={mark === 'italic' ? 'italic' : mark === 'underline' ? 'underline' : ''}>{mark[0].toUpperCase()}</strong></button>)}
        </div>
        <AutoSizeTextArea className={block.kind === 'heading' ? 'manuscript-input heading-input' : 'manuscript-input'} value={blockText(block)} readOnly={readOnly} onChange={(value, selection) => updateBlock(index, replaceBlockText(block, value), selection)} onSelectionChange={(selection) => onSelectionChange?.(block, selection)} ariaLabel={`Block ${index + 1}`} pageBlockId={block.id} sourceBlockId={(block as PaginatedBlock).pagination?.sourceBlockId ?? block.id} />
        <div className="format-hint">{block.runs.some((run) => run.marks.length > 0) ? block.runs.flatMap((run) => run.marks).join(' · ') : 'semantic paragraph'}</div>
      </div>)}
    {document.blocks.length === 0 && <p className="empty-editor">Start writing…</p>}
  </div>;
}

interface ModalProps { eyebrow?: string; title: string; onClose?: () => void; children: React.ReactNode; footer?: React.ReactNode; }

function Modal({ eyebrow, title, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    if (!onClose) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div className="modal-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id="modal-title">{title}</h2>{onClose && <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClose}>×</button>}</div>
    <div className="modal-content">{children}</div>
    {footer && <div className="modal-actions">{footer}</div>}
  </div></div>;
}

interface FormDialogConfig { eyebrow: string; title: string; fields: Array<{ key: string; label: string; value: string; placeholder?: string; type?: 'text' | 'number' }>; onSubmit: (values: Record<string, string>) => Promise<void>; }

function FormDialog({ config, busy, onCancel, onSubmit }: { config: FormDialogConfig; busy: boolean; onCancel: () => void; onSubmit: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(config.fields.map((field) => [field.key, field.value])));
  return <Modal eyebrow={config.eyebrow} title={config.title} onClose={onCancel}>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
      {config.fields.map((field) => <label className="modal-field" key={field.key}>{field.label}<input autoFocus={field.key === config.fields[0]?.key} type={field.type ?? 'text'} value={values[field.key] ?? ''} placeholder={field.placeholder} required onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}
      <div className="modal-actions"><button type="button" className="text-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>Continue</button></div>
    </form>
  </Modal>;
}

function ChoiceDialog({ onSplit, onKeep, onCancel, busy }: { onSplit: () => void; onKeep: () => void; onCancel: () => void; busy: boolean }) {
  return <Modal eyebrow="RETURN TO SCENES" title="What should happen to this continuous draft?" onClose={onCancel}>
    <p>Weave never guesses scene boundaries. Choose an explicit-marker split or keep this revision separate and recoverable.</p>
    <div className="choice-grid"><button type="button" onClick={onSplit} disabled={busy}><strong>Split automatically</strong><span>Use only paragraphs containing <code>***</code> or <code>Nova cena</code>. The old scene set stays preserved.</span></button><button type="button" onClick={onKeep} disabled={busy}><strong>Keep separate</strong><span>Leave the continuous draft and every scene document intact.</span></button></div>
    <button type="button" className="text-button" onClick={onCancel}>Cancel</button>
  </Modal>;
}

function CanvasChoiceDialog({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (title: string, engine: CanvasEngine) => void }) {
  const [title, setTitle] = useState('Untitled canvas');
  const [engine, setEngine] = useState<CanvasEngine>('react-flow');
  return <Modal eyebrow="NEW CANVAS" title="Choose a canvas engine" onClose={onCancel}>
    <form onSubmit={(event) => { event.preventDefault(); if (title.trim()) onSubmit(title.trim(), engine); }}>
      <label className="modal-field">Canvas title<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <fieldset className="canvas-engine-choices"><legend>Canvas engine</legend><label className={engine === 'react-flow' ? 'selected' : ''}><input type="radio" name="canvas-engine" value="react-flow" checked={engine === 'react-flow'} onChange={() => setEngine('react-flow')} /><span><strong>React Flow</strong><small>Structured Markdown-note nodes, resolved wiki-link edges, and saved layout.</small></span></label><label className={engine === 'excalidraw' ? 'selected' : ''}><input type="radio" name="canvas-engine" value="excalidraw" checked={engine === 'excalidraw'} onChange={() => setEngine('excalidraw')} /><span><strong>Excalidraw</strong><small>Freeform local drawing with scene elements and files saved in this project.</small></span></label></fieldset>
      <p className="modal-help">You can cancel with Escape or the Cancel button. The choice is stored with this canvas and cannot change its engine later.</p>
      <div className="modal-actions"><button type="button" className="text-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !title.trim()}>Create canvas</button></div>
    </form>
  </Modal>;
}

function NoteRenameDialog({ initialTitle, busy, onCancel, onSubmit }: { initialTitle: string; busy: boolean; onCancel: () => void; onSubmit: (title: string) => void }) {
  const [value, setValue] = useState(initialTitle);
  useEffect(() => setValue(initialTitle), [initialTitle]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); } };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onCancel]);
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby="rename-note-dialog-title" aria-describedby="rename-note-dialog-description">
    <div className="modal-heading"><p className="eyebrow">NOTE</p><h2 id="rename-note-dialog-title">Rename note</h2><button type="button" className="modal-close" aria-label="Close dialog" disabled={busy} onClick={onCancel}>×</button></div>
    <p id="rename-note-dialog-description">Choose a new title for “{initialTitle}”. Cancel or Escape leaves the note unchanged.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
      <label className="modal-field">Note name<input autoFocus required value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !value.trim()}>Rename note</button></div>
    </form>
  </div></div>;
}

function NoteDeleteDialog({ title, phase, referenceMessage, busy, onCancel, onConfirm }: { title: string; phase: 'confirm' | 'references'; referenceMessage?: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const references = phase === 'references';
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); } };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [busy, onCancel]);
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby="delete-note-dialog-title" aria-describedby="delete-note-dialog-description">
    <div className="modal-heading"><p className="eyebrow">NOTE</p><h2 id="delete-note-dialog-title">{references ? 'References found' : 'Delete note'}</h2><button type="button" className="modal-close" aria-label="Close dialog" disabled={busy} onClick={onCancel}>×</button></div>
    {references ? <><p id="delete-note-dialog-description"><strong>We could not delete “{title}” because it is still referenced.</strong> Deleting it with remove-references will remove its canvas placements and leave incoming Markdown links unresolved for repair. This cannot be undone.</p>{referenceMessage && <p className="modal-help">{referenceMessage}</p>}</> : <p id="delete-note-dialog-description">Are you sure you want to delete “{title}”? This permanently removes the note and its canvas placements. Cancel or Escape leaves the note unchanged.</p>}
    <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>{references ? 'Delete and remove references' : 'Delete note'}</button></div>
  </div></div>;
}

export default function App() {
  const repository = useMemo<ProjectRepository>(() => isDesktop ? new TauriProjectRepository() : new InMemoryProjectRepository(), []);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>();
  const [selectedStoryId, setSelectedStoryId] = useState<string>();
  const [selectedChapterId, setSelectedChapterId] = useState<string>();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>();
  const [documentHead, setDocumentHead] = useState<DocumentHead>();
  const [draft, setDraft] = useState<ContinuousDraft>();
  const [mode, setMode] = useState<'scene' | 'continuous' | 'compose'>('scene');
  const [workspaceMode, setWorkspaceMode] = useState<'writing' | 'worldbuilding'>('writing');
  const [worldbuildingTabs, setWorldbuildingTabs] = useState<WorldbuildingTab[]>([]);
  const [activeWorldbuildingTabKey, setActiveWorldbuildingTabKey] = useState<string>();
  const [editorDocument, setEditorDocument] = useState<StructuredDocument>(initialDocument());
  const [styleProfile, setStyleProfile] = useState<EditorStyleProfile>({ ...DEFAULT_EDITOR_STYLE });
  const [showReturnChoices, setShowReturnChoices] = useState(false);
  const [formDialog, setFormDialog] = useState<FormDialogConfig>();
  const [canvasDialog, setCanvasDialog] = useState<{ storyId: string }>();
  const [noteAction, setNoteAction] = useState<NoteActionState>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>({ state: 'saved', message: 'All changes saved' });
  const [pageContentWidth, setPageContentWidth] = useState<number>();
  const documentHeadRef = useRef<DocumentHead>();
  const editorDocumentRef = useRef(editorDocument);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const canonicalSelectionRef = useRef<CanonicalSelection>();
  const restoreFocusRef = useRef(false);
  const noteFlushRef = useRef<{ noteId: string; flush: () => Promise<boolean> }>();
  documentHeadRef.current = documentHead;
  editorDocumentRef.current = editorDocument;

  useLayoutEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  const autosave = useMemo(() => new AutosaveController(() => latestSaveRef.current(), {
    delayMs: 700,
    onStatus: (status) => { setAutosaveStatus(status); if (status.state !== 'error') setLocalError(''); }
  }), []);

  const refresh = useCallback(async (keepSelection = true) => {
    const next = await repository.snapshot();
    setSnapshot(next);
    setStyleProfile(next.styleProfile);
    const storyId = keepSelection ? (selectedStoryId && next.stories.some((item) => item.id === selectedStoryId) ? selectedStoryId : next.stories[0]?.id) : next.stories[0]?.id;
    const chapterList = next.chapters.filter((item) => item.storyId === storyId);
    const chapterId = keepSelection ? (selectedChapterId && chapterList.some((item) => item.id === selectedChapterId) ? selectedChapterId : chapterList[0]?.id) : chapterList[0]?.id;
    setSelectedStoryId(storyId); setSelectedChapterId(chapterId);
    if (chapterId) {
      const nextScenes = await repository.listScenes(chapterId);
      setScenes(nextScenes);
      if (!selectedSceneId || !nextScenes.some((item) => item.id === selectedSceneId)) setSelectedSceneId(nextScenes[0]?.id);
    }
  }, [repository, selectedChapterId, selectedSceneId, selectedStoryId]);

  useEffect(() => { if (snapshot) void refresh(); }, []); // desktop starts at the project chooser
  useEffect(() => { if (!snapshot) return; setWorldbuildingTabs((current) => current.filter((tab) => tab.kind === 'note' ? snapshot.markdownNotes.some((note) => note.id === tab.id) : snapshot.canvases.some((canvas) => canvas.id === tab.id))); }, [snapshot]);
  useEffect(() => { setActiveWorldbuildingTabKey((active) => worldbuildingTabs.some((tab) => worldbuildingTabKey(tab) === active) ? active : worldbuildingTabs[0] ? worldbuildingTabKey(worldbuildingTabs[0]) : undefined); }, [worldbuildingTabs]);
  useEffect(() => {
    if (!selectedChapterId) return;
    void repository.listScenes(selectedChapterId).then((nextScenes) => {
      setScenes(nextScenes);
      if (!selectedSceneId || !nextScenes.some((scene) => scene.id === selectedSceneId)) setSelectedSceneId(nextScenes[0]?.id);
    }).catch(() => undefined);
  }, [repository, selectedChapterId]);
  useEffect(() => {
    if (!selectedSceneId || mode !== 'scene') return;
    void repository.getDocument(scenes.find((scene) => scene.id === selectedSceneId)?.documentId ?? '').then((head) => {
      setDocumentHead(head); documentHeadRef.current = head; setEditorDocument(head.document); editorDocumentRef.current = head.document;
    }).catch(() => undefined);
  }, [mode, repository, scenes, selectedSceneId]);
  useLayoutEffect(() => {
    const element = pageStackRef.current;
    if (!element) return;
    const updateWidth = () => setPageContentWidth(element.clientWidth);
    updateWidth();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [snapshot, sidebarCollapsed]);
  useEffect(() => {
    const flush = () => { void autosave.flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => { window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', flush); };
  }, [autosave]);

  const run = async (operation: () => Promise<void>) => { setBusy(true); setLocalError(''); try { await operation(); } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const registerNoteFlush = useCallback((noteId: string, flush?: () => Promise<boolean>) => {
    if (flush) noteFlushRef.current = { noteId, flush };
    else if (noteFlushRef.current?.noteId === noteId) noteFlushRef.current = undefined;
  }, []);
  const flushNoteBeforeAction = async (noteId: string) => {
    const registered = noteFlushRef.current;
    if (!registered || registered.noteId !== noteId) return true;
    return registered.flush();
  };
  const latestMarkdownNote = async (noteId: string): Promise<MarkdownNote | undefined> => (await repository.listMarkdownNotes()).find((note) => note.id === noteId);
  const submitFormDialog = (values: Record<string, string>) => void run(async () => { const config = formDialog; if (!config) return; await config.onSubmit(values); setFormDialog(undefined); });

  const saveCurrentDocument = useCallback(async () => {
    const head = documentHeadRef.current;
    if (!head || mode === 'compose') return;
    const result = await repository.saveDocument(head.documentId, editorDocumentRef.current, head.revision);
    const nextHead = { documentId: head.documentId, document: result.revision.document, revision: result.revision.number, revisionId: result.revision.id };
    documentHeadRef.current = nextHead;
    editorDocumentRef.current = result.revision.document;
    setDocumentHead(nextHead); setEditorDocument(result.revision.document);
    const writingStats = await repository.getWritingStats();
    setSnapshot((current) => current ? { ...current, writingStats, status: result.status } : current);
  }, [mode, repository]);
  latestSaveRef.current = saveCurrentDocument;
  const pages = useMemo<PaginatedPage[]>(() => paginateDocumentWithSources(editorDocument, styleProfile, pageContentWidth), [editorDocument, styleProfile, pageContentWidth]);
  const rememberSelection = (block: StructuredDocument['blocks'][number], selection: SelectionInfo) => {
    const paginated = block as PaginatedBlock;
    const metadata = paginated.pagination;
    const sourceBlockId = metadata?.sourceBlockId ?? block.id;
    const fragmentLength = blockText(block).length;
    const startAffinity = selection.direction === 'backward' ? 'backward' : 'forward';
    const endAffinity = selection.direction === 'backward' ? 'forward' : 'backward';
    canonicalSelectionRef.current = {
      sourceBlockId,
      start: pageOffsetToCanonical(metadata, selection.start, fragmentLength),
      end: pageOffsetToCanonical(metadata, selection.end, fragmentLength),
      startAffinity,
      endAffinity,
      direction: selection.direction
    };
    if (selection.focused) restoreFocusRef.current = true;
  };
  useLayoutEffect(() => {
    const selection = canonicalSelectionRef.current;
    if (!selection) return;
    const start = canonicalOffsetToPage(pages, selection.sourceBlockId, selection.start, selection.startAffinity);
    const end = canonicalOffsetToPage(pages, selection.sourceBlockId, selection.end, selection.endAffinity);
    if (!start || !end) return;
    const focus = selection.direction === 'backward' ? start : end;
    const textarea = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[data-page-block-id]')).find((element) => element.dataset.pageBlockId === focus.blockId);
    if (!textarea) return;
    const sameFragment = start.blockId === end.blockId;
    const localStart = sameFragment ? start.offset : focus.offset;
    const localEnd = sameFragment ? end.offset : localStart;
    textarea.setSelectionRange(localStart, localEnd, sameFragment ? selection.direction : 'none');
    if (restoreFocusRef.current) textarea.focus();
    restoreFocusRef.current = false;
  }, [pages, editorDocument, styleProfile]);
  const updatePage = (pageIndex: number, page: StructuredDocument) => {
    const value = mergePaginatedDocument(editorDocumentRef.current, pages, pageIndex, page);
    editorDocumentRef.current = value;
    setEditorDocument(value);
    if (mode !== 'compose') autosave.markDirty();
  };
  const pageStyle = { '--page-width': `${pageDimensions(styleProfile.pageSize).widthPx}px`, '--page-height': `${pageDimensions(styleProfile.pageSize).heightPx}px` } as React.CSSProperties;

  const createProject = () => void run(async () => {
    await autosave.flush();
    setFormDialog({ eyebrow: 'NEW PROJECT', title: 'Create a project', fields: [
      { key: 'directory', label: 'Project directory', value: `${isDesktop ? '' : '/tmp/'}my-weave-project` },
      { key: 'name', label: 'Project name', value: 'My story' }
    ], onSubmit: async (values) => { const directory = values.directory.trim(); const name = values.name.trim() || 'My story'; await repository.createProject(directory, name); const story = await repository.createStory('Story 1'); const chapter = await repository.createChapter(story.id, 'Chapter 1'); await repository.createScene(chapter.id, 'Scene 1'); await repository.createScene(chapter.id, 'Scene 2'); await refresh(false); } });
  });
  const openProject = () => void run(async () => { await autosave.flush(); setFormDialog({ eyebrow: 'OPEN PROJECT', title: 'Open a project', fields: [{ key: 'directory', label: 'Project directory', value: '', placeholder: '/path/to/project' }], onSubmit: async (values) => { await repository.openProject(values.directory.trim()); await refresh(false); } }); });
  const addScene = () => void run(async () => { if (!selectedChapterId) return; const scene = await repository.createScene(selectedChapterId, `Scene ${scenes.length + 1}`); await refresh(); setSelectedSceneId(scene.id); });
  const addChapter = () => void run(async () => { if (!selectedStoryId) return; const chapterNumber = (snapshot?.chapters.filter((item) => item.storyId === selectedStoryId).length ?? 0) + 1; await repository.createChapter(selectedStoryId, `Chapter ${chapterNumber}`); await refresh(false); });
  const renameScene = (scene: Scene) => void run(async () => { await autosave.flush(); setFormDialog({ eyebrow: 'SCENE', title: 'Rename scene', fields: [{ key: 'title', label: 'Scene title', value: scene.title }], onSubmit: async (values) => { const title = values.title.trim(); if (title) { await repository.renameScene(scene.id, title); await refresh(); } } }); });
  const moveScene = (scene: Scene, delta: number) => void run(async () => { await repository.reorderScene(scene.id, scene.position + delta); await refresh(); });

  const selectScene = (scene: Scene) => void run(async () => { await autosave.flush(); setMode('scene'); setDraft(undefined); setSelectedSceneId(scene.id); });
  const openContinuous = () => void run(async () => {
    if (!selectedChapterId) return;
    await autosave.flush();
    const value = await repository.enterContinuousDraft(selectedChapterId); const head = await repository.getDocument(value.documentId);
    setDraft(value); setDocumentHead(head); documentHeadRef.current = head; setEditorDocument(head.document); editorDocumentRef.current = head.document; setMode('continuous'); await refresh();
  });
  const returnToScenes = () => void run(async () => { await autosave.flush(); setShowReturnChoices(true); });
  const split = () => void run(async () => { if (!draft) return; await autosave.flush(); const result = await repository.automaticallySplitContinuous(draft.id); setShowReturnChoices(false); setDraft(undefined); setMode('scene'); await refresh(false); setSelectedSceneId(result.scenes[0]?.id); });
  const keepSeparate = () => void run(async () => { if (!draft) return; await autosave.flush(); await repository.keepContinuousSeparate(draft.id); setShowReturnChoices(false); setDraft(undefined); setMode('scene'); await refresh(false); });
  const save = () => void run(async () => { if (!documentHeadRef.current) return; autosave.markDirty(); await autosave.flush(); });
  const compose = () => void run(async () => { if (!selectedChapterId) return; await autosave.flush(); const composed = await repository.composeChapter(selectedChapterId); setMode('compose'); setEditorDocument(composed); editorDocumentRef.current = composed; setDocumentHead(undefined); documentHeadRef.current = undefined; });
  const doExport = () => void run(async () => {
    await autosave.flush();
    const head = documentHeadRef.current;
    if (!head) { setLocalError('Save a scene or continuous draft before exporting.'); return; }
    const options = { title: snapshot?.project.name ?? 'Manuscript', header: snapshot?.project.name ?? 'Manuscript', pageNumbering: true, styleProfile };
    const files = formats.map((format) => exportCapturedRevision({ id: head.revisionId, documentId: head.documentId, number: head.revision, document: head.document, createdAt: new Date().toISOString(), reason: 'edit' }, format, options));
    for (const file of files) { await repository.writeExport(file); if (!isDesktop) { const url = URL.createObjectURL(new Blob([file.bytes as unknown as BlobPart], { type: file.mimeType })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url); } }
  });
  const checkIntegrity = () => void run(async () => { await autosave.flush(); await repository.integrityCheck(); await refresh(); });
  const backup = () => void run(async () => { await autosave.flush(); await repository.createBackup(); await refresh(); });
  const updateStyle = (profile: EditorStyleProfile) => void run(async () => { const saved = await repository.updateStyleProfile(profile); setStyleProfile(saved); setSnapshot((current) => current ? { ...current, styleProfile: saved } : current); });
  const updateGoal = (target: number) => void run(async () => { await repository.setDailyWordTarget(target); const writingStats = await repository.getWritingStats(); setSnapshot((current) => current ? { ...current, writingStats } : current); });
  const newStory = () => void run(async () => { await autosave.flush(); setFormDialog({ eyebrow: 'MANUSCRIPT', title: 'New story', fields: [{ key: 'title', label: 'Story title', value: 'New story' }], onSubmit: async (values) => { const title = values.title.trim(); if (title) { await repository.createStory(title); await refresh(false); } } }); });
  const retryAutosave = () => void run(async () => { await autosave.retry(); });
  const createWorldbuildingNote = () => void run(async () => { await autosave.flush(); const note = await repository.createMarkdownNote('Untitled note'); await refresh(); openWorldbuildingTab({ kind: 'note', id: note.id }); });
  const createWorldbuildingCanvas = () => void run(async () => { await autosave.flush(); if (!selectedStoryId) { setLocalError('Choose a manuscript story before creating a local note canvas.'); return; } setCanvasDialog({ storyId: selectedStoryId }); });
  const submitCanvasChoice = (title: string, engine: CanvasEngine) => void run(async () => { const choice = canvasDialog; if (!choice) return; const canvas = await repository.createCanvas(choice.storyId, title, engine); setCanvasDialog(undefined); await refresh(); openWorldbuildingTab({ kind: 'canvas', id: canvas.id }); });
  const openWorldbuildingTab = (tab: WorldbuildingTab) => { const key = worldbuildingTabKey(tab); setWorldbuildingTabs((current) => current.some((candidate) => worldbuildingTabKey(candidate) === key) ? current : [...current, tab]); setActiveWorldbuildingTabKey(key); };
  const closeWorldbuildingTab = (key: string) => setWorldbuildingTabs((current) => { const index = current.findIndex((tab) => worldbuildingTabKey(tab) === key); const next = current.filter((tab) => worldbuildingTabKey(tab) !== key); setActiveWorldbuildingTabKey((active) => active === key ? (next[index] ? worldbuildingTabKey(next[index]) : next[index - 1] ? worldbuildingTabKey(next[index - 1]) : undefined) : active); return next; });
  const requestRenameNote = (note: MarkdownNote) => setNoteAction({ kind: 'rename', noteId: note.id, title: note.title });
  const requestDeleteNote = (note: MarkdownNote) => setNoteAction({ kind: 'delete', noteId: note.id, title: note.title, phase: 'confirm' });
  const submitNoteRename = (nextTitle: string) => void run(async () => {
    const action = noteAction;
    if (!action || action.kind !== 'rename' || !nextTitle.trim()) return;
    if (!await flushNoteBeforeAction(action.noteId)) return;
    const note = await latestMarkdownNote(action.noteId);
    if (!note) { setNoteAction(undefined); await refresh(); return; }
    await repository.updateMarkdownNote(note.id, { title: nextTitle.trim(), markdown: note.markdown }, note.revision);
    setNoteAction(undefined);
    await refresh();
  });
  const confirmNoteDelete = (mode: 'reject' | 'remove-references') => void run(async () => {
    const action = noteAction;
    if (!action || action.kind !== 'delete') return;
    if (!await flushNoteBeforeAction(action.noteId)) return;
    const note = await latestMarkdownNote(action.noteId);
    if (!note) { setNoteAction(undefined); closeWorldbuildingTab(worldbuildingTabKey({ kind: 'note', id: action.noteId })); await refresh(); return; }
    try {
      await repository.deleteMarkdownNote(note.id, note.revision, mode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mode === 'reject' && message.startsWith('Cannot delete')) {
        setNoteAction({ kind: 'delete', noteId: note.id, title: note.title, phase: 'references', referenceMessage: message });
        return;
      }
      throw error;
    }
    setNoteAction(undefined);
    closeWorldbuildingTab(worldbuildingTabKey({ kind: 'note', id: note.id }));
    await refresh();
  });

  if (!snapshot) return <><main className="welcome"><div className="welcome-card"><div className="welcome-card-top"><div className="mark">W</div><ThemeControl theme={theme} onToggle={() => setTheme(toggleTheme)} /></div><p className="eyebrow">OFFLINE DESKTOP WRITING</p><h1>Make room for the story.</h1><p className="welcome-copy">Weave keeps your manuscript, revisions, SQLite database, and recovery files in a visible <code>.weave</code> project directory. No server. No network. No guesswork.</p><div className="welcome-actions"><button type="button" className="primary-button" onClick={createProject} disabled={busy}>Create project</button><button type="button" className="secondary-button" onClick={openProject} disabled={busy}>Open project</button></div>{localError && <p className="error-message">{localError}</p>}<p className="offline-note"><span className="status-dot" /> local-only · SQLite · revisioned</p></div></main>{formDialog && <FormDialog config={formDialog} busy={busy} onCancel={() => setFormDialog(undefined)} onSubmit={submitFormDialog} />}</>;

  const activeChapter: Chapter | undefined = snapshot.chapters.find((chapter) => chapter.id === selectedChapterId);
  const activeScene = scenes.find((scene) => scene.id === selectedSceneId);
  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <header className="topbar"><div className="brand-cluster"><button type="button" className="sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((current) => !current)}>☰</button><div className="brand"><span className="brand-mark">W</span><span>Weave</span><span className="offline-pill">OFFLINE</span></div></div><div className="top-actions"><button type="button" onClick={checkIntegrity}>Integrity</button><button type="button" onClick={backup}>Backup</button><button type="button" onClick={doExport} disabled={busy || mode === 'compose'}>Export all</button><ThemeControl theme={theme} onToggle={() => setTheme(toggleTheme)} /><StatusBar status={autosaveStatus} />{autosaveStatus.state === 'error' && <button type="button" className="retry-button" onClick={retryAutosave}>Retry</button>}</div></header>
    <aside className="sidebar"><nav className="workspace-sections" role="tablist" aria-label="Primary workspaces"><button type="button" role="tab" id="manuscript-workspace-tab" aria-controls="manuscript-workspace" aria-selected={workspaceMode === 'writing'} className={workspaceMode === 'writing' ? 'selected' : ''} onClick={() => void run(async () => { await autosave.flush(); setWorkspaceMode('writing'); })}>Manuscript</button><button type="button" role="tab" id="worldbuilding-workspace-tab" aria-controls="worldbuilding-workspace" aria-selected={workspaceMode === 'worldbuilding'} className={workspaceMode === 'worldbuilding' ? 'selected' : ''} onClick={() => void run(async () => { await autosave.flush(); setWorkspaceMode('worldbuilding'); })}>Worldbuilding</button></nav>{workspaceMode === 'writing' ? <><div className="sidebar-heading"><span>MANUSCRIPT</span><div className="sidebar-heading-actions"><button type="button" onClick={createProject} aria-label="New project">+</button><button type="button" onClick={() => setSidebarCollapsed(true)} aria-label="Collapse sidebar">‹</button></div></div>{snapshot.stories.map((story) => <div key={story.id} className="tree-group"><button type="button" className={`tree-item story ${selectedStoryId === story.id ? 'selected' : ''}`} onClick={() => void run(async () => { await autosave.flush(); setSelectedStoryId(story.id); })}>▾ <span>{story.title}</span></button>{snapshot.chapters.filter((chapter) => chapter.storyId === story.id).map((chapter) => <div key={chapter.id} className="chapter-group"><button type="button" className={`tree-item chapter ${selectedChapterId === chapter.id ? 'selected' : ''}`} onClick={() => void run(async () => { await autosave.flush(); setSelectedChapterId(chapter.id); setSelectedSceneId(undefined); })}>▾ <span>{chapter.title}</span></button>{selectedChapterId === chapter.id && scenes.map((scene) => <button type="button" key={scene.id} className={`tree-item scene ${selectedSceneId === scene.id && mode === 'scene' ? 'selected' : ''}`} onClick={() => selectScene(scene)}><span className="scene-index">{String(scene.position + 1).padStart(2, '0')}</span>{scene.title}</button>)}{selectedChapterId === chapter.id && <button type="button" className="add-scene" onClick={addScene}>+ New scene</button>}</div>)}</div>)}<button type="button" className="add-story" onClick={newStory}>+ New story</button><div className="sidebar-bottom"><button type="button" onClick={addChapter} disabled={!selectedStoryId}>+ Chapter</button><button type="button" onClick={openProject}>Open</button></div></> : <nav className="worldbuilding-sidebar" aria-label="Worldbuilding navigation"><p className="eyebrow">WORLDBUILDING</p><section className="worldbuilding-sidebar-group"><div className="worldbuilding-sidebar-heading"><h2>Notes</h2><button type="button" className="worldbuilding-create-icon" aria-label="Create new note" title="Create new note" onClick={createWorldbuildingNote}><Plus size={14} strokeWidth={2} aria-hidden="true" /></button></div>{snapshot.markdownNotes.map((note) => { const key = worldbuildingTabKey({ kind: 'note', id: note.id }); const selected = activeWorldbuildingTabKey === key; return <div className="worldbuilding-sidebar-note-row" key={note.id}><button type="button" className={`worldbuilding-sidebar-note-title ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => openWorldbuildingTab({ kind: 'note', id: note.id })}>{note.title}</button><div className="worldbuilding-sidebar-note-actions" aria-label={`${note.title} note actions`}><button type="button" className="worldbuilding-sidebar-note-action" aria-label={`Rename ${note.title}`} title={`Rename ${note.title}`} onClick={(event) => { event.stopPropagation(); requestRenameNote(note); }}><Pencil size={14} strokeWidth={2} aria-hidden="true" /></button><button type="button" className="worldbuilding-sidebar-note-action worldbuilding-sidebar-note-delete" aria-label={`Delete ${note.title}`} title={`Delete ${note.title}`} onClick={(event) => { event.stopPropagation(); requestDeleteNote(note); }}><Trash2 size={14} strokeWidth={2} aria-hidden="true" /></button></div></div>; })}{snapshot.markdownNotes.length === 0 && <p>No notes yet.</p>}</section><section className="worldbuilding-sidebar-group"><div className="worldbuilding-sidebar-heading"><h2>Canvases</h2><button type="button" className="worldbuilding-create-icon" aria-label="Create new canvas" title="Create new canvas" onClick={createWorldbuildingCanvas}><Plus size={14} strokeWidth={2} aria-hidden="true" /></button></div>{snapshot.canvases.map((canvas) => { const key = worldbuildingTabKey({ kind: 'canvas', id: canvas.id }); return <button type="button" key={canvas.id} className={activeWorldbuildingTabKey === key ? 'selected' : ''} aria-current={activeWorldbuildingTabKey === key ? 'page' : undefined} onClick={() => openWorldbuildingTab({ kind: 'canvas', id: canvas.id })}>{canvas.title}</button>; })}{snapshot.canvases.length === 0 && <p>No canvases yet.</p>}</section><p className="worldbuilding-sidebar-note">Open tabs remain available when returning to Manuscript.</p></nav>}</aside>
    {workspaceMode === 'worldbuilding' ? <WorldbuildingWorkspace repository={repository} snapshot={snapshot} tabs={worldbuildingTabs} activeTabKey={activeWorldbuildingTabKey} onOpenTab={openWorldbuildingTab} onActivateTab={setActiveWorldbuildingTabKey} onCloseTab={closeWorldbuildingTab} onCreateNote={createWorldbuildingNote} onCreateCanvas={createWorldbuildingCanvas} onRefresh={async () => { await refresh(); }} onRegisterNoteFlush={registerNoteFlush} onReturnToManuscript={() => setWorkspaceMode('writing')} onError={setLocalError} /> : <main id="manuscript-workspace" role="tabpanel" aria-labelledby="manuscript-workspace-tab" className="workspace"><div className="workspace-head"><div><p className="eyebrow">{activeChapter?.title ?? 'Chapter'}</p><h1>{mode === 'continuous' ? 'Continuous draft' : mode === 'compose' ? 'Composed chapter' : activeScene?.title ?? 'Choose a scene'}</h1></div><div className="mode-switch"><button type="button" className={mode === 'scene' ? 'active' : ''} onClick={() => activeScene && selectScene(activeScene)}>Scenes</button><button type="button" className={mode === 'compose' ? 'active' : ''} onClick={compose}>Chapter view</button><button type="button" className={mode === 'continuous' ? 'active' : ''} onClick={openContinuous}>Continuous draft</button></div></div>
      {localError && <div className="inline-error" role="alert">{localError}</div>}
      <GoalPanel stats={snapshot.writingStats} onSaveTarget={updateGoal} />
      <div className="page-stack" ref={pageStackRef} aria-label="Manuscript pages"><StyleControls profile={styleProfile} onChange={updateStyle} disabled={mode === 'compose'} />{pages.map((page, pageIndex) => <section className="paper-page" style={pageStyle} key={`${pageIndex}-${page.document.blocks[0]?.id ?? 'empty'}`}><div className="paper-meta"><span>{mode === 'compose' ? 'NON-DESTRUCTIVE COMPOSITION' : mode === 'continuous' ? 'SEPARATE REVISION · SOURCE SNAPSHOT PRESERVED' : 'SCENE DOCUMENT'}</span><span>{pageDimensions(styleProfile.pageSize).label} · Page {pageIndex + 1} of {pages.length}</span></div><Editor document={page.document} styleProfile={styleProfile} onChange={(value) => updatePage(pageIndex, value)} onSelectionChange={rememberSelection} readOnly={mode === 'compose'} /><div className="paper-footer"><span>{mode === 'compose' ? 'Scene documents remain the source.' : 'Structured document · changes save automatically'}</span>{documentHead && pageIndex === pages.length - 1 && <span>revision {documentHead.revision}</span>}</div></section>)}</div>
      <footer className="editor-footer"><div>{mode === 'continuous' && <button type="button" className="secondary-button" onClick={returnToScenes}>Return to scenes</button>}{mode === 'scene' && activeScene && <><button type="button" className="secondary-button" onClick={() => renameScene(activeScene)}>Rename</button><button type="button" className="icon-button" onClick={() => moveScene(activeScene, -1)} aria-label="Move scene up">↑</button><button type="button" className="icon-button" onClick={() => moveScene(activeScene, 1)} aria-label="Move scene down">↓</button></>}{mode === 'compose' && <span className="guard-note">Composition is a view, never a second source.</span>}</div><div className="save-actions">{mode !== 'compose' && <button type="button" className="secondary-button" onClick={save} disabled={busy || !documentHead}>Save now</button>}</div></footer>
    </main>}
    {showReturnChoices && <ChoiceDialog onSplit={split} onKeep={keepSeparate} onCancel={() => setShowReturnChoices(false)} busy={busy} />}
    {formDialog && <FormDialog config={formDialog} busy={busy} onCancel={() => setFormDialog(undefined)} onSubmit={submitFormDialog} />}
    {canvasDialog && <CanvasChoiceDialog busy={busy} onCancel={() => setCanvasDialog(undefined)} onSubmit={submitCanvasChoice} />}
    {noteAction?.kind === 'rename' && <NoteRenameDialog initialTitle={noteAction.title} busy={busy} onCancel={() => setNoteAction(undefined)} onSubmit={submitNoteRename} />}
    {noteAction?.kind === 'delete' && <NoteDeleteDialog title={noteAction.title} phase={noteAction.phase} referenceMessage={noteAction.referenceMessage} busy={busy} onCancel={() => setNoteAction(undefined)} onConfirm={() => confirmNoteDelete(noteAction.phase === 'references' ? 'remove-references' : 'reject')} />}
  </div>;
}
