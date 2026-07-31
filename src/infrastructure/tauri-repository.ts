import { invoke } from '@tauri-apps/api/core';
import type { ProjectRepository, DocumentHead, SaveDocumentResult, SplitResult } from '../domain/repository';
import type {
  BackupRecord,
  Chapter,
  ContinuousDraft,
  IntegrityReport,
  OperationStatus,
  Project,
  ProjectSnapshot,
  Revision,
  Scene,
  SceneSet,
  Story,
  StructuredDocument
} from '../domain/types';

/** The only renderer-to-desktop boundary. Components never call invoke directly. */
const command = <T>(name: string, args?: Record<string, unknown>) => invoke<T>(name, args);

export class TauriProjectRepository implements ProjectRepository {
  createProject(directory: string, name: string): Promise<Project> { return command('create_project', { directory, name }); }
  openProject(directory: string): Promise<Project> { return command('open_project', { directory }); }
  getProject(): Promise<Project> { return command('get_project'); }
  createStory(title: string): Promise<Story> { return command('create_story', { title }); }
  createChapter(storyId: string, title: string): Promise<Chapter> { return command('create_chapter', { storyId, title }); }
  createScene(chapterId: string, title: string, document?: StructuredDocument): Promise<Scene> { return command('create_scene', { chapterId, title, document }); }
  listStories(): Promise<Story[]> { return command('list_stories'); }
  listChapters(storyId?: string): Promise<Chapter[]> { return command('list_chapters', { storyId }); }
  listSceneSets(chapterId: string): Promise<SceneSet[]> { return command('list_scene_sets', { chapterId }); }
  listScenes(chapterId: string, sceneSetId?: string): Promise<Scene[]> { return command('list_scenes', { chapterId, sceneSetId }); }
  renameScene(sceneId: string, title: string): Promise<Scene> { return command('rename_scene', { sceneId, title }); }
  reorderScene(sceneId: string, position: number): Promise<Scene[]> { return command('reorder_scene', { sceneId, position }); }
  getDocument(documentId: string): Promise<DocumentHead> { return command('get_document', { documentId }); }
  getRevision(revisionId: string): Promise<Revision> { return command('get_revision', { revisionId }); }
  saveDocument(documentId: string, document: StructuredDocument, expectedRevision: number): Promise<SaveDocumentResult> { return command('save_document', { documentId, document, expectedRevision }); }
  enterContinuousDraft(chapterId: string): Promise<ContinuousDraft> { return command('enter_continuous_draft', { chapterId }); }
  getContinuousDraft(draftId: string): Promise<ContinuousDraft> { return command('get_continuous_draft', { draftId }); }
  keepContinuousSeparate(draftId: string): Promise<ContinuousDraft> { return command('keep_continuous_separate', { draftId }); }
  automaticallySplitContinuous(draftId: string): Promise<SplitResult> { return command('automatically_split_continuous', { draftId }); }
  composeChapter(chapterId: string): Promise<StructuredDocument> { return command('compose_chapter', { chapterId }); }
  integrityCheck(): Promise<IntegrityReport> { return command('integrity_check'); }
  createBackup(): Promise<BackupRecord> { return command('create_backup'); }
  recoverFromBackup(backupId: string): Promise<OperationStatus> { return command('recover_from_backup', { backupId }); }
  writeExport(file: { filename: string; bytes: Uint8Array }): Promise<string> { return command('write_export', { filename: file.filename, bytes: Array.from(file.bytes) }); }
  getStatus(): Promise<OperationStatus> { return command('get_status'); }
  snapshot(): Promise<ProjectSnapshot> { return command('project_snapshot'); }
}
