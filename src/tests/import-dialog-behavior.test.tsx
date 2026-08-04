import React, { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/Worldbuilding', () => ({
  WorldbuildingWorkspace: () => null,
  worldbuildingTabKey: (tab: { kind: string; id: string }) => `${tab.kind}:${tab.id}`
}));

import { ImportChoiceDialog } from '../app/ImportChoiceDialog';
import { MarkdownImportDialog } from '../app/App';

let dom: JSDOM | undefined;
let root: Root | undefined;

function installDom() {
  dom = new JSDOM('<!doctype html><html><body><button id="trigger">Open import</button><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true
  });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  root = createRoot(document.getElementById('root')!);
}

async function render(view: React.ReactNode) {
  await act(async () => { root!.render(view); });
}

async function press(element: Element, key: string, shiftKey = false) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })); });
}

function ChoiceHarness({ busy, folderAvailable = true, onCancel }: { busy: boolean; folderAvailable?: boolean; onCancel?: () => void }) {
  const [open, setOpen] = useState(true);
  return open ? <ImportChoiceDialog busy={busy} folderAvailable={folderAvailable} trigger={document.getElementById('trigger') as HTMLElement} onCancel={() => { onCancel?.(); setOpen(false); }} onChooseFolder={() => undefined} onChooseMarkdown={() => undefined} /> : null;
}

function MarkdownFailureHarness({ onRetry }: { onRetry: () => void }) {
  const [error, setError] = useState<string>();
  return <MarkdownImportDialog defaultTarget="scene" canImportScene canImportChapter busy={false} error={error} onCancel={() => undefined} onRetry={onRetry} onSubmit={() => setError('Could not save the imported scene.')} />;
}

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  dom?.window.close();
  dom = undefined;
  root = undefined;
});

describe('interactive import dialogs', () => {
  it('traps focus, closes with Escape, and restores the trigger', async () => {
    installDom();
    const trigger = document.getElementById('trigger') as HTMLButtonElement;
    trigger.focus();
    await render(<ChoiceHarness busy={false} />);
    const dialog = document.querySelector('.import-choice-dialog')!;
    const folder = document.querySelector('button:has(strong)') as HTMLButtonElement;
    const buttons = [...dialog.querySelectorAll('button')];
    const cancel = buttons.find((button) => button.textContent === 'Cancel')!;
    expect(document.activeElement).toBe(folder);

    cancel.focus();
    await press(cancel, 'Tab');
    expect(document.activeElement).toBe(folder);
    await press(folder, 'Tab', true);
    expect(document.activeElement).toBe(cancel);

    await press(dialog, 'Escape');
    expect(document.querySelector('.import-choice-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes with Cancel and restores the original trigger', async () => {
    installDom();
    const trigger = document.getElementById('trigger') as HTMLButtonElement;
    const cancelled = vi.fn();
    trigger.focus();
    await render(<ChoiceHarness busy={false} onCancel={cancelled} />);
    const cancel = [...document.querySelectorAll('.import-choice-dialog button')].find((button) => button.textContent === 'Cancel')! as HTMLButtonElement;
    await act(async () => { cancel.click(); });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.import-choice-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('uses the dialog itself as the only busy focus fallback and blocks dismissal', async () => {
    installDom();
    const cancelled = vi.fn();
    await render(<ChoiceHarness busy folderAvailable={false} onCancel={cancelled} />);
    const dialog = document.querySelector('.import-choice-dialog') as HTMLElement;
    const controls = [...dialog.querySelectorAll('button')];
    expect(document.activeElement).toBe(dialog);
    expect(controls.every((control) => (control as HTMLButtonElement).disabled)).toBe(true);
    await press(dialog, 'Tab');
    expect(document.activeElement).toBe(dialog);
    await press(dialog, 'Escape');
    expect(cancelled).not.toHaveBeenCalled();
    expect(document.querySelector('.import-choice-dialog')).not.toBeNull();
  });

  it('keeps a Markdown submission failure inside the open dialog and retries it', async () => {
    installDom();
    const retry = vi.fn();
    await render(<MarkdownFailureHarness onRetry={retry} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ name: 'failed.md', text: async () => '# Failed' }] });
    await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    const submit = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === 'Import file')! as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => { submit.click(); });
    const alert = document.querySelector('[role="alert"]')!;
    const retryButton = [...alert.querySelectorAll('button')].find((button) => button.textContent === 'Retry import')!;
    expect(alert.textContent).toContain('Could not save the imported scene.');
    await act(async () => { retryButton.click(); });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('disables every Markdown import control while busy and announces progress', async () => {
    installDom();
    const retry = vi.fn();
    const cancelled = vi.fn();
    await render(<MarkdownImportDialog defaultTarget="scene" canImportScene canImportChapter busy error="Previous failure" onCancel={cancelled} onRetry={retry} onSubmit={() => undefined} />);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true);
    expect([...document.querySelectorAll('input[type="radio"]')].every((input) => (input as HTMLInputElement).disabled)).toBe(true);
    expect([...dialog.querySelectorAll('button')].every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Importing Markdown locally');
    const retryButton = [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Retry import')!;
    await act(async () => { retryButton.click(); });
    expect(retry).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
  });
});
