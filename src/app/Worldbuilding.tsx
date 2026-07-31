import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ProjectRepository } from '../domain/repository';
import {
  RELATIONSHIP_TYPES,
  type Backlink,
  type CanvasProjection,
  type CanvasViewport,
  type DocumentAnchor,
  type ProjectSnapshot,
  type RelationshipType,
  type StoryCanvas,
  type WorldbuildingItem,
  type WorldbuildingItemKind,
  type WorldbuildingProperties
} from '../domain/types';

const propertyFields: Record<WorldbuildingItemKind, Array<{ key: string; label: string; placeholder: string }>> = {
  world: [{ key: 'genre', label: 'Genre', placeholder: 'Epic fantasy' }, { key: 'era', label: 'Era', placeholder: 'Third age' }, { key: 'summary', label: 'Summary', placeholder: 'A concise premise' }],
  place: [{ key: 'placeType', label: 'Place type', placeholder: 'City, district, tavern…' }, { key: 'region', label: 'Region', placeholder: 'Northern coast' }, { key: 'description', label: 'Description', placeholder: 'What makes this place distinct?' }],
  character: [{ key: 'role', label: 'Role', placeholder: 'Protagonist' }, { key: 'pronouns', label: 'Pronouns', placeholder: 'she/her' }, { key: 'summary', label: 'Summary', placeholder: 'A concise character note' }],
  term: [{ key: 'category', label: 'Category', placeholder: 'Magic, faction, artifact…' }, { key: 'definition', label: 'Definition', placeholder: 'What does this mean?' }]
};

interface EntityOption { id: string; label: string; kind: string; }

function entityOptions(snapshot: ProjectSnapshot, storyId?: string): EntityOption[] {
  const chapterIds = new Set(snapshot.chapters.filter((chapter) => !storyId || chapter.storyId === storyId).map((chapter) => chapter.id));
  const setIds = new Set(snapshot.sceneSets.filter((set) => chapterIds.has(set.chapterId)).map((set) => set.id));
  return [
    ...snapshot.worldbuildingItems.map((item) => ({ id: item.id, label: item.title, kind: item.kind })),
    ...snapshot.chapters.filter((chapter) => !storyId || chapter.storyId === storyId).map((chapter) => ({ id: chapter.id, label: chapter.title, kind: 'chapter' })),
    ...snapshot.scenes.filter((scene) => !storyId || setIds.has(scene.sceneSetId)).map((scene) => ({ id: scene.id, label: scene.title, kind: 'scene' }))
  ];
}

function titleFor(entities: EntityOption[], id: string): string { return entities.find((entity) => entity.id === id)?.label ?? 'Missing item'; }
function newProperties(kind: WorldbuildingItemKind): Record<string, string> { return Object.fromEntries(propertyFields[kind].map((field) => [field.key, ''])); }

