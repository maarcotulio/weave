import { afterEach, describe, expect, it } from 'vitest';
import { RECENT_PROJECTS_STORAGE_KEY, readRecentProjects, rememberRecentProject, removeRecentProject, selectedProjectDirectory, validateProjectDirectory } from '../domain/recent-projects';

function installStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(RECENT_PROJECTS_STORAGE_KEY, initial);
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  } as Storage;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
  return localStorage;
}

afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); });

describe('recent project metadata', () => {
  it('keeps newest projects first, deduplicates paths, and stores no project content', () => {
    installStorage();
    rememberRecentProject({ directory: '/tmp/one', name: 'One' }, '2025-01-01T00:00:00.000Z');
    const current = rememberRecentProject({ directory: '/tmp/two', name: 'Two' }, '2025-01-02T00:00:00.000Z');
    expect(current.map((item) => item.directory)).toEqual(['/tmp/two', '/tmp/one']);
    expect(JSON.stringify(current)).not.toContain('manuscript');
    const deduplicated = rememberRecentProject({ directory: '/tmp/one', name: 'Renamed' }, '2025-01-03T00:00:00.000Z');
    expect(deduplicated.map((item) => item.directory)).toEqual(['/tmp/one', '/tmp/two']);
    expect(deduplicated[0]?.name).toBe('Renamed');
  });

  it('removes an entry without touching the project directory', () => {
    installStorage();
    rememberRecentProject({ directory: '/tmp/one', name: 'One' });
    rememberRecentProject({ directory: '/tmp/two', name: 'Two' });
    expect(removeRecentProject('/tmp/one').map((item) => item.directory)).toEqual(['/tmp/two']);
  });

  it('drops malformed metadata and rejects unsafe project-directory aliases', () => {
    installStorage(JSON.stringify([{ directory: '/tmp/valid', name: 'Valid', lastOpenedAt: 'now' }, { directory: '/tmp/secret', name: 'Secret', lastOpenedAt: 'now', markdown: 'content' }, { directory: '.weave', name: 'Bad', lastOpenedAt: 'now' }, null]));
    expect(readRecentProjects().map((item) => item.directory)).toEqual(['/tmp/valid', '/tmp/secret']);
    expect(() => validateProjectDirectory('')).toThrow();
    expect(() => validateProjectDirectory('/tmp/project/.weave')).toThrow();
    expect(() => validateProjectDirectory('/tmp/project/..')).toThrow();
  });

  it('accepts exactly one safe folder from the native picker', () => {
    expect(selectedProjectDirectory('/tmp/chosen-project')).toBe('/tmp/chosen-project');
    expect(selectedProjectDirectory(null)).toBeUndefined();
    expect(selectedProjectDirectory([])).toBeUndefined();
    expect(selectedProjectDirectory(['/tmp/one', '/tmp/two'])).toBeUndefined();
    expect(() => selectedProjectDirectory('/tmp/chosen-project/.weave')).toThrow();
  });
});
