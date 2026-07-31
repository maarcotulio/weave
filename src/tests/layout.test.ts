import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('writing page layout', () => {
  it('keeps a document-sized page while providing responsive desktop fallbacks', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
    expect(css).toContain('width: min(816px, calc(100% - 48px))');
    expect(css).toContain('min-height: 1056px');
    expect(css).toContain('@media (max-width: 1100px)');
    expect(css).toContain('grid-template-columns: 220px minmax(0, 1fr)');
  });
});
