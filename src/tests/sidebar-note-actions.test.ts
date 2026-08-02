import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
const workspaceSource = readFileSync(join(process.cwd(), 'src/app/Worldbuilding.tsx'), 'utf8');

describe('Markdown note sidebar actions', () => {
  it('keeps note opening on the title and isolates row actions', () => {
    expect(appSource).toContain('worldbuilding-file-row');
    expect(appSource).toContain('WorldbuildingTree');
    expect(appSource).toContain('onClick={() => entry.kind !== \'folder\' && onOpen(entry)}');
    expect(appSource).toContain('onRenameNote');
    expect(appSource).toContain('onDeleteNote');
    expect(appSource).toContain("import { Pencil, Plus, Trash2 } from 'lucide-react'");
    expect(appSource).toContain('<Pencil size={13} aria-hidden="true" />');
    expect(appSource).toContain('<Trash2 size={13} aria-hidden="true" />');
    expect(readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8')).toContain('.worldbuilding-file-row:hover, .worldbuilding-file-row.selected { background: var(--accent-tint); }');
    expect(appSource).toContain('onDragStart');
    expect(appSource).not.toContain('worldbuilding-sidebar-note-row');
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
    expect(appSource).toContain('function NoteDeleteDialog');
    expect(appSource).toContain('closeDisabled={busy}');
    expect(appSource).toContain('aria-modal="true"');
    expect(appSource).toContain('Are you sure you want to delete');
    expect(appSource).toContain('Delete note');
    expect(appSource).toContain('Delete and remove references');
    expect(appSource).toContain('mode === \'reject\' && message.startsWith(\'Cannot delete\')');
    expect(appSource).toContain('phase: \'references\'');
    expect(appSource).toContain("'remove-references'");
    expect(appSource).toContain('canDismissWithEscape');
    expect(appSource).toContain('>Cancel</button>');
    expect(appSource).toContain('className="danger-button"');
  });

  it('defines an accessible note-name modal and keeps creation behind explicit confirmation', () => {
    expect(appSource).toContain('function NoteCreateDialog');
    expect(appSource).toContain('<Modal eyebrow="NOTE" title="Create note" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger}>');
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
    expect(appSource.slice(createStart, submitStart)).toContain('await autosave.flush(); setWorldbuildingCreateDialog(undefined); setNoteCreateDialog({ trigger });');
    expect(appSource.slice(createStart, submitStart)).not.toContain('createMarkdownNote');
    const submitFlow = appSource.slice(submitStart, canvasStart);
    expect(submitFlow).toContain('const name = title.trim();');
    expect(submitFlow).toContain('if (!name) return;');
    expect(submitFlow).toContain('repository.createMarkdownNote(name)');
    expect(submitFlow).toContain('setNoteCreateDialog(undefined);');
    expect(submitFlow).toContain('await refresh();');
    expect(submitFlow).toContain('openWorldbuildingTab({ kind: \'note\', id: note.id })');
  });
});
