import { DOCUMENT_FORMAT_VERSION, type StructuredDocument } from './types';
import { newId, paragraph, textRun } from './document';

/** Convert a Markdown file into deterministic structured manuscript blocks. */
export function markdownToDocument(markdown: string): StructuredDocument {
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const blocks = lines.map((line) => {
    const heading = line.match(/^(#{1,3})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/);
    if (!heading) return paragraph(line);
    return {
      id: newId('block'),
      kind: 'heading' as const,
      headingLevel: heading[1].length as 1 | 2 | 3,
      runs: [textRun(heading[2].trim())]
    };
  });
  return { formatVersion: DOCUMENT_FORMAT_VERSION, blocks: blocks.length ? blocks : [paragraph('')] };
}

/** Use the source filename as a stable, human-readable imported record title. */
export function markdownTitleFromFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  const title = basename.replace(/\.md$/i, '').trim();
  return title || 'Untitled import';
}

/** Remove created records in reverse order, attempting every compensation. */
export async function rollbackInReverse<T>(created: readonly T[], remove: (value: T) => Promise<void>): Promise<void> {
  const failures: string[] = [];
  for (let index = created.length - 1; index >= 0; index -= 1) {
    try {
      await remove(created[index]);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length) throw new Error(`Markdown import rollback failed: ${failures.join('; ')}`);
}
