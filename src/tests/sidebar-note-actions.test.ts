import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
const workspaceSource = readFileSync(join(process.cwd(), 'src/app/Worldbuilding.tsx'), 'utf8');

describe('Markdown note sidebar actions', () => {
  it('keeps note opening on the title and isolates row actions', () => {
    expect(appSource).toContain('worldbuilding-sidebar-note-row');
    expect(appSource).toContain('worldbuilding-sidebar-note-title');
    expect(appSource).toContain('onClick={() => openWorldbuildingTab({ kind: \'note\', id: note.id })}');
    expect(appSource).toContain('event.stopPropagation(); requestRenameNote(note)');
    expect(appSource).toContain('event.stopPropagation(); requestDeleteNote(note)');
    expect(appSource).toContain("import { Pencil, Plus, Trash2 } from 'lucide-react'");
    expect(appSource).toContain('<Pencil size={14} strokeWidth={2} aria-hidden="true" />');
    expect(appSource).toContain('<Trash2 size={14} strokeWidth={2} aria-hidden="true" />');
    expect(appSource).not.toContain('worldbuilding-sidebar-note-action">Rename');
    expect(appSource).not.toContain('worldbuilding-sidebar-note-delete" aria-label={`Delete ${note.title}`} onClick');
  });

  it('keeps rename and delete out of the note editor header', () => {
    const headerStart = workspaceSource.indexOf('<header className="note-editor-head"><h1>');
    const headerEnd = workspaceSource.indexOf('</header>', headerStart);
    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(workspaceSource.slice(headerStart, headerEnd)).not.toContain('Delete note');
    expect(workspaceSource.slice(headerStart, headerEnd)).not.toContain('Rename note');
    expect(workspaceSource).not.toContain('window.confirm');
    expect(workspaceSource).not.toContain('Pencil');
  });

  it('defines labeled confirmation states and preserves reference warnings', () => {
    expect(appSource).toContain('role="dialog" aria-modal="true" aria-busy={busy}');
    expect(appSource).toContain('aria-labelledby="delete-note-dialog-title"');
    expect(appSource).toContain('aria-describedby="delete-note-dialog-description"');
    expect(appSource).toContain('Are you sure you want to delete');
    expect(appSource).toContain('Delete note');
    expect(appSource).toContain('Delete and remove references');
    expect(appSource).toContain('mode === \'reject\' && message.startsWith(\'Cannot delete\')');
    expect(appSource).toContain('phase: \'references\'');
    expect(appSource).toContain("'remove-references'");
    expect(appSource).toContain("event.key === 'Escape'");
    expect(appSource).toContain('>Cancel</button>');
    expect(appSource).toContain('className="danger-button"');
  });
});
