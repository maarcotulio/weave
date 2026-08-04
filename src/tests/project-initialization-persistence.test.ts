import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { documentFromText } from '../domain/document';
import { SQLiteProjectRepository } from '../infrastructure/sqlite-repository';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('project initialization and local persistence', () => {
  it('selects a desktop project folder before creation and does not seed manuscript content in the renderer', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const createProject = app.slice(app.indexOf('const chooseDesktopProjectDirectory ='), app.indexOf('const openProjectAt ='));
    expect(createProject).toContain("openDirectory({ directory: true, multiple: false, title })");
    expect(createProject).toContain("chooseDesktopProjectDirectory('Choose a folder for the new project')");
    expect(createProject).toContain('repository.createProject(projectDirectory, name)');
    expect(createProject).not.toContain("value: `${isDesktop ? '' : '/tmp/'}my-weave-project`");
    expect(createProject).not.toContain('repository.createStory');
    expect(createProject).not.toContain('repository.createChapter');
    expect(createProject).not.toContain('repository.createScene');
    const openProject = app.slice(app.indexOf('const openProject ='), app.indexOf('const forgetRecentProject ='));
    expect(openProject).toContain("chooseDesktopProjectDirectory('Choose a Weave project folder to open')");
    expect(openProject).toContain('repository.openProject(directory)');
  });

  it('creates and reopens a project with only project metadata and storage structure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'weave-empty-project-'));
    directories.push(directory);
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'Empty project');

    const created = await repository.snapshot();
    expect(created.project).toMatchObject({ directory, name: 'Empty project' });
    expect({ stories: created.stories, chapters: created.chapters, sceneSets: created.sceneSets, scenes: created.scenes, continuousDrafts: created.continuousDrafts, markdownNotes: created.markdownNotes, canvases: created.canvases }).toEqual({ stories: [], chapters: [], sceneSets: [], scenes: [], continuousDrafts: [], markdownNotes: [], canvases: [] });
    expect(JSON.parse(await readFile(join(directory, '.weave', 'files', 'latest.json'), 'utf8')).documents).toEqual([]);
    repository.close();

    const reopened = new SQLiteProjectRepository(directory);
    await reopened.openProject(directory);
    const reopenedSnapshot = await reopened.snapshot();
    expect({ stories: reopenedSnapshot.stories, chapters: reopenedSnapshot.chapters, sceneSets: reopenedSnapshot.sceneSets, scenes: reopenedSnapshot.scenes, continuousDrafts: reopenedSnapshot.continuousDrafts, markdownNotes: reopenedSnapshot.markdownNotes, canvases: reopenedSnapshot.canvases }).toEqual({ stories: [], chapters: [], sceneSets: [], scenes: [], continuousDrafts: [], markdownNotes: [], canvases: [] });
    expect(JSON.parse(await readFile(join(directory, '.weave', 'files', 'latest.json'), 'utf8')).documents).toEqual([]);
    reopened.close();
  });

  it('reopens explicitly created manuscript and Worldbuilding records with saved document revisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'weave-explicit-project-'));
    directories.push(directory);
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'Explicit project');
    const story = await repository.createStory('Created story');
    const chapter = await repository.createChapter(story.id, 'Created chapter');
    const scene = await repository.createScene(chapter.id, 'Created scene', documentFromText('first draft'));
    const head = await repository.getDocument(scene.documentId);
    await repository.saveDocument(scene.documentId, documentFromText('saved after creation'), head.revision);
    const folder = await repository.createWorldbuildingFolder('Created folder');
    const note = await repository.createMarkdownNote('Created note', '# Local note');
    const canvas = await repository.createCanvas(story.id, 'Created canvas');
    await repository.saveCanvasLayout(canvas.id, [], { x: 25, y: -8, zoom: 1.2 }, canvas.revision);
    await repository.moveWorldbuildingEntry('note', note.id, folder.id);
    await repository.moveWorldbuildingEntry('canvas', canvas.id, folder.id);
    repository.close();

    const reopened = new SQLiteProjectRepository(directory);
    await reopened.openProject(directory);
    const snapshot = await reopened.snapshot();
    expect(snapshot.stories).toEqual([expect.objectContaining({ id: story.id, title: 'Created story' })]);
    expect(snapshot.chapters).toEqual([expect.objectContaining({ id: chapter.id, storyId: story.id, title: 'Created chapter' })]);
    expect(snapshot.scenes).toEqual([expect.objectContaining({ id: scene.id, sceneSetId: chapter.activeSceneSetId, title: 'Created scene', documentId: scene.documentId })]);
    expect((await reopened.getDocument(scene.documentId)).document.blocks[0]?.runs[0]?.text).toBe('saved after creation');
    expect((await reopened.getDocument(scene.documentId)).revision).toBe(2);
    expect(snapshot.worldbuildingFolders).toEqual([expect.objectContaining({ id: folder.id, title: 'Created folder' })]);
    expect(snapshot.markdownNotes).toEqual([expect.objectContaining({ id: note.id, title: 'Created note', markdown: '# Local note', folderId: folder.id })]);
    expect(snapshot.canvases).toEqual([expect.objectContaining({ id: canvas.id, title: 'Created canvas', folderId: folder.id, viewport: { x: 25, y: -8, zoom: 1.2 } })]);
    reopened.close();
  });
});
