import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, applyNodeChanges, type Edge, type Node, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@xyflow/react/dist/style.css';
import '@excalidraw/excalidraw/index.css';
import { effectiveTextMargins, pageDimensions } from '../domain/pagination';
import { buildWorldbuildingIndex, type WorldbuildingIndexEntry } from '../domain/worldbuilding-index';
import { MarkdownPageEditor } from './MarkdownPageEditor';
import type { ProjectRepository } from '../domain/repository';
import type { CanvasEngine, CanvasProjection, CanvasViewport, ExcalidrawSceneState, MarkdownNote, ProjectSnapshot, StoryCanvas } from '../domain/types';

export type WorldbuildingTab = { kind: 'note' | 'canvas'; id: string };
export const worldbuildingTabKey = (tab: WorldbuildingTab) => `${tab.kind}:${tab.id}`;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function WorldbuildingIndexPanel({ snapshot, onOpen }: { snapshot: ProjectSnapshot; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const entries = useMemo(() => buildWorldbuildingIndex(snapshot.markdownNotes), [snapshot.markdownNotes]);
  const types = useMemo(() => [...new Set(entries.flatMap((entry) => entry.type ? [entry.type] : []))], [entries]);
  const filtered = entries.filter((entry) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || entry.title.toLowerCase().includes(needle) || entry.type?.includes(needle) || entry.conflictingTypes?.some((type) => type.includes(needle));
    const matchesType = typeFilter === 'all' || (typeFilter === 'unclassified' && entry.status === 'unclassified') || (typeFilter === 'conflict' && entry.status === 'conflict') || entry.type === typeFilter;
    return matchesQuery && matchesType;
  });
  const label = (entry: WorldbuildingIndexEntry) => entry.status === 'classified' ? entry.type : entry.status === 'conflict' ? `Conflict · ${entry.conflictingTypes?.join(', ')}` : 'Unclassified';
  return <section className="worldbuilding-index" aria-label="Derived worldbuilding index">
    <header className="worldbuilding-index-head"><div><p className="eyebrow">DERIVED NOTE INDEX</p><h1>Worldbuilding index</h1><p>Characters, places, and other typed notes are indexed from Markdown without creating entities.</p></div><span className="worldbuilding-index-count">{filtered.length} of {entries.length} notes</span></header>
    <p className="worldbuilding-index-convention"><strong>Convention:</strong> put a single explicit field at the start of a note: <code>---</code> then <code>type: character</code> (or <code>place</code>, or another type) then <code>---</code>. Notes without a type stay unclassified. Conflicting values are shown as conflicts and never guessed.</p>
    <div className="worldbuilding-index-filters"><label>Search notes<input aria-label="Search worldbuilding index" value={query} placeholder="Title or type" onChange={(event) => setQuery(event.target.value)} /></label><label>Filter by type<select aria-label="Filter worldbuilding index by type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}<option value="unclassified">Unclassified</option><option value="conflict">Conflicts</option></select></label></div>
    {filtered.length === 0 ? <p className="worldbuilding-index-empty">No notes match this filter.</p> : <ul className="worldbuilding-index-list">{filtered.map((entry) => <li key={entry.sourceNoteId} className="worldbuilding-index-item"><div><strong>{entry.title || 'Untitled note'}</strong><span className={entry.status === 'conflict' ? 'worldbuilding-index-conflict' : undefined}>{label(entry)}</span></div><button type="button" className="text-button" onClick={() => onOpen(entry.sourceNoteId)}>Open source note</button></li>)}</ul>}
  </section>;
}

