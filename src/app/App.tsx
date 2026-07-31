import { useCallback, useEffect, useMemo, useState } from 'react';
import { InMemoryProjectRepository, type DocumentHead, type ProjectRepository } from '../domain/repository';
import { blockText, documentFromText, replaceBlockText, toggleMarks } from '../domain/document';
import { exportCapturedRevision } from '../export/editorial';
import { TauriProjectRepository } from '../infrastructure/tauri-repository';
import type { Chapter, ContinuousDraft, ExportFormat, OperationStatus, ProjectSnapshot, Scene, SemanticMark, StructuredDocument } from '../domain/types';

const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const formats: ExportFormat[] = ['pdf', 'docx', 'markdown', 'text'];

function initialDocument(): StructuredDocument { return documentFromText(''); }

function StatusBar({ status }: { status: OperationStatus }) {
  return <div className={`status status-${status.state}`} role="status"><span className="status-dot" />{status.message}</div>;
}

function Editor({ document, onChange, readOnly = false }: { document: StructuredDocument; onChange: (value: StructuredDocument) => void; readOnly?: boolean }) {
  const updateBlock = (index: number, value: StructuredDocument['blocks'][number]) => {
    const blocks = document.blocks.map((block, blockIndex) => blockIndex === index ? value : block);
    onChange({ ...document, blocks });
  };
  return <div className="editor" aria-label={readOnly ? 'Composed chapter' : 'Manuscript editor'}>
    {document.blocks.map((block, index) => block.kind === 'scene-break' ?
      <div className="scene-break" key={block.id}><span>scene break · composed view</span></div> :
      <div className="block" key={block.id}>
        <div className="block-tools">
          <select aria-label="Block style" value={block.kind === 'heading' ? `heading-${block.headingLevel ?? 1}` : 'paragraph'} disabled={readOnly} onChange={(event) => {
            const value = event.target.value;
            updateBlock(index, { ...block, kind: value === 'paragraph' ? 'paragraph' : 'heading', headingLevel: value === 'paragraph' ? undefined : Number(value.split('-')[1]) as 1 | 2 | 3 });
          }}>
            <option value="paragraph">Paragraph</option><option value="heading-1">Heading 1</option><option value="heading-2">Heading 2</option><option value="heading-3">Heading 3</option>
          </select>
          {(['bold', 'italic', 'underline'] as SemanticMark[]).map((mark) => <button type="button" key={mark} className="format-button" disabled={readOnly} onClick={() => updateBlock(index, toggleMarks(block, [mark]))} aria-label={`Toggle ${mark}`}><strong className={mark === 'italic' ? 'italic' : mark === 'underline' ? 'underline' : ''}>{mark[0].toUpperCase()}</strong></button>)}
        </div>
        <textarea className={block.kind === 'heading' ? 'manuscript-input heading-input' : 'manuscript-input'} value={blockText(block)} readOnly={readOnly} rows={Math.max(1, Math.min(8, blockText(block).split('\n').length))} onChange={(event) => updateBlock(index, replaceBlockText(block, event.target.value))} />
        <div className="format-hint">{block.runs.some((run) => run.marks.length > 0) ? block.runs.flatMap((run) => run.marks).join(' · ') : 'semantic paragraph'}</div>
      </div>)}
    {document.blocks.length === 0 && <p className="empty-editor">Start writing…</p>}
  </div>;
}

function ChoiceDialog({ onSplit, onKeep, onCancel, busy }: { onSplit: () => void; onKeep: () => void; onCancel: () => void; busy: boolean }) {
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="return-title">
    <p className="eyebrow">RETURN TO SCENES</p><h2 id="return-title">What should happen to this continuous draft?</h2>
    <p>Weave never guesses scene boundaries. Choose an explicit-marker split or keep this revision separate and recoverable.</p>
    <div className="choice-grid"><button type="button" onClick={onSplit} disabled={busy}><strong>Split automatically</strong><span>Use only paragraphs containing <code>***</code> or <code>Nova cena</code>. The old scene set stays preserved.</span></button><button type="button" onClick={onKeep} disabled={busy}><strong>Keep separate</strong><span>Leave the continuous draft and every scene document intact.</span></button></div>
    <button type="button" className="text-button" onClick={onCancel}>Cancel</button>
  </div></div>;
}

