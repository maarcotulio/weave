import type { Chapter, ProjectSnapshot, Scene, Story } from '../domain/types';

interface ManuscriptOutlineProps {
  snapshot: ProjectSnapshot;
  selectedChapterId?: string;
  selectedSceneId?: string;
  outlineFiles?: React.ReactNode;
  onSelectChapter: (story: Story, chapter: Chapter) => void;
  onSelectScene: (story: Story, chapter: Chapter, scene: Scene) => void;
  onMoveChapter: (chapter: Chapter, position: number) => void;
  onMoveScene: (scene: Scene, position: number) => void;
}

type DragPayload = { kind: 'chapter' | 'scene'; id: string };

function dragPayload(event: React.DragEvent, payload: DragPayload) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-weave-manuscript', JSON.stringify(payload));
}

function readPayload(event: React.DragEvent): DragPayload | undefined {
  try {
    const value = JSON.parse(event.dataTransfer.getData('application/x-weave-manuscript')) as DragPayload;
    return value && (value.kind === 'chapter' || value.kind === 'scene') && typeof value.id === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function ManuscriptOutline({ snapshot, selectedChapterId, selectedSceneId, outlineFiles, onSelectChapter, onSelectScene, onMoveChapter, onMoveScene }: ManuscriptOutlineProps) {
  const chaptersFor = (storyId: string) => snapshot.chapters.filter((chapter) => chapter.storyId === storyId).sort((a, b) => a.position - b.position);
  const scenesFor = (chapter: Chapter) => snapshot.scenes.filter((scene) => scene.sceneSetId === chapter.activeSceneSetId).sort((a, b) => a.position - b.position);
  const dropOn = (event: React.DragEvent, target: Chapter | Scene) => {
    event.preventDefault();
    const payload = readPayload(event);
    if (!payload || payload.id === target.id) return;
    if (payload.kind === 'chapter' && 'activeSceneSetId' in target) {
      const source = snapshot.chapters.find((chapter) => chapter.id === payload.id);
      if (source && source.storyId === target.storyId) onMoveChapter(source, target.position);
    } else if (payload.kind === 'scene' && 'documentId' in target) {
      const source = snapshot.scenes.find((scene) => scene.id === payload.id);
      if (source && source.sceneSetId === target.sceneSetId) onMoveScene(source, target.position);
    }
  };
  return <main id="manuscript-outline" className="outline-workspace" aria-label="Manuscript outline and corkboard">
    <header className="outline-head"><div><p className="eyebrow">MANUSCRIPT OUTLINE</p><h1>Corkboard</h1><p>Reorganize stories, chapters, and scenes without changing their structured documents or Markdown.</p></div><span className="outline-help">Drag cards to reorder · keyboard buttons are available on every card</span></header>
    {outlineFiles}
    <div className="outline-board">
      {snapshot.stories.map((story) => <section className="outline-story" key={story.id} aria-labelledby={`outline-story-${story.id}`}>
        <div className="outline-story-heading"><h2 id={`outline-story-${story.id}`}>{story.title}</h2><span>{chaptersFor(story.id).length} chapters</span></div>
        <div className="outline-chapters">
          {chaptersFor(story.id).map((chapter, chapterIndex, chapters) => <article className={`outline-card chapter-card ${selectedChapterId === chapter.id ? 'selected' : ''}`} key={chapter.id} draggable onDragStart={(event) => dragPayload(event, { kind: 'chapter', id: chapter.id })} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOn(event, chapter)}>
            <div className="outline-card-heading"><button type="button" className="outline-card-title" onClick={() => onSelectChapter(story, chapter)}><span className="outline-card-kind">CHAPTER {String(chapter.position + 1).padStart(2, '0')}</span><strong>{chapter.title}</strong></button><div className="outline-move-buttons"><button type="button" disabled={chapterIndex === 0} aria-label={`Move ${chapter.title} up`} onClick={() => onMoveChapter(chapter, chapter.position - 1)}>↑</button><button type="button" disabled={chapterIndex === chapters.length - 1} aria-label={`Move ${chapter.title} down`} onClick={() => onMoveChapter(chapter, chapter.position + 1)}>↓</button></div></div>
            <div className="outline-scenes" aria-label={`${chapter.title} scenes`}>
              {scenesFor(chapter).map((scene, sceneIndex, scenes) => <div className={`outline-card scene-card ${selectedSceneId === scene.id ? 'selected' : ''}`} key={scene.id} draggable onDragStart={(event) => { event.stopPropagation(); dragPayload(event, { kind: 'scene', id: scene.id }); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); dropOn(event, scene); }}>
                <button type="button" className="outline-card-title" onClick={() => onSelectScene(story, chapter, scene)}><span className="outline-card-kind">SCENE {String(scene.position + 1).padStart(2, '0')}</span><strong>{scene.title}</strong><small>Structured scene document</small></button><div className="outline-move-buttons"><button type="button" disabled={sceneIndex === 0} aria-label={`Move ${scene.title} up`} onClick={() => onMoveScene(scene, scene.position - 1)}>↑</button><button type="button" disabled={sceneIndex === scenes.length - 1} aria-label={`Move ${scene.title} down`} onClick={() => onMoveScene(scene, scene.position + 1)}>↓</button></div>
              </div>)}
              {scenesFor(chapter).length === 0 && <p className="outline-empty">No scenes yet.</p>}
            </div>
          </article>)}
          {chaptersFor(story.id).length === 0 && <p className="outline-empty">No chapters yet.</p>}
        </div>
      </section>)}
      {snapshot.stories.length === 0 && <p className="outline-empty">Create a story to start outlining.</p>}
    </div>
  </main>;
}
