/** Versioned structured content. HTML is never the source of truth. */
export const DOCUMENT_FORMAT_VERSION = 1 as const;
export type DocumentFormatVersion = typeof DOCUMENT_FORMAT_VERSION;

export type SemanticMark = 'bold' | 'italic' | 'underline';
export type BlockKind = 'paragraph' | 'heading' | 'scene-break';
export type Alignment = 'left' | 'center' | 'right';
export type LineSpacing = 'single' | '1.15' | '1.5' | 'double';

export interface EditorStyleProfile {
  /** Presentation only; never embedded in StructuredDocument. */
  fontFamily: string;
  fontSizePt: number;
  lineSpacing: LineSpacing;
}

export const DEFAULT_EDITOR_STYLE: EditorStyleProfile = Object.freeze({
  fontFamily: 'Times New Roman',
  fontSizePt: 12,
  lineSpacing: 'double'
});

export const FONT_FAMILY_OPTIONS = ['Times New Roman', 'Georgia', 'Arial', 'Courier New'] as const;
export const FONT_SIZE_OPTIONS = [10, 11, 12, 14, 16, 18, 24] as const;
export const LINE_SPACING_OPTIONS: LineSpacing[] = ['single', '1.15', '1.5', 'double'];

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
  styleProfile: EditorStyleProfile;
  writingStats: WritingStats;
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