function TabStrip({ tabs, activeKey, snapshot, onActivate, onClose }: { tabs: WorldbuildingTab[]; activeKey?: string; snapshot: ProjectSnapshot; onActivate: (key: string) => void; onClose: (key: string) => void }) {
  const labelFor = (tab: WorldbuildingTab) => tab.kind === 'note' ? snapshot.markdownNotes.find((note) => note.id === tab.id)?.title ?? 'Deleted note' : snapshot.canvases.find((canvas) => canvas.id === tab.id)?.title ?? 'Deleted canvas';
  return <div className="world-tab-strip" role="tablist" aria-label="Open Worldbuilding tabs">
    {tabs.map((tab) => { const key = worldbuildingTabKey(tab); return <div className="world-tab" role="presentation" key={key}>
      <button type="button" role="tab" id={`world-tab-${key}`} aria-selected={activeKey === key} aria-controls={`world-panel-${key}`} className={activeKey === key ? 'active' : ''} onClick={() => onActivate(key)}>{tab.kind === 'note' ? 'Note' : 'Canvas'} · {labelFor(tab)}</button>
      <button type="button" className="world-tab-close" aria-label={`Close ${labelFor(tab)} tab`} onClick={() => onClose(key)}>×</button>
    </div>; })}
  </div>;
}

const NOTE_PAGE_CHARACTERS = 2100;
const noteLineHeight: Record<string, number> = { single: 1, '1.15': 1.15, '1.5': 1.5, double: 2 };
function splitNotePages(markdown: string): string[] {
  if (!markdown) return [''];
  const pages: string[] = [];
  let offset = 0;
  while (offset < markdown.length) {
    const limit = Math.min(markdown.length, offset + NOTE_PAGE_CHARACTERS);
    if (limit === markdown.length) { pages.push(markdown.slice(offset)); break; }
    const lineBreak = markdown.lastIndexOf('\n', limit);
    const end = lineBreak > offset ? lineBreak + 1 : limit;
    pages.push(markdown.slice(offset, end));
    offset = end;
  }
  return pages.length ? pages : [''];
}

