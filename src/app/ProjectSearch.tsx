import { useEffect, useMemo, useRef, useState } from 'react';
import { documentMap, searchManuscript, searchResultKindLabel, type ManuscriptSearchResult, type SearchTarget } from '../domain/manuscript-search';
import { canDismissWithEscape, trappedFocusIndex } from '../domain/modal-focus';
import type { ProjectRepository } from '../domain/repository';
import type { ProjectSnapshot, StructuredDocument } from '../domain/types';

export function ProjectSearch({ repository, snapshot, open, trigger, onClose, onNavigate }: { repository: ProjectRepository; snapshot: ProjectSnapshot; open: boolean; trigger?: HTMLElement | null; onClose: () => void; onNavigate: (target: SearchTarget) => void }) {
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<ReadonlyMap<string, StructuredDocument>>(new Map());
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const trimmedQuery = query.trim();
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = trigger;
    const closeOnKey = (event: KeyboardEvent) => {
      if (canDismissWithEscape(event.key, false)) { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]')).filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0);
      if (!focusable.length) { event.preventDefault(); return; }
      const nextIndex = trappedFocusIndex({ currentIndex: focusable.indexOf(document.activeElement as HTMLElement), controlCount: focusable.length, shiftKey: event.shiftKey });
      if (nextIndex === undefined) return;
      event.preventDefault(); focusable[nextIndex]?.focus();
    };
    document.addEventListener('keydown', closeOnKey);
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      document.removeEventListener('keydown', closeOnKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, trigger]);

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
  if (!open) return null;

  const navigate = (target: SearchTarget) => {
    onClose();
    onNavigate(target);
  };
  return <div className="modal-backdrop search-modal-backdrop"><div id="project-search-dialog" ref={dialogRef} className="modal project-search-modal" role="dialog" aria-modal="true" aria-labelledby="project-search-title" aria-describedby="project-search-description" tabIndex={-1}>
    <div className="modal-heading"><p className="eyebrow">LOCAL PROJECT</p><h2 id="project-search-title">Search project</h2><button type="button" className="modal-close" aria-label="Close search dialog" onClick={onClose}>×</button></div>
    <div className="modal-content"><p id="project-search-description">Search manuscript, drafts, and Markdown notes stored in this local project.</p><label className="project-search-label" htmlFor="project-search-input">Search project</label><input id="project-search-input" type="search" value={query} placeholder="Search manuscript, drafts, and notes" onChange={(event) => setQuery(event.target.value)} /><p className="project-search-status" role="status" aria-live="polite">{status}</p>{trimmedQuery && !loading && results.length > 0 && <div className="project-search-results" role="listbox" aria-label="Project search results">{groups.map((kind) => <section className="project-search-group" key={kind}><h3>{searchResultKindLabel(kind)}</h3><ul>{results.filter((result) => result.kind === kind).map((result) => <SearchResultButton key={result.id} result={result} onNavigate={navigate} />)}</ul></section>)}</div>}</div>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Close</button></div>
  </div></div>;
}

function SearchResultButton({ result, onNavigate }: { result: ManuscriptSearchResult; onNavigate: (target: SearchTarget) => void }) {
  return <li><button type="button" className="project-search-result" role="option" onClick={() => onNavigate(result.target)}><strong>{result.title}</strong><span>{result.snippet}</span></button></li>;
}
