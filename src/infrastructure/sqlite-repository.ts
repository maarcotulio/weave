/*
 * Node-side repository used by desktop smoke tests and recovery tooling. The
 * Tauri app uses the same use cases through tauri-repository.ts; neither path
 * lets renderer components issue SQL.
 *
 * Node 24's built-in node:sqlite keeps the development repository dependency
 * free. The Rust/Tauri repository in src-tauri is the production boundary.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (path: string) => any };
import { InMemoryProjectRepository } from '../domain/repository';
import { now } from '../domain/document';
import { DEFAULT_EDITOR_STYLE, type EditorStyleProfile, type WritingGoals } from '../domain/types';
import type { BackupRecord, OperationStatus, Project, StructuredDocument, MarkdownNote, NoteLink, StoryCanvas, CanvasPosition, CanvasViewport, CanvasNode, CanvasEdge, CanvasEngine, ExcalidrawSceneState } from '../domain/types';
import type { SaveDocumentResult, SplitResult, DocumentHead } from '../domain/repository';
import type { Chapter, ContinuousDraft, IntegrityReport, Revision, Scene, SceneSet, Story } from '../domain/types';

interface PersistedState {
  project?: Project;
  stories: Story[];
  chapters: Chapter[];
  sceneSets: SceneSet[];
  scenes: Scene[];
  documents: any[];
  drafts: ContinuousDraft[];
  backups: BackupRecord[];
  markdownNotes: MarkdownNote[];
  noteLinks: NoteLink[];
  canvases: StoryCanvas[];
  canvasNodes: CanvasNode[];
  canvasEdges: CanvasEdge[];
  styleProfile: EditorStyleProfile;
  writingGoals: WritingGoals;
  status: OperationStatus;
}

/** SQLite-backed local project repository. */
export class SQLiteProjectRepository extends InMemoryProjectRepository {
  readonly databasePath: string;
  readonly projectDirectory: string;
  private readonly database: any;

  constructor(projectDirectory: string) {
    super();
    this.projectDirectory = projectDirectory;
    this.databasePath = join(projectDirectory, '.weave', 'project.db');
    mkdirSync(join(projectDirectory, '.weave', 'files'), { recursive: true });
    mkdirSync(join(projectDirectory, '.weave', 'backups'), { recursive: true });
    this.database = new DatabaseSync(this.databasePath);
    this.state.status = { state: 'migrating', message: 'Applying local project migrations…', at: now() };
    this.migrate();
    this.loadState();
    this.state.status = { state: 'migrating', message: 'Project schema ready; opening safely…', at: now() };
  }

  async createProject(directory: string, name: string): Promise<Project> {
    const project = await super.createProject(directory, name);
    this.persist();
    return project;
  }

  async openProject(directory: string): Promise<Project> {
    if (directory !== this.projectDirectory) throw new Error('Repository opened for a different directory');
    this.loadState();
    const project = await super.openProject(directory);
    this.persist();
    return project;
  }

  async createStory(title: string): Promise<Story> { const value = await super.createStory(title); this.persist(); return value; }
  async createChapter(storyId: string, title: string): Promise<Chapter> { const value = await super.createChapter(storyId, title); this.persist(); return value; }
  async createScene(chapterId: string, title: string, document?: StructuredDocument): Promise<Scene> { const value = await super.createScene(chapterId, title, document); this.persist(); return value; }
  async renameScene(sceneId: string, title: string): Promise<Scene> { const value = await super.renameScene(sceneId, title); this.persist(); return value; }
  async reorderScene(sceneId: string, position: number): Promise<Scene[]> { const value = await super.reorderScene(sceneId, position); this.persist(); return value; }
  async createMarkdownNote(title: string, markdown?: string): Promise<MarkdownNote> { const value = await super.createMarkdownNote(title, markdown); this.persist(); return value; }
  async updateMarkdownNote(noteId: string, input: { title: string; markdown: string }, expectedRevision: number): Promise<MarkdownNote> { try { const value = await super.updateMarkdownNote(noteId, input, expectedRevision); this.persist(); return value; } catch (error) { this.persist(); throw error; } }
  async deleteMarkdownNote(noteId: string, expectedRevision: number, mode?: 'reject' | 'remove-references'): Promise<void> { try { await super.deleteMarkdownNote(noteId, expectedRevision, mode); this.persist(); } catch (error) { this.persist(); throw error; } }
  async repairNoteLink(linkId: string, targetId: string): Promise<NoteLink> { const value = await super.repairNoteLink(linkId, targetId); this.persist(); return value; }
  async createCanvas(storyId: string, title: string, engine?: CanvasEngine): Promise<StoryCanvas> { const value = await super.createCanvas(storyId, title, engine); this.persist(); return value; }
  async saveExcalidrawScene(canvasId: string, scene: ExcalidrawSceneState, expectedRevision: number): Promise<StoryCanvas> { try { const value = await super.saveExcalidrawScene(canvasId, scene, expectedRevision); this.persist(); return value; } catch (error) { this.persist(); throw error; } }
  async addCanvasNode(canvasId: string, entityId: string, position: CanvasPosition, expectedRevision: number): Promise<CanvasNode> { try { const value = await super.addCanvasNode(canvasId, entityId, position, expectedRevision); this.persist(); return value; } catch (error) { this.persist(); throw error; } }
  async removeCanvasNode(canvasId: string, nodeId: string, expectedRevision: number): Promise<void> { try { await super.removeCanvasNode(canvasId, nodeId, expectedRevision); this.persist(); } catch (error) { this.persist(); throw error; } }
  async saveCanvasLayout(canvasId: string, positions: Array<{ id: string; position: CanvasPosition }>, viewport: CanvasViewport, expectedRevision: number): Promise<StoryCanvas> { try { const value = await super.saveCanvasLayout(canvasId, positions, viewport, expectedRevision); this.persist(); return value; } catch (error) { this.persist(); throw error; } }

