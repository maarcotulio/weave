import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { documentFromText, paragraph } from '../domain/document';
import { InMemoryProjectRepository } from '../domain/repository';
import { NoSceneMarkersError, RevisionConflictError, type StructuredDocument } from '../domain/types';
import { SQLiteProjectRepository } from '../infrastructure/sqlite-repository';
import { exportCapturedRevision, exportRevision, renderMarkdown, renderPlainText } from '../export/editorial';

async function fixture(repository = new InMemoryProjectRepository()) {
  await repository.createProject('/tmp/test.weave', 'Test manuscript');
  const story = await repository.createStory('Story');
  const chapter = await repository.createChapter(story.id, 'Chapter 1');
  const first = await repository.createScene(chapter.id, 'First', documentFromText('First scene'));
  const second = await repository.createScene(chapter.id, 'Second', documentFromText('Second scene'));
  return { repository, story, chapter, first, second };
}

describe('scene source model', () => {
  it('renames and reorders scenes without replacing their documents', async () => {
    const { repository, chapter, first, second } = await fixture();
    const firstBefore = await repository.getDocument(first.documentId);
    await repository.renameScene(second.id, 'Renamed');
    await repository.reorderScene(second.id, 0);
    const scenes = await repository.listScenes(chapter.id);
    expect(scenes.map((scene) => scene.title)).toEqual(['Renamed', 'First']);
    expect((await repository.getDocument(first.documentId)).document).toEqual(firstBefore.document);
    expect((await repository.getDocument(second.documentId)).document).toEqual({ ...documentFromText('Second scene'), blocks: expect.any(Array) });
  });

  it('composes in memory and keeps scene documents as the source', async () => {
    const { repository, chapter, first, second } = await fixture();
    const composed = await repository.composeChapter(chapter.id);
    expect(composed.blocks.map((block) => block.runs.map((run) => run.text).join(''))).toContain('First scene');
    expect(composed.blocks.some((block) => block.kind === 'scene-break')).toBe(true);
    expect((await repository.listSceneSets(chapter.id)).filter((set) => set.active)).toHaveLength(1);
    expect((await repository.getDocument(first.documentId)).revision).toBe(1);
    expect((await repository.getDocument(second.documentId)).revision).toBe(1);
  });

  it('creates a separate continuous revision and offers keep-separate', async () => {
    const { repository, chapter, first } = await fixture();
    const draft = await repository.enterContinuousDraft(chapter.id);
    const draftHead = await repository.getDocument(draft.documentId);
    expect(draft.sourceRevisionId).toBe(draftHead.revisionId);
    expect((await repository.getDocument(first.documentId)).revision).toBe(1);
    const kept = await repository.keepContinuousSeparate(draft.id);
    expect(kept.status).toBe('kept-separate');
    expect((await repository.listScenes(chapter.id)).length).toBe(2);
    expect((await repository.getContinuousDraft(draft.id)).status).toBe('kept-separate');
  });

  it('rejects unmarked prose and rolls back the complete split', async () => {
    const { repository, chapter, first } = await fixture();
    const beforeSets = await repository.listSceneSets(chapter.id);
    const draft = await repository.enterContinuousDraft(chapter.id);
    const head = await repository.getDocument(draft.documentId);
    await repository.saveDocument(draft.documentId, documentFromText('No heuristic boundary'), head.revision);
    await expect(repository.automaticallySplitContinuous(draft.id)).rejects.toBeInstanceOf(NoSceneMarkersError);
    expect(await repository.listSceneSets(chapter.id)).toEqual(beforeSets);
    expect((await repository.getContinuousDraft(draft.id)).status).toBe('open');
    expect((await repository.getDocument(first.documentId)).revision).toBe(1);
  });

  it('splits only explicit markers, preserving the old scene set and snapshot', async () => {
    const { repository, chapter, first } = await fixture();
    const oldSet = (await repository.listSceneSets(chapter.id))[0];
    const draft = await repository.enterContinuousDraft(chapter.id);
    const head = await repository.getDocument(draft.documentId);
    const marked = documentFromText('New first\n***\nUnmarked prose remains with second scene\nNova cena\nThird scene');
    await repository.saveDocument(draft.documentId, marked, head.revision);
    const result = await repository.automaticallySplitContinuous(draft.id);
    expect(result.scenes).toHaveLength(3);
    expect((await repository.listSceneSets(chapter.id)).find((set) => set.id === oldSet.id)?.active).toBe(false);
    expect((await repository.listScenes(chapter.id)).map((scene) => scene.title)).toEqual(['Scene 1', 'Scene 2', 'Scene 3']);
    expect((await repository.getDocument(first.documentId)).document.blocks[0].runs[0].text).toBe('First scene');
    expect(result.sourceRevisionId).toBe(draft.sourceRevisionId);
  });

  it('surfaces optimistic revision conflicts', async () => {
    const { repository, first } = await fixture();
    const head = await repository.getDocument(first.documentId);
    await repository.saveDocument(first.documentId, documentFromText('new'), head.revision);
    await expect(repository.saveDocument(first.documentId, documentFromText('stale'), head.revision)).rejects.toBeInstanceOf(RevisionConflictError);
    expect((await repository.getStatus()).state).toBe('revision-conflict');
  });
});

