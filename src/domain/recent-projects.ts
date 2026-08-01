import type { Project } from './types';

/** Recent-project metadata is deliberately separate from project contents. */
export interface RecentProject {
  directory: string;
  name: string;
  lastOpenedAt: string;
}

export const RECENT_PROJECTS_STORAGE_KEY = 'weave.recent-projects.v1';
const MAX_RECENT_PROJECTS = 12;

/** Validate the path syntax without probing the filesystem or following links. */
export function validateProjectDirectory(value: string): string {
  const directory = value.trim();
  if (!directory) throw new Error('A project directory is required');
  if ([...directory].some((character) => character.charCodeAt(0) < 0x20)) throw new Error('The project directory contains an invalid character');
  const segments = directory.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Choose a project directory without traversal aliases');
  }
  if (segments.some((segment) => segment === '.weave')) {
    throw new Error('Choose the project directory, not its .weave folder');
  }
  return directory;
}

function storage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try { return window.localStorage; } catch { return undefined; }
}

function parseRecentProjects(value: string | null): RecentProject[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): RecentProject[] => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Partial<RecentProject>;
      if (typeof candidate.directory !== 'string' || typeof candidate.name !== 'string' || typeof candidate.lastOpenedAt !== 'string') return [];
      try {
        const directory = validateProjectDirectory(candidate.directory);
        const name = candidate.name.trim();
        if (!name || name.length > 200 || candidate.lastOpenedAt.length > 80) return [];
        return [{ directory, name, lastOpenedAt: candidate.lastOpenedAt }];
      } catch { return []; }
    });
  } catch { return []; }
}

export function readRecentProjects(): RecentProject[] {
  const store = storage();
  if (!store) return [];
  try { return parseRecentProjects(store.getItem(RECENT_PROJECTS_STORAGE_KEY)).slice(0, MAX_RECENT_PROJECTS); } catch { return []; }
}

function writeRecentProjects(projects: RecentProject[]): RecentProject[] {
  const value = projects.slice(0, MAX_RECENT_PROJECTS);
  const store = storage();
  if (store) {
    try { store.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(value)); } catch { /* Storage can be unavailable or full; opening a project still succeeds. */ }
  }
  return value;
}

export function rememberRecentProject(project: Pick<Project, 'directory' | 'name'>, openedAt = new Date().toISOString()): RecentProject[] {
  const directory = validateProjectDirectory(project.directory);
  const name = project.name.trim();
  if (!name) throw new Error('A project name is required');
  const previous = readRecentProjects().filter((item) => item.directory !== directory);
  return writeRecentProjects([{ directory, name: name.slice(0, 200), lastOpenedAt: openedAt }, ...previous]);
}

export function removeRecentProject(directory: string): RecentProject[] {
  let normalized: string;
  try { normalized = validateProjectDirectory(directory); } catch { return readRecentProjects(); }
  return writeRecentProjects(readRecentProjects().filter((item) => item.directory !== normalized));
}

/** Useful for stale entries and tests; it never checks or reads project content. */
export function isValidRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RecentProject>;
  try {
    return typeof candidate.directory === 'string' && validateProjectDirectory(candidate.directory) === candidate.directory.trim()
      && typeof candidate.name === 'string' && candidate.name.trim().length > 0
      && typeof candidate.lastOpenedAt === 'string';
  } catch { return false; }
}
