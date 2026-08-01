import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWorldbuildingIndex, parseWorldbuildingType } from '../domain/worldbuilding-index';

describe('derived Markdown worldbuilding index', () => {
  it('recognizes only an explicit leading type convention', () => {
    expect(parseWorldbuildingType('---\ntype: character\n---\n# Ada')).toEqual({ type: 'character' });
    expect(parseWorldbuildingType('A character mentioned in prose.')).toEqual({});
    expect(parseWorldbuildingType('tags: [character]\n')).toEqual({});
  });

  it('handles absent and conflicting fields without guessing', () => {
    expect(parseWorldbuildingType('---\n---\n')).toEqual({});
    expect(parseWorldbuildingType('---\ntype: character\ntype: place\n---\n')).toEqual({ conflictingTypes: ['character', 'place'] });
    expect(parseWorldbuildingType('---\ntype: "Character"\n---\n')).toEqual({ type: 'character' });
  });

  it('documents filtering and opening the canonical source in the workspace', () => {
    const component = readFileSync(join(process.cwd(), 'src/app/Worldbuilding.tsx'), 'utf8');
    expect(component).toContain('type: character');
    expect(component).toContain('Filter by type');
    expect(component).toContain('Search worldbuilding index');
    expect(component).toContain('Open source note');
    expect(component).toContain('buildWorldbuildingIndex(snapshot.markdownNotes)');
  });

  it('builds sorted derived entries that retain their source note IDs', () => {
    expect(buildWorldbuildingIndex([
      { id: 'place-id', title: 'Harbor', markdown: '---\ntype: place\n---' },
      { id: 'plain-id', title: 'Loose note', markdown: 'No type' },
      { id: 'conflict-id', title: 'Broken note', markdown: '---\ntype: character\ntype: place\n---' }
    ])).toEqual([
      { sourceNoteId: 'conflict-id', title: 'Broken note', status: 'conflict', conflictingTypes: ['character', 'place'] },
      { sourceNoteId: 'place-id', title: 'Harbor', type: 'place', status: 'classified' },
      { sourceNoteId: 'plain-id', title: 'Loose note', status: 'unclassified' }
    ]);
  });

  it('orders equivalent titles deterministically by source note ID', () => {
    expect(buildWorldbuildingIndex([
      { id: 'z-note', title: 'Alpha', markdown: '' },
      { id: 'm-note', title: 'ＡLPHA', markdown: '' },
      { id: 'a-note', title: 'alpha', markdown: '' }
    ]).map((entry) => entry.sourceNoteId)).toEqual(['a-note', 'm-note', 'z-note']);
  });
});
