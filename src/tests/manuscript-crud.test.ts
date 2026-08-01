import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutosaveController } from '../domain/autosave';
import { documentFromText } from '../domain/document';
import { firstEnabledFocusIndex, trappedFocusIndex, canDismissWithEscape } from '../domain/modal-focus';
import { manuscriptDeleteImpact } from '../domain/manuscript-lifecycle';
import { InMemoryProjectRepository } from '../domain/repository';
import { SQLiteProjectRepository } from '../infrastructure/sqlite-repository';

async function fixture() {
  const repository = new InMemoryProjectRepository();
  await repository.createProject('/tmp/manuscript-crud.weave', 'CRUD');
  const firstStory = await repository.createStory('First story');
  const firstChapter = await repository.createChapter(firstStory.id, 'First chapter');
  const firstScene = await repository.createScene(firstChapter.id, 'First scene', documentFromText('first scene text'));
  const secondScene = await repository.createScene(firstChapter.id, 'Second scene', documentFromText('second scene text'));
  const secondChapter = await repository.createChapter(firstStory.id, 'Second chapter');
  const secondChapterScene = await repository.createScene(secondChapter.id, 'Other scene', documentFromText('other scene text'));
  const secondStory = await repository.createStory('Second story');
  const secondStoryChapter = await repository.createChapter(secondStory.id, 'Other chapter');
  await repository.createScene(secondStoryChapter.id, 'Other story scene');
  return { repository, firstStory, firstChapter, firstScene, secondScene, secondChapter, secondChapterScene, secondStory, secondStoryChapter };
}

describe('manuscript CRUD', () => {
  it('renames stories, chapters, and scenes while preserving scene documents', async () => {
    const { repository, firstStory, firstChapter, firstScene } = await fixture();
    await repository.renameStory(firstStory.id, 'Renamed story');
    await repository.renameChapter(firstChapter.id, 'Renamed chapter');
    await repository.renameScene(firstScene.id, 'Renamed scene');
    expect((await repository.listStories())[0].title).toBe('Renamed story');
    expect((await repository.listChapters(firstStory.id))[0].title).toBe('Renamed chapter');
    expect((await repository.listScenes(firstChapter.id))[0].title).toBe('Renamed scene');
    expect((await repository.getDocument(firstScene.documentId)).document.blocks[0].runs[0].text).toBe('first scene text');
  });

  it('orders siblings by position after reorder and deletion', async () => {
    const { repository, firstChapter, firstScene, secondScene } = await fixture();
    const thirdScene = await repository.createScene(firstChapter.id, 'Third scene');
    await repository.reorderScene(thirdScene.id, 0);
    await repository.deleteScene(firstScene.id);
    const scenes = await repository.listScenes(firstChapter.id);
    expect(scenes.map((scene) => [scene.id, scene.position])).toEqual([[thirdScene.id, 0], [secondScene.id, 1]]);
  });

  it('deletes a scene and cascades its document while reindexing siblings', async () => {
    const { repository, firstChapter, firstScene, secondScene } = await fixture();
    await repository.deleteScene(firstScene.id);
    await expect(repository.getDocument(firstScene.documentId)).rejects.toThrow(`Unknown document ${firstScene.documentId}`);
    const scenes = await repository.listScenes(firstChapter.id);
    expect(scenes.map((scene) => [scene.id, scene.position])).toEqual([[secondScene.id, 0]]);
  });

  it('deletes a chapter with all scene sets, scenes, drafts, and documents but keeps sibling chapters', async () => {
    const { repository, firstStory, firstChapter, firstScene, secondChapter, secondChapterScene } = await fixture();
    const draft = await repository.enterContinuousDraft(firstChapter.id);
    const unrelatedDraft = await repository.enterContinuousDraft(secondChapter.id);
    await repository.deleteChapter(firstChapter.id);
    expect((await repository.listChapters(firstStory.id)).map((chapter) => chapter.id)).toEqual([secondChapter.id]);
    expect(await repository.listScenes(secondChapter.id)).toEqual([expect.objectContaining({ id: secondChapterScene.id, position: 0 })]);
    await expect(repository.getDocument(firstScene.documentId)).rejects.toThrow();
    await expect(repository.getDocument(draft.documentId)).rejects.toThrow();
    await expect(repository.getDocument(unrelatedDraft.documentId)).resolves.toEqual(expect.objectContaining({ documentId: unrelatedDraft.documentId }));
    expect((await repository.listSceneSets(firstChapter.id))).toEqual([]);
  });

  it('surfaces missing-item errors without mutating the manuscript', async () => {
    const { repository, firstStory, firstChapter } = await fixture();
    const before = await repository.snapshot();
    await expect(repository.deleteStory('missing-story')).rejects.toThrow('Unknown story missing-story');
    await expect(repository.deleteChapter('missing-chapter')).rejects.toThrow('Unknown chapter missing-chapter');
    await expect(repository.deleteScene('missing-scene')).rejects.toThrow('Unknown scene missing-scene');
    expect(await repository.snapshot()).toEqual(before);
    expect((await repository.listChapters(firstStory.id)).some((chapter) => chapter.id === firstChapter.id)).toBe(true);
  });

  it('keeps an open draft when deleting a scene from an unrelated chapter', async () => {
    const { repository, firstChapter, secondChapterScene } = await fixture();
    const draft = await repository.enterContinuousDraft(firstChapter.id);
    await repository.deleteScene(secondChapterScene.id);
    await expect(repository.getDocument(draft.documentId)).resolves.toEqual(expect.objectContaining({ documentId: draft.documentId }));
    expect((await repository.snapshot()).continuousDrafts).toEqual([expect.objectContaining({ id: draft.id, chapterId: firstChapter.id })]);
  });

  it('deletes a story as a complete cascade and leaves later stories usable', async () => {
    const { repository, firstStory, firstScene, secondStory, secondStoryChapter } = await fixture();
    const unrelatedDraft = await repository.enterContinuousDraft(secondStoryChapter.id);
    const canvas = await repository.createCanvas(firstStory.id, 'Story canvas');
    await repository.deleteStory(firstStory.id);
    const snapshot = await repository.snapshot();
    expect(snapshot.stories.map((story) => story.id)).toEqual([secondStory.id]);
    expect(snapshot.chapters.map((chapter) => chapter.storyId)).toEqual([secondStory.id]);
    expect(snapshot.scenes.some((scene) => scene.documentId === firstScene.documentId)).toBe(false);
    expect(snapshot.canvases.some((candidate) => candidate.id === canvas.id)).toBe(false);
    expect((await repository.listScenes(secondStoryChapter.id)).length).toBe(1);
    await expect(repository.getDocument(unrelatedDraft.documentId)).resolves.toEqual(expect.objectContaining({ documentId: unrelatedDraft.documentId }));
  });
});

