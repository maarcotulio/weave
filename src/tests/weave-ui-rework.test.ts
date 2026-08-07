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

  it('keeps four equal workspace controls in a 2x2 grid with accessible search behavior', () => {
    const app = source('src/app/App.tsx');
    const styles = source('src/app/styles.css');
    const featureStyles = source('src/app/feature-pages.css');
    const navigationStart = app.indexOf('<nav className="workspace-route-tabs"');
    const navigationEnd = app.indexOf('</nav>', navigationStart) + '</nav>'.length;
    const navigation = app.slice(navigationStart, navigationEnd);
    const controlsStart = app.indexOf('<div className="workspace-sections">');
    const controlsEnd = app.indexOf('</div></div>{workspaceMode', controlsStart) + '</div></div>'.length;
    const controls = app.slice(controlsStart, controlsEnd);
    expect(app).toContain('role="tablist" aria-label="Primary workspaces"');
    expect(navigation.match(/<button/g)).toHaveLength(3);
    expect(navigation).toContain('id="manuscript-workspace-tab"');
    expect(navigation).toContain('id="outline-workspace-tab"');
    expect(navigation).toContain('id="worldbuilding-workspace-tab"');
    expect(navigation).not.toContain('id="project-search-tab"');
    expect(controls.match(/<button/g)).toHaveLength(4);
    expect(controls).toContain('id="project-search-tab"');
    expect(controls).toContain('aria-haspopup="dialog"');
    expect(controls).toContain('aria-expanded={searchOpen}');
    expect(controls).toContain('workspace-route-tabs');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(styles).toContain('grid-template-rows: repeat(2, minmax(38px, auto));');
    expect(styles).toContain('.workspace-sections button:focus-visible');
    expect(styles).toContain('.workspace-search-trigger:focus-visible');
    expect(styles).toContain('.workspace-search-trigger { margin-top: 0; }');
    expect(styles).toContain('.workspace-route-tabs { display: contents; }');
    expect(featureStyles).toContain('.workspace-navigation { display: block; }');
    expect(featureStyles).toContain('.workspace-sections { display: grid; }');
    expect(featureStyles).not.toContain('.workspace-navigation { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }');
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

  it('blends the Files tree into the sidebar surface while preserving its accessible tree label', () => {
    const app = source('src/app/App.tsx');
    const styles = source('src/app/styles.css');
    expect(app).toContain('<h2>Files</h2>');
    expect(app).toContain('aria-label="Worldbuilding files"');
    // The Files tree must not override the sidebar's own background (var(--panel-strong)) with
    // the page-surface token (var(--bg)) — that mismatch rendered as a stray darker box inside
    // the sidebar, most visible in dark mode. It should inherit the sidebar's background instead,
    // same as the analogous Manuscript tree (.tree-item et al., which never set a background).
    expect(styles).toContain('.worldbuilding-file-tree { margin-bottom: 22px; padding: 8px 2px; }');
    expect(styles).not.toContain('.worldbuilding-file-tree { margin-bottom: 22px; padding: 8px 2px; background: var(--bg); border: 0; }');
    expect(styles).toContain('.worldbuilding-file-actions button:hover, .worldbuilding-file-actions button:focus-visible');
  });

  it('warns instead of claiming SQLite persistence when the welcome screen is not running in the desktop app', () => {
    const app = source('src/app/App.tsx');
    const welcomeStart = app.indexOf('if (!snapshot) return');
    const welcomeEnd = app.indexOf('formDialog && <FormDialog', welcomeStart);
    const welcome = app.slice(welcomeStart, welcomeEnd);
    // The SQLite/`.weave` persistence claim only appears on the real desktop path.
    expect(welcome).toContain("isDesktop ? <p className=\"welcome-copy\">Weave keeps your manuscript, revisions, SQLite database");
    // The non-desktop (browser fallback) path gets an honest warning instead, not the same claim.
    expect(welcome).toContain('modal-warning');
    expect(welcome).toContain('Browser preview — nothing is saved');
    expect(welcome).toContain('npm run desktop:dev');
    // The bottom status line also stops claiming SQLite outside the desktop app.
    expect(welcome).toContain("isDesktop ? 'local-only · SQLite · revisioned' : 'browser preview · nothing persisted'");
  });
});
