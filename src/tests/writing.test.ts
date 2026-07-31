import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutosaveController } from '../domain/autosave';
import { blockText, documentFromText } from '../domain/document';
import { countDocumentWords, localCalendarDate } from '../domain/goals';
import { mergePaginatedDocument, pageDimensions, paginateDocument, paginateDocumentWithSources } from '../domain/pagination';
import { InMemoryProjectRepository } from '../domain/repository';
import { DEFAULT_EDITOR_STYLE, type StructuredDocument } from '../domain/types';
import { SQLiteProjectRepository } from '../infrastructure/sqlite-repository';
import { exportCapturedRevision } from '../export/editorial';

async function fixture() {
  const repository = new InMemoryProjectRepository();
  await repository.createProject('/tmp/writing.weave', 'Writing');
  const story = await repository.createStory('Story');
  const chapter = await repository.createChapter(story.id, 'Chapter');
  const first = await repository.createScene(chapter.id, 'First', documentFromText('one two'));
  await repository.createScene(chapter.id, 'Second', documentFromText('three'));
  return { repository, chapter, first };
}

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

  it('persists a daily target and rolls daily progress at the local calendar boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 2, 12));
    const { repository, first } = await fixture();
    await repository.setDailyWordTarget(750);
    const head = await repository.getDocument(first.documentId);
    await repository.saveDocument(first.documentId, documentFromText('one two three four'), head.revision);
    expect((await repository.getWritingStats()).dailyTarget).toBe(750);
    expect((await repository.getWritingStats()).dailyWords).toBe(2);
    expect(localCalendarDate()).toBe('2025-01-02');
    vi.setSystemTime(new Date(2025, 0, 3, 0, 1));
    const nextDay = await repository.getWritingStats();
    expect(nextDay.date).toBe('2025-01-03');
    expect(nextDay.dailyWords).toBe(0);
    expect(nextDay.dailyTarget).toBe(750);
    vi.useRealTimers();
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

  it('splits one oversized paragraph across pages and merges edited fragments without loss', () => {
    const prose = Array.from({ length: 1800 }, (_, index) => `word${index}`).join(' ');
    const document = documentFromText(prose);
    const style = { ...DEFAULT_EDITOR_STYLE, pageSize: 'letter' as const };
    const pages = paginateDocument(document, style);
    const legalPages = paginateDocument(document, { ...style, pageSize: 'legal' });
    expect(pages.length).toBeGreaterThan(1);
    expect(legalPages.length).toBeLessThan(pages.length);
    expect(pages.flatMap((page) => page.blocks).map(blockText).join('')).toBe(prose);
    expect(new Set(pages.flatMap((page) => page.blocks.map((block) => block.id))).size).toBe(pages.flatMap((page) => page.blocks).length);

    const sourced = paginateDocumentWithSources(document, style);
    const firstPage = sourced[0].document;
    const firstBlock = firstPage.blocks[0];
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
});
