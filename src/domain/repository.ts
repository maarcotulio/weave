import {
  cloneDocument,
  documentFromText,
  emptyDocument,
  newId,
  now,
  validateDocument
} from './document';
import { composeChapter, splitByExplicitMarkers } from './scenes';
import {
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
  type StructuredDocument
} from './types';

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
  getDocument(documentId: string): Promise<DocumentHead>;
  getRevision(revisionId: string): Promise<Revision>;
  saveDocument(documentId: string, document: StructuredDocument, expectedRevision: number): Promise<SaveDocumentResult>;
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

interface RepositoryState {
  project?: Project;
  stories: Story[];
  chapters: Chapter[];
  sceneSets: SceneSet[];
  scenes: Scene[];
  documents: DocumentRecord[];
  drafts: ContinuousDraft[];
  backups: BackupRecord[];
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
    status: initialStatus()
  };
  protected backupStates = new Map<string, RepositoryState>();

  async createProject(directory: string, name: string): Promise<Project> {
    this.state = { stories: [], chapters: [], sceneSets: [], scenes: [], documents: [], drafts: [], backups: [], status: initialStatus() };
    this.backupStates.clear();
    const project: Project = { id: newId('project'), name, directory, schemaVersion: 1, createdAt: now(), updatedAt: now() };
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
    record.headRevision += 1;
    const revision = makeRevision(documentId, document, record.headRevision, 'edit');
    record.revisions.push(revision);
    this.touchProject();
    this.state.status = { state: 'saved', message: `Saved revision ${record.headRevision}`, at: now() };
    return { revision: deepClone(revision), status: this.state.status };
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
      status: deepClone(this.state.status)
    };
  }

  protected addDocument(document: StructuredDocument, reason: Revision['reason']): DocumentRecord {
    validateDocument(document);
    const id = newId('document');
    const revision = makeRevision(id, document, 1, reason);
    const record = { id, headRevision: 1, revisions: [revision] };
    this.state.documents.push(record);
    return record;
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