/* Markdown note links remain exact [[Note title]] or [[Note title|label]] tokens. */
function NoteEditor({ repository, note, snapshot, onRefresh, onOpen, onRegisterNoteFlush, onError }: { repository: ProjectRepository; note: MarkdownNote; snapshot: ProjectSnapshot; onRefresh: () => Promise<void>; onOpen: (id: string) => void; onRegisterNoteFlush: (noteId: string, flush?: () => Promise<boolean>) => void; onError: (message: string) => void }) {
  const [title, setTitle] = useState(note.title);
  const [markdown, setMarkdown] = useState(note.markdown);
  const [repairTargetId, setRepairTargetId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savePaused, setSavePaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean>>();
  const editVersion = useRef(0);
  const pages = useMemo(() => splitNotePages(markdown), [markdown]);
  const links = snapshot.noteLinks.filter((link) => link.noteId === note.id);
  const backlinks = snapshot.noteLinks.filter((link) => link.targetId === note.id);
  const pageSize = snapshot.styleProfile.pageSize ?? 'letter';
  const dimensions = pageDimensions(pageSize);
  const margins = effectiveTextMargins(snapshot.styleProfile);

  useEffect(() => {
    setTitle(note.title);
    setMarkdown(note.markdown);
    setDirty(false);
    setSavePaused(false);
  }, [note.id, note.revision]);

  const save = useCallback((force = false): Promise<boolean> => {
    if (!dirty && !force) return Promise.resolve(false);
    if (savingRef.current) return savePromiseRef.current ?? Promise.resolve(false);
    const version = editVersion.current;
    savingRef.current = true;
    setSaving(true);
    const operation = (async () => {
      try {
        const saved = await repository.updateMarkdownNote(note.id, { title, markdown }, note.revision);
        if (version === editVersion.current) {
          setTitle(saved.title);
          setDirty(false);
        }
        await onRefresh();
        return true;
      } catch (error) {
        setSavePaused(true);
        onError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
        savePromiseRef.current = undefined;
      }
    })();
    savePromiseRef.current = operation;
    return operation;
  }, [dirty, markdown, note.id, note.revision, onError, onRefresh, repository, title]);

  const flush = useCallback(async () => {
    if (!dirty) return true;
    const version = editVersion.current;
    const saved = await save(true);
    return saved && version === editVersion.current;
  }, [dirty, save]);

  useEffect(() => {
    onRegisterNoteFlush(note.id, flush);
    return () => onRegisterNoteFlush(note.id);
  }, [flush, note.id, onRegisterNoteFlush]);

  useEffect(() => {
    if (!dirty || savePaused) return;
    const timer = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(timer);
  }, [dirty, save, savePaused]);

  const editMarkdown = (value: string) => { editVersion.current += 1; setMarkdown(value); setDirty(true); setSavePaused(false); };
  const updatePage = (pageIndex: number, value: string) => {
    const start = pages.slice(0, pageIndex).reduce((total, page) => total + page.length, 0);
    const next = `${markdown.slice(0, start)}${value}${markdown.slice(start + pages[pageIndex].length)}`;
    editMarkdown(next);
  };
  return <section className="note-tab-panel" id={`world-panel-note:${note.id}`} role="tabpanel" aria-labelledby={`world-tab-note:${note.id}`}>
    <header className="note-editor-head"><h1>{title || 'Untitled note'}</h1><div className="note-editor-actions"><span className="note-save-state" role="status">{saving ? 'Saving…' : savePaused ? 'Save needs retry' : dirty ? 'Unsaved changes' : `Saved automatically · revision ${note.revision}`}</span>{savePaused && <button type="button" className="text-button" onClick={() => { setSavePaused(false); void save(true); }}>Retry</button>}</div></header>
    <div className="note-editor-layout"><section className="note-page-stack" aria-label="Markdown note pages" style={{ '--page-width': `${dimensions.widthPx}px`, '--page-height': `${dimensions.heightPx}px`, '--editor-font-family': snapshot.styleProfile.fontFamily, '--editor-font-size': `${snapshot.styleProfile.fontSizePt}pt`, '--editor-line-height': noteLineHeight[snapshot.styleProfile.lineSpacing], '--text-margin-top': `${margins.top}px`, '--text-margin-right': `${margins.right}px`, '--text-margin-bottom': `${margins.bottom}px`, '--text-margin-left': `${margins.left}px` } as React.CSSProperties}>{pages.map((page, pageIndex) => <section className="note-paper-page" key={`${note.id}-page-${pageIndex}`}><div className="paper-meta"><span>MARKDOWN NOTE · CANONICAL TEXT</span><span>{dimensions.label} · Page {pageIndex + 1} of {pages.length}</span></div><MarkdownPageEditor markdown={page} pageIndex={pageIndex} onChange={(value) => updatePage(pageIndex, value)} /><div className="paper-footer"><span>Markdown source · autosaves locally</span><span>revision {note.revision}</span></div></section>)}</section>
      <aside className="note-link-index" aria-label="Note links and backlinks"><h2>Links</h2>{links.map((link) => link.targetId ? <p key={link.id}><button type="button" className="context-link" onClick={() => onOpen(link.targetId!)}>→ {snapshot.markdownNotes.find((candidate) => candidate.id === link.targetId)?.title ?? 'Missing note'}</button>{link.label && <> as “{link.label}”</>}</p> : <p key={link.id} className="unresolved-note-link"><strong>Unresolved:</strong> <code>[[{link.targetText}{link.label ? `|${link.label}` : ''}]]</code><select aria-label={`Repair ${link.targetText}`} value={repairTargetId} onChange={(event) => setRepairTargetId(event.target.value)}><option value="">Choose note</option>{snapshot.markdownNotes.filter((candidate) => candidate.id !== note.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select><button type="button" className="text-button" disabled={!repairTargetId} onClick={() => void repository.repairNoteLink(link.id, repairTargetId).then(async () => { setRepairTargetId(''); await onRefresh(); }).catch((error) => onError(error instanceof Error ? error.message : String(error)))}>Repair</button></p>)}{links.length === 0 && <p>No wiki links in this note.</p>}<h2>Backlinks</h2>{backlinks.map((link) => <p key={link.id}><button type="button" className="context-link" onClick={() => onOpen(link.noteId)}>{snapshot.markdownNotes.find((candidate) => candidate.id === link.noteId)?.title ?? 'Missing note'}</button></p>)}{backlinks.length === 0 && <p>No note backlinks.</p>}</aside>
    </div>
  </section>;
}

function NoteCanvas({ repository, canvas, snapshot, onRefresh, onError }: { repository: ProjectRepository; canvas: StoryCanvas; snapshot: ProjectSnapshot; onRefresh: () => Promise<void>; onError: (message: string) => void }) {
  const [projection, setProjection] = useState<CanvasProjection>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [noteToAdd, setNoteToAdd] = useState('');
  const [viewport, setViewport] = useState<CanvasViewport>(canvas.viewport);
  const instance = useRef<ReactFlowInstance<Node, Edge>>();
  const load = useCallback(async () => {
    const next = await repository.getCanvasProjection(canvas.id);
    const labels = new Map(snapshot.noteLinks.map((link) => [link.id, link.label ? `[[${link.targetText}|${link.label}]]` : `[[${link.targetText}]]`]));
    setProjection(next); setViewport(next.canvas.viewport);
    setNodes(next.nodes.map((node) => ({ id: node.id, position: node.position, data: { label: node.label }, ariaLabel: `Markdown note: ${node.label}` })));
    setEdges(next.edges.map((edge) => ({ id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, label: labels.get(edge.noteLinkId) ?? 'wiki link', focusable: true })));
  }, [canvas.id, repository, snapshot.noteLinks]);
  useEffect(() => { void load().catch((error) => onError(error instanceof Error ? error.message : String(error))); }, [load, onError]);
  const saveLayout = async (nextNodes: Node[], nextViewport = viewport) => {
    if (!projection) return;
    try { const saved = await repository.saveCanvasLayout(canvas.id, nextNodes.map((node) => ({ id: node.id, position: node.position })), nextViewport, projection.canvas.revision); setProjection((current) => current ? { ...current, canvas: saved } : current); setViewport(saved.viewport); await onRefresh(); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); await load(); }
  };
  const addNote = async () => { if (!projection || !noteToAdd) return; try { await repository.addCanvasNode(canvas.id, noteToAdd, { x: 80 + nodes.length * 32, y: 80 + nodes.length * 24 }, projection.canvas.revision); setNoteToAdd(''); await load(); await onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const removeNodes = async (removed: Node[]) => { if (!projection || !removed.length) return; try { let revision = projection.canvas.revision; for (const node of removed) { await repository.removeCanvasNode(canvas.id, node.id, revision); revision += 1; } await load(); await onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); await load(); } };
  const labels = new Map(projection?.nodes.map((node) => [node.id, node.label]));
  return <section className="canvas-tab-panel" id={`world-panel-canvas:${canvas.id}`} role="tabpanel" aria-labelledby={`world-tab-canvas:${canvas.id}`}><header className="note-editor-head"><div><p className="eyebrow">USER-CREATED NOTE CANVAS · REACT FLOW</p><h1>{canvas.title}</h1><p>React Flow projects Markdown note nodes and resolved wiki links. Layout and viewport are persisted separately from note content.</p></div></header>
    <div className="canvas-toolbar"><label>Add note<select value={noteToAdd} onChange={(event) => setNoteToAdd(event.target.value)}><option value="">Choose note</option>{snapshot.markdownNotes.filter((note) => !projection?.nodes.some((node) => node.entityId === note.id)).map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}</select></label><button type="button" className="secondary-button" disabled={!noteToAdd} onClick={() => void addNote()}>Add note node</button></div>
    <div className="react-flow-shell" role="region" aria-label="Note canvas" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Home') { event.preventDefault(); void instance.current?.fitView({ padding: 0.2 }); } }}><ReactFlow nodes={nodes} edges={edges} onNodesChange={(changes: NodeChange<Node>[]) => setNodes((current) => applyNodeChanges(changes, current))} onNodeDragStop={(_, node) => { const next = nodes.map((current) => current.id === node.id ? { ...current, position: node.position } : current); setNodes(next); void saveLayout(next); }} onNodesDelete={(removed) => void removeNodes(removed)} onMoveEnd={(_, next) => void saveLayout(nodes, { x: next.x, y: next.y, zoom: next.zoom })} onInit={(next) => { instance.current = next; }} defaultViewport={canvas.viewport} deleteKeyCode={['Backspace', 'Delete']} nodesFocusable edgesFocusable nodesConnectable={false} fitView><Background /><MiniMap pannable zoomable /><Controls showInteractive={false} /></ReactFlow></div>
    <section className="canvas-outline" aria-label="Note canvas outline fallback"><h2>Canvas outline</h2><p>Keyboard-accessible list of every note node and resolved wiki-link edge.</p><ul>{projection?.nodes.map((node) => <li key={node.id}><button type="button" onClick={() => { const flowNode = nodes.find((candidate) => candidate.id === node.id); if (flowNode) instance.current?.setCenter(flowNode.position.x, flowNode.position.y, { zoom: 1.2, duration: 150 }); }}>Note · {node.label}</button></li>)}</ul><h3>Wiki links</h3><ul>{projection?.edges.map((edge) => <li key={edge.id}>{labels.get(edge.sourceNodeId)} <span aria-hidden="true">→</span> {labels.get(edge.targetNodeId)}</li>)}{projection?.edges.length === 0 && <li>No resolved wiki links between placed notes.</li>}</ul></section>
  </section>;
}

function persistedAppState(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const keys = ['theme', 'viewBackgroundColor', 'scrollX', 'scrollY', 'zoom', 'gridSize', 'gridStep', 'zenModeEnabled', 'viewModeEnabled'];
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, cloneJson(source[key])]));
}

