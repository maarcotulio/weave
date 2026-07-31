import { blockText, cloneDocument } from './document';
import type { EditorStyleProfile, PageSize, StructuredDocument } from './types';

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

export function pageDimensions(pageSize: PageSize = 'letter'): PageDimensions {
  return PAGE_DIMENSIONS[pageSize] ?? PAGE_DIMENSIONS.letter;
}

/**
 * Produces a view-only page break model. Blocks are never edited or persisted
 * here: their original IDs and content are retained in each page slice.
 * Pages are allowed to grow for an unusually long paragraph rather than
 * clipping content in an inner scroll region.
 */
export function paginateDocument(document: StructuredDocument, style: EditorStyleProfile): StructuredDocument[] {
  const dimensions = pageDimensions(style.pageSize);
  const horizontalMargin = 144;
  const verticalMargin = 144;
  const chromeHeight = 74;
  const contentWidth = dimensions.widthPx - horizontalMargin;
  const lineHeight = Math.max(14, style.fontSizePt * ({ single: 1, '1.15': 1.15, '1.5': 1.5, double: 2 }[style.lineSpacing] ?? 2));
  const charactersPerLine = Math.max(24, Math.floor(contentWidth / (style.fontSizePt * 0.54)));
  const linesPerPage = Math.max(8, Math.floor((dimensions.heightPx - verticalMargin - chromeHeight) / lineHeight));
  const pages: StructuredDocument[] = [];
  let blocks = [] as StructuredDocument['blocks'];
  let usedLines = 0;

  const pushPage = () => {
    if (!blocks.length && pages.length) return;
    pages.push({ formatVersion: document.formatVersion, blocks: blocks.map((block) => ({ ...block, runs: block.runs.map((run) => ({ ...run, marks: [...run.marks] })) })) });
    blocks = [];
    usedLines = 0;
  };

  for (const block of document.blocks) {
    const text = blockText(block);
    const lineCount = text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
    const blockLines = block.kind === 'heading' ? lineCount + 1 : block.kind === 'scene-break' ? 2 : lineCount;
    if (blocks.length && usedLines + blockLines > linesPerPage) pushPage();
    blocks.push(block);
    usedLines += blockLines;
  }
  if (blocks.length || !pages.length) pushPage();
  return pages.map((page) => cloneDocument(page));
}
