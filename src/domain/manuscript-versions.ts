import { validateDocument } from './document';
import type {
  Chapter,
  ContinuousDraft,
  ManuscriptVersionChange,
  ManuscriptVersionChangeKind,
  ManuscriptVersionComparison,
  ManuscriptVersionDetail,
  ManuscriptVersionSnapshot,
  ManuscriptVersionSummary,
  ManuscriptVersionDocument,
  Revision,
  Scene,
  SceneSet,
  Story,
  StructuredDocument
} from './types';

const arrayOrEmpty = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

/** Read old snapshots without allowing missing optional collections to crash history. */
export function normalizeManuscriptVersionSnapshot(value: unknown): ManuscriptVersionSnapshot {
  const candidate = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
  return {
    stories: arrayOrEmpty<Story>(candidate.stories),
    chapters: arrayOrEmpty<Chapter>(candidate.chapters),
    sceneSets: arrayOrEmpty<SceneSet>(candidate.sceneSets),
    scenes: arrayOrEmpty<Scene>(candidate.scenes),
    continuousDrafts: arrayOrEmpty<ContinuousDraft>(candidate.continuousDrafts),
    documents: arrayOrEmpty<ManuscriptVersionDocument>(candidate.documents)
  };
}

export function normalizeManuscriptVersionDetail(value: unknown): ManuscriptVersionDetail {
  if (!value || typeof value !== 'object') throw new Error('Invalid manuscript version');
  const candidate = value as { summary?: ManuscriptVersionSummary; snapshot?: unknown };
  if (!candidate.summary || typeof candidate.summary !== 'object' || typeof candidate.summary.id !== 'string') throw new Error('Invalid manuscript version summary');
  return { summary: candidate.summary, snapshot: normalizeManuscriptVersionSnapshot(candidate.snapshot) };
}

function ids<T extends { id: string }>(values: readonly T[], kind: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (!value || typeof value.id !== 'string' || !value.id) throw new Error(`Invalid ${kind} record`);
    if (result.has(value.id)) throw new Error(`Duplicate ${kind} ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

/** Validate referential integrity before a snapshot can replace live manuscript data. */
export function validateManuscriptVersionSnapshot(snapshot: ManuscriptVersionSnapshot, projectId: string): void {
  const stories = ids(snapshot.stories, 'story');
  const chapters = ids(snapshot.chapters, 'chapter');
  const sets = ids(snapshot.sceneSets, 'scene set');
  const scenes = ids(snapshot.scenes, 'scene');
  const drafts = ids(snapshot.continuousDrafts, 'continuous draft');
  const documents = new Map<string, ManuscriptVersionDocument>();
  for (const entry of snapshot.documents) {
    if (!entry || typeof entry.documentId !== 'string' || !entry.documentId || documents.has(entry.documentId)) throw new Error(`Duplicate or invalid document ${entry?.documentId ?? ''}`);
    documents.set(entry.documentId, entry);
  }
  for (const story of snapshot.stories) {
    if (!story.projectId) throw new Error(`Story ${story.id} has no project`);
    if (story.projectId !== projectId) throw new Error(`Story ${story.id} belongs to a different project`);
  }
  for (const chapter of snapshot.chapters) {
    if (!stories.has(chapter.storyId)) throw new Error(`Chapter ${chapter.id} refers to missing story`);
    const activeSet = sets.get(chapter.activeSceneSetId);
    if (!activeSet || activeSet.chapterId !== chapter.id || !activeSet.active) throw new Error(`Chapter ${chapter.id} has no active scene set`);
  }
  for (const set of snapshot.sceneSets) if (!chapters.has(set.chapterId)) throw new Error(`Scene set ${set.id} refers to missing chapter`);
  for (const scene of snapshot.scenes) {
    if (!sets.has(scene.sceneSetId)) throw new Error(`Scene ${scene.id} refers to missing scene set`);
    if (!documents.has(scene.documentId)) throw new Error(`Scene ${scene.id} refers to missing document`);
  }
  for (const entry of snapshot.documents) {
    if (!entry.revision || entry.documentId !== entry.revision.documentId || entry.revision.number < 1) throw new Error(`Document ${entry.documentId} has an invalid revision`);
    validateDocument(entry.revision.document);
  }
  for (const draft of snapshot.continuousDrafts) {
    if (!chapters.has(draft.chapterId)) throw new Error(`Continuous draft ${draft.id} refers to missing chapter`);
    if (!sets.has(draft.baseSceneSetId)) throw new Error(`Continuous draft ${draft.id} refers to missing scene set`);
    if (!documents.has(draft.documentId)) throw new Error(`Continuous draft ${draft.id} refers to missing document`);
  }
}

function stable(value: unknown): string { return JSON.stringify(value); }

function labelFor(value: { title?: string; id: string }): string { return value.title ?? value.id; }

function recordChanges<T extends { id: string; title?: string }>(kind: ManuscriptVersionChangeKind, before: readonly T[], after: readonly T[]): ManuscriptVersionChange[] {
  const left = new Map(before.map((value) => [value.id, value]));
  const right = new Map(after.map((value) => [value.id, value]));
  const changes: ManuscriptVersionChange[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const previous = left.get(id);
    const next = right.get(id);
    if (!previous && next) changes.push({ kind, change: 'added', id, label: labelFor(next) });
    else if (previous && !next) changes.push({ kind, change: 'removed', id, label: labelFor(previous) });
    else if (stable(previous) !== stable(next)) changes.push({ kind, change: 'changed', id, beforeLabel: labelFor(previous!), afterLabel: labelFor(next!) });
  }
  return changes;
}

function documentChanges(before: readonly ManuscriptVersionDocument[], after: readonly ManuscriptVersionDocument[]): ManuscriptVersionChange[] {
  const left = new Map(before.map((value) => [value.documentId, value]));
  const right = new Map(after.map((value) => [value.documentId, value]));
  const changes: ManuscriptVersionChange[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const previous = left.get(id)?.revision;
    const next = right.get(id)?.revision;
    if (!previous && next) changes.push({ kind: 'document', change: 'added', id, afterDocument: next.document });
    else if (previous && !next) changes.push({ kind: 'document', change: 'removed', id, beforeDocument: previous.document });
    else if (previous && next && stable(previous.document) !== stable(next.document)) changes.push({ kind: 'document', change: 'changed', id, beforeDocument: previous.document, afterDocument: next.document });
  }
  return changes;
}

export function compareManuscriptVersionDetails(from: ManuscriptVersionDetail, to: ManuscriptVersionDetail): ManuscriptVersionComparison {
  const left = from.snapshot;
  const right = to.snapshot;
  const changes = [
    ...recordChanges('story', left.stories, right.stories),
    ...recordChanges('chapter', left.chapters, right.chapters),
    ...recordChanges('scene-set', left.sceneSets, right.sceneSets),
    ...recordChanges('scene', left.scenes, right.scenes),
    ...recordChanges('continuous-draft', left.continuousDrafts, right.continuousDrafts),
    ...documentChanges(left.documents, right.documents)
  ];
  return { from: from.summary, to: to.summary, changes };
}

export function revisionRecord(revision: Revision): { id: string; headRevision: number; revisions: Revision[] } {
  return { id: revision.documentId, headRevision: revision.number, revisions: [revision] };
}

export function cloneManuscriptVersionSnapshot(snapshot: ManuscriptVersionSnapshot): ManuscriptVersionSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ManuscriptVersionSnapshot;
}

export function documentText(document?: StructuredDocument): string {
  return document?.blocks.map((block) => block.runs.map((run) => run.text).join('')).join('\n') ?? '';
}
