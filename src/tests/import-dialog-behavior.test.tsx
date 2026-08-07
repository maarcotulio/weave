// @vitest-environment jsdom
//
// This file is the only one in the suite that does real DOM rendering, so it
// manages its own per-test JSDOM instance below (installDom) rather than
// relying on vitest's shared environment globals. But react-dom decides
// once, at module import time, whether the runtime supports real 'input'
// events (see react-dom's `canUseDOM`/`isInputEventSupported`) - and without
// the directive above, this file's default 'node' test environment has no
// `window`/`document` yet when the static `react-dom/client` import below
// runs, so that one-time detection freezes as "unsupported" and react-dom
// falls back to a legacy IE input-event polyfill for every text input in
// this file, which then throws (`attachEvent` doesn't exist in jsdom) and
// silently swallows real typing. The directive makes vitest set up a global
// jsdom before any import in this file runs, so that detection sees a real
// DOM and computes correctly, once, for the whole file.
import React, { useMemo, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nativeDialog = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock('../app/Worldbuilding', () => ({
  WorldbuildingWorkspace: () => null,
  worldbuildingTabKey: (tab: { kind: string; id: string }) => `${tab.kind}:${tab.id}`
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: nativeDialog.open }));

import { ImportChoiceDialog } from '../app/ImportChoiceDialog';
import { FormDialog, MarkdownImportDialog, type FormDialogConfig } from '../app/App';

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

/** React tracks the native value setter to detect real changes; assigning
 * `input.value` directly bypasses that tracker, so a plain `input` event
 * dispatch afterward is silently dropped by React's onChange. Going through
 * the native setter first (the standard workaround for simulating typing
 * without a testing-library `fireEvent`) keeps the tracker in sync so the
 * dispatched event actually reaches the component's onChange handler. */
function typeInto(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(dom!.window.HTMLInputElement.prototype, 'value')!.set!;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

function ProjectFormHarness({ desktop, onSubmit, onPickerRetry, onCancel }: { desktop: boolean; onSubmit: (values: Record<string, string>) => void; onPickerRetry: () => void; onCancel: () => void }) {
  const [error, setError] = useState<string>();
  const config = useMemo<FormDialogConfig>(() => ({
    eyebrow: 'PROJECT', title: desktop ? 'Desktop project' : 'Web project',
    fields: [{ key: 'directory', label: 'Project directory', value: '/tmp/project', readOnly: desktop }],
    onSubmit: async () => undefined,
    ...(desktop ? { retryLabel: 'Choose another folder', onRetry: onPickerRetry } : { retryOnSubmit: true })
  }), [desktop, onPickerRetry]);
  return <FormDialog config={config} busy={false} error={error} onCancel={onCancel} onSubmit={(values) => { onSubmit(values); setError('Project save failed'); }} />;
}

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  dom?.window.close();
  dom = undefined;
  root = undefined;
  nativeDialog.open.mockReset();
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

  it('retries web project errors with the editable form and never opens the native picker', async () => {
    installDom();
    const submitted = vi.fn();
    await render(<ProjectFormHarness desktop={false} onSubmit={submitted} onPickerRetry={vi.fn()} onCancel={vi.fn()} />);
    const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    await act(async () => { typeInto(input, '/tmp/edited-project'); });
    const submit = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === 'Continue')! as HTMLButtonElement;
    await act(async () => { submit.click(); });
    const retry = [...document.querySelectorAll('[role="alert"] button')].find((button) => button.textContent === 'Retry')! as HTMLButtonElement;
    await act(async () => { retry.click(); });
    expect(submitted).toHaveBeenNthCalledWith(1, { directory: '/tmp/edited-project' });
    expect(submitted).toHaveBeenNthCalledWith(2, { directory: '/tmp/edited-project' });
    expect(nativeDialog.open).not.toHaveBeenCalled();
  });

  it('uses a desktop picker retry instead of resubmitting and allows cancellation', async () => {
    installDom();
    const submitted = vi.fn();
    const pickerRetry = vi.fn();
    const cancelled = vi.fn();
    await render(<ProjectFormHarness desktop onSubmit={submitted} onPickerRetry={pickerRetry} onCancel={cancelled} />);
    const submit = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === 'Continue')! as HTMLButtonElement;
    await act(async () => { submit.click(); });
    const retry = [...document.querySelectorAll('[role="alert"] button')].find((button) => button.textContent === 'Choose another folder')! as HTMLButtonElement;
    await act(async () => { retry.click(); });
    const cancel = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === 'Cancel')! as HTMLButtonElement;
    await act(async () => { cancel.click(); });
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(pickerRetry).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