describe('editorial export', () => {
  const document: StructuredDocument = { formatVersion: 1, blocks: [{ id: 'b', kind: 'paragraph', runs: [{ text: 'A line', marks: ['bold'] }] }] };
  const revision = { id: 'r1', documentId: 'd1', number: 3, document, createdAt: '2025-01-01T00:00:00.000Z', reason: 'edit' as const };
  it('renders the semantic document using the editorial template', () => {
    expect(renderMarkdown(document, { title: 'Draft', author: 'A.' })).toContain('**A line**');
    expect(renderPlainText(document, { title: 'Draft', author: 'A.' })).toContain('Draft — A.');
    const docx = exportCapturedRevision(revision, 'docx', { title: 'Draft' });
    expect(new TextDecoder().decode(docx.bytes.slice(0, 2))).toBe('PK');
    expect(new TextDecoder().decode(exportCapturedRevision(revision, 'pdf', { title: 'Draft' }).bytes)).toContain('%PDF-1.4');
  });

  it('captures a revision before generating every requested format', async () => {
    const { repository, first } = await fixture();
    const head = await repository.getDocument(first.documentId);
    const files = await exportRevision(repository, head.revisionId, ['pdf', 'docx', 'markdown', 'text'], { title: 'Captured' });
    await repository.saveDocument(first.documentId, documentFromText('later edit'), head.revision);
    expect(files).toHaveLength(4);
    expect(files.every((file) => file.capturedRevisionId === head.revisionId)).toBe(true);
    expect(new TextDecoder().decode(files.find((file) => file.format === 'text')!.bytes)).toContain('First scene');
  });
});

describe('SQLite project safeguards', () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it('persists revisions and runs migrations in the visible .weave directory', async () => {
    directory = await mkdtemp(join(tmpdir(), 'weave-'));
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'SQLite test');
    const story = await repository.createStory('Story');
    const chapter = await repository.createChapter(story.id, 'Chapter');
    const scene = await repository.createScene(chapter.id, 'Scene', documentFromText('persisted'));
    repository.close();
    const reopened = new SQLiteProjectRepository(directory);
    expect((await reopened.getProject()).name).toBe('SQLite test');
    expect((await reopened.getDocument(scene.documentId)).document.blocks[0].runs[0].text).toBe('persisted');
    expect((await reopened.integrityCheck()).ok).toBe(true);
    const backup = await reopened.createBackup();
    const persistedHead = await reopened.getDocument(scene.documentId);
    await reopened.saveDocument(scene.documentId, documentFromText('changed after backup'), persistedHead.revision);
    expect((await reopened.recoverFromBackup(backup.id)).state).toBe('recovered');
    expect((await reopened.getDocument(scene.documentId)).document.blocks[0].runs[0].text).toBe('persisted');
    reopened.close();
  });
});
