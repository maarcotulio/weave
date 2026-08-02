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

  it('aligns version controls and exposes a disabled heading-level chapter action', () => {
    const app = source('src/app/App.tsx');
    const styles = source('src/app/feature-pages.css');
    expect(app).toContain('className="sidebar-new-chapter secondary-button"');
    expect(app).toContain('disabled={!selectedStoryId}');
    expect(styles).toContain('--version-control-height: 36px');
    expect(styles).toContain('min-height: var(--version-control-height)');
  });
});
