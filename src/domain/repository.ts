import {
  blockText,
  cloneDocument,
  documentFromText,
  emptyDocument,
  newId,
  now,
  validateDocument
} from './document';
import { composeChapter, splitByExplicitMarkers } from './scenes';
import { calculateProjectWordCount, documentMapFromRecords, localCalendarDate } from './goals';
import {
  DEFAULT_EDITOR_STYLE,
  type BackupRecord,
  type Chapter,
  type ContinuousDraft,
  type DocumentBlock,
  type IntegrityReport,
  type OperationStatus,
  type Project,
  type ProjectSnapshot,
  RevisionConflictError,
  type Revision,
  type Scene,
  type SceneSet,
  type Story,
  type StructuredDocument,
  type EditorStyleProfile,
  EntityRevisionConflictError,
  type MarkdownNote,
  type NoteLink,
  type StoryCanvas,
  type CanvasPosition,
  type CanvasViewport,
  type CanvasNode,
  type CanvasEdge,
  type CanvasProjection,
  type WritingGoals,
  type WritingStats
} from './types';

/* Legacy records are retained only to safely read pre-v4 state. They are not exposed by the repository contract or snapshot and are discarded by persistent adapters. */
type WorldbuildingItemKind = 'world' | 'place' | 'character' | 'term';
type WorldbuildingProperties = Record<string, string | undefined>;
type RelationshipType = 'contains' | 'located-in' | 'appears-in' | 'knows' | 'allied-with' | 'opposes' | 'mentions' | 'related-to';
const RELATIONSHIP_TYPES: readonly RelationshipType[] = ['contains', 'located-in', 'appears-in', 'knows', 'allied-with', 'opposes', 'mentions', 'related-to'];
interface WorldbuildingItem { id: string; projectId: string; kind: WorldbuildingItemKind; title: string; aliases: string[]; properties: WorldbuildingProperties; revision: number; createdAt: string; updatedAt: string; }
interface DomainRelationship { id: string; sourceId: string; targetId: string; type: RelationshipType; createdAt: string; }
interface DocumentAnchor { documentId: string; blockId: string; start: number; end: number; }
interface DocumentLink { id: string; anchor: DocumentAnchor; targetId?: string; unresolvedLabel?: string; createdAt: string; }
type Backlink = { kind: 'relationship'; id: string; sourceId: string; sourceTitle: string; type: RelationshipType } | { kind: 'document'; id: string; sourceId: string; sourceTitle: string; anchor: DocumentAnchor } | { kind: 'note'; id: string; sourceId: string; sourceTitle: string; noteId: string; start: number; end: number; label?: string };
interface ResolvedEntity { id: string; title: string; kind: WorldbuildingItemKind | 'chapter' | 'scene' | 'note'; }

export interface DocumentHead {
  documentId: string;
  document: StructuredDocument;
  revision: number;
  revisionId: string;
}

export interface SaveDocumentResult {
  revision: Revision;
  status: OperationStatus;
}

export interface SplitResult {
  sceneSet: SceneSet;
  scenes: Scene[];
  sourceRevisionId: string;
}

export interface ProjectRepository {
  createProject(directory: string, name: string): Promise<Project>;
  openProject(directory: string): Promise<Project>;
  getProject(): Promise<Project>;
  createStory(title: string): Promise<Story>;
  createChapter(storyId: string, title: string): Promise<Chapter>;
  createScene(chapterId: string, title: string, document?: StructuredDocument): Promise<Scene>;
  listStories(): Promise<Story[]>;
  listChapters(storyId?: string): Promise<Chapter[]>;
  listSceneSets(chapterId: string): Promise<SceneSet[]>;
  listScenes(chapterId: string, sceneSetId?: string): Promise<Scene[]>;
  renameScene(sceneId: string, title: string): Promise<Scene>;
  reorderScene(sceneId: string, position: number): Promise<Scene[]>;
  createMarkdownNote(title: string, markdown?: string): Promise<MarkdownNote>;
  updateMarkdownNote(noteId: string, input: { title: string; markdown: string }, expectedRevision: number): Promise<MarkdownNote>;
  deleteMarkdownNote(noteId: string, expectedRevision: number, mode?: 'reject' | 'remove-references'): Promise<void>;
  listMarkdownNotes(): Promise<MarkdownNote[]>;
  searchMarkdownNotes(query: string): Promise<MarkdownNote[]>;
  listNoteLinks(noteId?: string): Promise<NoteLink[]>;
  repairNoteLink(linkId: string, targetId: string): Promise<NoteLink>;
  createCanvas(storyId: string, title: string): Promise<StoryCanvas>;
  listCanvases(storyId?: string): Promise<StoryCanvas[]>;
  getCanvasProjection(canvasId: string): Promise<CanvasProjection>;
  addCanvasNode(canvasId: string, entityId: string, position: CanvasPosition, expectedRevision: number): Promise<CanvasNode>;
  removeCanvasNode(canvasId: string, nodeId: string, expectedRevision: number): Promise<void>;
  saveCanvasLayout(canvasId: string, positions: Array<{ id: string; position: CanvasPosition }>, viewport: CanvasViewport, expectedRevision: number): Promise<StoryCanvas>;
  getDocument(documentId: string): Promise<DocumentHead>;
  getRevision(revisionId: string): Promise<Revision>;
  saveDocument(documentId: string, document: StructuredDocument, expectedRevision: number): Promise<SaveDocumentResult>;
  getStyleProfile(): Promise<EditorStyleProfile>;
  updateStyleProfile(profile: EditorStyleProfile): Promise<EditorStyleProfile>;
  getWritingStats(): Promise<WritingStats>;
  setDailyWordTarget(target: number): Promise<WritingGoals>;
  enterContinuousDraft(chapterId: string): Promise<ContinuousDraft>;
  getContinuousDraft(draftId: string): Promise<ContinuousDraft>;
  keepContinuousSeparate(draftId: string): Promise<ContinuousDraft>;
  automaticallySplitContinuous(draftId: string): Promise<SplitResult>;
  composeChapter(chapterId: string): Promise<StructuredDocument>;
  integrityCheck(): Promise<IntegrityReport>;
  createBackup(): Promise<BackupRecord>;
  recoverFromBackup(backupId: string): Promise<OperationStatus>;
  writeExport(file: { filename: string; bytes: Uint8Array }): Promise<string>;
  getStatus(): Promise<OperationStatus>;
  snapshot(): Promise<ProjectSnapshot>;
}

interface DocumentRecord {
  id: string;
  headRevision: number;
  revisions: Revision[];
}

