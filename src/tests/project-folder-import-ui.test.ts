import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectFolderImportDialog } from '../app/ProjectFolderImportDialog';

describe('project-folder import dialog', () => {
  it('renders the accessible desktop import flow and all required folders', () => {
    const markup = renderToStaticMarkup(createElement(ProjectFolderImportDialog, { busy: false, onCancel: () => undefined, onChoose: () => undefined }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('manuscript');
    expect(markup).toContain('outline');
    expect(markup).toContain('worldbuilding');
    expect(markup).toContain('Choose folder…');
  });
});