function ItemForm({ item, onSave, onCancel }: { item?: WorldbuildingItem; onSave: (value: { kind: WorldbuildingItemKind; title: string; aliases: string[]; properties: WorldbuildingProperties; revision?: number }) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<WorldbuildingItemKind>(item?.kind ?? 'world');
  const [title, setTitle] = useState(item?.title ?? '');
  const [aliases, setAliases] = useState(item?.aliases.join(', ') ?? '');
  const [properties, setProperties] = useState<Record<string, string>>(() => ({ ...newProperties(item?.kind ?? 'world'), ...(item?.properties ?? {}) }));
  useEffect(() => {
    setKind(item?.kind ?? 'world'); setTitle(item?.title ?? ''); setAliases(item?.aliases.join(', ') ?? '');
    setProperties({ ...newProperties(item?.kind ?? 'world'), ...(item?.properties ?? {}) });
  }, [item]);
  return <form className="world-item-form" onSubmit={(event) => { event.preventDefault(); onSave({ kind, title, aliases: aliases.split(',').map((alias) => alias.trim()).filter(Boolean), properties, revision: item?.revision }); }}>
    <label>Type<select value={kind} disabled={Boolean(item)} onChange={(event) => { const next = event.target.value as WorldbuildingItemKind; setKind(next); setProperties(newProperties(next)); }}>{(['world', 'place', 'character', 'term'] as WorldbuildingItemKind[]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <label>Title<input value={title} required onChange={(event) => setTitle(event.target.value)} /></label>
    <label>Aliases <small>comma separated</small><input value={aliases} placeholder="Known names, nicknames" onChange={(event) => setAliases(event.target.value)} /></label>
    {propertyFields[kind].map((field) => <label key={field.key}>{field.label}<input value={properties[field.key] ?? ''} placeholder={field.placeholder} onChange={(event) => setProperties((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}
    <div className="world-form-actions"><button type="button" className="text-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button">{item ? 'Save item' : 'Create item'}</button></div>
  </form>;
}

function CanvasGraph({ repository, canvas, entities, onError, onChanged }: { repository: ProjectRepository; canvas: StoryCanvas; entities: EntityOption[]; onError: (message: string) => void; onChanged: () => Promise<void> }) {
  const [projection, setProjection] = useState<CanvasProjection>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nodeToAdd, setNodeToAdd] = useState('');
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('related-to');
  const [viewport, setViewport] = useState<CanvasViewport>(canvas.viewport);
  const [relationshipLabels, setRelationshipLabels] = useState<Record<string, string>>({});
  const instance = useRef<ReactFlowInstance<Node, Edge>>();

  const load = useCallback(async () => {
    const [next, relationships] = await Promise.all([repository.getCanvasProjection(canvas.id), repository.listRelationships()]);
    const labels = Object.fromEntries(relationships.map((relationship) => [relationship.id, relationship.type]));
    setProjection(next); setViewport(next.canvas.viewport); setRelationshipLabels(labels);
    setNodes(next.nodes.map((node) => ({ id: node.id, type: 'default', position: node.position, data: { label: node.label }, ariaLabel: `${node.entityKind}: ${node.label}` })));
    setEdges(next.edges.map((edge) => ({ id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, label: labels[edge.relationshipId] ?? 'relationship', focusable: true })));
  }, [canvas.id, repository]);
  useEffect(() => { void load().catch((error) => onError(error instanceof Error ? error.message : String(error))); }, [load, onError]);
  // Canvas labels are a projection. A domain rename updates this view without
  // ever writing a copied label back into the canvas record.
  useEffect(() => {
    setProjection((current) => {
      if (!current) return current;
      const refreshed = current.nodes.map((node) => ({ ...node, label: entities.find((entity) => entity.id === node.entityId)?.label ?? node.label }));
      setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, data: { ...node.data, label: refreshed.find((candidate) => candidate.id === node.id)?.label ?? node.data.label } })));
      return { ...current, nodes: refreshed };
    });
  }, [entities]);

  const saveLayout = async (nextNodes: Node[], nextViewport = viewport) => {
    if (!projection) return;
    try {
      const saved = await repository.saveCanvasLayout(canvas.id, nextNodes.map((node) => ({ id: node.id, position: node.position })), nextViewport, projection.canvas.revision);
      setProjection((current) => current ? { ...current, canvas: saved } : current);
      setViewport(saved.viewport);
      await onChanged();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); await load(); }
  };
  const onNodesChange = (changes: NodeChange<Node>[]) => setNodes((current) => applyNodeChanges(changes, current));
  const onConnect = async (connection: Connection) => {
    if (!projection || !connection.source || !connection.target) return;
    const source = projection.nodes.find((node) => node.id === connection.source);
    const target = projection.nodes.find((node) => node.id === connection.target);
    if (!source || !target) return;
    try {
      const relationship = await repository.createRelationship(source.entityId, target.entityId, relationshipType);
      await repository.connectCanvasNodes(canvas.id, source.id, target.id, relationship.id, projection.canvas.revision);
      await load(); await onChanged();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); await load(); }
  };
  const addNode = async () => {
    if (!projection || !nodeToAdd) return;
    try { await repository.addCanvasNode(canvas.id, nodeToAdd, { x: 80 + nodes.length * 32, y: 80 + nodes.length * 24 }, projection.canvas.revision); setNodeToAdd(''); await load(); await onChanged(); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const removeNodes = async (removed: Node[]) => {
    if (!projection || !removed.length) return;
    try {
      let current = projection.canvas.revision;
      for (const node of removed) { await repository.removeCanvasNode(canvas.id, node.id, current); current += 1; }
      await load(); await onChanged();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); await load(); }
  };
  const nodeLabels = new Map(projection?.nodes.map((node) => [node.id, node.label]));
  const relationFor = (edgeId: string) => { const relationshipId = projection?.edges.find((edge) => edge.id === edgeId)?.relationshipId; return relationshipId ? relationshipLabels[relationshipId] ?? relationshipId : ''; };

  return <section className="story-canvas" aria-labelledby="story-canvas-title">
    <div className="canvas-toolbar"><div><p className="eyebrow">REACT FLOW · LOCAL PROJECTION</p><h2 id="story-canvas-title">{canvas.title}</h2></div><label>Add real item<select aria-label="Add real data node" value={nodeToAdd} onChange={(event) => setNodeToAdd(event.target.value)}><option value="">Choose item, chapter, or scene</option>{entities.filter((entity) => !projection?.nodes.some((node) => node.entityId === entity.id)).map((entity) => <option key={entity.id} value={entity.id}>{entity.kind} · {entity.label}</option>)}</select></label><button type="button" className="secondary-button" onClick={addNode} disabled={!nodeToAdd}>Add node</button><label>New edge type<select aria-label="Relationship type for graph connection" value={relationshipType} onChange={(event) => setRelationshipType(event.target.value as RelationshipType)}>{RELATIONSHIP_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label></div>
    <p className="canvas-note">Drag a handle between nodes to create a validated <strong>{relationshipType}</strong> relationship. Positions and viewport save separately from domain content. Press Delete on a focused graph node to remove only its placement; Home fits the graph.</p>
    <div className="react-flow-shell" role="region" aria-label="Story relationship graph" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Home') { event.preventDefault(); void instance.current?.fitView({ padding: 0.2 }); } }}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onNodeDragStop={(_, node) => { const next = nodes.map((current) => current.id === node.id ? { ...current, position: node.position } : current); setNodes(next); void saveLayout(next); }} onNodesDelete={(removed) => void removeNodes(removed)} onConnect={(connection) => void onConnect(connection)} onMoveEnd={(_, nextViewport) => { const value = { x: nextViewport.x, y: nextViewport.y, zoom: nextViewport.zoom }; void saveLayout(nodes, value); }} onInit={(next) => { instance.current = next; }} defaultViewport={canvas.viewport} deleteKeyCode={['Backspace', 'Delete']} nodesFocusable edgesFocusable fitView>
        <Background /><MiniMap pannable zoomable /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <section className="canvas-outline" aria-label="Canvas outline fallback">
      <h3>Canvas outline</h3><p>Keyboard-accessible list of every graph node and relationship.</p>
      <ul>{projection?.nodes.map((node) => <li key={node.id}><button type="button" onClick={() => { const flowNode = nodes.find((candidate) => candidate.id === node.id); if (flowNode) instance.current?.setCenter(flowNode.position.x, flowNode.position.y, { zoom: 1.2, duration: 150 }); }}>{node.entityKind} · {node.label}</button></li>)}</ul>
      <h4>Relationships</h4><ul>{projection?.edges.map((edge) => <li key={edge.id}>{nodeLabels.get(edge.sourceNodeId)} <span aria-hidden="true">→</span> {nodeLabels.get(edge.targetNodeId)} <small>{relationFor(edge.id)}</small></li>)}{projection?.edges.length === 0 && <li>No graph relationships yet.</li>}</ul>
    </section>
  </section>;
}

export function WorldbuildingWorkspace({ repository, snapshot, selectedStoryId, onRefresh, onNavigateDocument, onError }: { repository: ProjectRepository; snapshot: ProjectSnapshot; selectedStoryId?: string; onRefresh: () => Promise<void>; onNavigateDocument: (anchor: DocumentAnchor) => void; onError: (message: string) => void }) {
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<WorldbuildingItem[]>(snapshot.worldbuildingItems);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('related-to');
  const [canvasId, setCanvasId] = useState<string>();
  const [canvasTitle, setCanvasTitle] = useState('Story map');
  const [linkSceneId, setLinkSceneId] = useState('');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [unresolvedLabel, setUnresolvedLabel] = useState('');
  const [repairTargetId, setRepairTargetId] = useState('');
  const selectedItem = snapshot.worldbuildingItems.find((item) => item.id === selectedItemId);
  const entities = useMemo(() => entityOptions(snapshot, selectedStoryId), [snapshot, selectedStoryId]);
  const activeCanvases = snapshot.canvases.filter((canvas) => !selectedStoryId || canvas.storyId === selectedStoryId);
  const activeCanvas = activeCanvases.find((canvas) => canvas.id === canvasId) ?? activeCanvases[0];

  useEffect(() => { if (!selectedItemId || !snapshot.worldbuildingItems.some((item) => item.id === selectedItemId)) setSelectedItemId(snapshot.worldbuildingItems[0]?.id); }, [selectedItemId, snapshot.worldbuildingItems]);
  useEffect(() => { if (!canvasId || !activeCanvases.some((canvas) => canvas.id === canvasId)) setCanvasId(activeCanvases[0]?.id); }, [activeCanvases, canvasId]);
  useEffect(() => { if (!linkSceneId) setLinkSceneId(snapshot.scenes[0]?.id ?? ''); }, [linkSceneId, snapshot.scenes]);
  useEffect(() => { let active = true; void repository.searchWorldbuilding(search).then((items) => { if (active) setSearchResults(items); }).catch((error) => onError(error instanceof Error ? error.message : String(error))); return () => { active = false; }; }, [onError, repository, search, snapshot.worldbuildingItems]);
  useEffect(() => { if (!selectedItem) { setBacklinks([]); return; } void repository.listBacklinks(selectedItem.id).then(setBacklinks).catch((error) => onError(error instanceof Error ? error.message : String(error))); }, [onError, repository, selectedItem]);

  const saveItem = async (value: { kind: WorldbuildingItemKind; title: string; aliases: string[]; properties: WorldbuildingProperties; revision?: number }) => {
    try {
      const item = selectedItem && value.revision ? await repository.updateWorldbuildingItem(selectedItem.id, { title: value.title, aliases: value.aliases, properties: value.properties }, value.revision) : await repository.createWorldbuildingItem(value);
      setSelectedItemId(item.id); setEditing(false); await onRefresh();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  const createRelationship = async () => { if (!sourceId || !targetId) return; try { await repository.createRelationship(sourceId, targetId, relationshipType); await onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const createCanvas = async () => { if (!selectedStoryId) { onError('Choose a story before creating a scoped canvas.'); return; } try { const canvas = await repository.createCanvas(selectedStoryId, canvasTitle); setCanvasId(canvas.id); await onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const createDocumentLink = async () => {
    const scene = snapshot.scenes.find((candidate) => candidate.id === linkSceneId); if (!scene) return;
    try { const document = await repository.getDocument(scene.documentId); const block = document.document.blocks[0]; if (!block) throw new Error('The selected scene has no structured block to anchor.'); await repository.createDocumentLink({ documentId: scene.documentId, blockId: block.id, start: 0, end: 0 }, linkTargetId || undefined, linkTargetId ? undefined : unresolvedLabel); setLinkTargetId(''); setUnresolvedLabel(''); await onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };

  return <main className="worldbuilding-workspace">
    <header className="worldbuilding-head"><div><p className="eyebrow">OFFLINE WORLDBUILDING</p><h1>World, people, places, and their context.</h1><p>Stable IDs keep links intact when titles change. Weave never infers links from arbitrary prose.</p></div><button type="button" className="primary-button" onClick={() => { setSelectedItemId(undefined); setEditing(true); }}>+ New item</button></header>
    <div className="worldbuilding-grid">
      <aside className="world-catalog" aria-label="Worldbuilding catalog"><label>Search titles, aliases, terms, and links<input value={search} placeholder="Search locally" onChange={(event) => setSearch(event.target.value)} /></label><div className="catalog-list">{searchResults.map((item) => <button type="button" key={item.id} className={item.id === selectedItemId ? 'selected' : ''} onClick={() => { setSelectedItemId(item.id); setEditing(false); }}><span className={`kind-pill kind-${item.kind}`}>{item.kind}</span><strong>{item.title}</strong>{item.aliases.length > 0 && <small>{item.aliases.join(' · ')}</small>}</button>)}{searchResults.length === 0 && <p>No local matches.</p>}</div></aside>
      <section className="world-detail" aria-live="polite">{editing ? <><h2>{selectedItem ? `Edit ${selectedItem.title}` : 'Create worldbuilding item'}</h2><ItemForm item={selectedItem} onSave={saveItem} onCancel={() => setEditing(false)} /></> : selectedItem ? <><div className="detail-title"><div><span className={`kind-pill kind-${selectedItem.kind}`}>{selectedItem.kind}</span><h2>{selectedItem.title}</h2></div><div><button type="button" className="secondary-button" onClick={() => setEditing(true)}>Edit</button><button type="button" className="text-button" onClick={() => { if (window.confirm(`Remove ${selectedItem.title}? Referenced records are protected.`)) void repository.deleteWorldbuildingItem(selectedItem.id, selectedItem.revision).then(onRefresh).catch((error) => onError(error instanceof Error ? error.message : String(error))); }}>Delete</button></div></div><p className="aliases"><strong>Aliases:</strong> {selectedItem.aliases.length ? selectedItem.aliases.join(', ') : 'None'}</p><dl>{Object.entries(selectedItem.properties).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><section className="link-panel"><h3>Outgoing links</h3>{snapshot.relationships.filter((relationship) => relationship.sourceId === selectedItem.id).map((relationship) => <p key={relationship.id}><strong>{relationship.type}</strong> → {titleFor(entities, relationship.targetId)} <button type="button" className="text-button" onClick={() => void repository.deleteRelationship(relationship.id).then(onRefresh)}>Remove</button></p>)}{!snapshot.relationships.some((relationship) => relationship.sourceId === selectedItem.id) && <p>No outgoing links.</p>}<h3>Backlinks</h3>{backlinks.map((backlink) => <p key={backlink.id}>{backlink.kind === 'relationship' ? <><strong>{backlink.type}</strong> from <button type="button" className="context-link" onClick={() => setSelectedItemId(backlink.sourceId)}>{backlink.sourceTitle}</button></> : <>Document link from <button type="button" className="context-link" onClick={() => onNavigateDocument(backlink.anchor)}>{backlink.sourceTitle}</button> <small>block context</small></>}</p>)}{backlinks.length === 0 && <p>No backlinks.</p>}</section></> : <p>Select a catalog item or create one.</p>}</section>
    </div>
    <section className="relationship-composer" aria-labelledby="relationship-composer-title"><h2 id="relationship-composer-title">Create typed relationship</h2><label>Source<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose source</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.kind} · {entity.label}</option>)}</select></label><label>Type<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value as RelationshipType)}>{RELATIONSHIP_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label>Target<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose target</option>{entities.filter((entity) => entity.id !== sourceId).map((entity) => <option key={entity.id} value={entity.id}>{entity.kind} · {entity.label}</option>)}</select></label><button type="button" className="primary-button" onClick={() => void createRelationship()} disabled={!sourceId || !targetId}>Link items</button></section>
    <section className="document-link-panel" aria-labelledby="document-link-title"><div><p className="eyebrow">EXPLICIT DOCUMENT LINKS</p><h2 id="document-link-title">Anchored, not parsed</h2><p>Create an explicit stable-ID anchor at a scene’s first block. Empty target labels remain visible until repaired.</p></div><label>Scene<select value={linkSceneId} onChange={(event) => setLinkSceneId(event.target.value)}>{snapshot.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label><label>Target<select value={linkTargetId} onChange={(event) => setLinkTargetId(event.target.value)}><option value="">Unresolved link</option>{snapshot.worldbuildingItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>{!linkTargetId && <label>Visible repair label<input value={unresolvedLabel} placeholder="Unresolved name" onChange={(event) => setUnresolvedLabel(event.target.value)} /></label>}<button type="button" className="secondary-button" onClick={() => void createDocumentLink()} disabled={!linkSceneId || (!linkTargetId && !unresolvedLabel.trim())}>Add document link</button><div className="document-link-list">{snapshot.documentLinks.map((link) => <p key={link.id}>{link.targetId ? <>Linked to {titleFor(entities, link.targetId)}</> : <><strong>Unresolved:</strong> {link.unresolvedLabel} <select aria-label={`Repair ${link.unresolvedLabel}`} value={repairTargetId} onChange={(event) => setRepairTargetId(event.target.value)}><option value="">Choose target</option>{snapshot.worldbuildingItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button type="button" className="text-button" disabled={!repairTargetId} onClick={() => void repository.repairDocumentLink(link.id, repairTargetId).then(async () => { setRepairTargetId(''); await onRefresh(); })}>Repair</button></>} <small>document anchor</small></p>)}{snapshot.documentLinks.length === 0 && <p>No document links yet.</p>}</div></section>
    <section className="canvas-section" aria-labelledby="canvas-section-title"><div className="canvas-section-head"><div><p className="eyebrow">STORY-SCOPED REACT FLOW</p><h2 id="canvas-section-title">Relationship canvas</h2></div><label>Canvas title<input value={canvasTitle} onChange={(event) => setCanvasTitle(event.target.value)} /></label><button type="button" className="primary-button" onClick={() => void createCanvas()} disabled={!selectedStoryId}>New canvas</button>{activeCanvases.length > 0 && <label>Open canvas<select value={activeCanvas?.id ?? ''} onChange={(event) => setCanvasId(event.target.value)}>{activeCanvases.map((canvas) => <option key={canvas.id} value={canvas.id}>{canvas.title}</option>)}</select></label>}</div>{activeCanvas ? <CanvasGraph repository={repository} canvas={activeCanvas} entities={entities} onError={onError} onChanged={onRefresh} /> : <p>Choose a story in Manuscript, then create a scoped canvas.</p>}</section>
  </main>;
}
