import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockText } from '../domain/document';
import { markdownTitleFromFilename, markdownToDocument, rollbackInReverse } from '../domain/markdown-import';
import { InMemoryProjectRepository } from '../domain/repository';
import { SQLiteProjectRepository } from '../infrastructure/sqlite-repository';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('deterministic Markdown import', () => {
  it('normalizes line endings and recognizes only explicit ATX headings', () => {
    const document = markdownToDocument('# Title #\r\nplain *text*\r## Subheading\n### Third ###\n- not a heading');
    expect(document.blocks.map((block) => ({ kind: block.kind, level: block.headingLevel, text: blockText(block) }))).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'paragraph', level: undefined, text: 'plain *text*' },
      { kind: 'heading', level: 2, text: 'Subheading' },
      { kind: 'heading', level: 3, text: 'Third' },
      { kind: 'paragraph', level: undefined, text: '- not a heading' }
    ]);
  });

  it('preserves empty lines and creates a usable block for empty input', () => {
    expect(markdownToDocument('first\n\nlast').blocks.map(blockText)).toEqual(['first', '', 'last']);
    expect(markdownToDocument('').blocks.map(blockText)).toEqual(['']);
  });

  it('derives safe deterministic titles from path-like filenames', () => {
    expect(markdownTitleFromFilename('/imports/Chapter One.MD')).toBe('Chapter One');
    expect(markdownTitleFromFilename('C:\\drafts\\scene.md')).toBe('scene');
    expect(markdownTitleFromFilename('   ')).toBe('Untitled import');
    expect(markdownTitleFromFilename('notes.txt')).toBe('notes.txt');
  });

  it('compensates multi-file mutations in reverse order when a later file fails', async () => {
    const created: string[] = [];
    const removed: string[] = [];
    await expect((async () => {
      for (const name of ['first.md', 'second.md', 'third.md']) {
        if (name === 'third.md') throw new Error('simulated mutation failure');
        created.push(name);
      }
    })()).rejects.toThrow('simulated mutation failure');
    await rollbackInReverse(created, async (name) => { removed.push(name); });
    expect(removed).toEqual(['second.md', 'first.md']);
  });

  it('attempts every rollback even when one compensation fails', async () => {
    const removed: string[] = [];
    await expect(rollbackInReverse(['first', 'second', 'third'], async (name) => {
      removed.push(name);
      if (name === 'second') throw new Error('delete failed');
    })).rejects.toThrow('delete failed');
    expect(removed).toEqual(['third', 'second', 'first']);
  });

  it('creates manuscript scenes with imported structured documents through the repository', async () => {
    const repository = new InMemoryProjectRepository();
    await repository.createProject('/tmp/import.weave', 'Import');
    const story = await repository.createStory('Story');
    const chapter = await repository.createChapter(story.id, 'Chapter');
    const scene = await repository.createScene(chapter.id, markdownTitleFromFilename('arrival.md'), markdownToDocument('# Arrival\nBody'));
    const head = await repository.getDocument(scene.documentId);
    expect(scene.title).toBe('arrival');
    expect(head.document.blocks.map(blockText)).toEqual(['Arrival', 'Body']);
    expect(head.document.blocks[0].kind).toBe('heading');
  });

  it('persists imported Markdown notes and original source through SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'weave-markdown-import-'));
    temporaryDirectories.push(directory);
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'Import');
    const source = '# Canonical\n\n[[Other]]';
    const note = await repository.createMarkdownNote(markdownTitleFromFilename('world.md'), source);
    repository.close();
    const reopened = new SQLiteProjectRepository(directory);
    await reopened.openProject(directory);
    expect((await reopened.listMarkdownNotes()).find((item) => item.id === note.id)).toMatchObject({ title: 'world', markdown: source });
    reopened.close();
  });
});
