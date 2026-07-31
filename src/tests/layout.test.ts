import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('writing page layout', () => {
  it('keeps document-sized pages, a collapsible sidebar, and responsive desktop fallbacks', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(css).toContain('.paper-page');
    expect(css).toContain('height: var(--page-height)');
    expect(css).toContain('min-height: 0');
    expect(css).toContain('overflow: visible');
    expect(css).toContain('display: flex; flex-direction: column');
    expect(css).toContain('margin-top: auto');
    expect(css).not.toContain('height: auto; overflow: visible');
    expect(css).toContain('@media (max-width: 1100px)');
    expect(css).toContain('grid-template-columns: 220px minmax(0, 1fr)');
    expect(css).not.toContain('.paper-wrap');
    expect(app).toContain('sidebar-toggle');
    expect(app).toContain('brand-cluster');
    expect(css).toContain('.brand-cluster');
    expect(app).toContain('function Modal');
    expect(app).toContain('paginateDocument');
    expect(app).toContain('data-page-block-id');
    expect(app).toContain('canonicalOffsetToPage');
  });
});
