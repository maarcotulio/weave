import { afterEach, describe, expect, it } from 'vitest';
import { RECENT_PROJECTS_STORAGE_KEY, defaultProjectDirectory, isValidRecentProject, projectDirectoryPlatform, readRecentProjects, rememberRecentProject, removeRecentProject, selectedProjectDirectory, validateProjectDirectory } from '../domain/recent-projects';

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

function projectRoot(name: string): string {
  return projectDirectoryPlatform() === 'windows' ? `C:\\weave\\${name}` : `/tmp/${name}`;
}

describe('recent project metadata', () => {
  it('keeps newest projects first, deduplicates paths, and stores no project content', () => {
    installStorage();
    const one = projectRoot('one');
    const two = projectRoot('two');
    rememberRecentProject({ directory: one, name: 'One' }, '2025-01-01T00:00:00.000Z');
    const current = rememberRecentProject({ directory: two, name: 'Two' }, '2025-01-02T00:00:00.000Z');
    expect(current.map((item) => item.directory)).toEqual([two, one]);
    expect(JSON.stringify(current)).not.toContain('manuscript');
    const deduplicated = rememberRecentProject({ directory: one, name: 'Renamed' }, '2025-01-03T00:00:00.000Z');
    expect(deduplicated.map((item) => item.directory)).toEqual([one, two]);
    expect(deduplicated[0]?.name).toBe('Renamed');
  });

  it('removes an entry without touching the project directory', () => {
    installStorage();
    const one = projectRoot('one');
    const two = projectRoot('two');
    rememberRecentProject({ directory: one, name: 'One' });
    rememberRecentProject({ directory: two, name: 'Two' });
    expect(removeRecentProject(one).map((item) => item.directory)).toEqual([two]);
  });

  it('drops persisted relative or unsafe metadata and keeps only current-platform absolute roots', () => {
    const valid = projectRoot('valid');
    const secret = projectRoot('secret');
    installStorage(JSON.stringify([
      { directory: valid, name: 'Valid', lastOpenedAt: 'now' },
      { directory: secret, name: 'Secret', lastOpenedAt: 'now', markdown: 'content' },
      { directory: '.hidden-project', name: 'Hidden relative', lastOpenedAt: 'now' },
      { directory: 'projects/book', name: 'Nested relative', lastOpenedAt: 'now' },
      { directory: '.weave', name: 'Storage relative', lastOpenedAt: 'now' },
      null
    ]));
    expect(readRecentProjects().map((item) => item.directory)).toEqual([valid, secret]);
    expect(() => validateProjectDirectory('')).toThrow();
    expect(() => validateProjectDirectory('.hidden-project')).toThrow();
    expect(() => validateProjectDirectory('projects/book')).toThrow();
    expect(() => rememberRecentProject({ directory: '.hidden-project', name: 'Unsafe' })).toThrow();
    expect(() => rememberRecentProject({ directory: 'projects/book', name: 'Unsafe' })).toThrow();
    expect(isValidRecentProject({ directory: '.hidden-project', name: 'Unsafe', lastOpenedAt: 'now' })).toBe(false);
    expect(isValidRecentProject({ directory: 'projects/book', name: 'Unsafe', lastOpenedAt: 'now' })).toBe(false);
    expect(() => validateProjectDirectory(`${projectRoot('project')}${projectDirectoryPlatform() === 'windows' ? '\\' : '/'}.weave`)).toThrow();
    expect(() => validateProjectDirectory(`${projectRoot('project')}${projectDirectoryPlatform() === 'windows' ? '\\' : '/'}..`)).toThrow();
  });

  it('uses the current platform absolute syntax and validates Unix and Windows roots explicitly', () => {
    expect(validateProjectDirectory('/tmp/project', 'unix')).toBe('/tmp/project');
    expect(() => validateProjectDirectory('C:\\project', 'unix')).toThrow();
    expect(validateProjectDirectory('C:\\project', 'windows')).toBe('C:\\project');
    expect(validateProjectDirectory('\\\\server\\share\\project', 'windows')).toBe('\\\\server\\share\\project');
    expect(() => validateProjectDirectory('.hidden-project', 'windows')).toThrow();
    expect(() => validateProjectDirectory('projects/book', 'windows')).toThrow();
    expect(defaultProjectDirectory()).toMatch(/^\/|^[a-zA-Z]:[\\/]/);
  });

  it('accepts exactly one safe folder from the native picker', () => {
    expect(selectedProjectDirectory(projectRoot('chosen-project'))).toBe(projectRoot('chosen-project'));
    expect(selectedProjectDirectory(null)).toBeUndefined();
    expect(selectedProjectDirectory([])).toBeUndefined();
    expect(selectedProjectDirectory(['/tmp/one', '/tmp/two'])).toBeUndefined();
    expect(() => selectedProjectDirectory('/tmp/chosen-project/.weave')).toThrow();
  });
});
