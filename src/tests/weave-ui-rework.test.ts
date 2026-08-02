import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('approved UI rework wiring', () => {
  it('keeps the Home progress surface and primary manuscript action together', () => {
    const home = source('src/app/Home.tsx');
    const styles = source('src/app/feature-pages.css');
    expect(home).toContain('className="home-progress-card"');
    expect(home).toContain('className="primary-button" onClick={onOpenManuscript}>Open manuscript');
    expect(home).toContain('role="progressbar"');
    expect(styles).toContain('.home-overview');
  });

  it('moves search to the sidebar modal and keeps worldbuilding index UI removed', () => {
    const app = source('src/app/App.tsx');
    const worldbuilding = source('src/app/Worldbuilding.tsx');
    const search = source('src/app/ProjectSearch.tsx');
    expect(app).toContain('id="project-search-tab"');
    expect(search).toContain('role="dialog"');
    expect(worldbuilding).not.toContain('WorldbuildingIndexPanel');
    expect(worldbuilding).not.toContain('Derived worldbuilding index');
  });

  it('places the chapter action below the selected chapter scene action', () => {
    const app = source('src/app/App.tsx');
    expect(app).toContain('className="add-scene" onClick={addScene}>+ New scene');
    expect(app).toContain('className="add-chapter" onClick={addChapter} disabled={!selectedStoryId}>+ New chapter');
    expect(app).not.toContain('sidebar-new-chapter');
    expect(app).not.toContain('>+ Chapter</button>');
  });

  it('keeps four readable workspace controls and accessible search behavior', () => {
    const app = source('src/app/App.tsx');
    const styles = source('src/app/styles.css');
    expect(app).toContain('role="tablist" aria-label="Primary workspaces"');
    expect(app).toContain('id="project-search-tab"');
    expect(styles).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(styles).toContain('.workspace-sections button:focus-visible');
    expect(styles).toContain('.workspace-search-trigger:focus-visible');
  });

  it('styles recent projects as readable metadata cards with contained removal', () => {
    const styles = source('src/app/styles.css');
    expect(styles).toContain('.recent-projects li:hover, .recent-projects li:focus-within');
    expect(styles).toContain('font: 600 14px/1.3 var(--font-display)');
    expect(styles).toContain('font: var(--text-meta)');
    expect(styles).toContain('.recent-project-remove:focus-visible');
  });

  it('puts the manuscript action in the Home header and removes the overview action row', () => {
    const home = source('src/app/Home.tsx');
    const headerStart = home.indexOf('<header className="home-header">');
    const headerEnd = home.indexOf('</header>', headerStart);
    expect(home.slice(headerStart, headerEnd)).toContain('Open manuscript');
    expect(home.slice(headerEnd)).not.toContain('className="home-actions"');
  });

  it('uses the page surface for the Files tree while preserving its accessible tree label', () => {
    const app = source('src/app/App.tsx');
    const styles = source('src/app/styles.css');
    expect(app).toContain('<h2>Files</h2>');
    expect(app).toContain('aria-label="Worldbuilding files"');
    expect(styles).toContain('.worldbuilding-file-tree { margin-bottom: 22px; padding: 8px 2px; background: var(--bg); border: 0; }');
    expect(styles).toContain('.worldbuilding-file-actions button:hover, .worldbuilding-file-actions button:focus-visible');
  });
});