  async updateStyleProfile(profile: EditorStyleProfile): Promise<EditorStyleProfile> {
    const value = await super.updateStyleProfile(profile);
    this.persist();
    return value;
  }

  async setDailyWordTarget(target: number): Promise<WritingGoals> {
    const value = await super.setDailyWordTarget(target);
    this.persist();
    return value;
  }

  async saveDocument(documentId: string, document: StructuredDocument, expectedRevision: number): Promise<SaveDocumentResult> {
    try {
      const value = await super.saveDocument(documentId, document, expectedRevision);
      this.persist();
      return value;
    } catch (error) {
      this.persist();
      throw error;
    }
  }

  async enterContinuousDraft(chapterId: string): Promise<ContinuousDraft> { const value = await super.enterContinuousDraft(chapterId); this.persist(); return value; }
  async keepContinuousSeparate(draftId: string): Promise<ContinuousDraft> { const value = await super.keepContinuousSeparate(draftId); this.persist(); return value; }

  async automaticallySplitContinuous(draftId: string): Promise<SplitResult> {
    try {
      const value = await super.automaticallySplitContinuous(draftId);
      this.persist();
      return value;
    } catch (error) {
      this.persist();
      throw error;
    }
  }

  async createBackup(): Promise<BackupRecord> {
    const value = await super.createBackup();
    this.persist();
    const backupPath = join(this.projectDirectory, '.weave', 'backups', `${value.id}.db`);
    // Flush WAL before the byte-for-byte copy. Recovery also stores a durable
    // state snapshot so a backup remains useful even if a platform copies only
    // the main SQLite file.
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    copyFileSync(this.databasePath, backupPath);
    value.path = backupPath;
    const storedBackup = this.state.backups.find((backup) => backup.id === value.id);
    if (storedBackup) storedBackup.path = backupPath;
    const record = this.database.prepare('SELECT state_json FROM project_state ORDER BY id DESC LIMIT 1').get() as { state_json: string } | undefined;
    this.database.prepare('INSERT OR REPLACE INTO backups (id, path, created_at, integrity, state_json) VALUES (?, ?, ?, ?, ?)').run(value.id, value.path, value.createdAt, value.integrity, record?.state_json ?? '{}');
    this.persist();
    return value;
  }

  async recoverFromBackup(backupId: string): Promise<OperationStatus> {
    const backup = this.database.prepare('SELECT state_json FROM backups WHERE id = ?').get(backupId) as { state_json: string } | undefined;
    if (!backup) throw new Error(`Unknown backup ${backupId}`);
    const restored = JSON.parse(backup.state_json) as any;
    this.state = {
      ...restored,
      worldbuildingItems: [],
      relationships: [],
      documentLinks: [],
      markdownNotes: restored.markdownNotes ?? [],
      noteLinks: restored.noteLinks ?? [],
      canvases: (restored.canvases ?? []).map((canvas: StoryCanvas) => ({ ...canvas, engine: canvas.engine ?? 'react-flow' })),
      canvasNodes: restored.canvasNodes ?? [],
      canvasEdges: restored.canvasEdges ?? [],
      styleProfile: { ...DEFAULT_EDITOR_STYLE, ...(restored.styleProfile ?? {}) },
      writingGoals: { dailyTarget: 500, dailyWordCounts: {}, ...(restored.writingGoals ?? {}) }
    };
    const noteIds = new Set(this.state.markdownNotes.map((note) => note.id));
    this.state.canvasNodes = this.state.canvasNodes.filter((node) => noteIds.has(node.entityId));
    this.state.canvasEdges = [];
    if (this.state.project) this.state.project.schemaVersion = Math.max(this.state.project.schemaVersion, 5);
    this.state.status = { state: 'recovered', message: 'Recovered backup; verify the project before editing', at: now() };
    this.persist();
    return this.state.status;
  }

