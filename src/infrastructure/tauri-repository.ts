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
  WorldbuildingItem,
  WorldbuildingItemKind,
  WorldbuildingProperties,
  RelationshipType,
  DomainRelationship,
  DocumentAnchor,
  DocumentLink,
  Backlink,
  StoryCanvas,
  CanvasPosition,
  CanvasViewport,
  CanvasNode,
  CanvasEdge,
  CanvasProjection
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
  createWorldbuildingItem(input: { kind: WorldbuildingItemKind; title: string; aliases?: string[]; properties?: WorldbuildingProperties }): Promise<WorldbuildingItem> { return command('create_worldbuilding_item', { input }); }
  updateWorldbuildingItem(itemId: string, input: { title: string; aliases: string[]; properties: WorldbuildingProperties }, expectedRevision: number): Promise<WorldbuildingItem> { return command('update_worldbuilding_item', { itemId, input, expectedRevision }); }
  deleteWorldbuildingItem(itemId: string, expectedRevision: number, mode?: 'reject' | 'remove-references'): Promise<void> { return command('delete_worldbuilding_item', { itemId, expectedRevision, mode }); }
  listWorldbuildingItems(kind?: WorldbuildingItemKind): Promise<WorldbuildingItem[]> { return command('list_worldbuilding_items', { kind }); }
  searchWorldbuilding(query: string): Promise<WorldbuildingItem[]> { return command('search_worldbuilding', { query }); }
  createRelationship(sourceId: string, targetId: string, type: RelationshipType): Promise<DomainRelationship> { return command('create_relationship', { sourceId, targetId, relationType: type }); }
  deleteRelationship(relationshipId: string): Promise<void> { return command('delete_relationship', { relationshipId }); }
  listRelationships(entityId?: string): Promise<DomainRelationship[]> { return command('list_relationships', { entityId }); }
  listBacklinks(targetId: string): Promise<Backlink[]> { return command('list_backlinks', { targetId }); }
  createDocumentLink(anchor: DocumentAnchor, targetId?: string, unresolvedLabel?: string): Promise<DocumentLink> { return command('create_document_link', { anchor, targetId, unresolvedLabel }); }
  repairDocumentLink(linkId: string, targetId: string): Promise<DocumentLink> { return command('repair_document_link', { linkId, targetId }); }
  listDocumentLinks(documentId?: string): Promise<DocumentLink[]> { return command('list_document_links', { documentId }); }
  createCanvas(storyId: string, title: string): Promise<StoryCanvas> { return command('create_canvas', { storyId, title }); }
  listCanvases(storyId?: string): Promise<StoryCanvas[]> { return command('list_canvases', { storyId }); }
  getCanvasProjection(canvasId: string): Promise<CanvasProjection> { return command('canvas_projection', { canvasId }); }
  addCanvasNode(canvasId: string, entityId: string, position: CanvasPosition, expectedRevision: number): Promise<CanvasNode> { return command('add_canvas_node', { canvasId, entityId, position, expectedRevision }); }
  removeCanvasNode(canvasId: string, nodeId: string, expectedRevision: number): Promise<void> { return command('remove_canvas_node', { canvasId, nodeId, expectedRevision }); }
  connectCanvasNodes(canvasId: string, sourceNodeId: string, targetNodeId: string, relationshipId: string, expectedRevision: number): Promise<CanvasEdge> { return command('connect_canvas_nodes', { canvasId, sourceNodeId, targetNodeId, relationshipId, expectedRevision }); }
  saveCanvasLayout(canvasId: string, positions: Array<{ id: string; position: CanvasPosition }>, viewport: CanvasViewport, expectedRevision: number): Promise<StoryCanvas> { return command('save_canvas_layout', { canvasId, positions, viewport, expectedRevision }); }
  getDocument(documentId: string): Promise<DocumentHead> { return command('get_document', { documentId }); }
  getRevision(revisionId: string): Promise<Revision> { return command('get_revision', { revisionId }); }
  saveDocument(documentId: string, document: StructuredDocument, expectedRevision: number): Promise<SaveDocumentResult> { return command('save_document', { documentId, document, expectedRevision }); }
  getStyleProfile(): Promise<EditorStyleProfile> { return command('get_style_profile'); }
  updateStyleProfile(profile: EditorStyleProfile): Promise<EditorStyleProfile> { return command('update_style_profile', { profile }); }
  getWritingStats(): Promise<WritingStats> { return command('writing_stats'); }
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
