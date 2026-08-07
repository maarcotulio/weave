// @vitest-environment jsdom
//
// Real-DOM regression test for the "+ New scene"/"+ New chapter" data-loss
// bug: typing into a scene starts the 700ms autosave debounce, and clicking
// either "+" button used to swap the active selection *before* flushing that
// pending save, so the in-flight text was silently discarded when the
// scene-document-loading effect reloaded from the (unsaved) repository.
//
// This follows the same real-rendering setup as
// src/tests/import-dialog-behavior.test.tsx (the only other file in this
// suite that renders real DOM instead of using vitest's shared jsdom
// environment) - see that file's header comment for why the
// @vitest-environment directive has to come first.
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../app/Worldbuilding', () => ({
  WorldbuildingWorkspace: () => null,
  worldbuildingTabKey: (tab: { kind: string; id: string }) => `${tab.kind}:${tab.id}`
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import App from '../app/App';

let dom: JSDOM | undefined;
let root: Root | undefined;

function installDom() {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
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

/** Lets any real (non-fake) timers/microtasks queued by an in-flight
 * `run(async () => ...)` handler settle before the next assertion or
 * interaction - the click handlers in App.tsx are fire-and-forget
 * (`onClick={() => void run(...)}`), so nothing else awaits their promise
 * chain directly. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/** React tracks the native value setter to detect real changes; assigning
 * `element.value` directly bypasses that tracker, so a plain `input` event
 * dispatch afterward is silently dropped by React's onChange. Going through
 * the native setter first (the standard workaround for simulating typing
 * without a testing-library `fireEvent`) keeps the tracker in sync so the
 * dispatched event actually reaches the component's onChange handler. */
function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(dom!.window.HTMLTextAreaElement.prototype, 'value')!.set!;
  nativeSetter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButton(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === text) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`No button with text "${text}" found`);
  return button;
}

/** The sidebar's "+" chapter control (aria-label "New chapter") calls the
 * exact same `addChapter` handler as the in-row "+ New chapter" button that
 * only appears once a chapter already exists - using the aria-label lookup
 * works whether or not a chapter exists yet, so it covers both the very
 * first chapter and every one after it. */
function addChapterButton(): HTMLButtonElement {
  const button = document.querySelector('button[aria-label="New chapter"]') as HTMLButtonElement | null;
  if (!button) throw new Error('No "New chapter" button found');
  return button;
}

function firstBlockTextarea(): HTMLTextAreaElement {
  const textarea = document.querySelector('textarea.manuscript-input') as HTMLTextAreaElement | null;
  if (!textarea) throw new Error('No manuscript editor textarea found');
  return textarea;
}

async function click(button: HTMLButtonElement) {
  await act(async () => { button.click(); });
  await settle();
}

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  dom?.window.close();
  dom = undefined;
  root = undefined;
});

describe('manuscript autosave flush on "+ New scene"/"+ New chapter"', () => {
  it('keeps unsaved scene text when immediately clicking "+ New scene"', async () => {
    installDom();
    await render(<App />);
    await settle();

    await click(findButton('Create project'));
    await click(findButton('Continue'));
    await click(findButton('Open manuscript'));
    await click(findButton('+ New story'));
    await click(findButton('Continue'));

    // Chapter is auto-selected as soon as it exists; create it, then the
    // first scene, so there is a scene document open in the editor.
    await click(addChapterButton());
    await click(findButton('+ New scene'));

    const firstSceneTextarea = firstBlockTextarea();
    expect(firstSceneTextarea).toBeTruthy();

    const message = 'Unsaved words that must survive';
    await act(async () => { typeInto(firstSceneTextarea, message); });
    // No settle() here - this must happen well inside the 700ms autosave
    // debounce window, before AutosaveController's timer fires.

    // Immediately create a second scene, exactly reproducing the reported
    // bug: this used to swap `selectedSceneId` without flushing first.
    const addSceneButton = findButton('+ New scene');
    await act(async () => { addSceneButton.click(); });
    await settle();

    // Switch back to the first scene and confirm the typed text survived.
    const firstSceneRow = [...document.querySelectorAll('.tree-item.scene')].find((el) => el.textContent?.includes('01'))! as HTMLButtonElement;
    await click(firstSceneRow);

    expect(firstBlockTextarea().value).toBe(message);
  });

  it('keeps unsaved scene text when immediately clicking "+ New chapter"', async () => {
    installDom();
    await render(<App />);
    await settle();

    await click(findButton('Create project'));
    await click(findButton('Continue'));
    await click(findButton('Open manuscript'));
    await click(findButton('+ New story'));
    await click(findButton('Continue'));

    await click(addChapterButton());
    await click(findButton('+ New scene'));

    const sceneTextarea = firstBlockTextarea();
    const message = 'Chapter-adjacent unsaved words that must survive';
    await act(async () => { typeInto(sceneTextarea, message); });
    // Again, no settle() here - stay inside the debounce window.

    const chapterButton = addChapterButton();
    await act(async () => { chapterButton.click(); });
    await settle();

    // Switch back to the original (first) scene explicitly and confirm the
    // typed text survived.
    const firstSceneRow = [...document.querySelectorAll('.tree-item.scene')].find((el) => el.textContent?.includes('01'))! as HTMLButtonElement;
    await click(firstSceneRow);

    expect(firstBlockTextarea().value).toBe(message);
  });
});
