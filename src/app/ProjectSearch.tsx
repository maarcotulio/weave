import { useEffect, useMemo, useState } from 'react';
import { documentMap, searchManuscript, searchResultKindLabel, type ManuscriptSearchResult, type SearchTarget } from '../domain/manuscript-search';
import type { ProjectRepository } from '../domain/repository';
import type { ProjectSnapshot, StructuredDocument } from '../domain/types';

export function ProjectSearch({ repository, snapshot, onNavigate }: { repository: ProjectRepository; snapshot: ProjectSnapshot; onNavigate: (target: SearchTarget) => void }) {
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<ReadonlyMap<string, StructuredDocument>>(new Map());
  const [loading, setLoading] = useState(false);
  const trimmedQuery = query.trim();

  useEffect(() => {
    let cancelled = false;
    if (!trimmedQuery) {
      setDocuments(new Map());
      setLoading(false);
      return () => { cancelled = true; };
    }
    const sceneSets = new Map(snapshot.sceneSets.map((sceneSet) => [sceneSet.id, sceneSet]));
    const activeSceneSetIds = new Set(snapshot.chapters.flatMap((chapter) => {
      const sceneSet = sceneSets.get(chapter.activeSceneSetId);
      return sceneSet?.active && sceneSet.chapterId === chapter.id ? [sceneSet.id] : [];
    }));
    const ids = [...new Set([
      ...snapshot.scenes.filter((scene) => activeSceneSetIds.has(scene.sceneSetId)).map((scene) => scene.documentId),
      ...snapshot.continuousDrafts.map((draft) => draft.documentId)
    ])];
    setLoading(true);
    void Promise.all(ids.map(async (id) => {
      try {
        return [id, (await repository.getDocument(id)).document] as const;
      } catch {
        return undefined;
      }
    }))
      .then((records) => {
        if (!cancelled) setDocuments(documentMap(records.filter((record): record is readonly [string, StructuredDocument] => record !== undefined)));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repository, snapshot.chapters, snapshot.continuousDrafts, snapshot.sceneSets, snapshot.scenes, trimmedQuery]);

  const results = useMemo(() => searchManuscript({ snapshot, documents }, trimmedQuery), [documents, snapshot, trimmedQuery]);
  const groups = useMemo(() => [...new Set(results.map((result) => result.kind))], [results]);
  const status = !trimmedQuery ? 'Type a word or phrase to search the local project.' : loading ? 'Searching local project…' : results.length ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'No results found.';

  return <section className="project-search" aria-label="Search project">
    <label className="project-search-label" htmlFor="project-search-input">Search project</label>
    <input id="project-search-input" type="search" value={query} placeholder="Search manuscript, drafts, and notes" onChange={(event) => setQuery(event.target.value)} />
    <p className="project-search-status" role="status" aria-live="polite">{status}</p>
    {trimmedQuery && !loading && results.length > 0 && <div className="project-search-results" role="listbox" aria-label="Project search results">
      {groups.map((kind) => <section className="project-search-group" key={kind}><h2>{searchResultKindLabel(kind)}</h2><ul>{results.filter((result) => result.kind === kind).map((result) => <SearchResultButton key={result.id} result={result} onNavigate={onNavigate} />)}</ul></section>)}
    </div>}
  </section>;
}

function SearchResultButton({ result, onNavigate }: { result: ManuscriptSearchResult; onNavigate: (target: SearchTarget) => void }) {
  return <li><button type="button" className="project-search-result" role="option" onClick={() => onNavigate(result.target)}><strong>{result.title}</strong><span>{result.snippet}</span></button></li>;
}
