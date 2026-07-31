import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { documentFromText } from '../domain/document';
import { InMemoryProjectRepository } from '../domain/repository';
import { EntityRevisionConflictError } from '../domain/types';
import { SQLiteProjectRepository } from '../infrastructure/sqlite-repository';

async function fixture(repository = new InMemoryProjectRepository()) {
  await repository.createProject('/tmp/worldbuilding.weave', 'Worldbuilding');
  const story = await repository.createStory('The Long Road');
  const chapter = await repository.createChapter(story.id, 'Arrival');
  const scene = await repository.createScene(chapter.id, 'At the Gate', documentFromText('Aster enters the city.'));
  const world = await repository.createWorldbuildingItem({ kind: 'world', title: 'Eld', aliases: ['The Old World'], properties: { genre: 'Fantasy', era: 'After the fall', summary: 'A weathered realm' } });
  const place = await repository.createWorldbuildingItem({ kind: 'place', title: 'Lumen', aliases: ['City of lamps'], properties: { placeType: 'City', region: 'West', description: 'A harbor city' } });
  const character = await repository.createWorldbuildingItem({ kind: 'character', title: 'Aster', aliases: ['The courier'], properties: { role: 'Courier', pronouns: 'they/them', summary: 'Carries a sealed letter' } });
  const term = await repository.createWorldbuildingItem({ kind: 'term', title: 'Glasswind', aliases: ['windglass'], properties: { category: 'Magic', definition: 'Storm magic trapped in glass' } });
  return { repository, story, chapter, scene, world, place, character, term };
}

describe('worldbuilding links and deletion rules', () => {
  it('uses stable IDs for aliases, relationships, backlinks, and rename-safe labels', async () => {
    const { repository, scene, place, character } = await fixture();
    const relation = await repository.createRelationship(character.id, place.id, 'located-in');
    const document = await repository.getDocument(scene.documentId);
    const block = document.document.blocks[0];
    const link = await repository.createDocumentLink({ documentId: scene.documentId, blockId: block.id, start: 0, end: 5 }, character.id);

    const renamed = await repository.updateWorldbuildingItem(character.id, { title: 'Aster Vale', aliases: ['The courier'], properties: { role: 'Courier', pronouns: 'they/them', summary: 'Carries a sealed letter' } }, character.revision);
    expect((await repository.listRelationships()).find((item) => item.id === relation.id)).toMatchObject({ sourceId: character.id, targetId: place.id });
    expect((await repository.listDocumentLinks(scene.documentId)).find((item) => item.id === link.id)?.targetId).toBe(character.id);
    const backlinks = await repository.listBacklinks(character.id);
    expect(backlinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'document', sourceId: scene.documentId, sourceTitle: 'At the Gate' })]));
    expect((await repository.searchWorldbuilding('courier')).map((item) => item.id)).toContain(renamed.id);
  });

  it('rejects destructive deletion by default and explicitly converts document references to repairable links', async () => {
    const { repository, scene, place, character } = await fixture();
    await repository.createRelationship(character.id, place.id, 'located-in');
    const head = await repository.getDocument(scene.documentId);
    await repository.createDocumentLink({ documentId: scene.documentId, blockId: head.document.blocks[0].id, start: 0, end: 0 }, character.id);
    const note = await repository.createMarkdownNote('Reference', '[[Aster]] is still referenced.');
    await expect(repository.deleteWorldbuildingItem(character.id, character.revision)).rejects.toThrow('Cannot delete Aster');
    await repository.deleteWorldbuildingItem(character.id, character.revision, 'remove-references');
    expect(await repository.listRelationships(character.id)).toEqual([]);
    expect(await repository.listWorldbuildingItems()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: character.id })]));
    const [unresolved] = await repository.listDocumentLinks(scene.documentId);
    expect(unresolved.targetId).toBeUndefined();
    expect(unresolved.unresolvedLabel).toBe('Aster');
    expect((await repository.listNoteLinks(note.id))[0].targetId).toBeUndefined();
  });

  it('rebuilds backlinks from persisted relationship and explicit anchor records rather than titles', async () => {
    const { repository, scene, character, term } = await fixture();
    await repository.createRelationship(term.id, character.id, 'mentions');
    const document = await repository.getDocument(scene.documentId);
    await repository.createDocumentLink({ documentId: scene.documentId, blockId: document.document.blocks[0].id, start: 0, end: 0 }, character.id);
    const once = await repository.listBacklinks(character.id);
    const twice = await repository.listBacklinks(character.id);
    expect(twice).toEqual(once);
    expect(once.map((link) => link.kind).sort()).toEqual(['document', 'relationship']);
    await expect(repository.createRelationship(character.id, character.id, 'knows')).rejects.toThrow('different items');
  });

  it('keeps stale worldbuilding revisions from silently overwriting structured properties', async () => {
    const { repository, character } = await fixture();
    await repository.updateWorldbuildingItem(character.id, { title: 'Aster', aliases: [], properties: { role: 'Courier', pronouns: 'they/them', summary: 'Updated' } }, character.revision);
    await expect(repository.updateWorldbuildingItem(character.id, { title: 'Stale Aster', aliases: [], properties: { role: 'Courier' } }, character.revision)).rejects.toBeInstanceOf(EntityRevisionConflictError);
  });

  it('persists multiple deterministic Markdown notes and rebuilds only exact wiki links into stable-ID backlinks', async () => {
    const { repository, character, place } = await fixture();
    const note = await repository.createMarkdownNote('Arrival notes', 'Plain Aster prose stays plain. Meet [[Aster]] at [[Lumen|the city]].');
    const second = await repository.createMarkdownNote('Loose end', 'Repair [[Unknown target]] later.');
    expect((await repository.listMarkdownNotes()).map((item) => item.id)).toEqual(expect.arrayContaining([note.id, second.id]));
    expect(await repository.listNoteLinks(note.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetText: 'Aster', targetId: character.id }),
      expect.objectContaining({ targetText: 'Lumen', label: 'the city', targetId: place.id })
    ]));
    expect(await repository.listNoteLinks(note.id)).toHaveLength(2);
    const unresolved = (await repository.listNoteLinks(second.id))[0];
    expect(unresolved.targetId).toBeUndefined();
    await repository.repairNoteLink(unresolved.id, place.id);
    const repaired = await repository.updateMarkdownNote(second.id, { title: 'Loose end', markdown: second.markdown }, second.revision);
    expect((await repository.listNoteLinks(repaired.id))[0].targetId).toBe(place.id);
    expect(await repository.listBacklinks(character.id)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'note', sourceId: note.id, sourceTitle: 'Arrival notes' })]));
  });

  it('preserves Markdown note link targets across a rename and stale note save', async () => {
    const { repository, character } = await fixture();
    const note = await repository.createMarkdownNote('Courier', '[[Aster]] arrives.');
    const renamed = await repository.updateWorldbuildingItem(character.id, { title: 'Aster Vale', aliases: [], properties: { role: 'Courier', pronouns: 'they/them', summary: 'Carries a sealed letter' } }, character.revision);
    expect(renamed.aliases).toContain('Aster');
    const saved = await repository.updateMarkdownNote(note.id, { title: 'Courier', markdown: note.markdown }, note.revision);
    expect((await repository.listNoteLinks(saved.id))[0].targetId).toBe(character.id);
    await expect(repository.updateMarkdownNote(note.id, { title: 'Stale', markdown: '[[Aster]]' }, note.revision)).rejects.toBeInstanceOf(EntityRevisionConflictError);
  });
});

