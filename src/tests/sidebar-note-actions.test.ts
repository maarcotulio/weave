import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
const workspaceSource = readFileSync(join(process.cwd(), 'src/app/Worldbuilding.tsx'), 'utf8');

describe('Markdown note sidebar actions', () => {
  it('keeps note opening on the title and isolates row actions', () => {
    expect(appSource).toContain('worldbuilding-sidebar-note-row');
    expect(appSource).toContain("worldbuilding-sidebar-note-row ${selected ? 'selected' : ''}");
    expect(appSource).toContain('worldbuilding-sidebar-note-title');
    expect(appSource).toContain('onClick={() => openWorldbuildingTab({ kind: \'note\', id: note.id })}');
    expect(appSource).toContain('event.stopPropagation(); requestRenameNote(note)');
    expect(appSource).toContain('event.stopPropagation(); requestDeleteNote(note)');
    expect(appSource).toContain("import { Pencil, Plus, Trash2 } from 'lucide-react'");
    expect(appSource).toContain('<Pencil size={14} strokeWidth={2} aria-hidden="true" />');
    expect(appSource).toContain('<Trash2 size={14} strokeWidth={2} aria-hidden="true" />');
    expect(readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8')).toContain('.worldbuilding-sidebar-note-row:hover, .worldbuilding-sidebar-note-row:focus-within, .worldbuilding-sidebar-note-row.selected { background: var(--accent-tint); }');
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

  it('defines an accessible note-name modal and keeps creation behind explicit confirmation', () => {
    expect(appSource).toContain('function NoteCreateDialog');
    expect(appSource).toContain('<Modal eyebrow="NOTE" title="Create note" onClose={busy ? undefined : onCancel}>');
    expect(appSource).toContain('id="create-note-name"');
    expect(appSource).toContain('autoFocus required aria-label="Note name"');
    expect(appSource).toContain('>Cancel</button>');
    expect(appSource).toContain('>Create note</button>');
    expect(appSource).toContain('disabled={busy || !value.trim()}');
    expect(appSource).toContain('const title = value.trim(); if (title) onSubmit(title);');
    expect(appSource).toContain('noteCreateDialog && <NoteCreateDialog');

    const createStart = appSource.indexOf('const createWorldbuildingNote =');
    const submitStart = appSource.indexOf('const submitNoteCreate =', createStart);
    const canvasStart = appSource.indexOf('const createWorldbuildingCanvas =', submitStart);
    expect(createStart).toBeGreaterThanOrEqual(0);
    expect(submitStart).toBeGreaterThan(createStart);
    expect(canvasStart).toBeGreaterThan(submitStart);
    expect(appSource.slice(createStart, submitStart)).toContain('await autosave.flush(); setNoteCreateDialog(true);');
    expect(appSource.slice(createStart, submitStart)).not.toContain('createMarkdownNote');
    const submitFlow = appSource.slice(submitStart, canvasStart);
    expect(submitFlow).toContain('const name = title.trim();');
    expect(submitFlow).toContain('if (!name) return;');
    expect(submitFlow).toContain('repository.createMarkdownNote(name)');
    expect(submitFlow).toContain('setNoteCreateDialog(false);');
    expect(submitFlow).toContain('await refresh();');
    expect(submitFlow).toContain('openWorldbuildingTab({ kind: \'note\', id: note.id })');
  });
});