  async integrityCheck(): Promise<IntegrityReport> {
    this.state.status = { state: 'integrity-check', message: 'Checking SQLite and document integrity…', at: now() };
    const sqlite = this.database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (sqlite.integrity_check !== 'ok') {
      const report = { ok: false, message: `SQLite integrity check: ${sqlite.integrity_check}`, checkedAt: now() };
      this.state.status = { state: 'failed', message: report.message, at: report.checkedAt };
      this.persist();
      return report;
    }
    const report = await super.integrityCheck();
    this.persist();
    return report;
  }

  close(): void { this.database.close(); }

  private migrate(): void {
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        integrity TEXT NOT NULL,
        state_json TEXT NOT NULL
      );
    `);
    const migration = this.database.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
    if (!migration) {
      this.database.exec('BEGIN; INSERT INTO schema_migrations(version, applied_at) VALUES (1, datetime(\'now\')); COMMIT;');
    }
    const worldbuildingMigration = this.database.prepare('SELECT version FROM schema_migrations WHERE version = 2').get();
    if (!worldbuildingMigration) {
      this.database.exec('BEGIN; INSERT INTO schema_migrations(version, applied_at) VALUES (2, datetime(\'now\')); COMMIT;');
    }
    const markdownNotesMigration = this.database.prepare('SELECT version FROM schema_migrations WHERE version = 3').get();
    if (!markdownNotesMigration) this.database.exec('BEGIN; INSERT INTO schema_migrations(version, applied_at) VALUES (3, datetime(\'now\')); COMMIT;');
    const notesOnlyMigration = this.database.prepare('SELECT version FROM schema_migrations WHERE version = 4').get();
    if (!notesOnlyMigration) this.database.exec('BEGIN; INSERT INTO schema_migrations(version, applied_at) VALUES (4, datetime(\'now\')); COMMIT;');
    const canvasEnginesMigration = this.database.prepare('SELECT version FROM schema_migrations WHERE version = 5').get();
    if (!canvasEnginesMigration) this.database.exec('BEGIN; INSERT INTO schema_migrations(version, applied_at) VALUES (5, datetime(\'now\')); COMMIT;');
  }

  private loadState(): void {
    const row = this.database.prepare('SELECT state_json FROM project_state WHERE id = 1').get() as { state_json: string } | undefined;
    if (!row) return;
    const value = JSON.parse(row.state_json) as any;
    this.state = {
      ...value,
      worldbuildingItems: [],
      relationships: [],
      documentLinks: [],
      markdownNotes: value.markdownNotes ?? [],
      noteLinks: value.noteLinks ?? [],
      canvases: (value.canvases ?? []).map((canvas: StoryCanvas) => ({ ...canvas, engine: canvas.engine ?? 'react-flow' })),
      canvasNodes: value.canvasNodes ?? [],
      canvasEdges: value.canvasEdges ?? [],
      styleProfile: { ...DEFAULT_EDITOR_STYLE, ...(value.styleProfile ?? {}) },
      writingGoals: { dailyTarget: 500, dailyWordCounts: {}, ...(value.writingGoals ?? {}) }
    };
    const noteIds = new Set(this.state.markdownNotes.map((note) => note.id));
    this.state.canvasNodes = this.state.canvasNodes.filter((node) => noteIds.has(node.entityId));
    this.state.canvasEdges = [];
    if (this.state.project) this.state.project.schemaVersion = Math.max(this.state.project.schemaVersion, 5);
  }

  private persist(): void {
    const serializable = JSON.stringify(this.state);
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.prepare('INSERT INTO project_state(id, state_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at').run(serializable, now());
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    writeFileSync(join(this.projectDirectory, '.weave', 'files', 'latest.json'), serializable, 'utf8');
  }
}
