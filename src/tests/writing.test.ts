import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutosaveController } from '../domain/autosave';
import { blockText, documentFromText } from '../domain/document';
import { countDocumentWords, localCalendarDate } from '../domain/goals';
import { calculateWritingAnalytics, normalizeWritingActivity } from '../domain/writing-analytics';
import { PAGE_LAYOUT, canonicalOffsetToPage, effectiveTextMargins, mergePaginatedDocument, pageDimensions, pageOffsetToCanonical, pageTextHeight, paginateDocument, paginateDocumentWithSources, type PaginatedBlock } from '../domain/pagination';
import { InMemoryProjectRepository } from '../domain/repository';
import { DEFAULT_EDITOR_STYLE, DEFAULT_TEXT_MARGINS, type StructuredDocument } from '../domain/types';
import { SQLiteProjectRepository } from '../infrastructure/sqlite-repository';
import { exportCapturedRevision } from '../export/editorial';

async function fixture() {
  const repository = new InMemoryProjectRepository();
  await repository.createProject('/tmp/writing.weave', 'Writing');
  const story = await repository.createStory('Story');
  const chapter = await repository.createChapter(story.id, 'Chapter');
  const first = await repository.createScene(chapter.id, 'First', documentFromText('one two'));
  await repository.createScene(chapter.id, 'Second', documentFromText('three'));
  return { repository, story, chapter, first };
}

describe('writing analytics', () => {
  it('calculates sessions, streaks, and daily pace from unique local dates', () => {
    const activity = [
      { date: '2025-01-01', words: 100 },
      { date: '2025-01-02', words: 200 },
      { date: '2025-01-02', words: 200 },
      { date: '2025-01-04', words: 300 }
    ];
    expect(normalizeWritingActivity(activity)).toEqual([
      { date: '2025-01-01', words: 100 },
      { date: '2025-01-02', words: 200 },
      { date: '2025-01-04', words: 300 }
    ]);
    expect(calculateWritingAnalytics(activity, '2025-01-04')).toEqual({ sessions: 3, currentStreak: 1, longestStreak: 2, averageWordsPerDay: 200 });
  });

  it('has explicit empty and non-today streak states', () => {
    expect(calculateWritingAnalytics([], '2025-01-04')).toEqual({ sessions: 0, currentStreak: 0, longestStreak: 0, averageWordsPerDay: 0 });
    expect(calculateWritingAnalytics([{ date: '2025-01-03', words: 100 }], '2025-01-04').currentStreak).toBe(0);
  });
});

