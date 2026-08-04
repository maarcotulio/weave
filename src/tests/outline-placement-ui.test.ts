import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ManuscriptOutline } from '../app/ManuscriptOutline';
import { OutlineFiles } from '../app/OutlineFiles';
import type { ProjectSnapshot } from '../domain/types';

const story = { id: 'story', projectId: 'project', title: 'Story', position: 0 };
const chapter = { id: 'chapter', storyId: story.id, title: 'Chapter', position: 0, activeSceneSetId: 'set' };
const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Project', directory: '/tmp/project', schemaVersion: 7, createdAt: '2026-08-05T00:00:00Z', updatedAt: '2026-08-05T00:00:00Z' },
  stories: [story], chapters: [chapter], sceneSets: [{ id: 'set', chapterId: chapter.id, createdAt: '2026-08-05T00:00:00Z', active: true }], scenes: [], continuousDrafts: [], worldbuildingFolders: [], outlineFiles: [], markdownNotes: [], noteLinks: [], canvases: [], backups: [],
  styleProfile: { fontFamily: 'Times New Roman', fontSizePt: 12, lineSpacing: 'double', pageSize: 'letter', textMargins: { top: 44, right: 72, bottom: 30, left: 72 } },
  writingStats: { date: '2026-08-05', dailyTarget: 500, dailyWords: 0, projectWords: 0, sessions: 0, currentStreak: 0, longestStreak: 0, averageWordsPerDay: 0 }, writingActivity: [], manuscriptVersions: [], status: { state: 'saved', message: 'Ready', at: '2026-08-05T00:00:00Z' }
};

describe('Outline file placement', () => {
  it('places planning files between the Corkboard header and the intact board', () => {
    const markup = renderToStaticMarkup(createElement(ManuscriptOutline, {
      snapshot,
      outlineFiles: createElement(OutlineFiles, { files: [], busy: false, onCreate: () => undefined, onSave: () => undefined, onDelete: () => undefined }),
      onSelectChapter: () => undefined,
      onSelectScene: () => undefined,
      onMoveChapter: () => undefined,
      onMoveScene: () => undefined
    }));
    expect(markup.indexOf('class="outline-head"')).toBeLessThan(markup.indexOf('class="outline-files"'));
    expect(markup.indexOf('class="outline-files"')).toBeLessThan(markup.indexOf('class="outline-board"'));
    expect(markup).toContain('class="outline-card chapter-card');
  });
});
