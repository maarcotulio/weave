import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../app/Worldbuilding', () => ({
  WorldbuildingWorkspace: () => null,
  worldbuildingTabKey: (tab: { kind: string; id: string }) => `${tab.kind}:${tab.id}`
}));

import { ImportChoiceDialog } from '../app/ImportChoiceDialog';
import { MarkdownImportDialog } from '../app/App';

describe('Import choice dialog', () => {
  it('renders explicit project-folder and single-Markdown-file paths', () => {
    const markup = renderToStaticMarkup(createElement(ImportChoiceDialog, { busy: false, folderAvailable: true, onCancel: () => undefined, onChooseFolder: () => undefined, onChooseMarkdown: () => undefined }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('Project folder');
    expect(markup).toContain('Markdown file');
    expect(markup).toContain('manuscript');
    expect(markup).toContain('outline');
    expect(markup).toContain('worldbuilding');
  });

  it('keeps folder import unavailable outside desktop without hiding Markdown import', () => {
    const markup = renderToStaticMarkup(createElement(ImportChoiceDialog, { busy: false, folderAvailable: false, onCancel: () => undefined, onChooseFolder: () => undefined, onChooseMarkdown: () => undefined }));
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*><strong>Project folder/);
    expect(markup).toMatch(/<button[^>]*><strong>Markdown file/);
  });

  it('asks for exactly one Markdown file before showing the existing explicit destinations', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownImportDialog, { defaultTarget: 'scene', canImportScene: true, canImportChapter: true, busy: false, onCancel: () => undefined, onSubmit: () => undefined }));
    expect(markup).toContain('Choose one .md file');
    expect(markup).toContain('aria-label="Choose a Markdown file"');
    expect(markup).not.toContain('multiple=""');
    expect(markup).toContain('New scene');
    expect(markup).toContain('New chapter');
  });
});
