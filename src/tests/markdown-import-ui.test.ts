import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Markdown import UI contract', () => {
  it('keeps the accessible manuscript picker behind ProjectRepository', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const styles = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');
    expect(app).toContain('Import Markdown into Manuscript');
    expect(app).toContain('{markdownImportDialog && <MarkdownImportDialog');
    expect(app).toContain('trigger={markdownImportDialog.trigger}');
    expect(app).toContain('onCancel={() => setMarkdownImportDialog(undefined)}');
    expect(app).toContain('accept=".md,text/markdown" multiple');
    expect(app).toContain('aria-label="Choose Markdown files"');
    expect(app).toContain('Only .md files can be imported');
    expect(app).toContain('repository.createScene');
    expect(app).toContain('repository.createChapter');
    expect(app).toContain('await autosave.flush()');
    expect(app).toContain('rollbackInReverse');
    expect(app).toContain('repository.deleteScene');
    expect(app).toContain('repository.deleteChapter');
    expect(app).not.toContain("invoke('create_scene'");
    expect(app).not.toContain('Import Markdown into Worldbuilding');
    expect(app).not.toContain("openMarkdownImport('worldbuilding')");
    expect(app).not.toContain('worldbuilding-import-button');
    expect(styles).toContain('.markdown-file-control');
    expect(styles).toContain('.markdown-file-picker:focus-within');
  });

  it('places Import .md immediately after Export all only on the Manuscript route', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    const exportAction = '<button type="button" onClick={doExport} disabled={busy || mode === \'compose\'}>Export all</button>';
    const manuscriptImport = "{route === 'manuscript' && <button type=\"button\" onClick={openMarkdownImport} disabled={busy || mode === 'compose'}>Import .md</button>}";
    expect(app).toContain(`${exportAction}${manuscriptImport}`);
    expect(app).toContain('disabled={busy || mode === \'compose\'}>Import .md</button>');
    expect(app).not.toContain('onImport: () => void');
    expect(app).not.toContain('onImport={() =>');
  });

  it('shows selected filenames and contextual manuscript targets', () => {
    const app = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    expect(app).toContain('aria-label="Selected Markdown files"');
    expect(app).toContain('New scene');
    expect(app).toContain('New chapter');
    expect(app).toContain('Create a chapter and its first scene from each file.');
    expect(app).toContain('Imported ${importedScenes.length} Markdown scene');
  });
});