describe('SQLite manuscript CRUD', () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it('persists edits and cascaded deletion through the SQLite adapter', async () => {
    directory = await mkdtemp(join(tmpdir(), 'weave-manuscript-crud-'));
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'SQLite CRUD');
    const story = await repository.createStory('Story');
    const chapter = await repository.createChapter(story.id, 'Chapter');
    const scene = await repository.createScene(chapter.id, 'Scene', documentFromText('SQLite scene'));
    await repository.renameStory(story.id, 'Renamed story');
    await repository.renameChapter(chapter.id, 'Renamed chapter');
    await repository.renameScene(scene.id, 'Renamed scene');
    repository.close();

    const reopened = new SQLiteProjectRepository(directory);
    expect((await reopened.listStories())[0].title).toBe('Renamed story');
    expect((await reopened.listChapters(story.id))[0].title).toBe('Renamed chapter');
    await reopened.deleteStory(story.id);
    expect((await reopened.listStories())).toEqual([]);
    expect((await reopened.listChapters())).toEqual([]);
    reopened.close();
  });
});

describe('manuscript destructive lifecycle invariants', () => {
  it('keeps unrelated continuous drafts and clears their source when deleted', () => {
    const draft = { chapterId: 'chapter-1', baseSceneSetId: 'set-1' } as const;
    expect(manuscriptDeleteImpact({ kind: 'chapter', id: 'chapter-2' }, { activeStoryId: 'story-1', draftStoryId: 'story-1', activeChapterId: 'chapter-1', mode: 'continuous', draft })).toMatchObject({ affectsDraft: false, clearDocument: false, nextMode: 'continuous' });
    expect(manuscriptDeleteImpact({ kind: 'story', id: 'story-1' }, { activeStoryId: 'story-1', draftStoryId: 'story-1', activeChapterId: 'chapter-1', mode: 'continuous', draft })).toMatchObject({ affectsDraft: true, clearDocument: true, nextMode: 'scene' });
    expect(manuscriptDeleteImpact({ kind: 'scene', id: 'scene-1' }, { activeStoryId: 'story-1', draftStoryId: 'story-1', activeChapterId: 'chapter-1', mode: 'continuous', draft, scene: { id: 'scene-1', chapterId: 'chapter-1', sceneSetId: 'set-1' } })).toMatchObject({ affectsDraft: false, clearDocument: false, nextMode: 'continuous' });
    expect(manuscriptDeleteImpact({ kind: 'scene', id: 'scene-2' }, { activeChapterId: 'chapter-1', activeDocumentId: 'document-2', mode: 'scene', scene: { id: 'scene-2', chapterId: 'chapter-1', sceneSetId: 'set-1', documentId: 'document-2' } })).toMatchObject({ affectsActiveSource: true, clearDocument: true, nextMode: 'scene' });
    expect(manuscriptDeleteImpact({ kind: 'scene', id: 'scene-3' }, { activeChapterId: 'chapter-1', activeSceneId: 'scene-3', activeDocumentId: 'draft-document', mode: 'continuous', scene: { id: 'scene-3', chapterId: 'chapter-1', sceneSetId: 'set-1', documentId: 'scene-document' } })).toMatchObject({ affectsActiveSource: false, clearDocument: false, nextMode: 'continuous' });
  });

  it('models modal initial focus, trapped tab traversal, and busy Escape behavior without jsdom', () => {
    expect(firstEnabledFocusIndex([true, true], 1)).toBe(1);
    expect(firstEnabledFocusIndex([false, true], 0)).toBe(1);
    expect(trappedFocusIndex({ currentIndex: 0, controlCount: 2, shiftKey: true })).toBe(1);
    expect(trappedFocusIndex({ currentIndex: 1, controlCount: 2, shiftKey: false })).toBe(0);
    expect(trappedFocusIndex({ currentIndex: -1, controlCount: 2, shiftKey: false })).toBe(0);
    expect(canDismissWithEscape('Escape', false)).toBe(true);
    expect(canDismissWithEscape('Escape', true)).toBe(false);
  });

  it('keeps autosave debounce and flush timing deterministic', async () => {
    vi.useFakeTimers();
    let saves = 0;
    const autosave = new AutosaveController(async () => { saves += 1; }, { delayMs: 100 });
    autosave.markDirty();
    await vi.advanceTimersByTimeAsync(99);
    expect(saves).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves).toBe(1);
    vi.useRealTimers();
  });
});

