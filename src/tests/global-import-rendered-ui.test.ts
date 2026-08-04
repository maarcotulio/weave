import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectSnapshot, StructuredDocument } from '../domain/types';

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('../app/Worldbuilding', () => ({
  WorldbuildingWorkspace: () => null,
  worldbuildingTabKey: (tab: { kind: string; id: string }) => `${tab.kind}:${tab.id}`
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)): [T, (next: T) => void] => {
      const value = state.index < state.values.length
        ? state.values[state.index++] as T
        : typeof initial === 'function' ? (initial as () => T)() : initial;
      return [value, () => undefined];
    }
  };
});

import App from '../app/App';

const document: StructuredDocument = { formatVersion: 1, blocks: [{ id: 'block-import', kind: 'paragraph', runs: [{ text: 'Saved manuscript text.', marks: [] }] }] };
const story = { id: 'story-import', projectId: 'project-import', title: 'Story', position: 0 };
const chapter = { id: 'chapter-import', storyId: story.id, title: 'Chapter 1', position: 0, activeSceneSetId: 'set-import' };
const scene = { id: 'scene-import', sceneSetId: 'set-import', title: 'Scene 1', position: 0, documentId: 'document-import' };
const snapshot: ProjectSnapshot = {
  project: { id: 'project-import', name: 'Import project', directory: '/tmp/import-project', schemaVersion: 6, createdAt: '2026-08-05T00:00:00Z', updatedAt: '2026-08-05T00:00:00Z' },
  stories: [story], chapters: [chapter], sceneSets: [{ id: 'set-import', chapterId: chapter.id, createdAt: '2026-08-05T00:00:00Z', active: true }], scenes: [scene], continuousDrafts: [], worldbuildingFolders: [], markdownNotes: [], noteLinks: [], canvases: [], backups: [],
  styleProfile: { fontFamily: 'Times New Roman', fontSizePt: 12, lineSpacing: 'double', pageSize: 'letter', textMargins: { top: 44, right: 72, bottom: 30, left: 72 } },
  writingStats: { date: '2026-08-05', dailyTarget: 500, dailyWords: 12, projectWords: 12, sessions: 1, currentStreak: 1, longestStreak: 1, averageWordsPerDay: 12 }, writingActivity: [], manuscriptVersions: [], status: { state: 'saved', message: 'All changes saved', at: '2026-08-05T00:00:00Z' }
};

function renderProjectRoute(route: 'home' | 'manuscript' | 'outline' | 'worldbuilding' | 'settings', mode: 'scene' | 'compose') {
  state.index = 0;
  state.values = ['light', [], snapshot, route, story.id, chapter.id, [scene], scene.id, { documentId: scene.documentId, document, revision: 2, revisionId: 'revision-import' }, undefined, mode, route === 'worldbuilding' ? 'worldbuilding' : 'writing', [], undefined, document, snapshot.styleProfile];
  return renderToStaticMarkup(createElement(App));
}

function importButton(markup: string) {
  return markup.match(/<button[^>]*>Import<\/button>/)?.[0];
}

describe('shared project Import UI', () => {
  it.each(['home', 'manuscript', 'outline', 'worldbuilding', 'settings'] as const)('renders enabled on the %s project route even in compose mode', (route) => {
    const button = importButton(renderProjectRoute(route, 'compose'));
    expect(button).toBeDefined();
    expect(button).not.toContain('disabled');
  });

  it('keeps Import directly after Export all in the rendered shared topbar', () => {
    const markup = renderProjectRoute('manuscript', 'scene');
    expect(markup).toMatch(/Export all<\/button><button[^>]*>Import<\/button>/);
  });
});
