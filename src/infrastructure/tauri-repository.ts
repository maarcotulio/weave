import { invoke } from '@tauri-apps/api/core';
import type { ProjectRepository, DocumentHead, SaveDocumentResult, SplitResult } from '../domain/repository';
import type {
  BackupRecord,
  Chapter,
  EditorStyleProfile,
  ContinuousDraft,
  IntegrityReport,
  OperationStatus,
  Project,
  ProjectSnapshot,
  Revision,
  Scene,
  SceneSet,
  Story,
  StructuredDocument,
  WritingGoals,
  WritingStats,
  WritingActivity,
  ManuscriptVersionSummary,
  ManuscriptVersionDetail,
  ManuscriptVersionComparison,
  RestoreManuscriptVersionResult,
  MarkdownNote,
  NoteLink,
  StoryCanvas,
  WorldbuildingFolder,
  WorldbuildingEntry,
  WorldbuildingEntryKind,
  CanvasPosition,
  CanvasViewport,
  CanvasNode,
  CanvasProjection,
  CanvasEngine,
  ExcalidrawSceneState
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
  renameStory(storyId: string, title: string): Promise<Story> { return command('rename_story', { storyId, title }); }
  renameChapter(chapterId: string, title: string): Promise<Chapter> { return command('rename_chapter', { chapterId, title }); }
  renameScene(sceneId: string, title: string): Promise<Scene> { return command('rename_scene', { sceneId, title }); }
  deleteStory(storyId: string): Promise<void> { return command('delete_story', { storyId }); }
  deleteChapter(chapterId: string): Promise<void> { return command('delete_chapter', { chapterId }); }
  deleteScene(sceneId: string): Promise<void> { return command('delete_scene', { sceneId }); }
  reorderChapter(chapterId: string, position: number): Promise<Chapter[]> { return command('reorder_chapter', { chapterId, position }); }
  reorderScene(sceneId: string, position: number): Promise<Scene[]> { return command('reorder_scene', { sceneId, position }); }
  createWorldbuildingFolder(title: string, parentId?: string): Promise<WorldbuildingFolder> { return command('create_worldbuilding_folder', { title, parentId }); }
  renameWorldbuildingFolder(folderId: string, title: string): Promise<WorldbuildingFolder> { return command('rename_worldbuilding_folder', { folderId, title }); }
  deleteWorldbuildingFolder(folderId: string): Promise<void> { return command('delete_worldbuilding_folder', { folderId }); }
  listWorldbuildingFolders(): Promise<WorldbuildingFolder[]> { return command('list_worldbuilding_folders'); }
  listWorldbuildingEntries(parentId?: string): Promise<WorldbuildingEntry[]> { return command('list_worldbuilding_entries', { parentId }); }
  moveWorldbuildingEntry(kind: WorldbuildingEntryKind, id: string, parentId?: string, position?: number): Promise<WorldbuildingEntry[]> { return command('move_worldbuilding_entry', { kind, id, parentId, position }); }
  createMarkdownNote(title: string, markdown?: string): Promise<MarkdownNote> { return command('create_markdown_note', { title, markdown }); }
  updateMarkdownNote(noteId: string, input: { title: string; markdown: string }, expectedRevision: number): Promise<MarkdownNote> { return command('update_markdown_note', { noteId, input, expectedRevision }); }
  deleteMarkdownNote(noteId: string, expectedRevision: number, mode?: 'reject' | 'remove-references'): Promise<void> { return command('delete_markdown_note', { noteId, expectedRevision, mode }); }
  listMarkdownNotes(): Promise<MarkdownNote[]> { return command('list_markdown_notes'); }
  searchMarkdownNotes(query: string): Promise<MarkdownNote[]> { return command('search_markdown_notes', { query }); }
  listNoteLinks(noteId?: string): Promise<NoteLink[]> { return command('list_note_links', { noteId }); }
  repairNoteLink(linkId: string, targetId: string): Promise<NoteLink> { return command('repair_note_link', { linkId, targetId }); }
  createCanvas(storyId: string, title: string, engine?: CanvasEngine): Promise<StoryCanvas> { return command('create_canvas', { storyId, title, engine: engine ?? 'react-flow' }); }
  updateCanvas(canvasId: string, input: { title: string }, expectedRevision: number): Promise<StoryCanvas> { return command('update_canvas', { canvasId, input, expectedRevision }); }
  deleteCanvas(canvasId: string, expectedRevision: number): Promise<void> { return command('delete_canvas', { canvasId, expectedRevision }); }
  listCanvases(storyId?: string): Promise<StoryCanvas[]> { return command('list_canvases', { storyId }); }
  getCanvasProjection(canvasId: string): Promise<CanvasProjection> { return command('canvas_projection', { canvasId }); }
  saveExcalidrawScene(canvasId: string, scene: ExcalidrawSceneState, expectedRevision: number): Promise<StoryCanvas> { return command('save_excalidraw_scene', { canvasId, scene, expectedRevision }); }
  addCanvasNode(canvasId: string, entityId: string, position: CanvasPosition, expectedRevision: number): Promise<CanvasNode> { return command('add_canvas_node', { canvasId, entityId, position, expectedRevision }); }
  removeCanvasNode(canvasId: string, nodeId: string, expectedRevision: number): Promise<void> { return command('remove_canvas_node', { canvasId, nodeId, expectedRevision }); }
  saveCanvasLayout(canvasId: string, positions: Array<{ id: string; position: CanvasPosition }>, viewport: CanvasViewport, expectedRevision: number): Promise<StoryCanvas> { return command('save_canvas_layout', { canvasId, positions, viewport, expectedRevision }); }
  getDocument(documentId: string): Promise<DocumentHead> { return command('get_document', { documentId }); }
  getRevision(revisionId: string): Promise<Revision> { return command('get_revision', { revisionId }); }
  saveDocument(documentId: string, document: StructuredDocument, expectedRevision: number): Promise<SaveDocumentResult> { return command('save_document', { documentId, document, expectedRevision }); }
  getStyleProfile(): Promise<EditorStyleProfile> { return command('get_style_profile'); }
  updateStyleProfile(profile: EditorStyleProfile): Promise<EditorStyleProfile> { return command('update_style_profile', { profile }); }
  getWritingStats(): Promise<WritingStats> { return command('writing_stats'); }
  getWritingActivity(days = 365): Promise<WritingActivity[]> { return command('writing_activity', { days }); }
  saveManuscriptVersion(label: string): Promise<ManuscriptVersionSummary> { return command('save_manuscript_version', { label }); }
  listManuscriptVersions(): Promise<ManuscriptVersionSummary[]> { return command('list_manuscript_versions'); }
  getManuscriptVersion(versionId: string): Promise<ManuscriptVersionDetail> { return command('get_manuscript_version', { versionId }); }
  compareManuscriptVersions(fromVersionId: string, toVersionId: string): Promise<ManuscriptVersionComparison> { return command('compare_manuscript_versions', { fromVersionId, toVersionId }); }
  restoreManuscriptVersion(versionId: string): Promise<RestoreManuscriptVersionResult> { return command('restore_manuscript_version', { versionId }); }
  setDailyWordTarget(target: number): Promise<WritingGoals> { return command('set_daily_word_target', { target }); }
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
