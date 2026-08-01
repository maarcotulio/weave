import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('writing navigation and motivation surfaces', () => {
  it('exposes Home heatmap, Settings controls, focus mode, and goal toast wiring', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const home = readFileSync(join(process.cwd(), 'src/app/Home.tsx'), 'utf8');
    const settings = readFileSync(join(process.cwd(), 'src/app/Settings.tsx'), 'utf8');
    const styles = readFileSync(join(process.cwd(), 'src/app/feature-pages.css'), 'utf8');
    expect(app).toContain("type AppRoute = 'home' | 'manuscript' | 'worldbuilding' | 'settings'");
    expect(app).toContain('Daily goal reached');
    expect(app).toContain('Save version');
    expect(app).toContain('Why save versions?');
    expect(app).toContain('Compare saved versions');
    expect(app).toContain('Type <code>RESTORE</code> to confirm');
    expect(app).toContain('restoreManuscriptVersion');
    expect(app).toContain('Enter Focus Mode');
    expect(app).toContain('>Export all</button><button type="button" onClick={() => navigate(\'settings\')');
    expect(app).not.toContain('id="home-workspace-tab"');
    expect(home).toContain('Writing activity heatmap');
    expect(home).toContain('days = 365');
    expect(settings).toContain('Global text margins');
    expect(styles).toContain('.focus-mode .topbar');
    expect(styles).toContain('.toast');
  });
});
