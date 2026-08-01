import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('project search UI wiring', () => {
  it('exposes explicit local search states and grouped result navigation', () => {
    const search = readFileSync(join(process.cwd(), 'src/app/ProjectSearch.tsx'), 'utf8');
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(search).toContain('Type a word or phrase to search the local project.');
    expect(search).toContain('No results found.');
    expect(search).toContain('role="listbox"');
    expect(search).toContain('searchResultKindLabel');
    expect(app).toContain('<ProjectSearch repository={repository} snapshot={snapshot} onNavigate={openSearchTarget} />');
    expect(app).toContain('await autosave.flush();');
    expect(app).toContain("target.kind === 'continuous-draft'");
    expect(app).toContain('flushActiveMarkdownNote');

    const searchNavigation = app.slice(app.indexOf('const openSearchTarget'), app.indexOf('const createProject'));
    expect(searchNavigation).toContain('if (!await flushActiveMarkdownNote()) return;');
    expect(searchNavigation.indexOf('flushActiveMarkdownNote')).toBeLessThan(searchNavigation.indexOf("if (target.kind === 'story')"));
    expect(search).toContain('snapshot.scenes.filter((scene) => activeSceneSetIds.has(scene.sceneSetId))');
    expect(search).toContain('return undefined;');
  });
});