describe('story-scoped React Flow projection persistence', () => {
  it('persists positions and viewport without mutating domain labels, refreshes labels after rename, and validates graph edges', async () => {
    const { repository, story, chapter, scene, character, place } = await fixture();
    const relation = await repository.createRelationship(character.id, scene.id, 'appears-in');
    const canvas = await repository.createCanvas(story.id, 'Plot map');
    const characterNode = await repository.addCanvasNode(canvas.id, character.id, { x: 15, y: 25 }, canvas.revision);
    let projection = await repository.getCanvasProjection(canvas.id);
    const sceneNode = await repository.addCanvasNode(canvas.id, scene.id, { x: 160, y: 25 }, projection.canvas.revision);
    projection = await repository.getCanvasProjection(canvas.id);
    const edge = await repository.connectCanvasNodes(canvas.id, characterNode.id, sceneNode.id, relation.id, projection.canvas.revision);
    projection = await repository.getCanvasProjection(canvas.id);
    const saved = await repository.saveCanvasLayout(canvas.id, [{ id: characterNode.id, position: { x: 240, y: 300 } }], { x: -44, y: 16, zoom: 1.25 }, projection.canvas.revision);
    expect(saved.viewport).toEqual({ x: -44, y: 16, zoom: 1.25 });
    expect((await repository.getCanvasProjection(canvas.id)).nodes.find((node) => node.id === characterNode.id)?.position).toEqual({ x: 240, y: 300 });
    expect((await repository.getCanvasProjection(canvas.id)).edges).toEqual([expect.objectContaining({ id: edge.id, relationshipId: relation.id })]);
    expect((await repository.getCanvasProjection(canvas.id)).nodes.find((node) => node.entityId === chapter.id)).toBeUndefined();

    await repository.updateWorldbuildingItem(character.id, { title: 'Aster Vale', aliases: ['The courier'], properties: { role: 'Courier', pronouns: 'they/them', summary: 'Carries a sealed letter' } }, character.revision);
    expect((await repository.getCanvasProjection(canvas.id)).nodes.find((node) => node.id === characterNode.id)?.label).toBe('Aster Vale');
    await expect(repository.connectCanvasNodes(canvas.id, characterNode.id, sceneNode.id, relation.id, canvas.revision)).rejects.toBeInstanceOf(EntityRevisionConflictError);
    await expect(repository.addCanvasNode(canvas.id, place.id, { x: 0, y: 0 }, canvas.revision)).rejects.toBeInstanceOf(EntityRevisionConflictError);
  });

  it('rejects chapter and scene nodes outside the canvas story and leaves domain data untouched when removing placements', async () => {
    const { repository, story, character } = await fixture();
    const second = await repository.createStory('Other story');
    const secondChapter = await repository.createChapter(second.id, 'Elsewhere');
    const canvas = await repository.createCanvas(story.id, 'Map');
    await expect(repository.addCanvasNode(canvas.id, secondChapter.id, { x: 1, y: 2 }, canvas.revision)).rejects.toThrow('belong to this canvas story');
    const node = await repository.addCanvasNode(canvas.id, character.id, { x: 1, y: 2 }, canvas.revision);
    const projection = await repository.getCanvasProjection(canvas.id);
    await repository.removeCanvasNode(canvas.id, node.id, projection.canvas.revision);
    expect((await repository.listWorldbuildingItems()).find((item) => item.id === character.id)?.title).toBe('Aster');
  });
});