function ExcalidrawCanvas({ repository, canvas, onRefresh, onError }: { repository: ProjectRepository; canvas: StoryCanvas; onRefresh: () => Promise<void>; onError: (message: string) => void }) {
  const [projection, setProjection] = useState<CanvasProjection>();
  const saveTimer = useRef<number>();
  const hydrated = useRef(false);
  const pendingRevision = useRef(0);
  const load = useCallback(async () => {
    hydrated.current = false;
    const next = await repository.getCanvasProjection(canvas.id);
    setProjection(next);
    pendingRevision.current = next.canvas.revision;
    requestAnimationFrame(() => { hydrated.current = true; });
  }, [canvas.id, repository]);
  useEffect(() => { void load().catch((error) => onError(error instanceof Error ? error.message : String(error))); return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }; }, [load, onError]);

  const persist = (elements: readonly unknown[], appState: unknown, files: unknown) => {
    if (!hydrated.current || !projection) return;
    const scene: ExcalidrawSceneState = { elements: cloneJson(Array.from(elements)), appState: persistedAppState(appState), files: cloneJson((files && typeof files === 'object' ? files : {}) as Record<string, unknown>) };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void repository.saveExcalidrawScene(canvas.id, scene, pendingRevision.current).then(async (saved) => { pendingRevision.current = saved.revision; await onRefresh(); }).catch((error) => onError(error instanceof Error ? error.message : String(error))); }, 700);
  };

  if (!projection) return <section className="canvas-tab-panel" aria-busy="true"><p className="canvas-loading">Loading Excalidraw…</p></section>;
  const stored = projection.canvas.excalidrawState;
  const initialData = { elements: stored?.elements ?? [], appState: stored?.appState ?? {}, files: stored?.files ?? {} };
  return <section className="canvas-tab-panel excalidraw-tab-panel" id={`world-panel-canvas:${canvas.id}`} role="tabpanel" aria-labelledby={`world-tab-canvas:${canvas.id}`}><header className="note-editor-head"><div><p className="eyebrow">USER-CREATED NOTE CANVAS · EXCALIDRAW</p><h1>{canvas.title}</h1><p>Excalidraw scene elements, view state, and local image files are persisted in the project. This canvas is independent from the React Flow note projection.</p></div><span className="note-save-state" role="status">Local scene · revision {pendingRevision.current}</span></header><div className="excalidraw-shell" role="region" aria-label="Excalidraw canvas"><Excalidraw initialData={initialData as never} onChange={(elements, appState, files) => persist(elements, appState, files)} autoFocus={false} /></div><p className="canvas-accessibility-note">Use Tab to reach drawing controls and keyboard shortcuts; the canvas remains local-only and does not enable collaboration.</p></section>;
}

