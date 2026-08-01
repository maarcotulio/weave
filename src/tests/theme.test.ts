import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyTheme, DEFAULT_THEME, persistTheme, readStoredTheme, THEME_STORAGE_KEY, toggleTheme } from '../app/theme';

function storage(values: Record<string, string> = {}) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; }
  };
}

describe('local theme preference', () => {
  it('falls back to light and rejects values outside the two supported themes', () => {
    expect(readStoredTheme(storage())).toBe(DEFAULT_THEME);
    expect(readStoredTheme(storage({ [THEME_STORAGE_KEY]: 'system' }))).toBe('light');
  });

  it('toggles only between light and dark and persists the choice locally', () => {
    const local = storage();
    expect(toggleTheme('light')).toBe('dark');
    expect(toggleTheme('dark')).toBe('light');
    persistTheme('dark', local);
    expect(local.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme(local)).toBe('dark');
  });

  it('applies the selected document theme without touching project data', () => {
    const root = { dataset: {} as DOMStringMap };
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
  });
});

describe('dark mode renderer contract', () => {
  it('exposes an accessible stateful control and token-driven dark overrides', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const colors = readFileSync(join(process.cwd(), 'src/app/tokens/colors.css'), 'utf8');
    const styles = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
    const index = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(app).toContain('aria-pressed={theme === \'dark\'}');
    expect(app).toContain('Switch to ${nextTheme} theme');
    expect(app).toContain('persistTheme(theme)');
    expect(colors).toContain('[data-theme="dark"]');
    expect(colors).toContain('--canvas-surface:');
    expect(styles).toContain('.react-flow__controls-button');
    expect(styles).toContain('.react-flow__minimap');
    expect(styles).not.toContain('background: #f0ede7');
    expect(index).toContain("localStorage.getItem('weave.theme')");
  });
});
