import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('writing navigation and motivation surfaces', () => {
  it('exposes Home heatmap, Settings controls, focus mode, and goal toast wiring', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const home = readFileSync(join(process.cwd(), 'src/app/Home.tsx'), 'utf8');
    const settings = readFileSync(join(process.cwd(), 'src/app/Settings.tsx'), 'utf8');
    const styles = readFileSync(join(process.cwd(), 'src/app/feature-pages.css'), 'utf8');
    expect(app).toContain("type AppRoute = 'home' | 'manuscript' | 'outline' | 'worldbuilding' | 'settings'");
    expect(app).toContain('Daily goal reached');
    expect(app).toContain('Save version');
    expect(app).toContain('Why save versions?');
    expect(app).toContain('Compare saved versions');
    expect(app).toContain('Type <code>RESTORE</code> to confirm');
    expect(app).toContain('restoreManuscriptVersion');
    expect(app).toContain('Enter Focus Mode');
    expect(app).toContain('>Export all</button>{route === \'manuscript\' && <button type="button" onClick={openMarkdownImport}');
    expect(app).not.toContain('id="home-workspace-tab"');
    expect(home).toContain('Writing activity heatmap');
    expect(home).toContain('Your writing rhythm');
    expect(home).toContain('Daily pace');
    expect(settings).toContain('Global text margins');
    expect(settings).toContain('Local writing statistics');
    expect(settings).toContain('Repeated autosaves with no new words');
    expect(styles).toContain('.focus-mode .topbar');
    expect(styles).toContain('.toast');
  });

  it('exposes a native-drag manuscript outline with keyboard ordering controls', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const outline = readFileSync(join(process.cwd(), 'src/app/ManuscriptOutline.tsx'), 'utf8');
    expect(app).toContain("navigate('outline')");
    expect(app).toContain('repository.reorderChapter');
    expect(outline).toContain('onDragStart');
    expect(outline).toContain('application/x-weave-manuscript');
    expect(outline).toContain('Move ${chapter.title} up');
    expect(outline).toContain('Move ${scene.title} down');
  });

  it('keeps nested scene drags and drops from reaching the chapter card', () => {
    const outline = readFileSync(join(process.cwd(), 'src/app/ManuscriptOutline.tsx'), 'utf8');
    expect(outline).toContain("onDragStart={(event) => { event.stopPropagation(); dragPayload(event, { kind: 'scene', id: scene.id }); }}");
    expect(outline).toContain('onDrop={(event) => { event.stopPropagation(); dropOn(event, scene); }}');
    expect(outline).toContain("if (payload.kind === 'chapter' && 'activeSceneSetId' in target)");
    expect(outline).toContain("} else if (payload.kind === 'scene' && 'documentId' in target)");
  });

  it('reopens metadata-only recent projects in the web fallback', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(app).toContain('const project = !isDesktop && recentName');
    expect(app).toContain('repository.createProject(validatedDirectory, recentName)');
    expect(app).toContain('openProjectAt(project.directory, project.name)');
  });
});
