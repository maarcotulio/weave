import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityRevisionConflictError } from '../domain/types';
import { InMemoryProjectRepository } from '../domain/repository';
import { SQLiteProjectRepository } from '../infrastructure/sqlite-repository';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('Outline files', () => {
  it('keeps Markdown planning files separate from manuscript records and checks revisions', async () => {
    const repository = new InMemoryProjectRepository();
    await repository.createProject('/tmp/outline', 'Outline');
    const file = await repository.createOutlineFile('Arc / opening', '# Opening\nPlan');
    expect((await repository.snapshot()).outlineFiles).toEqual([expect.objectContaining({ id: file.id, markdown: '# Opening\nPlan' })]);
    const saved = await repository.updateOutlineFile(file.id, { title: 'Arc / opening', markdown: 'Revised plan' }, file.revision);
    await expect(repository.updateOutlineFile(file.id, { title: file.title, markdown: 'lost update' }, file.revision)).rejects.toBeInstanceOf(EntityRevisionConflictError);
    await repository.deleteOutlineFile(saved.id, saved.revision);
    expect(await repository.listOutlineFiles()).toEqual([]);
  });

  it('persists Outline Markdown through SQLite reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'weave-outline-'));
    directories.push(directory);
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'Outline');
    const file = await repository.createOutlineFile('Story beats', '- Arrival');
    repository.close();
    const reopened = new SQLiteProjectRepository(directory);
    await reopened.openProject(directory);
    expect(await reopened.listOutlineFiles()).toEqual([expect.objectContaining({ id: file.id, title: 'Story beats', markdown: '- Arrival', revision: 1 })]);
    reopened.close();
  });
});
