import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Tauri repository command contract', () => {
  it('registers every command invoked by TauriProjectRepository, including document saves', () => {
    const adapter = readFileSync(join(process.cwd(), 'src/infrastructure/tauri-repository.ts'), 'utf8');
    const rust = readFileSync(join(process.cwd(), 'src-tauri/src/main.rs'), 'utf8');
    const invoked = [...adapter.matchAll(/command\('([a-z_]+)'/g)].map((match) => match[1]);
    const handler = rust.match(/tauri::generate_handler!\[([^\]]+)\]/s)?.[1]
      .split(',')
      .map((name) => name.trim()) ?? [];

    expect(invoked).not.toHaveLength(0);
    expect(handler).toEqual(expect.arrayContaining(invoked));
    expect(invoked).toContain('save_document');
    expect(handler).toContain('save_document');
  });
});