export default function App() {
  const repository = useMemo<ProjectRepository>(() => isDesktop ? new TauriProjectRepository() : new InMemoryProjectRepository(), []);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>();
  const [selectedStoryId, setSelectedStoryId] = useState<string>();
  const [selectedChapterId, setSelectedChapterId] = useState<string>();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>();
  const [documentHead, setDocumentHead] = useState<DocumentHead>();
  const [draft, setDraft] = useState<ContinuousDraft>();
  const [mode, setMode] = useState<'scene' | 'continuous' | 'compose'>('scene');
  const [editorDocument, setEditorDocument] = useState<StructuredDocument>(initialDocument());
  const [showReturnChoices, setShowReturnChoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const refresh = useCallback(async (keepSelection = true) => {
    const next = await repository.snapshot();
    setSnapshot(next);
    const storyId = keepSelection ? (selectedStoryId && next.stories.some((item) => item.id === selectedStoryId) ? selectedStoryId : next.stories[0]?.id) : next.stories[0]?.id;
    const chapterList = next.chapters.filter((item) => item.storyId === storyId);
    const chapterId = keepSelection ? (selectedChapterId && chapterList.some((item) => item.id === selectedChapterId) ? selectedChapterId : chapterList[0]?.id) : chapterList[0]?.id;
    setSelectedStoryId(storyId); setSelectedChapterId(chapterId);
    if (chapterId) {
      const nextScenes = await repository.listScenes(chapterId);
      setScenes(nextScenes);
      if (!selectedSceneId || !nextScenes.some((item) => item.id === selectedSceneId)) setSelectedSceneId(nextScenes[0]?.id);
    }
  }, [repository, selectedChapterId, selectedSceneId, selectedStoryId]);

  useEffect(() => { if (snapshot) void refresh(); }, []); // desktop starts at the project chooser

  useEffect(() => {
    if (!selectedChapterId) return;
    void repository.listScenes(selectedChapterId).then((nextScenes) => {
      setScenes(nextScenes);
      if (!selectedSceneId || !nextScenes.some((scene) => scene.id === selectedSceneId)) setSelectedSceneId(nextScenes[0]?.id);
    }).catch(() => undefined);
  }, [repository, selectedChapterId]);

  useEffect(() => {
    if (!selectedSceneId || mode !== 'scene') return;
    void repository.getDocument(scenes.find((scene) => scene.id === selectedSceneId)?.documentId ?? '').then((head) => { setDocumentHead(head); setEditorDocument(head.document); }).catch(() => undefined);
  }, [mode, repository, scenes, selectedSceneId]);

  const run = async (operation: () => Promise<void>) => { setBusy(true); setLocalError(''); try { await operation(); } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };

  const createProject = () => void run(async () => {
    const directory = window.prompt('Project directory', `${isDesktop ? '' : '/tmp/' }my-weave-project`); if (!directory) return;
    const name = window.prompt('Project name', 'My story') || 'My story';
    await repository.createProject(directory, name); const story = await repository.createStory('Story 1'); const chapter = await repository.createChapter(story.id, 'Chapter 1'); await repository.createScene(chapter.id, 'Scene 1'); await repository.createScene(chapter.id, 'Scene 2'); await refresh(false);
  });
  const openProject = () => void run(async () => { const directory = window.prompt('Open .weave project directory'); if (!directory) return; await repository.openProject(directory); await refresh(false); });
  const addScene = () => void run(async () => { if (!selectedChapterId) return; const scene = await repository.createScene(selectedChapterId, `Scene ${scenes.length + 1}`); await refresh(); setSelectedSceneId(scene.id); });
  const addChapter = () => void run(async () => { if (!selectedStoryId) return; const chapterNumber = (snapshot?.chapters.filter((item) => item.storyId === selectedStoryId).length ?? 0) + 1; await repository.createChapter(selectedStoryId, `Chapter ${chapterNumber}`); await refresh(false); });
  const renameScene = (scene: Scene) => void run(async () => { const title = window.prompt('Scene title', scene.title); if (title?.trim()) { await repository.renameScene(scene.id, title.trim()); await refresh(); } });
  const moveScene = (scene: Scene, delta: number) => void run(async () => { await repository.reorderScene(scene.id, scene.position + delta); await refresh(); });

  const selectScene = (scene: Scene) => { setMode('scene'); setDraft(undefined); setSelectedSceneId(scene.id); };
  const openContinuous = () => void run(async () => { if (!selectedChapterId) return; const value = await repository.enterContinuousDraft(selectedChapterId); const head = await repository.getDocument(value.documentId); setDraft(value); setDocumentHead(head); setEditorDocument(head.document); setMode('continuous'); await refresh(); });
  const returnToScenes = () => setShowReturnChoices(true);
  const split = () => void run(async () => { if (!draft) return; const result = await repository.automaticallySplitContinuous(draft.id); setShowReturnChoices(false); setDraft(undefined); setMode('scene'); await refresh(false); setSelectedSceneId(result.scenes[0]?.id); });
  const keepSeparate = () => void run(async () => { if (!draft) return; await repository.keepContinuousSeparate(draft.id); setShowReturnChoices(false); setDraft(undefined); setMode('scene'); await refresh(false); });
  const save = () => void run(async () => { if (!documentHead) return; const result = await repository.saveDocument(documentHead.documentId, editorDocument, documentHead.revision); setDocumentHead({ documentId: documentHead.documentId, document: result.revision.document, revision: result.revision.number, revisionId: result.revision.id }); setEditorDocument(result.revision.document); await refresh(); });
  const compose = () => void run(async () => { if (!selectedChapterId) return; const composed = await repository.composeChapter(selectedChapterId); setMode('compose'); setEditorDocument(composed); setDocumentHead(undefined); });
  const doExport = () => void run(async () => {
    if (!documentHead) { setLocalError('Save a scene or continuous draft before exporting.'); return; }
    const options = { title: snapshot?.project.name ?? 'Manuscript', header: snapshot?.project.name ?? 'Manuscript', pageNumbering: true };
    const files = formats.map((format) => exportCapturedRevision({ id: documentHead.revisionId, documentId: documentHead.documentId, number: documentHead.revision, document: documentHead.document, createdAt: new Date().toISOString(), reason: 'edit' }, format, options));
    for (const file of files) { await repository.writeExport(file); if (!isDesktop) { const url = URL.createObjectURL(new Blob([file.bytes as unknown as BlobPart], { type: file.mimeType })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url); } }
  });
  const checkIntegrity = () => void run(async () => { await repository.integrityCheck(); await refresh(); });
  const backup = () => void run(async () => { await repository.createBackup(); await refresh(); });

  if (!snapshot) return <main className="welcome"><div className="welcome-card"><div className="mark">W</div><p className="eyebrow">OFFLINE DESKTOP WRITING</p><h1>Make room for the story.</h1><p className="welcome-copy">Weave keeps your manuscript, revisions, SQLite database, and recovery files in a visible <code>.weave</code> project directory. No server. No network. No guesswork.</p><div className="welcome-actions"><button type="button" className="primary-button" onClick={createProject} disabled={busy}>Create project</button><button type="button" className="secondary-button" onClick={openProject} disabled={busy}>Open project</button></div>{localError && <p className="error-message">{localError}</p>}<p className="offline-note"><span className="status-dot" /> local-only · SQLite · revisioned</p></div></main>;

  const activeChapter = snapshot.chapters.find((chapter) => chapter.id === selectedChapterId);
  const activeScene = scenes.find((scene) => scene.id === selectedSceneId);
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">W</span><span>Weave</span><span className="offline-pill">OFFLINE</span></div><div className="top-actions"><button type="button" onClick={checkIntegrity}>Integrity</button><button type="button" onClick={backup}>Backup</button><button type="button" onClick={doExport} disabled={busy || mode === 'compose'}>Export all</button><StatusBar status={snapshot.status} /></div></header>
    <aside className="sidebar"><div className="sidebar-heading"><span>MANUSCRIPT</span><button type="button" onClick={createProject} aria-label="New project">+</button></div>{snapshot.stories.map((story) => <div key={story.id} className="tree-group"><button type="button" className={`tree-item story ${selectedStoryId === story.id ? 'selected' : ''}`} onClick={() => setSelectedStoryId(story.id)}>▾ <span>{story.title}</span></button>{snapshot.chapters.filter((chapter) => chapter.storyId === story.id).map((chapter) => <div key={chapter.id} className="chapter-group"><button type="button" className={`tree-item chapter ${selectedChapterId === chapter.id ? 'selected' : ''}`} onClick={() => { setSelectedChapterId(chapter.id); setSelectedSceneId(undefined); }}>▾ <span>{chapter.title}</span></button>{selectedChapterId === chapter.id && scenes.map((scene) => <button type="button" key={scene.id} className={`tree-item scene ${selectedSceneId === scene.id && mode === 'scene' ? 'selected' : ''}`} onClick={() => selectScene(scene)}><span className="scene-index">{String(scene.position + 1).padStart(2, '0')}</span>{scene.title}</button>)}{selectedChapterId === chapter.id && <button type="button" className="add-scene" onClick={addScene}>+ New scene</button>}</div>)}</div>)}<button type="button" className="add-story" onClick={() => void run(async () => { const title = window.prompt('Story title', 'New story'); if (title) { await repository.createStory(title); await refresh(false); } })}>+ New story</button><div className="sidebar-bottom"><button type="button" onClick={addChapter} disabled={!selectedStoryId}>+ Chapter</button><button type="button" onClick={openProject}>Open</button></div></aside>
    <main className="workspace"><div className="workspace-head"><div><p className="eyebrow">{activeChapter?.title ?? 'Chapter'}</p><h1>{mode === 'continuous' ? 'Continuous draft' : mode === 'compose' ? 'Composed chapter' : activeScene?.title ?? 'Choose a scene'}</h1></div><div className="mode-switch"><button type="button" className={mode === 'scene' ? 'active' : ''} onClick={() => activeScene && selectScene(activeScene)}>Scenes</button><button type="button" className={mode === 'compose' ? 'active' : ''} onClick={compose}>Chapter view</button><button type="button" className={mode === 'continuous' ? 'active' : ''} onClick={openContinuous}>Continuous draft</button></div></div>
      {localError && <div className="inline-error" role="alert">{localError}</div>}
      <section className="paper-wrap"><div className="paper-meta"><span>{mode === 'compose' ? 'NON-DESTRUCTIVE COMPOSITION' : mode === 'continuous' ? 'SEPARATE REVISION · SOURCE SNAPSHOT PRESERVED' : 'SCENE DOCUMENT'}</span><span>12 pt · Times New Roman · double spaced</span></div><Editor document={editorDocument} onChange={setEditorDocument} readOnly={mode === 'compose'} /><div className="paper-footer"><span>{mode === 'compose' ? 'Scene documents remain the source.' : 'Structured document · autosave is explicit'}</span>{documentHead && <span>revision {documentHead.revision}</span>}</div></section>
      <footer className="editor-footer"><div>{mode === 'continuous' && <button type="button" className="secondary-button" onClick={returnToScenes}>Return to scenes</button>}{mode === 'scene' && activeScene && <><button type="button" className="secondary-button" onClick={() => renameScene(activeScene)}>Rename</button><button type="button" className="icon-button" onClick={() => moveScene(activeScene, -1)} aria-label="Move scene up">↑</button><button type="button" className="icon-button" onClick={() => moveScene(activeScene, 1)} aria-label="Move scene down">↓</button></>}{mode === 'compose' && <span className="guard-note">Composition is a view, never a second source.</span>}</div><div className="save-actions">{mode !== 'compose' && <button type="button" className="primary-button" onClick={save} disabled={busy || !documentHead}>Save revision</button>}</div></footer>
    </main>
    {showReturnChoices && <ChoiceDialog onSplit={split} onKeep={keepSeparate} onCancel={() => setShowReturnChoices(false)} busy={busy} />}
  </div>;
}