interface ParsedWikiLink { targetText: string; label?: string; start: number; end: number; occurrence: number; }

/** Parse only explicit Obsidian-style tokens; surrounding Markdown/prose is never inferred. */
function parseWikiLinks(markdown: string): ParsedWikiLink[] {
  const expression = /\[\[([^\[\]|]+?)(?:\|([^\]|]*))?\]\]/g;
  const occurrences = new Map<string, number>();
  const links: ParsedWikiLink[] = [];
  for (const match of markdown.matchAll(expression)) {
    const targetText = match[1].trim();
    if (!targetText || match.index === undefined) continue;
    const label = match[2]?.trim() || undefined;
    const key = `${targetText}\u0000${label ?? ''}`;
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    links.push({ targetText, label, start: match.index, end: match.index + match[0].length, occurrence });
  }
  return links;
}

interface RepositoryState {
  project?: Project;
  stories: Story[];
  chapters: Chapter[];
  sceneSets: SceneSet[];
  scenes: Scene[];
  documents: DocumentRecord[];
  drafts: ContinuousDraft[];
  backups: BackupRecord[];
  /** v3 compatibility only; no longer surfaced or persisted by v4 adapters. */
  worldbuildingItems: WorldbuildingItem[];
  relationships: DomainRelationship[];
  documentLinks: DocumentLink[];
  markdownNotes: MarkdownNote[];
  noteLinks: NoteLink[];
  canvases: StoryCanvas[];
  canvasNodes: CanvasNode[];
  canvasEdges: CanvasEdge[];
  styleProfile: EditorStyleProfile;
  writingGoals: WritingGoals;
  status: OperationStatus;
}

const initialStatus = (): OperationStatus => ({ state: 'idle', message: 'Ready', at: now() });

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeRevision(documentId: string, document: StructuredDocument, number: number, reason: Revision['reason']): Revision {
  return { id: newId('revision'), documentId, number, document: cloneDocument(document), createdAt: now(), reason };
}

/** Deterministic repository used by the UI shell and unit tests. */
export class InMemoryProjectRepository implements ProjectRepository {
  protected state: RepositoryState = {
    stories: [],
    chapters: [],
    sceneSets: [],
    scenes: [],
    documents: [],
    drafts: [],
    backups: [],
    worldbuildingItems: [],
    relationships: [],
    documentLinks: [],
    markdownNotes: [],
    noteLinks: [],
    canvases: [],
    canvasNodes: [],
    canvasEdges: [],
    styleProfile: { ...DEFAULT_EDITOR_STYLE },
    writingGoals: { dailyTarget: 500, dailyWordCounts: {} },
    status: initialStatus()
  };
  protected backupStates = new Map<string, RepositoryState>();

  async createProject(directory: string, name: string): Promise<Project> {
    this.state = { stories: [], chapters: [], sceneSets: [], scenes: [], documents: [], drafts: [], backups: [], worldbuildingItems: [], relationships: [], documentLinks: [], markdownNotes: [], noteLinks: [], canvases: [], canvasNodes: [], canvasEdges: [], styleProfile: { ...DEFAULT_EDITOR_STYLE }, writingGoals: { dailyTarget: 500, dailyWordCounts: {} }, status: initialStatus() };
    this.backupStates.clear();
    const project: Project = { id: newId('project'), name, directory, schemaVersion: 3, createdAt: now(), updatedAt: now() };
    this.state.project = project;
    this.state.status = { state: 'saved', message: 'Project created', at: now() };
    return deepClone(project);
  }

  async openProject(directory: string): Promise<Project> {
    if (!this.state.project || this.state.project.directory !== directory) {
      throw new Error(`No project is open at ${directory}`);
    }
    this.state.status = { state: 'saved', message: 'Project opened offline', at: now() };
    return deepClone(this.state.project);
  }

  async getProject(): Promise<Project> {
    if (!this.state.project) throw new Error('No project is open');
    return deepClone(this.state.project);
  }

  async createStory(title: string): Promise<Story> {
    const project = await this.getProject();
    const story: Story = { id: newId('story'), projectId: project.id, title, position: this.state.stories.length };
    this.state.stories.push(story);
    return deepClone(story);
  }

  async createChapter(storyId: string, title: string): Promise<Chapter> {
    this.requireStory(storyId);
    const activeSet: SceneSet = { id: newId('scene-set'), chapterId: 'pending', createdAt: now(), active: true };
    const chapter: Chapter = { id: newId('chapter'), storyId, title, position: this.state.chapters.filter((item) => item.storyId === storyId).length, activeSceneSetId: activeSet.id };
    activeSet.chapterId = chapter.id;
    this.state.chapters.push(chapter);
    this.state.sceneSets.push(activeSet);
    return deepClone(chapter);
  }

  async createScene(chapterId: string, title: string, document: StructuredDocument = emptyDocument()): Promise<Scene> {
    const chapter = this.requireChapter(chapterId);
    validateDocument(document);
    const sceneSetId = chapter.activeSceneSetId;
    const documentRecord = this.addDocument(document, 'created');
    const scenes = this.state.scenes.filter((scene) => scene.sceneSetId === sceneSetId);
    const scene: Scene = { id: newId('scene'), sceneSetId, title, position: scenes.length, documentId: documentRecord.id };
    this.state.scenes.push(scene);
    return deepClone(scene);
  }

  async listStories(): Promise<Story[]> { return deepClone(this.state.stories.sort((a, b) => a.position - b.position)); }

  async listChapters(storyId?: string): Promise<Chapter[]> {
    return deepClone(this.state.chapters.filter((chapter) => !storyId || chapter.storyId === storyId).sort((a, b) => a.position - b.position));
  }

