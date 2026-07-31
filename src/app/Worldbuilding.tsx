import { useCallback, useEffect, useRef, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, applyNodeChanges, type Edge, type Node, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ProjectRepository } from '../domain/repository';
import type { CanvasProjection, CanvasViewport, MarkdownNote, ProjectSnapshot, StoryCanvas } from '../domain/types';

export type WorldbuildingTab = { kind: 'note' | 'canvas'; id: string };
export const worldbuildingTabKey = (tab: WorldbuildingTab) => `${tab.kind}:${tab.id}`;

function TabStrip({ tabs, activeKey, snapshot, onActivate, onClose }: { tabs: WorldbuildingTab[]; activeKey?: string; snapshot: ProjectSnapshot; onActivate: (key: string) => void; onClose: (key: string) => void }) {
  const labelFor = (tab: WorldbuildingTab) => tab.kind === 'note' ? snapshot.markdownNotes.find((note) => note.id === tab.id)?.title ?? 'Deleted note' : snapshot.canvases.find((canvas) => canvas.id === tab.id)?.title ?? 'Deleted canvas';
  return <div className="world-tab-strip" role="tablist" aria-label="Open Worldbuilding tabs">
    {tabs.map((tab) => { const key = worldbuildingTabKey(tab); return <div className="world-tab" role="presentation" key={key}>
      <button type="button" role="tab" id={`world-tab-${key}`} aria-selected={activeKey === key} aria-controls={`world-panel-${key}`} className={activeKey === key ? 'active' : ''} onClick={() => onActivate(key)}>{tab.kind === 'note' ? 'Note' : 'Canvas'} · {labelFor(tab)}</button>
      <button type="button" className="world-tab-close" aria-label={`Close ${labelFor(tab)} tab`} onClick={() => onClose(key)}>×</button>
    </div>; })}
  </div>;
}

