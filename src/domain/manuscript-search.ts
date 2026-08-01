import { documentToText } from './document';
import type { ProjectSnapshot, StructuredDocument } from './types';

/** A stable destination for a local search result. No remote index or persisted cache is required. */
export type SearchTarget =
  | { kind: 'story'; storyId: string }
  | { kind: 'chapter'; storyId: string; chapterId: string }
  | { kind: 'scene'; storyId: string; chapterId: string; sceneId: string; documentId: string }
  | { kind: 'continuous-draft'; storyId: string; chapterId: string; draftId: string; documentId: string }
  | { kind: 'note'; noteId: string };

export type SearchResultKind = 'story' | 'chapter' | 'scene' | 'continuous-draft' | 'note';

export interface ManuscriptSearchResult {
  id: string;
  kind: SearchResultKind;
  title: string;
  snippet: string;
  target: SearchTarget;
}

export interface ManuscriptSearchCorpus {
  snapshot: ProjectSnapshot;
  /** Current heads are fetched on demand; revisions remain canonical in the repository. */
  documents: ReadonlyMap<string, StructuredDocument>;
}

function searchable(value: string): string {
  // NFKC makes equivalent Unicode forms searchable while retaining authored text in snippets.
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

/** Compare UTF-16 code units directly so ordering never depends on the host locale. */
function compareDeterministic(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function matches(value: string, needle: string): boolean {
  return searchable(value).includes(needle);
}

interface NormalizedSource {
  value: string;
  /** Normalized lengths at source code-point boundaries, used to avoid slicing inside Unicode characters. */
  normalizedBoundaries: number[];
  sourceOffsets: number[];
}

function normalizedSource(source: string): NormalizedSource {
  const normalizedBoundaries = [0];
  const sourceOffsets = [0];
  let sourceOffset = 0;
  for (const character of source) {
    sourceOffset += character.length;
    sourceOffsets.push(sourceOffset);
    normalizedBoundaries.push(searchable(source.slice(0, sourceOffset)).length);
  }
  return { value: searchable(source), normalizedBoundaries, sourceOffsets };
}

function sourceOffsets(normalizedBoundaries: number[], sourceBoundaries: number[], normalizedStart: number, normalizedEnd: number): { start: number; end: number } {
  // Use the last source boundary at or before a match start. This keeps a match
  // inside an NFKC expansion (for example, one character of a ligature) whole.
  let startBoundary = 0;
  for (let index = 0; index < normalizedBoundaries.length && normalizedBoundaries[index] <= normalizedStart; index += 1) {
    startBoundary = index;
  }

  // Include all source characters contributing to a normalized match. Equal
  // lengths occur when a combining mark composes with the preceding character.
  let endBoundary = normalizedBoundaries.length - 1;
  for (let index = 0; index < normalizedBoundaries.length; index += 1) {
    if (normalizedBoundaries[index] >= normalizedEnd) {
      endBoundary = index;
      while (endBoundary + 1 < normalizedBoundaries.length && normalizedBoundaries[endBoundary + 1] === normalizedBoundaries[endBoundary]) endBoundary += 1;
      break;
    }
  }
  return { start: sourceBoundaries[startBoundary], end: sourceBoundaries[endBoundary] };
}

function snippet(title: string, content: string, needle: string): string {
  const source = content || title;
  if (!needle) return source.slice(0, 160) || 'No text';
  const normalized = normalizedSource(source);
  const index = normalized.value.indexOf(needle);
  if (index < 0) return title.slice(0, 160) || 'No text';
  const offsets = sourceOffsets(normalized.normalizedBoundaries, normalized.sourceOffsets, index, index + needle.length);
  let start = Math.max(0, offsets.start - 64);
  let end = Math.min(source.length, offsets.end + 96);
  // Keep the context window on code-point boundaries too; a UTF-16 slice must
  // never expose half of a surrogate pair.
  if (start > 0 && source.charCodeAt(start) >= 0xdc00 && source.charCodeAt(start) <= 0xdfff) start -= 1;
  if (end < source.length && source.charCodeAt(end - 1) >= 0xd800 && source.charCodeAt(end - 1) <= 0xdbff) end += 1;
  const value = source.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${value}${end < source.length ? '…' : ''}` || title;
}

function addResult(results: ManuscriptSearchResult[], result: ManuscriptSearchResult, query: string, searchableText: string): void {
  if (matches(searchableText, query)) results.push(result);
}

/**
 * Derive a deterministic full-text result set from the current local snapshot.
 * Keeping this function pure avoids a second index that could drift from Markdown,
 * structured documents, revisions, or autosave state.
 */
export function searchManuscript(corpus: ManuscriptSearchCorpus, query: string): ManuscriptSearchResult[] {
  const needle = searchable(query.trim());
  if (!needle) return [];
  const { snapshot, documents } = corpus;
  const stories = new Map(snapshot.stories.map((story) => [story.id, story]));
  const chapters = new Map(snapshot.chapters.map((chapter) => [chapter.id, chapter]));
  const sceneSets = new Map(snapshot.sceneSets.map((sceneSet) => [sceneSet.id, sceneSet]));
  const activeSceneSetIds = new Set(snapshot.chapters.flatMap((chapter) => {
    const sceneSet = sceneSets.get(chapter.activeSceneSetId);
    return sceneSet?.active && sceneSet.chapterId === chapter.id ? [sceneSet.id] : [];
  }));
  const scenes = snapshot.scenes
    .filter((scene) => activeSceneSetIds.has(scene.sceneSetId))
    .slice()
    .sort((a, b) => a.position - b.position || compareDeterministic(a.id, b.id));
  const drafts = snapshot.continuousDrafts.slice().sort((a, b) => compareDeterministic(a.createdAt, b.createdAt) || compareDeterministic(a.id, b.id));
  const notes = snapshot.markdownNotes.slice().sort((a, b) => compareDeterministic(a.title, b.title) || compareDeterministic(a.id, b.id));
  const results: ManuscriptSearchResult[] = [];

  for (const story of snapshot.stories.slice().sort((a, b) => a.position - b.position || compareDeterministic(a.id, b.id))) {
    addResult(results, { id: `story:${story.id}`, kind: 'story', title: story.title, snippet: snippet(story.title, '', needle), target: { kind: 'story', storyId: story.id } }, needle, story.title);
  }
  for (const chapter of snapshot.chapters.slice().sort((a, b) => a.position - b.position || compareDeterministic(a.id, b.id))) {
    addResult(results, { id: `chapter:${chapter.id}`, kind: 'chapter', title: chapter.title, snippet: snippet(chapter.title, '', needle), target: { kind: 'chapter', storyId: chapter.storyId, chapterId: chapter.id } }, needle, chapter.title);
  }
  for (const scene of scenes) {
    const sceneSet = sceneSets.get(scene.sceneSetId);
    const chapter = sceneSet ? chapters.get(sceneSet.chapterId) : undefined;
    const story = chapter ? stories.get(chapter.storyId) : undefined;
    const text = documents.get(scene.documentId) ? documentToText(documents.get(scene.documentId)!) : '';
    const titleAndText = `${scene.title}\n${text}`;
    if (!matches(titleAndText, needle)) continue;
    results.push({ id: `scene:${scene.id}`, kind: 'scene', title: scene.title, snippet: snippet(scene.title, text, needle), target: { kind: 'scene', storyId: story?.id ?? '', chapterId: chapter?.id ?? '', sceneId: scene.id, documentId: scene.documentId } });
  }
  for (const draft of drafts) {
    const chapter = chapters.get(draft.chapterId);
    const story = chapter ? stories.get(chapter.storyId) : undefined;
    const text = documents.get(draft.documentId) ? documentToText(documents.get(draft.documentId)!) : '';
    const title = `${chapter?.title ?? 'Chapter'} · Continuous draft`;
    const titleAndText = `${title}\n${text}`;
    if (!matches(titleAndText, needle)) continue;
    results.push({ id: `continuous-draft:${draft.id}`, kind: 'continuous-draft', title, snippet: snippet(title, text, needle), target: { kind: 'continuous-draft', storyId: story?.id ?? '', chapterId: draft.chapterId, draftId: draft.id, documentId: draft.documentId } });
  }
  for (const note of notes) {
    const content = `${note.title}\n${note.markdown}`;
    if (!matches(content, needle)) continue;
    results.push({ id: `note:${note.id}`, kind: 'note', title: note.title, snippet: snippet(note.title, note.markdown, needle), target: { kind: 'note', noteId: note.id } });
  }

  const kindOrder: Record<SearchResultKind, number> = { story: 0, chapter: 1, scene: 2, 'continuous-draft': 3, note: 4 };
  return results.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || compareDeterministic(a.title, b.title) || compareDeterministic(a.id, b.id));
}

export function searchResultKindLabel(kind: SearchResultKind): string {
  return kind === 'continuous-draft' ? 'Continuous draft' : kind[0].toUpperCase() + kind.slice(1);
}

export type SearchDocumentRecords = Iterable<readonly [string, StructuredDocument]>;

export function documentMap(records: SearchDocumentRecords): ReadonlyMap<string, StructuredDocument> {
  return new Map(records);
}