  async listSceneSets(chapterId: string): Promise<SceneSet[]> {
    return deepClone(this.state.sceneSets.filter((set) => set.chapterId === chapterId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }

  async listScenes(chapterId: string, sceneSetId?: string): Promise<Scene[]> {
    const chapter = this.requireChapter(chapterId);
    const setId = sceneSetId ?? chapter.activeSceneSetId;
    return deepClone(this.state.scenes.filter((scene) => scene.sceneSetId === setId).sort((a, b) => a.position - b.position));
  }

  async renameScene(sceneId: string, title: string): Promise<Scene> {
    const scene = this.requireScene(sceneId);
    scene.title = title;
    return deepClone(scene);
  }

  async reorderScene(sceneId: string, position: number): Promise<Scene[]> {
    const scene = this.requireScene(sceneId);
    const siblings = this.state.scenes.filter((item) => item.sceneSetId === scene.sceneSetId).sort((a, b) => a.position - b.position);
    const from = siblings.findIndex((item) => item.id === sceneId);
    if (from < 0) throw new Error('Scene is not in its scene set');
    const bounded = Math.max(0, Math.min(Math.trunc(position), siblings.length - 1));
    const [moved] = siblings.splice(from, 1);
    siblings.splice(bounded, 0, moved);
    siblings.forEach((item, index) => { item.position = index; });
    return deepClone(siblings);
  }

  async createWorldbuildingItem(input: { kind: WorldbuildingItemKind; title: string; aliases?: string[]; properties?: WorldbuildingProperties }): Promise<WorldbuildingItem> {
    const project = await this.getProject();
    this.validateWorldbuildingInput(input.kind, input.title, input.aliases ?? [], input.properties ?? {});
    const item: WorldbuildingItem = {
      id: newId('world-item'), projectId: project.id, kind: input.kind, title: input.title.trim(),
      aliases: this.normalizedAliases(input.aliases ?? []), properties: deepClone(input.properties ?? {}), revision: 1,
      createdAt: now(), updatedAt: now()
    };
    this.state.worldbuildingItems.push(item);
    this.touchProject();
    this.state.status = { state: 'saved', message: `${item.kind} saved`, at: now() };
    return deepClone(item);
  }

  async updateWorldbuildingItem(itemId: string, input: { title: string; aliases: string[]; properties: WorldbuildingProperties }, expectedRevision: number): Promise<WorldbuildingItem> {
    const item = this.requireWorldbuildingItem(itemId);
    if (item.revision !== expectedRevision) throw this.entityConflict(item.id, expectedRevision, item.revision);
    this.validateWorldbuildingInput(item.kind, input.title, input.aliases, input.properties);
    const previousTitle = item.title;
    item.title = input.title.trim();
    // Keep a renamed wiki target resolvable deterministically while existing
    // NoteLink records continue to point at this stable item ID.
    item.aliases = this.normalizedAliases([...input.aliases, ...(previousTitle === item.title ? [] : [previousTitle])]);
    item.properties = deepClone(input.properties);
    item.revision += 1;
    item.updatedAt = now();
    this.touchProject();
    this.state.status = { state: 'saved', message: `${item.kind} saved`, at: now() };
    return deepClone(item);
  }

  async deleteWorldbuildingItem(itemId: string, expectedRevision: number, mode: 'reject' | 'remove-references' = 'reject'): Promise<void> {
    const item = this.requireWorldbuildingItem(itemId);
    if (item.revision !== expectedRevision) throw this.entityConflict(item.id, expectedRevision, item.revision);
    const relationships = this.state.relationships.filter((relationship) => relationship.sourceId === itemId || relationship.targetId === itemId);
    const links = this.state.documentLinks.filter((link) => link.targetId === itemId);
    const noteLinks = this.state.noteLinks.filter((link) => link.targetId === itemId);
    const canvasNodes = this.state.canvasNodes.filter((node) => node.entityId === itemId);
    if (mode === 'reject' && (relationships.length || links.length || noteLinks.length || canvasNodes.length)) {
      throw new Error(`Cannot delete ${item.title}: ${relationships.length} relationship(s), ${links.length} document link(s), ${noteLinks.length} Markdown link(s), and ${canvasNodes.length} canvas node(s) still refer to it. Choose remove-references to keep unresolved links repairable.`);
    }
    if (mode === 'remove-references') {
      const removedRelationshipIds = new Set(relationships.map((relationship) => relationship.id));
      const removedNodeIds = new Set(canvasNodes.map((node) => node.id));
      this.state.relationships = this.state.relationships.filter((relationship) => !removedRelationshipIds.has(relationship.id));
      this.state.canvasEdges = this.state.canvasEdges.filter((edge) => !removedNodeIds.has(edge.sourceNodeId) && !removedNodeIds.has(edge.targetNodeId));
      this.state.canvasNodes = this.state.canvasNodes.filter((node) => !removedNodeIds.has(node.id));
      this.state.documentLinks = this.state.documentLinks.map((link) => link.targetId === itemId ? { ...link, targetId: undefined, unresolvedLabel: item.title } : link);
      this.state.noteLinks = this.state.noteLinks.map((link) => link.targetId === itemId ? { ...link, targetId: undefined } : link);
    }
    this.state.worldbuildingItems = this.state.worldbuildingItems.filter((candidate) => candidate.id !== itemId);
    this.touchProject();
    this.state.status = { state: 'saved', message: `${item.title} deleted safely`, at: now() };
  }

  async listWorldbuildingItems(kind?: WorldbuildingItemKind): Promise<WorldbuildingItem[]> {
    return deepClone(this.state.worldbuildingItems.filter((item) => !kind || item.kind === kind).sort((left, right) => left.title.localeCompare(right.title)));
  }

  async searchWorldbuilding(query: string): Promise<WorldbuildingItem[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return this.listWorldbuildingItems();
    const linkedIds = new Set(this.state.relationships.filter((relationship) => {
      const source = this.entityTitle(relationship.sourceId).toLocaleLowerCase();
      const target = this.entityTitle(relationship.targetId).toLocaleLowerCase();
      return source.includes(needle) || target.includes(needle) || relationship.type.includes(needle);
    }).flatMap((relationship) => [relationship.sourceId, relationship.targetId]));
    return deepClone(this.state.worldbuildingItems.filter((item) =>
      item.title.toLocaleLowerCase().includes(needle) ||
      item.aliases.some((alias) => alias.toLocaleLowerCase().includes(needle)) ||
      Object.values(item.properties).some((value) => value?.toLocaleLowerCase().includes(needle)) ||
      linkedIds.has(item.id)
    ).sort((left, right) => left.title.localeCompare(right.title)));
  }

  async createRelationship(sourceId: string, targetId: string, type: RelationshipType): Promise<DomainRelationship> {
    this.validateRelationship(sourceId, targetId, type);
    const existing = this.state.relationships.find((relationship) => relationship.sourceId === sourceId && relationship.targetId === targetId && relationship.type === type);
    if (existing) return deepClone(existing);
    const relationship: DomainRelationship = { id: newId('relationship'), sourceId, targetId, type, createdAt: now() };
    this.state.relationships.push(relationship);
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Relationship saved', at: now() };
    return deepClone(relationship);
  }

  async deleteRelationship(relationshipId: string): Promise<void> {
    this.requireRelationship(relationshipId);
    this.state.relationships = this.state.relationships.filter((relationship) => relationship.id !== relationshipId);
    this.state.canvasEdges = this.state.canvasEdges.filter(() => true);
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Relationship removed from links and canvases', at: now() };
  }

  async listRelationships(entityId?: string): Promise<DomainRelationship[]> {
    return deepClone(this.state.relationships.filter((relationship) => !entityId || relationship.sourceId === entityId || relationship.targetId === entityId));
  }

  async listBacklinks(targetId: string): Promise<Backlink[]> {
    this.requireEntity(targetId);
    const relationships: Backlink[] = this.state.relationships.filter((relationship) => relationship.targetId === targetId).map((relationship) => ({
      kind: 'relationship', id: relationship.id, sourceId: relationship.sourceId, sourceTitle: this.entityTitle(relationship.sourceId), type: relationship.type
    }));
    const documents: Backlink[] = this.state.documentLinks.filter((link) => link.targetId === targetId).map((link) => ({
      kind: 'document', id: link.id, sourceId: link.anchor.documentId, sourceTitle: this.documentTitle(link.anchor.documentId), anchor: deepClone(link.anchor)
    }));
    const notes: Backlink[] = this.state.noteLinks.filter((link) => link.targetId === targetId).map((link) => ({
      kind: 'note', id: link.id, sourceId: link.noteId, sourceTitle: this.requireMarkdownNote(link.noteId).title, noteId: link.noteId, start: link.start, end: link.end, label: link.label
    }));
    return [...relationships, ...documents, ...notes];
  }

  async createDocumentLink(anchor: DocumentAnchor, targetId?: string, unresolvedLabel?: string): Promise<DocumentLink> {
    this.validateAnchor(anchor);
    if (targetId) this.requireWorldbuildingItem(targetId);
    if (!targetId && !unresolvedLabel?.trim()) throw new Error('An unresolved document link needs a visible label');
    const link: DocumentLink = { id: newId('document-link'), anchor: deepClone(anchor), targetId, unresolvedLabel: targetId ? undefined : unresolvedLabel!.trim(), createdAt: now() };
    this.state.documentLinks.push(link);
    this.touchProject();
    this.state.status = { state: 'saved', message: targetId ? 'Document link saved' : 'Unresolved document link saved for repair', at: now() };
    return deepClone(link);
  }

  async repairDocumentLink(linkId: string, targetId: string): Promise<DocumentLink> {
    const link = this.requireDocumentLink(linkId);
    this.requireWorldbuildingItem(targetId);
    link.targetId = targetId;
    link.unresolvedLabel = undefined;
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Document link repaired', at: now() };
    return deepClone(link);
  }

  async listDocumentLinks(documentId?: string): Promise<DocumentLink[]> {
    return deepClone(this.state.documentLinks.filter((link) => !documentId || link.anchor.documentId === documentId));
  }

  async createMarkdownNote(title: string, markdown = ''): Promise<MarkdownNote> {
    const project = await this.getProject();
    if (!title.trim()) throw new Error('A note title is required');
    const note: MarkdownNote = { id: newId('note'), projectId: project.id, title: title.trim(), markdown, revision: 1, createdAt: now(), updatedAt: now() };
    this.state.markdownNotes.push(note);
    this.state.noteLinks.push(...this.rebuildNoteLinks(note, []));
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Markdown note saved', at: now() };
    return deepClone(note);
  }

  async updateMarkdownNote(noteId: string, input: { title: string; markdown: string }, expectedRevision: number): Promise<MarkdownNote> {
    const note = this.requireMarkdownNote(noteId);
    if (note.revision !== expectedRevision) throw this.entityConflict(note.id, expectedRevision, note.revision);
    if (!input.title.trim()) throw new Error('A note title is required');
    const previousLinks = this.state.noteLinks.filter((link) => link.noteId === noteId);
    note.title = input.title.trim();
    note.markdown = input.markdown;
    note.revision += 1;
    note.updatedAt = now();
    this.state.noteLinks = [...this.state.noteLinks.filter((link) => link.noteId !== noteId), ...this.rebuildNoteLinks(note, previousLinks)];
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Markdown note and deterministic links saved', at: now() };
    return deepClone(note);
  }

  async deleteMarkdownNote(noteId: string, expectedRevision: number, mode: 'reject' | 'remove-references' = 'reject'): Promise<void> {
    const note = this.requireMarkdownNote(noteId);
    if (note.revision !== expectedRevision) throw this.entityConflict(note.id, expectedRevision, note.revision);
    const incomingLinks = this.state.noteLinks.filter((link) => link.noteId !== noteId && link.targetId === noteId);
    const outgoingLinkIds = new Set(this.state.noteLinks.filter((link) => link.noteId === noteId).map((link) => link.id));
    const nodeIds = new Set(this.state.canvasNodes.filter((node) => node.entityId === noteId).map((node) => node.id));
    if (mode === 'reject' && (incomingLinks.length || nodeIds.size)) throw new Error(`Cannot delete ${note.title}: references remain. Choose remove-references to preserve unresolved Markdown links.`);
    this.state.noteLinks = this.state.noteLinks.filter((link) => link.noteId !== noteId).map((link) => mode === 'remove-references' && link.targetId === noteId ? { ...link, targetId: undefined } : link);
    this.state.canvasNodes = this.state.canvasNodes.filter((node) => !nodeIds.has(node.id));
    this.state.canvasEdges = this.state.canvasEdges.filter((edge) => !outgoingLinkIds.has(edge.noteLinkId) && !nodeIds.has(edge.sourceNodeId) && !nodeIds.has(edge.targetNodeId));
    this.state.markdownNotes = this.state.markdownNotes.filter((candidate) => candidate.id !== noteId);
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Markdown note deleted safely', at: now() };
  }

  async listMarkdownNotes(): Promise<MarkdownNote[]> {
    return deepClone(this.state.markdownNotes.slice().sort((left, right) => left.title.localeCompare(right.title)));
  }

  async searchMarkdownNotes(query: string): Promise<MarkdownNote[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return this.listMarkdownNotes();
    const linkedNoteIds = new Set(this.state.noteLinks.filter((link) => link.targetText.toLocaleLowerCase().includes(needle) || link.label?.toLocaleLowerCase().includes(needle) || (link.targetId && this.requireMarkdownNote(link.targetId).title.toLocaleLowerCase().includes(needle))).map((link) => link.noteId));
    return deepClone(this.state.markdownNotes.filter((note) => note.title.toLocaleLowerCase().includes(needle) || note.markdown.toLocaleLowerCase().includes(needle) || linkedNoteIds.has(note.id)).sort((left, right) => left.title.localeCompare(right.title)));
  }

  async listNoteLinks(noteId?: string): Promise<NoteLink[]> {
    return deepClone(this.state.noteLinks.filter((link) => !noteId || link.noteId === noteId).sort((left, right) => left.start - right.start));
  }

  async repairNoteLink(linkId: string, targetId: string): Promise<NoteLink> {
    const link = this.requireNoteLink(linkId);
    this.requireMarkdownNote(targetId);
    link.targetId = targetId;
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Markdown link repaired by stable ID', at: now() };
    return deepClone(link);
  }

  async createCanvas(storyId: string, title: string): Promise<StoryCanvas> {
    this.requireStory(storyId);
    if (!title.trim()) throw new Error('Canvas title is required');
    const canvas: StoryCanvas = { id: newId('canvas'), storyId, title: title.trim(), viewport: { x: 0, y: 0, zoom: 1 }, revision: 1, createdAt: now(), updatedAt: now() };
    this.state.canvases.push(canvas);
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Story canvas saved', at: now() };
    return deepClone(canvas);
  }

  async listCanvases(storyId?: string): Promise<StoryCanvas[]> {
    return deepClone(this.state.canvases.filter((canvas) => !storyId || canvas.storyId === storyId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
  }

  async getCanvasProjection(canvasId: string): Promise<CanvasProjection> {
    const canvas = this.requireCanvas(canvasId);
    const nodes = this.state.canvasNodes.filter((node) => node.canvasId === canvasId).map((node) => {
      const note = this.requireMarkdownNote(node.entityId);
      return { ...deepClone(node), entityKind: 'note' as const, label: note.title };
    });
    const edges = this.state.noteLinks.flatMap((link) => {
      if (!link.targetId) return [];
      const source = nodes.find((node) => node.entityId === link.noteId);
      const target = nodes.find((node) => node.entityId === link.targetId);
      return source && target ? [{ id: `canvas-note-link-${canvasId}-${link.id}`, canvasId, sourceNodeId: source.id, targetNodeId: target.id, noteLinkId: link.id }] : [];
    });
    return { canvas: deepClone(canvas), nodes, edges };
  }

  async addCanvasNode(canvasId: string, entityId: string, position: CanvasPosition, expectedRevision: number): Promise<CanvasNode> {
    const canvas = this.requireCanvasRevision(canvasId, expectedRevision);
    this.requireMarkdownNote(entityId);
    const existing = this.state.canvasNodes.find((node) => node.canvasId === canvasId && node.entityId === entityId);
    if (existing) return deepClone(existing);
    this.validatePosition(position);
    const node: CanvasNode = { id: newId('canvas-node'), canvasId, entityId, position: deepClone(position) };
    this.state.canvasNodes.push(node);
    this.bumpCanvas(canvas);
    this.state.status = { state: 'saved', message: 'Markdown note added to canvas', at: now() };
    return deepClone(node);
  }

  async removeCanvasNode(canvasId: string, nodeId: string, expectedRevision: number): Promise<void> {
    const canvas = this.requireCanvasRevision(canvasId, expectedRevision);
    const node = this.state.canvasNodes.find((candidate) => candidate.id === nodeId && candidate.canvasId === canvasId);
    if (!node) throw new Error(`Unknown canvas node ${nodeId}`);
    this.state.canvasNodes = this.state.canvasNodes.filter((candidate) => candidate.id !== nodeId);
    this.state.canvasEdges = this.state.canvasEdges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId);
    this.bumpCanvas(canvas);
    this.state.status = { state: 'saved', message: 'Canvas placement removed; domain data is unchanged', at: now() };
  }

  async saveCanvasLayout(canvasId: string, positions: Array<{ id: string; position: CanvasPosition }>, viewport: CanvasViewport, expectedRevision: number): Promise<StoryCanvas> {
    const canvas = this.requireCanvasRevision(canvasId, expectedRevision);
    if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) throw new Error('Canvas viewport is invalid');
    const nodes = new Map(this.state.canvasNodes.filter((node) => node.canvasId === canvasId).map((node) => [node.id, node]));
    for (const update of positions) {
      const node = nodes.get(update.id);
      if (!node) throw new Error(`Unknown canvas node ${update.id}`);
      this.validatePosition(update.position);
      node.position = deepClone(update.position);
    }
    canvas.viewport = deepClone(viewport);
    this.bumpCanvas(canvas);
    this.state.status = { state: 'saved', message: 'Canvas arrangement saved; domain content is unchanged', at: now() };
    return deepClone(canvas);
  }

  async getDocument(documentId: string): Promise<DocumentHead> {
    const record = this.requireDocument(documentId);
    const head = record.revisions[record.revisions.length - 1];
    return { documentId, document: cloneDocument(head.document), revision: record.headRevision, revisionId: head.id };
  }

  async getRevision(revisionId: string): Promise<Revision> {
    for (const record of this.state.documents) {
      const revision = record.revisions.find((item) => item.id === revisionId);
      if (revision) return deepClone(revision);
    }
    throw new Error(`Unknown revision ${revisionId}`);
  }

  async saveDocument(documentId: string, document: StructuredDocument, expectedRevision: number): Promise<SaveDocumentResult> {
    this.state.status = { state: 'saving', message: 'Saving revision…', at: now() };
    validateDocument(document);
    const record = this.requireDocument(documentId);
    if (record.headRevision !== expectedRevision) {
      this.state.status = { state: 'revision-conflict', message: 'Save stopped: this document changed elsewhere', at: now() };
      throw new RevisionConflictError(documentId, expectedRevision, record.headRevision);
    }
    const projectWordsBefore = this.currentProjectWordCount();
    record.headRevision += 1;
    const revision = makeRevision(documentId, document, record.headRevision, 'edit');
    record.revisions.push(revision);
    const projectWordsAfter = this.currentProjectWordCount();
    this.recordDailyWordDelta(projectWordsAfter - projectWordsBefore);
    this.touchProject();
    this.state.status = { state: 'saved', message: `Saved revision ${record.headRevision}`, at: now() };
    return { revision: deepClone(revision), status: this.state.status };
  }

  async getStyleProfile(): Promise<EditorStyleProfile> {
    return deepClone(this.state.styleProfile ?? DEFAULT_EDITOR_STYLE);
  }

  async updateStyleProfile(profile: EditorStyleProfile): Promise<EditorStyleProfile> {
    this.validateStyleProfile(profile);
    this.state.styleProfile = { ...DEFAULT_EDITOR_STYLE, ...deepClone(profile), pageSize: profile.pageSize ?? DEFAULT_EDITOR_STYLE.pageSize };
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Writing style saved', at: now() };
    return deepClone(this.state.styleProfile);
  }

  async getWritingStats(): Promise<WritingStats> {
    const date = localCalendarDate();
    return {
      date,
      dailyTarget: this.state.writingGoals?.dailyTarget ?? 500,
      dailyWords: this.state.writingGoals?.dailyWordCounts?.[date] ?? 0,
      projectWords: this.currentProjectWordCount()
    };
  }

  async setDailyWordTarget(target: number): Promise<WritingGoals> {
    if (!Number.isFinite(target) || target < 0) throw new Error('Daily word target must be zero or greater');
    this.state.writingGoals.dailyTarget = Math.trunc(target);
    this.touchProject();
    this.state.status = { state: 'saved', message: 'Daily writing goal saved', at: now() };
    return deepClone(this.state.writingGoals);
  }

  async enterContinuousDraft(chapterId: string): Promise<ContinuousDraft> {
    const chapter = this.requireChapter(chapterId);
    const scenes = await this.listScenes(chapterId);
    const documents = new Map<string, StructuredDocument>();
    for (const scene of scenes) documents.set(scene.documentId, (await this.getDocument(scene.documentId)).document);
    const composed = composeChapter(scenes, documents);
    const sourceRevision = this.addDocument(composed, 'continuous-draft').revisions[0];
    const draft: ContinuousDraft = { id: newId('draft'), chapterId, documentId: sourceRevision.documentId, baseSceneSetId: chapter.activeSceneSetId, sourceRevisionId: sourceRevision.id, status: 'open', createdAt: now() };
    this.state.drafts.push(draft);
    this.state.status = { state: 'saved', message: 'Continuous draft opened from a scene snapshot', at: now() };
    return deepClone(draft);
  }

  async getContinuousDraft(draftId: string): Promise<ContinuousDraft> {
    return deepClone(this.requireDraft(draftId));
  }

  async keepContinuousSeparate(draftId: string): Promise<ContinuousDraft> {
    const draft = this.requireDraft(draftId);
    if (draft.status !== 'open') throw new Error(`Draft is already ${draft.status}`);
    draft.status = 'kept-separate';
    this.state.status = { state: 'saved', message: 'Continuous draft kept separately; scenes unchanged', at: now() };
    return deepClone(draft);
  }

  async automaticallySplitContinuous(draftId: string): Promise<SplitResult> {
    // The complete operation is a single state transaction. A thrown marker or
    // validation error leaves the original active set and draft untouched.
    const before = deepClone(this.state);
    try {
      const draft = this.requireDraft(draftId);
      if (draft.status !== 'open') throw new Error(`Draft is already ${draft.status}`);
      const source = this.requireDocument(draft.documentId).revisions.at(-1)!;
      const splitDocuments = splitByExplicitMarkers(source.document);
      const chapter = this.requireChapter(draft.chapterId);
      const oldSet = this.state.sceneSets.find((set) => set.id === chapter.activeSceneSetId);
      if (!oldSet) throw new Error('Active scene set is missing');
      oldSet.active = false;
      const sceneSet: SceneSet = { id: newId('scene-set'), chapterId: chapter.id, createdAt: now(), sourceRevisionId: draft.sourceRevisionId, active: true };
      this.state.sceneSets.push(sceneSet);
      const scenes: Scene[] = [];
      splitDocuments.forEach((document, position) => {
        validateDocument(document);
        const record = this.addDocument(document, 'automatic-split');
        scenes.push({ id: newId('scene'), sceneSetId: sceneSet.id, title: `Scene ${position + 1}`, position, documentId: record.id });
      });
      this.state.scenes.push(...scenes);
      chapter.activeSceneSetId = sceneSet.id;
      draft.status = 'split';
      this.state.status = { state: 'saved', message: `Created ${scenes.length} scenes from explicit markers`, at: now() };
      return { sceneSet: deepClone(sceneSet), scenes: deepClone(scenes), sourceRevisionId: draft.sourceRevisionId };
    } catch (error) {
      this.state = before;
      this.state.status = { state: 'failed', message: error instanceof Error ? error.message : 'Automatic split failed', at: now() };
      throw error;
    }
  }

  async composeChapter(chapterId: string): Promise<StructuredDocument> {
    const scenes = await this.listScenes(chapterId);
    const documents = new Map<string, StructuredDocument>();
    for (const scene of scenes) documents.set(scene.documentId, (await this.getDocument(scene.documentId)).document);
    return composeChapter(scenes, documents);
  }

  async integrityCheck(): Promise<IntegrityReport> {
    this.state.status = { state: 'integrity-check', message: 'Checking project integrity…', at: now() };
    try {
      if (!this.state.project) throw new Error('Project metadata is missing');
      for (const document of this.state.documents) {
        for (const revision of document.revisions) validateDocument(revision.document);
      }
      for (const chapter of this.state.chapters) {
        if (!this.state.sceneSets.some((set) => set.id === chapter.activeSceneSetId && set.active)) throw new Error(`Chapter ${chapter.id} has no active scene set`);
      }
      for (const relationship of this.state.relationships) this.validateRelationship(relationship.sourceId, relationship.targetId, relationship.type);
      for (const link of this.state.documentLinks) {
        this.validateAnchor(link.anchor);
        if (link.targetId) this.requireWorldbuildingItem(link.targetId);
        if (!link.targetId && !link.unresolvedLabel) throw new Error(`Document link ${link.id} has no target or repair label`);
      }
      for (const note of this.state.markdownNotes) {
        if (!note.title.trim() || note.revision < 1) throw new Error(`Markdown note ${note.id} is invalid`);
      }
      for (const link of this.state.noteLinks) {
        this.requireMarkdownNote(link.noteId);
        if (link.targetId) this.requireMarkdownNote(link.targetId);
        if (!link.targetText.trim() || link.start < 0 || link.end < link.start) throw new Error(`Markdown link ${link.id} is invalid`);
      }
      for (const canvas of this.state.canvases) {
        this.requireStory(canvas.storyId);
        if (canvas.revision < 1) throw new Error(`Canvas ${canvas.id} has an invalid revision`);
      }
      for (const node of this.state.canvasNodes) { this.requireCanvas(node.canvasId); this.requireMarkdownNote(node.entityId); this.validatePosition(node.position); }
      for (const edge of this.state.canvasEdges) {
        const source = this.requireCanvasNode(edge.canvasId, edge.sourceNodeId);
        const target = this.requireCanvasNode(edge.canvasId, edge.targetNodeId);
        const link = this.requireNoteLink(edge.noteLinkId);
        if (source.entityId !== link.noteId || target.entityId !== link.targetId) throw new Error(`Canvas edge ${edge.id} does not match its Markdown link`);
      }
      const report = { ok: true, message: 'Integrity check passed', checkedAt: now() };
      this.state.status = { state: 'saved', message: report.message, at: report.checkedAt };
      return report;
    } catch (error) {
      const report = { ok: false, message: error instanceof Error ? error.message : 'Integrity check failed', checkedAt: now() };
      this.state.status = { state: 'failed', message: report.message, at: report.checkedAt };
      return report;
    }
  }

  async createBackup(): Promise<BackupRecord> {
    const backup: BackupRecord = { id: newId('backup'), path: `${this.state.project?.directory ?? 'project'}/.weave/backups/${Date.now()}.db`, createdAt: now(), integrity: 'ok' };
    this.backupsSet(backup, deepClone(this.state));
    this.state.status = { state: 'backup', message: 'Backup captured', at: now() };
    return deepClone(backup);
  }

  async recoverFromBackup(backupId: string): Promise<OperationStatus> {
    const snapshot = this.backupStates.get(backupId);
    if (!snapshot) throw new Error(`Unknown backup ${backupId}`);
    this.state.status = { state: 'recovering', message: 'Recovering backup…', at: now() };
    this.state = deepClone(snapshot);
    this.state.status = { state: 'recovered', message: 'Recovered backup; verify the project before editing', at: now() };
    return this.state.status;
  }

  async writeExport(file: { filename: string; bytes: Uint8Array }): Promise<string> {
    // Browser fallback downloads through the UI; desktop uses the Tauri command.
    return `${this.state.project?.directory ?? 'project'}/.weave/exports/${file.filename}`;
  }

  async getStatus(): Promise<OperationStatus> { return deepClone(this.state.status); }

  async snapshot(): Promise<ProjectSnapshot> {
    if (!this.state.project) throw new Error('No project is open');
    return {
      project: deepClone(this.state.project),
      stories: deepClone(this.state.stories),
      chapters: deepClone(this.state.chapters),
      sceneSets: deepClone(this.state.sceneSets),
      scenes: deepClone(this.state.scenes),
      continuousDrafts: deepClone(this.state.drafts),
      markdownNotes: deepClone(this.state.markdownNotes),
      noteLinks: deepClone(this.state.noteLinks),
      canvases: deepClone(this.state.canvases),
      styleProfile: deepClone(this.state.styleProfile ?? DEFAULT_EDITOR_STYLE),
      writingStats: await this.getWritingStats(),
      status: deepClone(this.state.status)
    };
  }

  protected currentProjectWordCount(): number {
    return calculateProjectWordCount(this.state.chapters, this.state.scenes, this.state.drafts, documentMapFromRecords(this.state.documents));
  }

  private recordDailyWordDelta(delta: number): void {
    if (!delta) return;
    const date = localCalendarDate();
    const goals = this.state.writingGoals ?? { dailyTarget: 500, dailyWordCounts: {} };
    goals.dailyWordCounts[date] = Math.max(0, (goals.dailyWordCounts[date] ?? 0) + delta);
    this.state.writingGoals = goals;
  }

  private validateStyleProfile(profile: EditorStyleProfile): void {
    if (!profile.fontFamily.trim()) throw new Error('Font family is required');
    if (!Number.isFinite(profile.fontSizePt) || profile.fontSizePt < 8 || profile.fontSizePt > 72) throw new Error('Font size must be between 8 and 72 pt');
    if (!['single', '1.15', '1.5', 'double'].includes(profile.lineSpacing)) throw new Error('Unsupported line spacing');
    if (profile.pageSize !== undefined && !['letter', 'a4', 'legal'].includes(profile.pageSize)) throw new Error('Unsupported page size');
  }

  protected addDocument(document: StructuredDocument, reason: Revision['reason']): DocumentRecord {
    validateDocument(document);
    const id = newId('document');
    const revision = makeRevision(id, document, 1, reason);
    const record = { id, headRevision: 1, revisions: [revision] };
    this.state.documents.push(record);
    return record;
  }

  protected requireMarkdownNote(noteId: string): MarkdownNote {
    const note = this.state.markdownNotes.find((candidate) => candidate.id === noteId);
    if (!note) throw new Error(`Unknown Markdown note ${noteId}`);
    return note;
  }

  protected requireNoteLink(linkId: string): NoteLink {
    const link = this.state.noteLinks.find((candidate) => candidate.id === linkId);
    if (!link) throw new Error(`Unknown Markdown link ${linkId}`);
    return link;
  }

  /** Resolves one exact wiki target against local note titles, never prose. */
  protected resolveWikiTarget(targetText: string): string | undefined {
    const normalized = targetText.trim().toLocaleLowerCase();
    const candidates = this.state.markdownNotes.filter((note) => note.title.toLocaleLowerCase() === normalized).map((note) => note.id);
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  protected rebuildNoteLinks(note: MarkdownNote, previous: NoteLink[]): NoteLink[] {
    return parseWikiLinks(note.markdown).map((parsed) => {
      const existing = previous.find((link) => link.targetText === parsed.targetText && link.label === parsed.label && link.occurrence === parsed.occurrence);
      const targetId = existing?.targetId && this.noteExists(existing.targetId) ? existing.targetId : this.resolveWikiTarget(parsed.targetText);
      return { id: existing?.id ?? newId('note-link'), noteId: note.id, targetId, targetText: parsed.targetText, label: parsed.label, start: parsed.start, end: parsed.end, occurrence: parsed.occurrence, createdAt: existing?.createdAt ?? now() };
    });
  }

  protected noteExists(noteId: string): boolean {
    try { this.requireMarkdownNote(noteId); return true; } catch { return false; }
  }

  protected requireWorldbuildingItem(itemId: string): WorldbuildingItem {
    const item = this.state.worldbuildingItems.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`Unknown worldbuilding item ${itemId}`);
    return item;
  }

  protected requireRelationship(relationshipId: string): DomainRelationship {
    const relationship = this.state.relationships.find((candidate) => candidate.id === relationshipId);
    if (!relationship) throw new Error(`Unknown relationship ${relationshipId}`);
    return relationship;
  }

  protected requireDocumentLink(linkId: string): DocumentLink {
    const link = this.state.documentLinks.find((candidate) => candidate.id === linkId);
    if (!link) throw new Error(`Unknown document link ${linkId}`);
    return link;
  }

  protected requireCanvas(canvasId: string): StoryCanvas {
    const canvas = this.state.canvases.find((candidate) => candidate.id === canvasId);
    if (!canvas) throw new Error(`Unknown canvas ${canvasId}`);
    return canvas;
  }

  protected requireCanvasRevision(canvasId: string, expectedRevision: number): StoryCanvas {
    const canvas = this.requireCanvas(canvasId);
    if (canvas.revision !== expectedRevision) throw this.entityConflict(canvasId, expectedRevision, canvas.revision);
    return canvas;
  }

  protected requireCanvasNode(canvasId: string, nodeId: string): CanvasNode {
    const node = this.state.canvasNodes.find((candidate) => candidate.canvasId === canvasId && candidate.id === nodeId);
    if (!node) throw new Error(`Unknown canvas node ${nodeId}`);
    return node;
  }

  protected requireEntity(entityId: string): ResolvedEntity {
    const item = this.state.worldbuildingItems.find((candidate) => candidate.id === entityId);
    if (item) return { id: item.id, title: item.title, kind: item.kind };
    const chapter = this.state.chapters.find((candidate) => candidate.id === entityId);
    if (chapter) return { id: chapter.id, title: chapter.title, kind: 'chapter' };
    const scene = this.state.scenes.find((candidate) => candidate.id === entityId);
    if (scene) return { id: scene.id, title: scene.title, kind: 'scene' };
    const note = this.state.markdownNotes.find((candidate) => candidate.id === entityId);
    if (note) return { id: note.id, title: note.title, kind: 'note' };
    throw new Error(`Unknown relationship entity ${entityId}`);
  }

  protected entityTitle(entityId: string): string { return this.requireEntity(entityId).title; }

  protected documentTitle(documentId: string): string {
    const scene = this.state.scenes.find((candidate) => candidate.documentId === documentId);
    if (scene) return scene.title;
    const draft = this.state.drafts.find((candidate) => candidate.documentId === documentId);
    return draft ? 'Continuous draft' : 'Document';
  }

  protected validateWorldbuildingInput(kind: WorldbuildingItemKind, title: string, aliases: string[], properties: WorldbuildingProperties): void {
    if (!['world', 'place', 'character', 'term'].includes(kind)) throw new Error('Unsupported worldbuilding item type');
    if (!title.trim()) throw new Error('A title is required');
    if (!Array.isArray(aliases)) throw new Error('Aliases must be a list');
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('Structured properties are required');
    const allowedProperties: Record<WorldbuildingItemKind, readonly string[]> = {
      world: ['genre', 'era', 'summary'], place: ['placeType', 'region', 'description'],
      character: ['role', 'pronouns', 'summary'], term: ['category', 'definition']
    };
    for (const [key, value] of Object.entries(properties)) {
      if (!allowedProperties[kind].includes(key) || typeof value !== 'string') throw new Error('Unsupported structured property');
    }
  }

  protected normalizedAliases(aliases: string[]): string[] {
    return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean).map((alias) => alias.slice(0, 160)))];
  }

  protected validateRelationship(sourceId: string, targetId: string, type: RelationshipType): void {
    if (sourceId === targetId) throw new Error('A relationship must connect two different items');
    this.requireEntity(sourceId); this.requireEntity(targetId);
    if (!(RELATIONSHIP_TYPES as readonly string[]).includes(type)) throw new Error('Unsupported relationship type');
  }

  protected validateAnchor(anchor: DocumentAnchor): void {
    if (!Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) || anchor.start < 0 || anchor.end < anchor.start) throw new Error('Document link offsets are invalid');
    const record = this.requireDocument(anchor.documentId);
    const block = record.revisions.at(-1)?.document.blocks.find((candidate) => candidate.id === anchor.blockId);
    if (!block || anchor.end > blockText(block).length) throw new Error('Document link anchor does not point to the current structured document');
  }

  protected validatePosition(position: CanvasPosition): void {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('Canvas position is invalid');
  }

  protected entityCanAppearOnStory(entityId: string, storyId: string): boolean {
    const chapter = this.state.chapters.find((candidate) => candidate.id === entityId);
    if (chapter) return chapter.storyId === storyId;
    const scene = this.state.scenes.find((candidate) => candidate.id === entityId);
    if (!scene) return true;
    const set = this.state.sceneSets.find((candidate) => candidate.id === scene.sceneSetId);
    const sceneChapter = set && this.state.chapters.find((candidate) => candidate.id === set.chapterId);
    return sceneChapter?.storyId === storyId;
  }

  protected bumpCanvas(canvas: StoryCanvas): void {
    canvas.revision += 1;
    canvas.updatedAt = now();
    this.touchProject();
  }

  protected entityConflict(entityId: string, expectedRevision: number, currentRevision: number): EntityRevisionConflictError {
    this.state.status = { state: 'revision-conflict', message: 'Save stopped: this item changed elsewhere', at: now() };
    return new EntityRevisionConflictError(entityId, expectedRevision, currentRevision);
  }

  protected requireStory(storyId: string): Story {
    const story = this.state.stories.find((item) => item.id === storyId);
    if (!story) throw new Error(`Unknown story ${storyId}`);
    return story;
  }

  protected requireChapter(chapterId: string): Chapter {
    const chapter = this.state.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error(`Unknown chapter ${chapterId}`);
    return chapter;
  }

  protected requireScene(sceneId: string): Scene {
    const scene = this.state.scenes.find((item) => item.id === sceneId);
    if (!scene) throw new Error(`Unknown scene ${sceneId}`);
    return scene;
  }

  protected requireDocument(documentId: string): DocumentRecord {
    const document = this.state.documents.find((item) => item.id === documentId);
    if (!document) throw new Error(`Unknown document ${documentId}`);
    return document;
  }

  protected requireDraft(draftId: string): ContinuousDraft {
    const draft = this.state.drafts.find((item) => item.id === draftId);
    if (!draft) throw new Error(`Unknown continuous draft ${draftId}`);
    return draft;
  }

  private touchProject(): void {
    if (this.state.project) this.state.project.updatedAt = now();
  }

  private backupsSet(backup: BackupRecord, state: RepositoryState): void {
    this.state.backups.push(backup);
    this.backupStates.set(backup.id, state);
  }
}

export { documentFromText };
