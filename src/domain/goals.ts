import { blockText } from './document';
import type { Chapter, ContinuousDraft, DocumentBlock, Scene, StructuredDocument } from './types';

/** A calendar date in the user's local timezone, not UTC. */
export function localCalendarDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Count prose words while ignoring scene-break blocks. Punctuation is not a word. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
}

export function countBlockWords(block: DocumentBlock): number {
  const text = blockText(block).trim();
  return block.kind === 'scene-break' || (block.kind === 'paragraph' && (text === '***' || text === 'Nova cena')) ? 0 : countWords(text);
}

export function countDocumentWords(document: StructuredDocument): number {
  return document.blocks.reduce((total, block) => total + countBlockWords(block), 0);
}

/**
 * Count each chapter's active source exactly once. An open continuous draft is
 * the active source for its chapter; otherwise the chapter's active scene set
 * is the source. Kept-separate and split drafts are historical revisions and
 * are deliberately excluded.
 */
export function calculateProjectWordCount(
  chapters: readonly Chapter[],
  scenes: readonly Scene[],
  drafts: readonly ContinuousDraft[],
  documents: ReadonlyMap<string, StructuredDocument>
): number {
  return chapters.reduce((total, chapter) => {
    const openDraft = drafts
      .filter((draft) => draft.chapterId === chapter.id && draft.status === 'open')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (openDraft) {
      const document = documents.get(openDraft.documentId);
      return total + (document ? countDocumentWords(document) : 0);
    }
    return total + scenes
      .filter((scene) => scene.sceneSetId === chapter.activeSceneSetId)
      .reduce((chapterTotal, scene) => {
        const document = documents.get(scene.documentId);
        return chapterTotal + (document ? countDocumentWords(document) : 0);
      }, 0);
  }, 0);
}

export function documentMapFromRecords(records: readonly { id: string; revisions: readonly { document: StructuredDocument }[] }[]): Map<string, StructuredDocument> {
  return new Map(records.map((record) => [record.id, record.revisions.at(-1)?.document]).filter((entry): entry is [string, StructuredDocument] => Boolean(entry[1])));
}
