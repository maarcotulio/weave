import type { ContinuousDraft } from './types';

export type ManuscriptDeleteKind = 'story' | 'chapter' | 'scene';
export type ManuscriptEditorMode = 'scene' | 'continuous' | 'compose';

export interface ManuscriptDeleteAction {
  kind: ManuscriptDeleteKind;
  id: string;
}

export interface ManuscriptDeleteScene {
  id: string;
  chapterId: string;
  sceneSetId: string;
  documentId?: string;
}

export interface ManuscriptDeleteContext {
  activeStoryId?: string;
  draftStoryId?: string;
  activeChapterId?: string;
  activeSceneId?: string;
  activeDocumentId?: string;
  mode: ManuscriptEditorMode;
  draft?: Pick<ContinuousDraft, 'chapterId' | 'baseSceneSetId'>;
  scene?: ManuscriptDeleteScene;
}

export interface ManuscriptDeleteImpact {
  affectsDraft: boolean;
  affectsActiveSource: boolean;
  clearDocument: boolean;
  nextMode: ManuscriptEditorMode;
}

/**
 * Decides which in-memory editor records can be discarded after a destructive
 * manuscript operation. The repository cascade remains authoritative for
 * durable records; this only keeps the renderer from orphaning an open draft.
 */
export function manuscriptDeleteImpact(action: ManuscriptDeleteAction, context: ManuscriptDeleteContext): ManuscriptDeleteImpact {
  const affectsDraft = Boolean(context.draft && (
    (action.kind === 'story' && context.draftStoryId === action.id) ||
    (action.kind === 'chapter' && context.draft.chapterId === action.id)
  ));
  const affectsActiveSource = (
    (action.kind === 'story' && context.activeStoryId === action.id) ||
    (action.kind === 'chapter' && context.activeChapterId === action.id) ||
    (action.kind === 'scene' && (
      (context.mode === 'scene' && (
        context.activeSceneId === action.id ||
        context.scene?.documentId === context.activeDocumentId
      )) ||
      (context.mode === 'compose' && context.scene?.chapterId === context.activeChapterId)
    ))
  );
  const clearDocument = affectsDraft || affectsActiveSource;
  return { affectsDraft, affectsActiveSource, clearDocument, nextMode: clearDocument ? 'scene' : context.mode };
}
