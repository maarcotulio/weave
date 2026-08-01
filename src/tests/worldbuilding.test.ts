import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryProjectRepository } from '../domain/repository';
import { EntityRevisionConflictError } from '../domain/types';
import { SQLiteProjectRepository } from '../infrastructure/sqlite-repository';

async function fixture(repository = new InMemoryProjectRepository()) {
  await repository.createProject('/tmp/worldbuilding.weave', 'Worldbuilding');
  const story = await repository.createStory('The Long Road');
  await repository.createChapter(story.id, 'Arrival');
  return { repository, story };
}

describe('notes-only worldbuilding', () => {
  it('indexes only exact Markdown note links and preserves resolved stable IDs through a note rename', async () => {
    const { repository } = await fixture();
    const alpha = await repository.createMarkdownNote('Alpha', 'Plain Beta prose stays plain. [[Beta|the second note]] is a link.');
    const beta = await repository.createMarkdownNote('Beta', 'A note.');
    const saved = await repository.updateMarkdownNote(alpha.id, { title: alpha.title, markdown: alpha.markdown }, alpha.revision);
    const [link] = await repository.listNoteLinks(saved.id);
    expect(link).toMatchObject({ targetText: 'Beta', label: 'the second note', targetId: beta.id });
    expect(await repository.listNoteLinks(beta.id)).toEqual([]);

    const renamed = await repository.updateMarkdownNote(beta.id, { title: 'Beta renamed', markdown: beta.markdown }, beta.revision);
    const again = await repository.updateMarkdownNote(saved.id, { title: saved.title, markdown: saved.markdown }, saved.revision);
    expect((await repository.listNoteLinks(again.id))[0].targetId).toBe(renamed.id);
    expect(await repository.listMarkdownNotes()).toHaveLength(2);
    await expect(repository.updateMarkdownNote(saved.id, { title: 'Stale', markdown: '' }, saved.revision)).rejects.toBeInstanceOf(EntityRevisionConflictError);
  });

  it('projects a canvas with Markdown note nodes and resolved wiki-link edges only', async () => {
    const { repository, story } = await fixture();
    const source = await repository.createMarkdownNote('Source', '[[Target]]');
    const target = await repository.createMarkdownNote('Target', '');
    const sourceSaved = await repository.updateMarkdownNote(source.id, { title: source.title, markdown: source.markdown }, source.revision);
    const canvas = await repository.createCanvas(story.id, 'Research map');
    const sourceNode = await repository.addCanvasNode(canvas.id, sourceSaved.id, { x: 15, y: 25 }, canvas.revision);
    const withSource = await repository.getCanvasProjection(canvas.id);
    const targetNode = await repository.addCanvasNode(canvas.id, target.id, { x: 160, y: 25 }, withSource.canvas.revision);
    const projection = await repository.getCanvasProjection(canvas.id);
    const noteLink = (await repository.listNoteLinks(sourceSaved.id))[0];

    expect(projection.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sourceNode.id, entityId: sourceSaved.id, entityKind: 'note', label: 'Source' }),
      expect.objectContaining({ id: targetNode.id, entityId: target.id, entityKind: 'note', label: 'Target' })
    ]));
    expect(projection.edges).toEqual([expect.objectContaining({ sourceNodeId: sourceNode.id, targetNodeId: targetNode.id, noteLinkId: noteLink.id })]);
    const saved = await repository.saveCanvasLayout(canvas.id, [{ id: sourceNode.id, position: { x: 240, y: 300 } }], { x: -44, y: 16, zoom: 1.25 }, projection.canvas.revision);
    expect(saved.viewport).toEqual({ x: -44, y: 16, zoom: 1.25 });
    expect((await repository.getCanvasProjection(canvas.id)).nodes.find((node) => node.id === sourceNode.id)?.position).toEqual({ x: 240, y: 300 });
    await repository.removeCanvasNode(canvas.id, sourceNode.id, saved.revision);
    expect((await repository.listMarkdownNotes()).find((note) => note.id === source.id)?.markdown).toBe('[[Target]]');
  });

  it('persists the selected canvas engine and Excalidraw scene state with revision checks', async () => {
    const { repository, story } = await fixture();
    const reactFlow = await repository.createCanvas(story.id, 'Legacy-compatible');
    expect(reactFlow.engine).toBe('react-flow');
    const excalidraw = await repository.createCanvas(story.id, 'Sketches', 'excalidraw');
    expect(excalidraw.engine).toBe('excalidraw');
    expect(excalidraw.excalidrawState?.elements).toEqual([]);
    const saved = await repository.saveExcalidrawScene(excalidraw.id, { elements: [{ id: 'rectangle-1', type: 'rectangle' }], appState: { viewBackgroundColor: '#fefefe' }, files: {} }, excalidraw.revision);
    expect(saved.revision).toBe(excalidraw.revision + 1);
    const reopened = await repository.getCanvasProjection(excalidraw.id);
    expect(reopened.canvas.engine).toBe('excalidraw');
    expect(reopened.canvas.excalidrawState?.elements).toEqual([{ id: 'rectangle-1', type: 'rectangle' }]);
    await expect(repository.saveExcalidrawScene(excalidraw.id, { elements: [], appState: {}, files: {} }, excalidraw.revision)).rejects.toThrow('changed');
    await expect(repository.saveExcalidrawScene(reactFlow.id, { elements: [], appState: {}, files: {} }, reactFlow.revision)).rejects.toThrow('only be saved');
  });

  it('accepts only notes as canvas nodes and keeps deletions reference-safe', async () => {
    const { repository, story } = await fixture();
    const source = await repository.createMarkdownNote('Source', '[[Target]]');
    const target = await repository.createMarkdownNote('Target', '');
    const sourceSaved = await repository.updateMarkdownNote(source.id, { title: source.title, markdown: source.markdown }, source.revision);
    const canvas = await repository.createCanvas(story.id, 'Notes');
    await expect(repository.addCanvasNode(canvas.id, 'not-a-note', { x: 0, y: 0 }, canvas.revision)).rejects.toThrow('Unknown Markdown note');
    await repository.addCanvasNode(canvas.id, target.id, { x: 0, y: 0 }, canvas.revision);
    await expect(repository.deleteMarkdownNote(target.id, target.revision)).rejects.toThrow('Cannot delete Target');
    await repository.deleteMarkdownNote(target.id, target.revision, 'remove-references');
    expect((await repository.listNoteLinks(sourceSaved.id))[0].targetId).toBeUndefined();
    expect((await repository.getCanvasProjection(canvas.id)).nodes).toEqual([]);
  });
});