export function WorldbuildingWorkspace({ repository, snapshot, tabs, activeTabKey, onOpenTab, onActivateTab, onCloseTab, onCreateNote, onCreateCanvas, onRefresh, onRegisterNoteFlush, onFlushActiveNote, onReturnToManuscript, onError }: { repository: ProjectRepository; snapshot: ProjectSnapshot; tabs: WorldbuildingTab[]; activeTabKey?: string; onOpenTab: (tab: WorldbuildingTab, options?: { noteFlushed?: boolean }) => void; onActivateTab: (key: string) => void; onCloseTab: (key: string) => void; onCreateNote: () => void; onCreateCanvas: () => void; onRefresh: () => Promise<void>; onRegisterNoteFlush: (noteId: string, flush?: () => Promise<boolean>) => void; onFlushActiveNote: (noteId: string) => Promise<boolean>; onReturnToManuscript: () => void; onError: (message: string) => void }) {
  const active = tabs.find((tab) => worldbuildingTabKey(tab) === activeTabKey) ?? tabs[0];
  const note = active?.kind === 'note' ? snapshot.markdownNotes.find((candidate) => candidate.id === active.id) : undefined;
  const canvas = active?.kind === 'canvas' ? snapshot.canvases.find((candidate) => candidate.id === active.id) : undefined;
  const engine: CanvasEngine = canvas?.engine ?? 'react-flow';
  const openNote = async (id: string) => {
    if (note && note.id !== id && !await onFlushActiveNote(note.id)) return;
    onOpenTab({ kind: 'note', id }, { noteFlushed: true });
  };
  return <main id="worldbuilding-workspace" role="tabpanel" aria-labelledby="worldbuilding-workspace-tab" className="worldbuilding-workspace"><section className="worldbuilding-main"><WorldbuildingIndexPanel snapshot={snapshot} onOpen={(id) => { void openNote(id); }} />{tabs.length > 0 && <TabStrip tabs={tabs} activeKey={active ? worldbuildingTabKey(active) : undefined} snapshot={snapshot} onActivate={onActivateTab} onClose={onCloseTab} />}{note ? <NoteEditor repository={repository} note={note} snapshot={snapshot} onRefresh={onRefresh} onOpen={(id) => { void openNote(id); }} onRegisterNoteFlush={onRegisterNoteFlush} onError={onError} /> : canvas ? engine === 'excalidraw' ? <ExcalidrawCanvas repository={repository} canvas={canvas} onRefresh={onRefresh} onError={onError} /> : <NoteCanvas repository={repository} canvas={canvas} snapshot={snapshot} onRefresh={onRefresh} onError={onError} /> : <section className="worldbuilding-empty" aria-label="Worldbuilding empty state"><p className="eyebrow">LOCAL WORLDBUILDING</p><p>Create a Markdown page or choose a canvas engine.</p><button type="button" onClick={onCreateNote}>Create new note</button><button type="button" onClick={onCreateCanvas}>Create new canvas</button><button type="button" onClick={onReturnToManuscript}>Close</button></section>}</section></main>;
}