describe('manuscript destructive UI contract', () => {
  const appSource = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
  const stylesSource = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
  it('highlights the complete selected manuscript row including actions', () => {
    expect(appSource).toContain("className={`manuscript-tree-row ${selectedStoryId === story.id ? 'selected' : ''}`}");
    expect(appSource).toContain("className={`manuscript-tree-row ${selectedChapterId === chapter.id ? 'selected' : ''}`}");
    expect(appSource).toContain("className={`manuscript-tree-row scene-row ${selectedSceneId === scene.id && mode === 'scene' ? 'selected' : ''}`}");
    expect(stylesSource).toContain('.manuscript-tree-row.selected { background: var(--accent-tint); }');
    expect(stylesSource).toContain('.manuscript-tree-row.selected .tree-item { background: transparent; }');
  });

  it('requires an accessible modal and explicit confirmation for every manuscript deletion', () => {
    expect(appSource).toContain('ManuscriptDeleteDialog');
    expect(appSource).toContain('aria-describedby={descriptionId}');
    expect(appSource).toContain('Close dialog without deleting');
    expect(appSource).toContain('canDismissWithEscape');
    expect(appSource).toContain('trappedFocusIndex');
    expect(appSource).toContain('item.trigger');
    expect(appSource).not.toContain('dialogRef.current?.focus();');
    expect(appSource).toContain('repository.deleteStory(action.id)');
    expect(appSource).toContain('repository.deleteChapter(action.id)');
    expect(appSource).toContain('repository.deleteScene(action.id)');
    expect(appSource).toContain('role="alert"');
    expect(appSource).toContain('setManuscriptDelete((current) => current ? { ...current, error:');
    expect(appSource).toContain('await autosave.flush();');
    expect(appSource).not.toContain('window.confirm');
  });

  it('keeps the ten-second countdown exclusive to deleting an entire story', () => {
    expect(appSource).toContain("item.kind === 'story' ? 10 : 0");
    expect(appSource).toContain("if (item.kind !== 'story') return;");
    expect(appSource).toContain('setInterval');
    expect(appSource).toContain('disabled={busy || (isStory && remaining > 0)}');
    expect(appSource).toContain('setEditorDocument(empty)');
    expect(appSource).toContain('Delete story permanently');
    expect(appSource).toContain('There is no undo.');
  });
});
