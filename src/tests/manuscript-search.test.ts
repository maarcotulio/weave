import { describe, expect, it } from 'vitest';
import { documentFromText } from '../domain/document';
import { documentMap, searchManuscript } from '../domain/manuscript-search';
import type { ProjectSnapshot } from '../domain/types';

function corpus() {
  const story = { id: 'story-1', projectId: 'project-1', title: 'The Story', position: 0 };
  const chapter = { id: 'chapter-1', storyId: story.id, title: 'Chapter One', position: 0, activeSceneSetId: 'set-1' };
  const scene = { id: 'scene-1', sceneSetId: 'set-1', title: 'Opening scene', position: 0, documentId: 'doc-1' };
  const snapshot = {
    project: { id: 'project-1', name: 'Test', directory: '/tmp/test', schemaVersion: 5, createdAt: '', updatedAt: '' },
    stories: [story], chapters: [chapter], sceneSets: [{ id: 'set-1', chapterId: chapter.id, createdAt: '', active: true as boolean }], scenes: [scene],
    continuousDrafts: [{ id: 'draft-1', chapterId: chapter.id, documentId: 'doc-2', baseSceneSetId: 'set-1', sourceRevisionId: 'revision-2', status: 'open' as const, createdAt: '' }],
    markdownNotes: [{ id: 'note-1', projectId: 'project-1', title: 'Research', markdown: 'A café in São Paulo', revision: 1, createdAt: '', updatedAt: '' }],
    noteLinks: [], canvases: [], backups: [], styleProfile: { fontFamily: 'Georgia', fontSizePt: 12, lineSpacing: 'double' as const }, writingStats: { date: '', dailyTarget: 500, dailyWords: 0, projectWords: 0, sessions: 0, currentStreak: 0, longestStreak: 0, averageWordsPerDay: 0 }, writingActivity: [], manuscriptVersions: [], status: { state: 'idle' as const, message: '', at: '' }
  } satisfies ProjectSnapshot;
  return { snapshot, documents: documentMap([['doc-1', documentFromText('The café opens.')], ['doc-2', documentFromText('A continuous draft about the café.')]]) };
}

describe('searchManuscript', () => {
  it('searches structured scenes, continuous drafts, hierarchy, and Markdown notes with stable destinations', () => {
    const results = searchManuscript(corpus(), 'CAFÉ');
    expect(results.map((result) => result.kind)).toEqual(['scene', 'continuous-draft', 'note']);
    expect(results[0]?.target).toMatchObject({ kind: 'scene', sceneId: 'scene-1', documentId: 'doc-1' });
    expect(results[1]?.target).toMatchObject({ kind: 'continuous-draft', draftId: 'draft-1', documentId: 'doc-2' });
    expect(results[2]?.snippet).toContain('café');
  });

  it('returns explicit empty-query and no-result states to callers', () => {
    const value = corpus();
    expect(searchManuscript(value, '   ')).toEqual([]);
    expect(searchManuscript(value, 'missing')).toEqual([]);
  });

  it('keeps only the canonical active scene set and preserves navigable targets', () => {
    const value = corpus();
    value.snapshot.sceneSets.push({ id: 'set-old', chapterId: 'chapter-1', createdAt: 'old', active: false });
    value.snapshot.scenes.push({ id: 'scene-old', sceneSetId: 'set-old', title: 'Historical scene', position: 0, documentId: 'doc-old' });
    value.documents = documentMap([
      ['doc-1', documentFromText('The active manuscript text.')],
      ['doc-2', documentFromText('A continuous draft about the café.')]
    ]);

    const results = searchManuscript(value, 'active manuscript');
    expect(results.map((result) => result.id)).toEqual(['scene:scene-1']);
    expect(results[0]?.target).toMatchObject({ kind: 'scene', chapterId: 'chapter-1', sceneId: 'scene-1', documentId: 'doc-1' });
  });

  it('uses locale-independent ordering with ID tie-breakers', () => {
    const value = corpus();
    value.snapshot.markdownNotes = [
      { id: 'note-b', projectId: 'project-1', title: 'Same', markdown: 'needle', revision: 1, createdAt: '', updatedAt: '' },
      { id: 'note-a', projectId: 'project-1', title: 'Same', markdown: 'needle', revision: 1, createdAt: '', updatedAt: '' },
      { id: 'note-lower', projectId: 'project-1', title: 'a', markdown: 'needle', revision: 1, createdAt: '', updatedAt: '' },
      { id: 'note-upper', projectId: 'project-1', title: 'Z', markdown: 'needle', revision: 1, createdAt: '', updatedAt: '' }
    ];
    expect(searchManuscript(value, 'needle').map((result) => result.id)).toEqual([
      'note:note-a', 'note:note-b', 'note:note-upper', 'note:note-lower'
    ]);
  });

  it('maps normalized matches back to authored Unicode snippets', () => {
    const value = corpus();
    value.documents = documentMap([['doc-1', documentFromText('A ﬃ target appears here.')]]);
    const result = searchManuscript(value, 'target').find((candidate) => candidate.kind === 'scene');
    expect(result?.snippet).toContain('ﬃ target');
    expect(result?.snippet).toContain('target');
  });

  it('keeps ordering deterministic across repeated searches and Unicode normalization', () => {
    const value = corpus();
    const first = searchManuscript(value, 'Cafe\u0301');
    const second = searchManuscript(value, 'Cafe\u0301');
    expect(first).toEqual(second);
    expect(first.some((result) => result.kind === 'scene')).toBe(true);
  });
});
