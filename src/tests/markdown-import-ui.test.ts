import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownImportAction } from '../app/MarkdownImportAction';

const run = async (operation: () => Promise<void>) => operation();

describe('Markdown import action', () => {
  it('renders as an enabled, keyboard-reachable button when the project is not busy', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownImportAction, {
      busy: false,
      run,
      flushDocument: async () => undefined,
      flushMarkdownNote: async () => true,
      onOpen: () => undefined
    }));
    expect(markup).toBe('<button type="button">Import</button>');
  });

  it('uses busy as its only disabled restriction', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownImportAction, {
      busy: true,
      run,
      flushDocument: async () => undefined,
      flushMarkdownNote: async () => true,
      onOpen: () => undefined
    }));
    expect(markup).toBe('<button type="button" disabled="">Import</button>');
  });

  it('flushes a dirty Markdown note only when the user opens import and leaves the dialog closed on flush failure', async () => {
    const calls: string[] = [];
    const action = MarkdownImportAction({
      busy: false,
      run,
      flushDocument: async () => { calls.push('document'); },
      flushMarkdownNote: async () => { calls.push('note'); return false; },
      onOpen: () => { calls.push('open'); }
    });
    expect(calls).toEqual([]);
    await action.props.onClick?.({} as never);
    expect(calls).toEqual(['document', 'note']);
  });

  it('opens the existing Manuscript dialog only after both flushes complete through the app operation runner', async () => {
    const calls: string[] = [];
    const action = MarkdownImportAction({
      busy: false,
      run: async (operation) => { calls.push('run'); await operation(); },
      flushDocument: async () => { calls.push('document'); },
      flushMarkdownNote: async () => { calls.push('note'); return true; },
      onOpen: () => { calls.push('open'); }
    });
    await action.props.onClick?.({} as never);
    expect(calls).toEqual(['run', 'document', 'note', 'open']);
  });
});
