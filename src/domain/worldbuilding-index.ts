import type { MarkdownNote } from './types';

/**
 * The index intentionally recognizes one small, explicit Markdown convention.
 * A note may start with YAML-like frontmatter and a single `type` field:
 *
 * ---
 * type: character
 * ---
 *
 * Markdown remains the source of truth; these records are rebuilt whenever the
 * current note list changes and are never repository entities.
 */
export type WorldbuildingIndexStatus = 'classified' | 'unclassified' | 'conflict';

export interface WorldbuildingIndexEntry {
  sourceNoteId: string;
  title: string;
  type?: string;
  status: WorldbuildingIndexStatus;
  conflictingTypes?: string[];
}

function scalarValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted || undefined;
  }
  return trimmed;
}

function normalizedType(value: string): string {
  return value.toLowerCase();
}

function normalizedForComparison(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function compareDeterministically(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Parse only a leading frontmatter `type` field; prose and tags are ignored. */
export function parseWorldbuildingType(markdown: string): { type?: string; conflictingTypes?: string[] } {
  const normalizedMarkdown = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalizedMarkdown.split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close < 0) return {};

  const values: string[] = [];
  for (const line of lines.slice(1, close)) {
    const match = line.match(/^\s*type\s*:\s*(.*?)\s*$/i);
    if (!match) continue;
    const value = scalarValue(match[1]);
    if (value) values.push(normalizedType(value));
  }
  const unique = [...new Set(values)];
  if (unique.length > 1) return { conflictingTypes: unique };
  return unique.length === 1 ? { type: unique[0] } : {};
}

export function buildWorldbuildingIndex(notes: readonly Pick<MarkdownNote, 'id' | 'title' | 'markdown'>[]): WorldbuildingIndexEntry[] {
  return notes.map((note): WorldbuildingIndexEntry => {
    const parsed = parseWorldbuildingType(note.markdown);
    if (parsed.conflictingTypes) return { sourceNoteId: note.id, title: note.title, status: 'conflict', conflictingTypes: parsed.conflictingTypes };
    if (!parsed.type) return { sourceNoteId: note.id, title: note.title, status: 'unclassified' };
    return { sourceNoteId: note.id, title: note.title, type: parsed.type, status: 'classified' };
  }).sort((left, right) => {
    const titleOrder = compareDeterministically(normalizedForComparison(left.title), normalizedForComparison(right.title));
    return titleOrder || compareDeterministically(left.sourceNoteId, right.sourceNoteId);
  });
}
