/** Versioned structured content. HTML is never the source of truth. */
export const DOCUMENT_FORMAT_VERSION = 1 as const;
export type DocumentFormatVersion = typeof DOCUMENT_FORMAT_VERSION;

export type SemanticMark = 'bold' | 'italic' | 'underline';
export type BlockKind = 'paragraph' | 'heading' | 'scene-break';
export type Alignment = 'left' | 'center' | 'right';
export type LineSpacing = 'single' | '1.15' | '1.5' | 'double';
export type PageSize = 'letter' | 'a4' | 'legal';

export interface TextMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Defaults preserve the original writing-paper proportions. */
export const DEFAULT_TEXT_MARGINS: TextMargins = Object.freeze({ top: 44, right: 72, bottom: 30, left: 72 });

export interface EditorStyleProfile {
  /** Presentation only; never embedded in StructuredDocument. */
  fontFamily: string;
  fontSizePt: number;
  lineSpacing: LineSpacing;
  /** Physical page format for the writing canvas and visual exports. */
  pageSize?: PageSize;
  /** Global writing margins. Applied to manuscript and Markdown note pages only. */
  textMargins?: TextMargins;
}

export const DEFAULT_EDITOR_STYLE: EditorStyleProfile = Object.freeze({
  fontFamily: 'Times New Roman',
  fontSizePt: 12,
  lineSpacing: 'double',
  pageSize: 'letter'
});

export const FONT_FAMILY_OPTIONS = ['Times New Roman', 'Georgia', 'Arial', 'Courier New'] as const;
export const FONT_SIZE_OPTIONS = [10, 11, 12, 14, 16, 18, 24] as const;
export const LINE_SPACING_OPTIONS: LineSpacing[] = ['single', '1.15', '1.5', 'double'];
export const PAGE_SIZE_OPTIONS: PageSize[] = ['letter', 'a4', 'legal'];

export interface TextRun {
  text: string;
  marks: SemanticMark[];
}

export interface DocumentBlock {
  id: string;
  kind: BlockKind;
  headingLevel?: 1 | 2 | 3;
  alignment?: Alignment;
  runs: TextRun[];
}

export interface StructuredDocument {
  formatVersion: DocumentFormatVersion;
  blocks: DocumentBlock[];
}

