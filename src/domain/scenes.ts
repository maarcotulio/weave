import { blockText, cloneDocument, newId } from './document';
import { NoSceneMarkersError, type DocumentBlock, type Scene, type StructuredDocument } from './types';

/**
 * Scene boundaries are deliberately boring: only a whole paragraph containing
 * *** or Nova cena is a boundary. No prose, punctuation, or model inference is
 * interpreted as a scene break.
 */
export function isExplicitSceneMarker(block: DocumentBlock): boolean {
  if (block.kind !== 'paragraph') return false;
  const value = blockText(block).trim();
  return value === '***' || value === 'Nova cena';
}

export function hasExplicitSceneMarker(document: StructuredDocument): boolean {
  return document.blocks.some(isExplicitSceneMarker);
}

export function splitByExplicitMarkers(document: StructuredDocument): StructuredDocument[] {
  const scenes: DocumentBlock[][] = [[]];
  let markerCount = 0;
  for (const block of document.blocks) {
    if (isExplicitSceneMarker(block)) {
      markerCount += 1;
      scenes.push([]);
    } else {
      scenes[scenes.length - 1].push(block);
    }
  }
  if (markerCount === 0) throw new NoSceneMarkersError();

  // A marker at the edge is still explicit, but an empty edge scene is not a
  // useful writing document. Keep one empty document only when the whole draft
  // is empty so the user can recover it rather than silently dropping content.
  const nonEmpty = scenes.filter((blocks) => blocks.length > 0);
  const kept = nonEmpty.length > 0 ? nonEmpty : [[]];
  return kept.map((blocks) => ({ formatVersion: document.formatVersion, blocks: blocks.map((block) => ({ ...block, runs: block.runs.map((run) => ({ ...run, marks: [...run.marks] })) })) }));
}

/** Build a view document; this function never writes it to a repository. */
export function composeChapter(scenes: readonly Scene[], documents: ReadonlyMap<string, StructuredDocument>): StructuredDocument {
  const blocks: DocumentBlock[] = [];
  scenes
    .slice()
    .sort((a, b) => a.position - b.position)
    .forEach((scene, index) => {
      const document = documents.get(scene.documentId);
      if (!document) throw new Error(`Missing document ${scene.documentId}`);
      if (index > 0) {
        blocks.push({ id: newId('scene-break'), kind: 'scene-break', runs: [{ text: '', marks: [] }] });
      }
      blocks.push(...cloneDocument(document).blocks);
    });
  return { formatVersion: 1, blocks };
}