describe('writing style and goals', () => {
  it('keeps style presentation separate and counts only the active chapter source', async () => {
    const { repository, chapter, first } = await fixture();
    expect((await repository.snapshot()).styleProfile).toEqual(DEFAULT_EDITOR_STYLE);
    const style = { fontFamily: 'Georgia', fontSizePt: 14, lineSpacing: '1.5' as const };
    expect(await repository.updateStyleProfile(style)).toEqual({ ...style, pageSize: 'letter' });
    const initial = await repository.getWritingStats();
    expect(initial.projectWords).toBe(3);

    const draft = await repository.enterContinuousDraft(chapter.id);
    expect((await repository.getWritingStats()).projectWords).toBe(3);
    const draftHead = await repository.getDocument(draft.documentId);
    await repository.saveDocument(draft.documentId, documentFromText('one two three four'), draftHead.revision);
    expect((await repository.getWritingStats()).projectWords).toBe(4);
    await repository.keepContinuousSeparate(draft.id);
    expect((await repository.getWritingStats()).projectWords).toBe(3);
    expect((await repository.getDocument(first.documentId)).revision).toBe(1);
  });

  it('saves multiple manuscript-only milestones with labels and timestamps', async () => {
    const { repository, first } = await fixture();
    await repository.createMarkdownNote('Excluded note', '# Notes are not part of manuscript versions');
    const firstVersion = await repository.saveManuscriptVersion('First milestone');
    await expect(repository.saveManuscriptVersion('   ')).rejects.toThrow('version label');
    const head = await repository.getDocument(first.documentId);
    await repository.saveDocument(first.documentId, documentFromText('one two three four'), head.revision);
    const secondVersion = await repository.saveManuscriptVersion('Expanded draft');
    expect(secondVersion.id).not.toBe(firstVersion.id);
    expect(secondVersion.wordCount).toBe(5);
    expect((await repository.listManuscriptVersions()).map((version) => version.label)).toEqual(['Expanded draft', 'First milestone']);
    expect((await repository.snapshot()).manuscriptVersions).toHaveLength(2);
  });

  it('details and compares immutable manuscript snapshots', async () => {
    const { repository, first, chapter } = await fixture();
    const before = await repository.saveManuscriptVersion('Before edit');
    const head = await repository.getDocument(first.documentId);
    await repository.saveDocument(first.documentId, documentFromText('one two changed'), head.revision);
    const after = await repository.saveManuscriptVersion('After edit');
    const detail = await repository.getManuscriptVersion(before.id);
    expect(detail.snapshot.scenes).toHaveLength(2);
    const comparison = await repository.compareManuscriptVersions(before.id, after.id);
    expect(comparison.changes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'document', change: 'changed', id: first.documentId })]));
    expect(comparison.from.id).toBe(before.id);
    expect(comparison.to.id).toBe(after.id);
    expect((await repository.getDocument(first.documentId)).document.blocks[0].runs[0].text).toContain('changed');
    expect((await repository.listScenes(chapter.id)).length).toBe(2);
  });

  it('restores manuscript content behind a backup without touching notes, canvases, settings, or version history', async () => {
    const { repository, first, chapter, story } = await fixture();
    const note = await repository.createMarkdownNote('Keep me', 'unchanged');
    const canvas = await repository.createCanvas(story.id, 'Keep canvas');
    await repository.updateStyleProfile({ ...DEFAULT_EDITOR_STYLE, fontFamily: 'Georgia' });
    const saved = await repository.saveManuscriptVersion('Safe point');
    const head = await repository.getDocument(first.documentId);
    await repository.saveDocument(first.documentId, documentFromText('later text'), head.revision);
    const result = await repository.restoreManuscriptVersion(saved.id);
    expect(result.status.state).toBe('recovered');
    expect(result.backup.id).toMatch(/^backup-/);
    expect((await repository.getDocument(first.documentId)).document.blocks[0].runs[0].text).toContain('one two');
    expect((await repository.listMarkdownNotes()).find((value) => value.id === note.id)?.markdown).toBe('unchanged');
    expect((await repository.listCanvases()).find((value) => value.id === canvas.id)?.title).toBe('Keep canvas');
    expect((await repository.getStyleProfile()).fontFamily).toBe('Georgia');
    expect((await repository.listManuscriptVersions()).map((value) => value.id)).toContain(saved.id);
    expect((await repository.listScenes(chapter.id))).toHaveLength(2);
  });

  it('restores historical manuscript content while preserving newer dangling canvases', async () => {
    const { repository, story } = await fixture();
    const saved = await repository.saveManuscriptVersion('Before second story');
    const newerStory = await repository.createStory('Newer story');
    const canvas = await repository.createCanvas(newerStory.id, 'Newer canvas');
    await expect(repository.restoreManuscriptVersion(saved.id)).resolves.toMatchObject({ status: { state: 'recovered' } });
    expect((await repository.listCanvases()).find((value) => value.id === canvas.id)?.title).toBe('Newer canvas');
    expect((await repository.listStories()).map((value) => value.title)).toEqual(['Story']);
    expect(story.id).toBe((await repository.listStories())[0].id);
  });

  it('rejects an invalid version before creating a backup or partially replacing manuscript state', async () => {
    const { repository, first } = await fixture();
    const saved = await repository.saveManuscriptVersion('Valid');
    const state = repository as unknown as { state: { manuscriptVersions: Array<{ summary: unknown; snapshot: unknown }>; backups: unknown[] } };
    state.state.manuscriptVersions[0].snapshot = { stories: [], chapters: [], sceneSets: [], scenes: [{ id: 'bad', sceneSetId: 'missing', title: 'Bad', position: 0, documentId: first.documentId }], continuousDrafts: [], documents: [] };
    await expect(repository.restoreManuscriptVersion(saved.id)).rejects.toThrow('missing scene set');
    expect((await repository.getDocument(first.documentId)).document.blocks[0].runs[0].text).toContain('one two');
    expect(state.state.backups).toHaveLength(0);
  });

  it('rejects a cross-project historical story before restore backup creation', async () => {
    const { repository } = await fixture();
    const saved = await repository.saveManuscriptVersion('Cross-project check');
    const state = repository as unknown as { state: { manuscriptVersions: Array<{ snapshot: { stories: Array<{ projectId: string }> } }>; backups: unknown[]; stories: unknown[]; chapters: unknown[]; sceneSets: unknown[]; scenes: unknown[]; documents: unknown[]; drafts: unknown[] } };
    const liveBefore = JSON.parse(JSON.stringify({ stories: state.state.stories, chapters: state.state.chapters, sceneSets: state.state.sceneSets, scenes: state.state.scenes, documents: state.state.documents, drafts: state.state.drafts }));
    state.state.manuscriptVersions[0].snapshot.stories[0].projectId = 'different-project';
    await expect(repository.restoreManuscriptVersion(saved.id)).rejects.toThrow('different project');
    expect({ stories: state.state.stories, chapters: state.state.chapters, sceneSets: state.state.sceneSets, scenes: state.state.scenes, documents: state.state.documents, drafts: state.state.drafts }).toEqual(liveBefore);
    expect(state.state.backups).toHaveLength(0);
  });

  it('rejects duplicate manuscript record IDs before restore backup creation', async () => {
    const { repository } = await fixture();
    const saved = await repository.saveManuscriptVersion('Duplicate check');
    const state = repository as unknown as { state: { manuscriptVersions: Array<{ snapshot: { stories: Array<{ id: string; [key: string]: unknown }> } }>; backups: unknown[] } };
    const snapshot = state.state.manuscriptVersions[0].snapshot;
    snapshot.stories.push({ ...snapshot.stories[0] });
    await expect(repository.restoreManuscriptVersion(saved.id)).rejects.toThrow('Duplicate story');
    expect(state.state.backups).toHaveLength(0);
  });

  it('persists a restore and its recovery backup across SQLite reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'weave-restore-'));
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'SQLite restore');
    const story = await repository.createStory('Story');
    const chapter = await repository.createChapter(story.id, 'Chapter');
    const scene = await repository.createScene(chapter.id, 'Scene', documentFromText('original'));
    const saved = await repository.saveManuscriptVersion('SQLite safe point');
    const head = await repository.getDocument(scene.documentId);
    await repository.saveDocument(scene.documentId, documentFromText('changed'), head.revision);
    const restored = await repository.restoreManuscriptVersion(saved.id);
    repository.close();
    const reopened = new SQLiteProjectRepository(directory);
    expect((await reopened.getDocument(scene.documentId)).document.blocks[0].runs[0].text).toBe('original');
    expect((await reopened.snapshot()).backups.some((backup) => backup.id === restored.backup.id)).toBe(true);
    reopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('persists a daily target and rolls daily progress at the local calendar boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 2, 12));
    const { repository, first } = await fixture();
    await repository.setDailyWordTarget(750);
    const head = await repository.getDocument(first.documentId);
    await repository.saveDocument(first.documentId, documentFromText('one two three four'), head.revision);
    expect((await repository.getWritingStats()).dailyTarget).toBe(750);
    expect((await repository.getWritingStats()).dailyWords).toBe(2);
    expect((await repository.getWritingStats()).sessions).toBe(1);
    expect((await repository.getWritingStats()).currentStreak).toBe(1);
    expect((await repository.getWritingStats()).averageWordsPerDay).toBe(2);
    const duplicateHead = await repository.getDocument(first.documentId);
    await repository.saveDocument(first.documentId, documentFromText('one two three four'), duplicateHead.revision);
    expect((await repository.getWritingStats()).dailyWords).toBe(2);
    expect((await repository.getWritingStats()).sessions).toBe(1);
    expect((await repository.getWritingActivity()).at(-1)?.words).toBe(2);
    expect(localCalendarDate()).toBe('2025-01-02');
    vi.setSystemTime(new Date(2025, 0, 3, 0, 1));
    const nextDay = await repository.getWritingStats();
    expect(nextDay.date).toBe('2025-01-03');
    expect(nextDay.dailyWords).toBe(0);
    expect(nextDay.dailyTarget).toBe(750);
    vi.useRealTimers();
  });

  it('uses the global margin profile when calculating writing pages', () => {
    expect(effectiveTextMargins({ textMargins: { top: 50, right: 60, bottom: 40, left: 60 } })).toEqual({ top: 50, right: 60, bottom: 40, left: 60 });
    expect(effectiveTextMargins({})).toEqual(DEFAULT_TEXT_MARGINS);
    expect(pageTextHeight('letter', { top: 80, right: 72, bottom: 80, left: 72 })).toBeLessThan(pageTextHeight('letter'));
  });

  it('paginates long manuscripts without changing canonical blocks and respects page size', () => {
    const document = documentFromText(Array.from({ length: 80 }, (_, index) => `Paragraph ${index} with enough words to occupy the writing page.`).join('\n'));
    const style = { ...DEFAULT_EDITOR_STYLE, pageSize: 'a4' as const };
    const pages = paginateDocument(document, style);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((page) => page.blocks).map((block) => block.id)).toEqual(document.blocks.map((block) => block.id));
    expect(pageDimensions('a4').label).toBe('A4');
    expect(pageDimensions('a4').heightPx).toBeGreaterThan(pageDimensions('letter').heightPx);
  });

  it('reserves the real fixed-page footer boundary before reflowing content', () => {
    expect(PAGE_LAYOUT.footerHeightPx).toBe(25);
    expect(PAGE_LAYOUT.metaHeightPx).toBe(25);
    expect(pageTextHeight('letter')).toBe(906);
    expect(pageTextHeight('a4')).toBeGreaterThan(pageTextHeight('letter'));
  });

  it('splits one oversized paragraph across pages and merges edited fragments without loss', () => {
    const prose = Array.from({ length: 1800 }, (_, index) => `word${index}`).join(' ');
    const document = documentFromText(prose);
    const style = { ...DEFAULT_EDITOR_STYLE, fontFamily: 'Georgia', fontSizePt: 24, lineSpacing: 'double' as const, pageSize: 'letter' as const };
    const pages = paginateDocument(document, style);
    const legalPages = paginateDocument(document, { ...style, pageSize: 'legal' });
    expect(pages.length).toBeGreaterThan(1);
    expect(legalPages.length).toBeLessThan(pages.length);
    expect(pages.flatMap((page) => page.blocks).map(blockText).join('')).toBe(prose);
    expect(new Set(pages.flatMap((page) => page.blocks.map((block) => block.id))).size).toBe(pages.flatMap((page) => page.blocks).length);

    const sourced = paginateDocumentWithSources(document, style);
    const firstPage = sourced[0].document;
    const firstBlock = firstPage.blocks[0];
    const metadata = (firstBlock as PaginatedBlock).pagination!;
    const forward = canonicalOffsetToPage(sourced, metadata.sourceBlockId, metadata.end, 'forward');
    const backward = canonicalOffsetToPage(sourced, metadata.sourceBlockId, metadata.end, 'backward');
    expect(forward?.pageIndex).toBe(1);
    expect(forward?.offset).toBe(0);
    expect(backward?.pageIndex).toBe(0);
    expect(pageOffsetToCanonical(metadata, firstBlock.runs[0].text.length, blockText(firstBlock).length)).toBe(metadata.end);
    const typedOffset = pageOffsetToCanonical(metadata, blockText(firstBlock).length + 3, blockText(firstBlock).length + 3);
    expect(typedOffset).toBe(metadata.end + 3);
    const reflowed = paginateDocumentWithSources(document, { ...style, fontSizePt: 12, pageSize: 'a4' });
    const remapped = canonicalOffsetToPage(reflowed, metadata.sourceBlockId, typedOffset, 'forward');
    expect(remapped?.sourceBlockId).toBe(metadata.sourceBlockId);
    const edited = { ...firstPage, blocks: firstPage.blocks.map((block, index) => index === 0 ? { ...block, runs: [{ text: `edited ${blockText(block)}`, marks: [] }] } : block) };
    const merged = mergePaginatedDocument(document, sourced, 0, edited);
    expect(blockText(merged.blocks[0])).toBe(`edited ${blockText(firstBlock)}${prose.slice(blockText(firstBlock).length)}`);
  });

  it('uses the style profile in visual exports', () => {
    const document: StructuredDocument = documentFromText('A page');
    const revision = { id: 'r', documentId: 'd', number: 1, document, createdAt: new Date().toISOString(), reason: 'edit' as const };
    const file = exportCapturedRevision(revision, 'docx', { title: 'Draft', styleProfile: { fontFamily: 'Arial', fontSizePt: 16, lineSpacing: '1.5', pageSize: 'a4' } });
    const packageBytes = new TextDecoder().decode(file.bytes);
    expect(packageBytes).toContain('Arial');
    expect(packageBytes).toContain('w:val="32"');
    expect(packageBytes).toContain('w:line="360"');
    expect(packageBytes).toContain('w:w="11900"');
    expect(countDocumentWords(document)).toBe(2);
  });
});