describe('offline persistence and accessible workspace', () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it('reloads notes, note-only placements, and their derived canvas links through SQLite', async () => {
    directory = await mkdtemp(join(tmpdir(), 'weave-world-'));
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'Offline');
    const story = await repository.createStory('Story');
    const source = await repository.createMarkdownNote('Source', '[[Target]]');
    const target = await repository.createMarkdownNote('Target', '');
    const sourceSaved = await repository.updateMarkdownNote(source.id, { title: source.title, markdown: source.markdown }, source.revision);
    const canvas = await repository.createCanvas(story.id, 'Offline notes');
    await repository.addCanvasNode(canvas.id, sourceSaved.id, { x: 41, y: 42 }, canvas.revision);
    const sketch = await repository.createCanvas(story.id, 'Offline sketch', 'excalidraw');
    await repository.saveExcalidrawScene(sketch.id, { elements: [{ id: 'ellipse-1', type: 'ellipse' }], appState: { viewBackgroundColor: '#fff' }, files: {} }, sketch.revision);
    const placed = await repository.getCanvasProjection(canvas.id);
    await repository.addCanvasNode(canvas.id, target.id, { x: 99, y: 42 }, placed.canvas.revision);
    repository.close();

    const reopened = new SQLiteProjectRepository(directory);
    expect((await reopened.listMarkdownNotes()).map((note) => note.title)).toEqual(['Source', 'Target']);
    const projection = await reopened.getCanvasProjection(canvas.id);
    expect(projection.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ entityKind: 'note', position: { x: 41, y: 42 } })]));
    expect(projection.edges).toHaveLength(1);
    const reopenedSketch = (await reopened.listCanvases(story.id)).find((candidate) => candidate.title === 'Offline sketch');
    expect(reopenedSketch?.engine).toBe('excalidraw');
    expect(reopenedSketch?.excalidrawState?.elements).toEqual([{ id: 'ellipse-1', type: 'ellipse' }]);
    expect((await reopened.integrityCheck()).ok).toBe(true);
    reopened.close();
  });

  it('keeps Worldbuilding tab activation, close semantics, and close-control alignment intact', () => {
    const component = readFileSync(join(process.cwd(), 'src/app/Worldbuilding.tsx'), 'utf8');
    const styles = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
    expect(component).toContain('role="tablist" aria-label="Open Worldbuilding tabs"');
    expect(component).toContain('onClick={() => onActivate(key)}');
    expect(component).toContain('aria-label={`Close ${labelFor(tab)} tab`}');
    expect(component).toContain('onClick={() => onClose(key)}');
    expect(styles).toContain('.world-tab-close { display: grid; place-items: center; width: 27px; padding: 0;');
    expect(styles).toContain('.world-tab-close:hover { color: var(--accent-dark); background: var(--accent-wash); }');
    expect(readFileSync(join(process.cwd(), 'src/app/base.css'), 'utf8')).toContain(':focus-visible');
  });

  it('ships accessible workspace tabs, exact empty actions, and a note-only React Flow fallback', () => {
    const component = readFileSync(join(process.cwd(), 'src/app/Worldbuilding.tsx'), 'utf8');
    expect(component).toContain("from '@xyflow/react'");
    expect(component).toContain("from '@excalidraw/excalidraw'");
    expect(component).toContain('note-page-stack');
    expect(component).toContain('Markdown source · autosaves locally');
    expect(component).toContain('saveExcalidrawScene');
    expect(component).toContain('role="tablist"');
    expect(component).toContain('role="tab"');
    expect(component).toContain('aria-label="Note canvas"');
    expect(component).toContain('nodesConnectable={false}');
    expect(component).toContain("event.key === 'Home'");
    expect(component).toContain('Canvas outline');
    expect(component).toContain('Keyboard-accessible list of every note node and resolved wiki-link edge.');
    expect(component).toContain('[[Note title|label]]');
    expect(component).toContain('Create new note</button><button type="button" onClick={onCreateCanvas}>Create new canvas</button><button type="button" onClick={onReturnToManuscript}>Close');
    expect(component).not.toContain('worldbuilding-nav');
    expect(component).not.toContain('Create typed relationship');
    expect(component).not.toContain('Anchored, not parsed');
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(app).toContain('Primary workspaces');
    expect(app).toContain('CanvasChoiceDialog');
    expect(app).toContain('type="radio"');
    expect(app).toContain('Choose a canvas engine');
    expect(app).toContain('Create canvas');
    expect(app).toContain('Escape');
    expect(app).toContain('worldbuilding-sidebar-group');
    expect(app).toContain('worldbuildingTabs');
    expect(app).toContain("import { Pencil, Plus, Trash2 } from 'lucide-react'");
    expect(app).toContain('worldbuilding-sidebar-heading');
    expect(app).toContain('className="worldbuilding-create-icon" aria-label="Create new note" title="Create new note" onClick={createWorldbuildingNote}><Plus');
    expect(app).toContain('className="worldbuilding-create-icon" aria-label="Create new canvas" title="Create new canvas" onClick={createWorldbuildingCanvas}><Plus');
    expect(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).toContain('"lucide-react"');
    expect(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).toContain('"@excalidraw/excalidraw": "0.18.1"');
    expect(readFileSync(join(process.cwd(), 'README.md'), 'utf8')).toContain('**0.18.1** package (MIT license');
    expect(app).toContain('onReturnToManuscript={() => setWorkspaceMode(\'writing\')}');
    const styles = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
    expect(styles).toContain('.worldbuilding-workspace { display: flex;');
    expect(styles).toContain('.worldbuilding-main { display: flex; flex: 1; flex-direction: column;');
    expect(styles).toContain('.worldbuilding-empty { display: flex; flex: 1; min-height: 0; width: 100%; flex-direction: column; align-items: center; justify-content: center;');
    expect(styles).toContain('.worldbuilding-sidebar-heading { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px;');
    expect(styles).toContain('.worldbuilding-create-icon { display: grid; place-items: center; flex: 0 0 27px; width: 27px; min-width: 27px; max-width: 27px; height: 27px; min-height: 27px; max-height: 27px; padding: 0;');
    expect(styles).toContain('.worldbuilding-sidebar-group > button {');
    expect(styles).not.toContain('.worldbuilding-sidebar-group button {');
  });
});
