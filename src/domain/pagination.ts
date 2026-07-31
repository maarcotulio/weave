import { blockText, cloneDocument } from './document';
import type { DocumentBlock, EditorStyleProfile, PageSize, StructuredDocument, TextRun } from './types';

export interface PageDimensions {
  widthPx: number;
  heightPx: number;
  widthPt: number;
  heightPt: number;
  label: string;
}

const PAGE_DIMENSIONS: Record<PageSize, PageDimensions> = {
  letter: { widthPx: 816, heightPx: 1056, widthPt: 612, heightPt: 792, label: 'US Letter' },
  a4: { widthPx: 794, heightPx: 1123, widthPt: 595, heightPt: 842, label: 'A4' },
  legal: { widthPx: 816, heightPx: 1344, widthPt: 612, heightPt: 1008, label: 'US Legal' }
};

export interface PageFragmentMetadata {
  sourceBlockId: string;
  start: number;
  end: number;
  sequence: number;
  total: number;
}

/** A view-only block. `pagination` must never be persisted in a revision. */
export type PaginatedBlock = DocumentBlock & { pagination?: PageFragmentMetadata };

export interface PaginatedPage {
  document: StructuredDocument;
}

export function pageDimensions(pageSize: PageSize = 'letter'): PageDimensions {
  return PAGE_DIMENSIONS[pageSize] ?? PAGE_DIMENSIONS.letter;
}

function lineHeightFor(style: EditorStyleProfile): number {
  return Math.max(14, style.fontSizePt * ({ single: 1, '1.15': 1.15, '1.5': 1.5, double: 2 }[style.lineSpacing] ?? 2));
}

function lineCount(text: string, charactersPerLine: number): number {
  return text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}

/** Split at a visual line boundary while preserving every source character. */
function splitTextIntoChunks(text: string, charactersPerLine: number): string[] {
  if (!text.length) return [''];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > charactersPerLine) {
    const newline = remaining.indexOf('\n', 0);
    let end = newline >= 0 && newline < charactersPerLine ? newline + 1 : 0;
    if (!end) {
      const whitespace = Math.max(remaining.lastIndexOf(' ', charactersPerLine), remaining.lastIndexOf('\t', charactersPerLine));
      end = whitespace > 0 ? whitespace + 1 : charactersPerLine;
    }
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  chunks.push(remaining);
  return chunks;
}

function sliceRuns(runs: readonly TextRun[], start: number, end: number): TextRun[] {
  const result: TextRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    const from = Math.max(start, runStart);
    const to = Math.min(end, runEnd);
    if (from < to) result.push({ text: run.text.slice(from - runStart, to - runStart), marks: [...run.marks] });
    offset = runEnd;
  }
  return result.length ? result : [{ text: '', marks: [] }];
}

function fragmentBlock(block: DocumentBlock, text: string, start: number, end: number, sequence: number, total: number): PaginatedBlock {
  return {
    ...block,
    id: total === 1 ? block.id : `${block.id}:page-${sequence + 1}`,
    runs: sliceRuns(block.runs, start, end),
    pagination: { sourceBlockId: block.id, start, end, sequence, total }
  };
}

/**
 * Build view pages and split oversized paragraphs by lines. The canonical
 * block remains whole; page fragments carry source offsets so edits can be
 * merged back before autosave.
 */
export function paginateDocumentWithSources(document: StructuredDocument, style: EditorStyleProfile): PaginatedPage[] {
  const dimensions = pageDimensions(style.pageSize);
  const horizontalMargin = 144;
  const verticalMargin = 144;
  const chromeHeight = 74;
  const contentWidth = dimensions.widthPx - horizontalMargin;
  const charactersPerLine = Math.max(24, Math.floor(contentWidth / (style.fontSizePt * 0.54)));
  const linesPerPage = Math.max(8, Math.floor((dimensions.heightPx - verticalMargin - chromeHeight) / lineHeightFor(style)));
  const pages: PaginatedPage[] = [];
  let blocks: PaginatedBlock[] = [];
  let usedLines = 0;

  const pushPage = () => {
    if (!blocks.length && pages.length) return;
    pages.push({ document: { formatVersion: document.formatVersion, blocks: blocks.map((block) => ({ ...block, runs: block.runs.map((run) => ({ ...run, marks: [...run.marks] })), pagination: block.pagination ? { ...block.pagination } : undefined })) } });
    blocks = [];
    usedLines = 0;
  };

  for (const block of document.blocks) {
    const text = blockText(block);
    const chunks = block.kind === 'scene-break' ? [''] : splitTextIntoChunks(text, charactersPerLine);
    let offset = 0;
    chunks.forEach((chunk, sequence) => {
      const start = offset;
      const end = offset + chunk.length;
      offset = end;
      const blockLines = block.kind === 'scene-break' ? 2 : lineCount(chunk, charactersPerLine) + (block.kind === 'heading' && sequence === 0 ? 1 : 0);
      if (blocks.length && usedLines + blockLines > linesPerPage) pushPage();
      blocks.push(fragmentBlock(block, chunk, start, end, sequence, chunks.length));
      usedLines += blockLines;
    });
  }
  if (blocks.length || !pages.length) pushPage();
  return pages.map((page) => ({ document: cloneDocument(page.document) }));
}

/** Backwards-compatible view-only page documents. */
export function paginateDocument(document: StructuredDocument, style: EditorStyleProfile): StructuredDocument[] {
  return paginateDocumentWithSources(document, style).map((page) => page.document);
}

function cleanFragment(block: PaginatedBlock): DocumentBlock {
  const { pagination: _pagination, ...documentBlock } = block;
  return documentBlock;
}

/** Merge an edited page fragment back into the canonical block sequence. */
export function mergePaginatedDocument(original: StructuredDocument, pages: readonly PaginatedPage[], editedPageIndex: number, editedPage: StructuredDocument): StructuredDocument {
  const fragments = new Map<string, Array<{ block: PaginatedBlock; metadata: PageFragmentMetadata }>>();
  pages.forEach((page, pageIndex) => {
    const source = pageIndex === editedPageIndex ? editedPage : page.document;
    source.blocks.forEach((candidate) => {
      const block = candidate as PaginatedBlock;
      const metadata = block.pagination;
      if (!metadata) return;
      const list = fragments.get(metadata.sourceBlockId) ?? [];
      list.push({ block, metadata });
      fragments.set(metadata.sourceBlockId, list);
    });
  });

  const blocks = original.blocks.map((originalBlock) => {
    const sourceFragments = (fragments.get(originalBlock.id) ?? []).sort((left, right) => left.metadata.sequence - right.metadata.sequence);
    if (!sourceFragments.length) return originalBlock;
    if (sourceFragments.length === 1 && sourceFragments[0].metadata.start === 0 && sourceFragments[0].metadata.end === blockText(originalBlock).length) {
      return cleanFragment(sourceFragments[0].block);
    }
    const first = cleanFragment(sourceFragments[0].block);
    return {
      ...first,
      id: originalBlock.id,
      runs: sourceFragments.flatMap(({ block }) => cleanFragment(block).runs)
    };
  });
  return { ...original, blocks };
}