describe('debounced autosave', () => {
  it('debounces typing, flushes explicitly, and retains failed dirty content for retry', async () => {
    vi.useFakeTimers();
    let saves = 0;
    let fail = true;
    const statuses: string[] = [];
    const autosave = new AutosaveController(async () => { saves += 1; if (fail) throw new Error('disk full'); }, { delayMs: 100, onStatus: (status) => statuses.push(status.state) });
    autosave.markDirty();
    await vi.advanceTimersByTimeAsync(99);
    expect(saves).toBe(0);
    fail = false;
    await autosave.flush();
    expect(saves).toBe(1);
    expect(autosave.getStatus().state).toBe('saved');
    autosave.markDirty();
    fail = true;
    await expect(autosave.flush()).rejects.toThrow('disk full');
    expect(autosave.getStatus().state).toBe('error');
    fail = false;
    await autosave.retry();
    expect(saves).toBe(3);
    expect(autosave.getStatus().state).toBe('saved');
    expect(statuses).toContain('error');
    vi.useRealTimers();
  });
});

describe('SQLite writing preferences', () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it('recovers style and goal settings after restart', async () => {
    directory = await mkdtemp(join(tmpdir(), 'weave-writing-'));
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'SQLite writing');
    await repository.updateStyleProfile({ fontFamily: 'Courier New', fontSizePt: 11, lineSpacing: 'single', pageSize: 'a4' });
    await repository.setDailyWordTarget(900);
    repository.close();
    const reopened = new SQLiteProjectRepository(directory);
    expect(await reopened.getStyleProfile()).toEqual({ fontFamily: 'Courier New', fontSizePt: 11, lineSpacing: 'single', pageSize: 'a4' });
    expect((await reopened.getWritingStats()).dailyTarget).toBe(900);
    reopened.close();
  });

  it('persists global text margins without changing the canonical document', async () => {
    directory = await mkdtemp(join(tmpdir(), 'weave-margins-'));
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'SQLite margins');
    await repository.updateStyleProfile({ ...DEFAULT_EDITOR_STYLE, textMargins: { top: 60, right: 80, bottom: 60, left: 80 } });
    await repository.saveManuscriptVersion('SQLite milestone');
    repository.close();
    const reopened = new SQLiteProjectRepository(directory);
    expect((await reopened.getStyleProfile()).textMargins).toEqual({ top: 60, right: 80, bottom: 60, left: 80 });
    expect((await reopened.listManuscriptVersions()).map((version) => version.label)).toEqual(['SQLite milestone']);
    reopened.close();
  });
});
