import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('direct UI kit route', () => {
  it('recognizes /ui directly and renders the reference without project state', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const kit = readFileSync(join(process.cwd(), 'src/app/UiKit.tsx'), 'utf8');
    expect(app).toContain("type AppRoute = 'home' | 'manuscript' | 'worldbuilding' | 'settings' | 'ui'");
    expect(app).toContain("value === 'ui'");
    expect(app).toContain("if (route === 'ui') return <UiKit />;");
    expect(kit).toContain('aria-labelledby="ui-kit-title"');
    expect(kit).toContain('Colors');
    expect(kit).toContain('Typography');
    expect(kit).toContain('Spacing');
    expect(kit).toContain('Buttons');
    expect(kit).toContain('Fields');
    expect(kit).toContain('States');
    expect(kit).toContain('Surfaces');
    expect(kit).toContain('Modal');
    expect(kit).toContain('Editor');
  });

  it('does not expose the UI kit through normal navigation and keeps editor controls focus-driven', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const styles = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
    const featureStyles = readFileSync(join(process.cwd(), 'src/app/feature-pages.css'), 'utf8');
    expect(app).not.toContain('>UI kit</');
    expect(app).not.toContain('href="/ui"');
    expect(app).not.toContain('semantic paragraph');
    expect(styles).toContain('.block:focus-within .block-tools');
    expect(styles).not.toContain('.block:hover .block-tools');
    expect(styles).not.toContain('.format-hint');
    expect(featureStyles).toContain('.version-help-button');
  });
});
