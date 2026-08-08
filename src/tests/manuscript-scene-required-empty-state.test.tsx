// @vitest-environment jsdom
//
// Regression coverage for gating the Manuscript workspace's writing
// "paper"/editor on an actual selected scene existing. Before this change,
// a chapter with zero scenes (or no chapter/story selected at all) still
// rendered a fully editable, but unbacked, empty paper: `documentHead` was
// `undefined` in that state, so anything typed there was silently
// discarded on save (`saveCurrentDocument()` bails out whenever
// `documentHead` is missing) - a phantom writing surface with nowhere to
// save. This suite asserts the new empty/prompt state replaces that paper
// until a scene is actually selected, and that the real editor still
// renders normally once one exists.
//
// Follows the same real-DOM rendering setup as
// src/tests/manuscript-scene-chapter-autosave-flush.test.tsx (see that
// file's header comment for why the @vitest-environment directive has to
// come first, and why real DOM instead of the shared jsdom environment).
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

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function findButton(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === text) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`No button with text "${text}" found`);
  return button;
}

function addChapterButton(): HTMLButtonElement {
  const button = document.querySelector('button[aria-label="New chapter"]') as HTMLButtonElement | null;
  if (!button) throw new Error('No "New chapter" button found');
  return button;
}

function manuscriptWorkspace(): HTMLElement {
  const main = document.getElementById('manuscript-workspace');
  if (!main) throw new Error('Manuscript workspace not rendered');
  return main;
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

describe('Manuscript workspace requires a scene before showing the editor', () => {
  it('shows an empty/prompt state instead of the editor when a chapter has no scenes yet', async () => {
    installDom();
    await render(<App />);
    await settle();

    await click(findButton('Create project'));
    await click(findButton('Continue'));
    await click(findButton('Open manuscript'));
    await click(findButton('+ New story'));
    await click(findButton('Continue'));
    await click(addChapterButton());

    const workspace = manuscriptWorkspace();
    expect(workspace.querySelector('textarea.manuscript-input')).toBeNull();
    expect(workspace.querySelector('.manuscript-scene-empty')).not.toBeNull();
    expect(workspace.textContent).toContain('This chapter has no scenes yet. Create one to start writing.');
    expect(workspace.querySelector('.editor-footer')).toBeNull();
  });

  it('renders the writing editor as soon as a scene is created and selected', async () => {
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

    const workspace = manuscriptWorkspace();
    expect(workspace.querySelector('.manuscript-scene-empty')).toBeNull();
    expect(workspace.querySelector('textarea.manuscript-input')).not.toBeNull();
    expect(workspace.querySelector('.editor-footer')).not.toBeNull();
  });

  it('guides toward creating a chapter first when no chapter is selected yet', async () => {
    installDom();
    await render(<App />);
    await settle();

    await click(findButton('Create project'));
    await click(findButton('Continue'));
    await click(findButton('Open manuscript'));
    await click(findButton('+ New story'));
    await click(findButton('Continue'));

    const workspace = manuscriptWorkspace();
    expect(workspace.querySelector('textarea.manuscript-input')).toBeNull();
    expect(workspace.querySelector('.manuscript-scene-empty')).not.toBeNull();
    expect(workspace.textContent).toContain('Choose or create a chapter, then add a scene to start writing.');
  });
});