describe('offline reload and accessible fallback', () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it('reloads local SQLite worldbuilding, relationships, document anchors, and graph placement', async () => {
    directory = await mkdtemp(join(tmpdir(), 'weave-world-'));
    const repository = new SQLiteProjectRepository(directory);
    await repository.createProject(directory, 'Offline');
    const story = await repository.createStory('Story');
    const chapter = await repository.createChapter(story.id, 'Chapter');
    const scene = await repository.createScene(chapter.id, 'Scene', documentFromText('Context'));
    const character = await repository.createWorldbuildingItem({ kind: 'character', title: 'Nova', properties: { role: 'Lead' } });
    const relation = await repository.createRelationship(character.id, scene.id, 'appears-in');
    const firstNote = await repository.createMarkdownNote('Offline note', '[[Nova]] appears in the scene.');
    await repository.createMarkdownNote('Second offline note', 'A separate persisted Markdown note.');
    const document = await repository.getDocument(scene.documentId);
    await repository.createDocumentLink({ documentId: scene.documentId, blockId: document.document.blocks[0].id, start: 0, end: 0 }, character.id);
    const canvas = await repository.createCanvas(story.id, 'Offline map');
    const characterNode = await repository.addCanvasNode(canvas.id, character.id, { x: 41, y: 42 }, canvas.revision);
    const projection = await repository.getCanvasProjection(canvas.id);
    const sceneNode = await repository.addCanvasNode(canvas.id, scene.id, { x: 99, y: 42 }, projection.canvas.revision);
    const next = await repository.getCanvasProjection(canvas.id);
    await repository.connectCanvasNodes(canvas.id, characterNode.id, sceneNode.id, relation.id, next.canvas.revision);
    const backup = await repository.createBackup();
    await repository.updateMarkdownNote(firstNote.id, { title: 'Changed after backup', markdown: 'No longer linked.' }, firstNote.revision);
    await repository.recoverFromBackup(backup.id);
    repository.close();

    const reopened = new SQLiteProjectRepository(directory);
    expect((await reopened.searchWorldbuilding('nova')).map((item) => item.title)).toEqual(['Nova']);
    expect((await reopened.listMarkdownNotes()).map((note) => note.title)).toEqual(['Offline note', 'Second offline note']);
    expect(await reopened.listNoteLinks(firstNote.id)).toEqual([expect.objectContaining({ targetId: character.id, targetText: 'Nova' })]);
    expect(await reopened.listBacklinks(character.id)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'document' }), expect.objectContaining({ kind: 'note', sourceId: firstNote.id })]));
    expect((await reopened.getCanvasProjection(canvas.id)).nodes).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: character.id, position: { x: 41, y: 42 } })]));
    expect((await reopened.getCanvasProjection(canvas.id)).edges).toHaveLength(1);
    expect((await reopened.integrityCheck()).ok).toBe(true);
    reopened.close();
  });

  it('ships a keyboard-addressable React Flow region and complete list/outline fallback', () => {
    const component = readFileSync(join(process.cwd(), 'src/app/Worldbuilding.tsx'), 'utf8');
    expect(component).toContain("from '@xyflow/react'");
    expect(component).toContain('aria-label="Story relationship graph"');
    expect(component).toContain('deleteKeyCode');
    expect(component).toContain("event.key === 'Home'");
    expect(component).toContain('Canvas outline');
    expect(component).toContain('Keyboard-accessible list of every graph node and relationship.');
    expect(component).toContain('[[Target|label]]');
    expect(component).toContain('Markdown note content');
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(app).toContain('Primary workspaces');
    expect(app).toContain('Worldbuilding');
  });
});
