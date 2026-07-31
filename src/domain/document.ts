import {
  DOCUMENT_FORMAT_VERSION,
  type DocumentBlock,
  type SemanticMark,
  type StructuredDocument,
  type TextRun
} from './types';

let sequence = 0;

/** IDs only provide local identity; SQLite supplies durable record identity. */
export function newId(prefix = 'id'): string {
  sequence += 1;
  const random = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${random ?? `${Date.now().toString(36)}-${sequence.toString(36)}`}`;
}

export function now(): string {
  return new Date().toISOString();
}

export function emptyDocument(): StructuredDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    blocks: [{ id: newId('block'), kind: 'paragraph', runs: [{ text: '', marks: [] }] }]
  };
}

export function textRun(text: string, marks: SemanticMark[] = []): TextRun {
  return { text, marks: [...new Set(marks)] };
}

export function paragraph(text = '', marks: SemanticMark[] = []): DocumentBlock {
  return { id: newId('block'), kind: 'paragraph', runs: [textRun(text, marks)] };
}

export function documentFromText(text: string): StructuredDocument {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    blocks: lines.map((line) => paragraph(line))
  };
}

export function blockText(block: DocumentBlock): string {
  return block.runs.map((run) => run.text).join('');
}

export function documentToText(document: StructuredDocument): string {
  return document.blocks
    .map((block) => (block.kind === 'scene-break' ? '***' : blockText(block)))
    .join('\n');
}

export function cloneDocument(document: StructuredDocument): StructuredDocument {
  return JSON.parse(JSON.stringify(document)) as StructuredDocument;
}

export function validateDocument(document: StructuredDocument): void {
  if (document.formatVersion !== DOCUMENT_FORMAT_VERSION) {
    throw new Error(`Unsupported document format ${String(document.formatVersion)}`);
  }
  if (!Array.isArray(document.blocks)) throw new Error('Document blocks must be an array');
  for (const block of document.blocks) {
    if (!block.id || !Array.isArray(block.runs)) throw new Error('Invalid document block');
    if (!['paragraph', 'heading', 'scene-break'].includes(block.kind)) {
      throw new Error(`Unsupported block kind ${block.kind}`);
    }
    for (const run of block.runs) {
      if (typeof run.text !== 'string' || !Array.isArray(run.marks)) {
        throw new Error('Invalid text run');
      }
      if (run.marks.some((mark) => !['bold', 'italic', 'underline'].includes(mark))) {
        throw new Error('Unsupported semantic mark');
      }
    }
  }
}

/** Replace visible block text while retaining the block's semantic kind. */
export function replaceBlockText(block: DocumentBlock, text: string): DocumentBlock {
  const marks = block.runs[0]?.marks ?? [];
  return { ...block, runs: [textRun(text, marks)] };
}

export function toggleMarks(block: DocumentBlock, marks: SemanticMark[]): DocumentBlock {
  const enabled = new Set(marks);
  return {
    ...block,
    runs: block.runs.map((run) => {
      const next = new Set(run.marks);
      for (const mark of enabled) {
        if (next.has(mark)) next.delete(mark);
        else next.add(mark);
      }
      return { ...run, marks: [...next] };
    })
  };
}