function NoteEditor({ repository, note, snapshot, onRefresh, onOpen, onClose, onError }: { repository: ProjectRepository; note: MarkdownNote; snapshot: ProjectSnapshot; onRefresh: () => Promise<void>; onOpen: (id: string) => void; onClose: () => void; onError: (message: string) => void }) {
  const [title, setTitle] = useState(note.title);
  const [markdown, setMarkdown] = useState(note.markdown);
  const [linkTargetId, setLinkTargetId] = useState('');
  const [repairTargetId, setRepairTargetId] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const links = snapshot.noteLinks.filter((link) => link.noteId === note.id);
  const backlinks = snapshot.noteLinks.filter((link) => link.targetId === note.id);
  useEffect(() => { setTitle(note.title); setMarkdown(note.markdown); }, [note.id, note.revision]);
  const save = async () => { try { await repository.updateMarkdownNote(note.id, { title, markdown }, note.revision); await onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const insertLink = () => {
    const target = snapshot.markdownNotes.find((candidate) => candidate.id === linkTargetId); if (!target) return;
    const start = editor.current?.selectionStart ?? markdown.length; const end = editor.current?.selectionEnd ?? start; const token = `[[${target.title}]]`;
    setMarkdown(`${markdown.slice(0, start)}${token}${markdown.slice(end)}`); setLinkTargetId('');
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(start + token.length, start + token.length); });
  };
  const deleteNote = async () => {
    if (!window.confirm(`Remove ${note.title}?`)) return;
    try { await repository.deleteMarkdownNote(note.id, note.revision); onClose(); await onRefresh(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Cannot delete') && window.confirm('Remove this note from canvases and leave incoming Markdown links unresolved for repair?')) {
        try { await repository.deleteMarkdownNote(note.id, note.revision, 'remove-references'); onClose(); await onRefresh(); } catch (retry) { onError(retry instanceof Error ? retry.message : String(retry)); }
      } else onError(message);
    }
  };
  return <section className="note-tab-panel" id={`world-panel-note:${note.id}`} role="tabpanel" aria-labelledby={`world-tab-note:${note.id}`}>
    <header className="note-editor-head"><div><p className="eyebrow">MARKDOWN NOTE</p><h1>{note.title}</h1><p>Only exact <code>[[Note title]]</code> and <code>[[Note title|label]]</code> create local note links.</p></div><div><button type="button" className="text-button" onClick={() => void deleteNote()}>Delete note</button><button type="button" className="primary-button" onClick={() => void save()} disabled={!title.trim()}>Save note</button></div></header>
    <div className="note-editor-layout"><section className="note-writing"><label>Note title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="note-link-picker"><label>Insert note link<select value={linkTargetId} onChange={(event) => setLinkTargetId(event.target.value)}><option value="">Choose note</option>{snapshot.markdownNotes.filter((candidate) => candidate.id !== note.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label><button type="button" className="secondary-button" disabled={!linkTargetId} onClick={insertLink}>Insert [[note]]</button></div><label>Markdown<textarea ref={editor} aria-label="Markdown note content" value={markdown} onChange={(event) => setMarkdown(event.target.value)} placeholder="# A local note\n\nLink another note with [[Title]] or [[Title|label]]." /></label></section>
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
  return <section className="canvas-tab-panel" id={`world-panel-canvas:${canvas.id}`} role="tabpanel" aria-labelledby={`world-tab-canvas:${canvas.id}`}><header className="note-editor-head"><div><p className="eyebrow">USER-CREATED NOTE CANVAS</p><h1>{canvas.title}</h1><p>Only Markdown note nodes appear here. Edges are resolved wiki links; dragging changes only saved layout and viewport.</p></div></header>
    <div className="canvas-toolbar"><label>Add note<select value={noteToAdd} onChange={(event) => setNoteToAdd(event.target.value)}><option value="">Choose note</option>{snapshot.markdownNotes.filter((note) => !projection?.nodes.some((node) => node.entityId === note.id)).map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}</select></label><button type="button" className="secondary-button" disabled={!noteToAdd} onClick={() => void addNote()}>Add note node</button></div>
    <div className="react-flow-shell" role="region" aria-label="Note canvas" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Home') { event.preventDefault(); void instance.current?.fitView({ padding: 0.2 }); } }}><ReactFlow nodes={nodes} edges={edges} onNodesChange={(changes: NodeChange<Node>[]) => setNodes((current) => applyNodeChanges(changes, current))} onNodeDragStop={(_, node) => { const next = nodes.map((current) => current.id === node.id ? { ...current, position: node.position } : current); setNodes(next); void saveLayout(next); }} onNodesDelete={(removed) => void removeNodes(removed)} onMoveEnd={(_, next) => void saveLayout(nodes, { x: next.x, y: next.y, zoom: next.zoom })} onInit={(next) => { instance.current = next; }} defaultViewport={canvas.viewport} deleteKeyCode={['Backspace', 'Delete']} nodesFocusable edgesFocusable nodesConnectable={false} fitView><Background /><MiniMap pannable zoomable /><Controls showInteractive={false} /></ReactFlow></div>
    <section className="canvas-outline" aria-label="Note canvas outline fallback"><h2>Canvas outline</h2><p>Keyboard-accessible list of every note node and resolved wiki-link edge.</p><ul>{projection?.nodes.map((node) => <li key={node.id}><button type="button" onClick={() => { const flowNode = nodes.find((candidate) => candidate.id === node.id); if (flowNode) instance.current?.setCenter(flowNode.position.x, flowNode.position.y, { zoom: 1.2, duration: 150 }); }}>Note · {node.label}</button></li>)}</ul><h3>Wiki links</h3><ul>{projection?.edges.map((edge) => <li key={edge.id}>{labels.get(edge.sourceNodeId)} <span aria-hidden="true">→</span> {labels.get(edge.targetNodeId)}</li>)}{projection?.edges.length === 0 && <li>No resolved wiki links between placed notes.</li>}</ul></section>
  </section>;
}

export function WorldbuildingWorkspace({ repository, snapshot, selectedStoryId, tabs, activeTabKey, onOpenTab, onActivateTab, onCloseTab, onRefresh, onReturnToManuscript, onError }: { repository: ProjectRepository; snapshot: ProjectSnapshot; selectedStoryId?: string; tabs: WorldbuildingTab[]; activeTabKey?: string; onOpenTab: (tab: WorldbuildingTab) => void; onActivateTab: (key: string) => void; onCloseTab: (key: string) => void; onRefresh: () => Promise<void>; onReturnToManuscript: () => void; onError: (message: string) => void }) {
  const active = tabs.find((tab) => worldbuildingTabKey(tab) === activeTabKey) ?? tabs[0];
  const createNote = async () => { try { const note = await repository.createMarkdownNote('Untitled note'); await onRefresh(); onOpenTab({ kind: 'note', id: note.id }); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const createCanvas = async () => { if (!selectedStoryId) { onError('Choose a manuscript story before creating a local note canvas.'); return; } const title = window.prompt('Canvas title', 'Untitled canvas'); if (!title?.trim()) return; try { const canvas = await repository.createCanvas(selectedStoryId, title.trim()); await onRefresh(); onOpenTab({ kind: 'canvas', id: canvas.id }); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const note = active?.kind === 'note' ? snapshot.markdownNotes.find((candidate) => candidate.id === active.id) : undefined;
  const canvas = active?.kind === 'canvas' ? snapshot.canvases.find((candidate) => candidate.id === active.id) : undefined;
  return <main id="worldbuilding-workspace" role="tabpanel" aria-labelledby="worldbuilding-workspace-tab" className="worldbuilding-workspace"><section className="worldbuilding-main">{tabs.length > 0 && <TabStrip tabs={tabs} activeKey={worldbuildingTabKey(active ?? tabs[0])} snapshot={snapshot} onActivate={onActivateTab} onClose={onCloseTab} />}{note ? <NoteEditor repository={repository} note={note} snapshot={snapshot} onRefresh={onRefresh} onOpen={(id) => onOpenTab({ kind: 'note', id })} onClose={() => onCloseTab(worldbuildingTabKey({ kind: 'note', id: note.id }))} onError={onError} /> : canvas ? <NoteCanvas repository={repository} canvas={canvas} snapshot={snapshot} onRefresh={onRefresh} onError={onError} /> : <section className="worldbuilding-empty" aria-label="Worldbuilding empty state"><button type="button" onClick={() => void createNote()}>Create new note</button><button type="button" onClick={() => void createCanvas()}>Create new canva</button><button type="button" onClick={onReturnToManuscript}>Close</button></section>}</section></main>;
}