export interface Project {
  id: string;
  name: string;
  directory: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface Story {
  id: string;
  projectId: string;
  title: string;
  position: number;
}

export interface Chapter {
  id: string;
  storyId: string;
  title: string;
  position: number;
  activeSceneSetId: string;
}

export interface SceneSet {
  id: string;
  chapterId: string;
  createdAt: string;
  sourceRevisionId?: string;
  active: boolean;
}

export interface Scene {
  id: string;
  sceneSetId: string;
  title: string;
  position: number;
  documentId: string;
}

/** A user-authored Markdown note; its link index is derived only from [[...]] tokens. */
export interface MarkdownNote {
  id: string;
  projectId: string;
  title: string;
  markdown: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteLink {
  id: string;
  noteId: string;
  /** Stable target note ID after deterministic exact title resolution or repair. */
  targetId?: string;
  targetText: string;
  label?: string;
  start: number;
  end: number;
  /** Identifies repeated identical wiki tokens when a note is saved again. */
  occurrence: number;
  createdAt: string;
}

export interface CanvasViewport { x: number; y: number; zoom: number; }
export interface CanvasPosition { x: number; y: number; }
/** Canvas engines are presentation choices; React Flow remains the projection engine for legacy canvases. */
export type CanvasEngine = 'react-flow' | 'excalidraw';
/** JSON-safe Excalidraw state. Markdown notes and React Flow projection data stay separate. */
export interface ExcalidrawSceneState {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}
export interface StoryCanvas {
  id: string;
  storyId: string;
  title: string;
  viewport: CanvasViewport;
  /** Optional on the type for reading pre-choice records; new records always persist it. */
  engine?: CanvasEngine;
  excalidrawState?: ExcalidrawSceneState;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** A placement only: it never stores or mutates note labels or content. */
export interface CanvasNode {
  id: string;
  canvasId: string;
  entityId: string;
  position: CanvasPosition;
}

/** Edges are projections of resolved Markdown note links. */
export interface CanvasEdge {
  id: string;
  canvasId: string;
  sourceNodeId: string;
  targetNodeId: string;
  noteLinkId: string;
}

export interface CanvasProjectionNode extends CanvasNode {
  entityKind: 'note';
  label: string;
}

export interface CanvasProjection {
  canvas: StoryCanvas;
  nodes: CanvasProjectionNode[];
  edges: CanvasEdge[];
}

export interface Revision {
  id: string;
  documentId: string;
  number: number;
  document: StructuredDocument;
  createdAt: string;
  reason: 'created' | 'edit' | 'continuous-draft' | 'automatic-split';
}

export type ContinuousDraftStatus = 'open' | 'kept-separate' | 'split';

export interface ContinuousDraft {
  id: string;
  chapterId: string;
  documentId: string;
  baseSceneSetId: string;
  sourceRevisionId: string;
  status: ContinuousDraftStatus;
  createdAt: string;
}

export interface BackupRecord {
  id: string;
  path: string;
  createdAt: string;
  integrity: 'pending' | 'ok' | 'failed';
}

export type OperationState =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'revision-conflict'
  | 'migrating'
  | 'integrity-check'
  | 'backup'
  | 'recovering'
  | 'recovered'
  | 'failed';

export interface OperationStatus {
  state: OperationState;
  message: string;
  at: string;
}

export interface WritingGoals {
  dailyTarget: number;
  /** Net words added to the project on each local calendar date. */
  dailyWordCounts: Record<string, number>;
}

export interface WritingStats {
  date: string;
  dailyTarget: number;
  dailyWords: number;
  projectWords: number;
}

export interface WritingActivity {
  date: string;
  words: number;
}

export interface ManuscriptVersionSummary {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  wordCount: number;
  sceneCount: number;
  chapterCount: number;
}

export interface ManuscriptVersionDocument {
  documentId: string;
  revision: Revision;
}

export interface ManuscriptVersionSnapshot {
  stories: Story[];
  chapters: Chapter[];
  sceneSets: SceneSet[];
  scenes: Scene[];
  continuousDrafts: ContinuousDraft[];
  documents: ManuscriptVersionDocument[];
}

export interface ManuscriptVersionDetail {
  summary: ManuscriptVersionSummary;
  snapshot: ManuscriptVersionSnapshot;
}

export type ManuscriptVersionChangeKind = 'story' | 'chapter' | 'scene-set' | 'scene' | 'continuous-draft' | 'document';
export type ManuscriptVersionChangeType = 'added' | 'removed' | 'changed';

export interface ManuscriptVersionChange {
  kind: ManuscriptVersionChangeKind;
  change: ManuscriptVersionChangeType;
  id: string;
  label?: string;
  beforeLabel?: string;
  afterLabel?: string;
  beforeDocument?: StructuredDocument;
  afterDocument?: StructuredDocument;
}

export interface ManuscriptVersionComparison {
  from: ManuscriptVersionSummary;
  to: ManuscriptVersionSummary;
  changes: ManuscriptVersionChange[];
}

export interface RestoreManuscriptVersionResult {
  status: OperationStatus;
  backup: BackupRecord;
}

export interface IntegrityReport {
  ok: boolean;
  message: string;
  checkedAt: string;
}

export interface ProjectSnapshot {
  project: Project;
  stories: Story[];
  chapters: Chapter[];
  sceneSets: SceneSet[];
  scenes: Scene[];
  continuousDrafts: ContinuousDraft[];
  markdownNotes: MarkdownNote[];
  noteLinks: NoteLink[];
  canvases: StoryCanvas[];
  backups: BackupRecord[];
  styleProfile: EditorStyleProfile;
  writingStats: WritingStats;
  writingActivity: WritingActivity[];
  manuscriptVersions: ManuscriptVersionSummary[];
  status: OperationStatus;
}

export interface ExportOptions {
  title: string;
  author?: string;
  header?: string;
  pageNumbering?: boolean;
  styleProfile?: EditorStyleProfile;
}

export type ExportFormat = 'pdf' | 'docx' | 'markdown' | 'text';

export interface ExportedFile {
  format: ExportFormat;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  capturedRevisionId: string;
}

export class RevisionConflictError extends Error {
  readonly currentRevision: number;
  readonly expectedRevision: number;

  constructor(documentId: string, expectedRevision: number, currentRevision: number) {
    super(`Document ${documentId} changed: expected revision ${expectedRevision}, current revision ${currentRevision}`);
    this.name = 'RevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

export class EntityRevisionConflictError extends Error {
  readonly currentRevision: number;
  readonly expectedRevision: number;

  constructor(entityId: string, expectedRevision: number, currentRevision: number) {
    super(`Entity ${entityId} changed: expected revision ${expectedRevision}, current revision ${currentRevision}`);
    this.name = 'EntityRevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

export class NoSceneMarkersError extends Error {
  constructor() {
    super('No explicit scene marker found. Use a paragraph containing *** or Nova cena.');
    this.name = 'NoSceneMarkersError';
  }
}

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}
