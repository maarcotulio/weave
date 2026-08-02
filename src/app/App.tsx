import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { CircleHelp, Maximize2, Minimize2 } from 'lucide-react';
import { AutosaveController, type AutosaveStatus } from '../domain/autosave';
import { blockText, documentFromText, replaceBlockText, toggleMarks } from '../domain/document';
import { DEFAULT_EDITOR_STYLE, FONT_FAMILY_OPTIONS, FONT_SIZE_OPTIONS, LINE_SPACING_OPTIONS, PAGE_SIZE_OPTIONS, type BackupRecord, type CanvasEngine, type Chapter, type ContinuousDraft, type EditorStyleProfile, type ExportFormat, type IntegrityReport, type ManuscriptVersionChange, type ManuscriptVersionComparison, type ManuscriptVersionDetail, type ManuscriptVersionSummary, type MarkdownNote, type ProjectSnapshot, type Scene, type StoryCanvas, type SemanticMark, type StructuredDocument, type WritingStats } from '../domain/types';
import { canonicalOffsetToPage, effectiveTextMargins, mergePaginatedDocument, pageDimensions, pageOffsetToCanonical, paginateDocumentWithSources, type PaginatedBlock, type PaginatedPage } from '../domain/pagination';
import { InMemoryProjectRepository, type DocumentHead, type ProjectRepository } from '../domain/repository';
import { exportCapturedRevision } from '../export/editorial';
import { TauriProjectRepository } from '../infrastructure/tauri-repository';
import { WorldbuildingWorkspace, type WorldbuildingTab, worldbuildingTabKey } from './Worldbuilding';
import { applyTheme, persistTheme, readStoredTheme, toggleTheme, type Theme } from './theme';
import { canDismissWithEscape, firstEnabledFocusIndex, trappedFocusIndex } from '../domain/modal-focus';
import { manuscriptDeleteImpact } from '../domain/manuscript-lifecycle';
import { documentText } from '../domain/manuscript-versions';
import { readRecentProjects, rememberRecentProject, removeRecentProject, validateProjectDirectory, type RecentProject } from '../domain/recent-projects';
import { HomePage } from './Home';
import { SettingsPage } from './Settings';
import { UiKit } from './UiKit';
import { ManuscriptOutline } from './ManuscriptOutline';
import { ProjectSearch } from './ProjectSearch';
import type { SearchTarget } from '../domain/manuscript-search';

const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const formats: ExportFormat[] = ['pdf', 'docx', 'markdown', 'text'];
const lineHeight: Record<EditorStyleProfile['lineSpacing'], number> = { single: 1, '1.15': 1.15, '1.5': 1.5, double: 2 };
type FocusTrigger = HTMLElement | null | undefined;
type NoteActionState =
  | { kind: 'rename'; noteId: string; title: string; trigger?: FocusTrigger }
  | { kind: 'delete'; noteId: string; title: string; phase: 'confirm' | 'references'; referenceMessage?: string; trigger?: FocusTrigger };
type CanvasActionState =
  | { kind: 'rename'; canvasId: string; title: string; trigger?: FocusTrigger }
  | { kind: 'delete'; canvasId: string; title: string; trigger?: FocusTrigger; error?: string };
type ManuscriptDeleteKind = 'story' | 'chapter' | 'scene';
interface ManuscriptDeleteState { kind: ManuscriptDeleteKind; id: string; title: string; childCount: number; error?: string; trigger?: FocusTrigger; }
interface ReturnChoicesState { trigger?: FocusTrigger; }
type ManuscriptVersionDialogState =
  | { kind: 'help' | 'save' | 'history'; trigger?: FocusTrigger }
  | { kind: 'detail'; detail: ManuscriptVersionDetail; trigger?: FocusTrigger }
  | { kind: 'comparison'; comparison: ManuscriptVersionComparison; trigger?: FocusTrigger };
interface RestoreVersionState { summary: ManuscriptVersionSummary; trigger?: FocusTrigger; error?: string; }

function captureFocusTrigger(): FocusTrigger {
  return typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
}

const focusableSelector = 'button, input, select, textarea, a[href], [contenteditable="true"], [tabindex]';
function dialogFocusable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true');
}

function initialDocument(): StructuredDocument { return documentFromText(''); }

type AppRoute = 'home' | 'manuscript' | 'outline' | 'worldbuilding' | 'settings' | 'ui';
function routeFromHash(): AppRoute {
  if (typeof window === 'undefined') return 'home';
  const value = (window.location.hash.replace(/^#\/?/, '') || window.location.pathname.split('/').filter(Boolean).at(-1) || '').toLowerCase();
  return value === 'manuscript' || value === 'outline' || value === 'worldbuilding' || value === 'settings' || value === 'ui' ? value : 'home';
}

function Toast({ message, tone = 'success', onDismiss }: { message: string; tone?: 'success' | 'error'; onDismiss: () => void }) {
  return <div className={`toast toast-${tone}`} role="status" aria-live="polite"><span className="toast-mark" aria-hidden="true">{tone === 'success' ? '✓' : '!'}</span><span>{message}</span><button type="button" aria-label="Dismiss notification" onClick={onDismiss}>×</button></div>;
}

function StatusBar({ status }: { status: AutosaveStatus }) {
  return <div className={`status status-${status.state}`} role="status"><span className="status-dot" />{status.message}</div>;
}

function ThemeControl({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const nextTheme = toggleTheme(theme);
  return <button type="button" className="theme-toggle" aria-label={`Switch to ${nextTheme} theme`} aria-pressed={theme === 'dark'} title={`Theme: ${theme}. Switch to ${nextTheme} theme`} onClick={onToggle}>
    <span aria-hidden="true">{theme === 'dark' ? '☀' : '◐'}</span><span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
  </button>;
}

function StyleControls({ profile, onChange, disabled, focusMode, onToggleFocus }: { profile: EditorStyleProfile; onChange: (profile: EditorStyleProfile) => void; disabled?: boolean; focusMode?: boolean; onToggleFocus?: () => void }) {
  return <div className="style-controls" aria-label="Writing style controls">
    <label>Font<select aria-label="Font family" value={profile.fontFamily} disabled={disabled} onChange={(event) => onChange({ ...profile, fontFamily: event.target.value })}>{FONT_FAMILY_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}</select></label>
    <label>Size<select aria-label="Font size" value={profile.fontSizePt} disabled={disabled} onChange={(event) => onChange({ ...profile, fontSizePt: Number(event.target.value) })}>{FONT_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} pt</option>)}</select></label>
    <label>Spacing<select aria-label="Line spacing" value={profile.lineSpacing} disabled={disabled} onChange={(event) => onChange({ ...profile, lineSpacing: event.target.value as EditorStyleProfile['lineSpacing'] })}>{LINE_SPACING_OPTIONS.map((spacing) => <option key={spacing} value={spacing}>{spacing === '1.15' ? '1.15' : spacing === '1.5' ? '1.5' : spacing[0].toUpperCase() + spacing.slice(1)}</option>)}</select></label>
    <label>Page<select aria-label="Page size" value={profile.pageSize ?? 'letter'} disabled={disabled} onChange={(event) => onChange({ ...profile, pageSize: event.target.value as NonNullable<EditorStyleProfile['pageSize']> })}>{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size === 'a4' ? 'A4' : size === 'legal' ? 'US Legal' : 'US Letter'}</option>)}</select></label>
    {onToggleFocus && <button type="button" className="focus-toggle" aria-label={focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode'} title={focusMode ? 'Exit Focus Mode' : 'Focus Mode'} aria-pressed={focusMode} disabled={disabled} onClick={onToggleFocus}>{focusMode ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}</button>}
  </div>;
}

type SelectionDirection = 'forward' | 'backward' | 'none';
interface SelectionInfo { start: number; end: number; direction: SelectionDirection; focused: boolean; }
interface CanonicalSelection { sourceBlockId: string; start: number; end: number; startAffinity: 'forward' | 'backward'; endAffinity: 'forward' | 'backward'; direction: SelectionDirection; }

function AutoSizeTextArea({ value, onChange, onSelectionChange, readOnly, className, ariaLabel, pageBlockId, sourceBlockId }: { value: string; onChange: (value: string, selection: SelectionInfo) => void; onSelectionChange?: (selection: SelectionInfo) => void; readOnly: boolean; className: string; ariaLabel?: string; pageBlockId: string; sourceBlockId: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const reportSelection = (focused: boolean) => {
    const element = ref.current;
    if (!element) return;
    onSelectionChange?.({ start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, focused });
  };
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} data-page-block-id={pageBlockId} data-source-block-id={sourceBlockId} className={className} aria-label={ariaLabel} value={value} readOnly={readOnly} rows={1} onChange={(event) => { const element = event.currentTarget; onChange(element.value, { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, focused: true }); }} onSelect={() => reportSelection(true)} onKeyUp={() => reportSelection(true)} onMouseUp={() => reportSelection(true)} onBlur={() => reportSelection(false)} />;
}

function GoalPanel({ stats, onSaveTarget }: { stats: WritingStats; onSaveTarget: (target: number) => void }) {
  const [target, setTarget] = useState(String(stats.dailyTarget));
  useEffect(() => setTarget(String(stats.dailyTarget)), [stats.dailyTarget]);
  const progress = stats.dailyTarget > 0 ? Math.min(100, Math.round((stats.dailyWords / stats.dailyTarget) * 100)) : 0;
  return <section className="goal-panel" aria-label="Writing goals">
    <div className="goal-stat"><span className="goal-label">TODAY · {stats.date}</span><strong>{stats.dailyWords.toLocaleString()} <small>/ {stats.dailyTarget.toLocaleString()} words</small></strong><div className="goal-track"><span style={{ width: `${progress}%` }} /></div></div>
    <div className="goal-stat project-total"><span className="goal-label">PROJECT TOTAL</span><strong>{stats.projectWords.toLocaleString()} <small>words</small></strong></div>
    <label className="goal-editor">Daily target<input type="number" min="0" step="1" value={target} onChange={(event) => setTarget(event.target.value)} onBlur={() => onSaveTarget(Math.max(0, Number(target) || 0))} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } }} /></label>
  </section>;
}

function Editor({ document, styleProfile, onChange, onSelectionChange, readOnly = false }: { document: StructuredDocument; styleProfile: EditorStyleProfile; onChange: (value: StructuredDocument) => void; onSelectionChange?: (block: StructuredDocument['blocks'][number], selection: SelectionInfo) => void; readOnly?: boolean }) {
  const updateBlock = (index: number, value: StructuredDocument['blocks'][number], selection?: SelectionInfo) => {
    const blocks = document.blocks.map((block, blockIndex) => blockIndex === index ? value : block);
    onChange({ ...document, blocks });
    if (selection) onSelectionChange?.(value, selection);
  };
  const style = { '--editor-font-family': styleProfile.fontFamily, '--editor-font-size': `${styleProfile.fontSizePt}pt`, '--editor-line-height': lineHeight[styleProfile.lineSpacing] } as React.CSSProperties;
  return <div className="editor" style={style} aria-label={readOnly ? 'Composed chapter' : 'Manuscript editor'}>
    {document.blocks.map((block, index) => block.kind === 'scene-break' ?
      <div className="scene-break" key={block.id}><span>scene break · composed view</span></div> :
      <div className="block" key={block.id}>
        <div className="block-tools">
          <select aria-label="Block style" value={block.kind === 'heading' ? `heading-${block.headingLevel ?? 1}` : 'paragraph'} disabled={readOnly} onChange={(event) => {
            const value = event.target.value;
            updateBlock(index, { ...block, kind: value === 'paragraph' ? 'paragraph' : 'heading', headingLevel: value === 'paragraph' ? undefined : Number(value.split('-')[1]) as 1 | 2 | 3 });
          }}>
            <option value="paragraph">Paragraph</option><option value="heading-1">Heading 1</option><option value="heading-2">Heading 2</option><option value="heading-3">Heading 3</option>
          </select>
          {(['bold', 'italic', 'underline'] as SemanticMark[]).map((mark) => <button type="button" key={mark} className="format-button" disabled={readOnly} onClick={() => updateBlock(index, toggleMarks(block, [mark]))} aria-label={`Toggle ${mark}`}><strong className={mark === 'italic' ? 'italic' : mark === 'underline' ? 'underline' : ''}>{mark[0].toUpperCase()}</strong></button>)}
        </div>
        <AutoSizeTextArea className={block.kind === 'heading' ? 'manuscript-input heading-input' : 'manuscript-input'} value={blockText(block)} readOnly={readOnly} onChange={(value, selection) => updateBlock(index, replaceBlockText(block, value), selection)} onSelectionChange={(selection) => onSelectionChange?.(block, selection)} ariaLabel={`Block ${index + 1}`} pageBlockId={block.id} sourceBlockId={(block as PaginatedBlock).pagination?.sourceBlockId ?? block.id} />
      </div>)}
    {document.blocks.length === 0 && <p className="empty-editor">Start writing…</p>}
  </div>;
}

interface ModalProps { eyebrow?: string; title: string; onClose?: () => void; closeDisabled?: boolean; busy?: boolean; trigger?: FocusTrigger; descriptionId?: string; children: React.ReactNode; footer?: React.ReactNode; }

function Modal({ eyebrow, title, onClose, closeDisabled = false, busy = false, trigger, descriptionId, children, footer }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;
  useEffect(() => {
    const previous = trigger;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (canDismissWithEscape(event.key, closeDisabledRef.current) && onCloseRef.current) { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogFocusable(dialogRef.current);
      if (!focusable.length) { event.preventDefault(); return; }
      const nextIndex = trappedFocusIndex({ currentIndex: focusable.indexOf(document.activeElement as HTMLElement), controlCount: focusable.length, shiftKey: event.shiftKey });
      if (nextIndex === undefined) return;
      event.preventDefault(); focusable[nextIndex]?.focus();
    };
    document.addEventListener('keydown', closeOnEscape);
    const focusable = dialogRef.current ? dialogFocusable(dialogRef.current) : [];
    if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) focusable[0]?.focus();
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (previous?.isConnected) previous.focus();
    };
  }, [trigger]);
  return <div className="modal-backdrop"><div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
    <div className="modal-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id={titleId}>{title}</h2>{onClose && <button type="button" className="modal-close" aria-label="Close dialog" disabled={closeDisabled} onClick={onClose}>×</button>}</div>
    <div className="modal-content">{children}</div>
    {footer && <div className="modal-actions">{footer}</div>}
  </div></div>;
}

function VersionHelpDialog({ busy, onCancel, trigger }: { busy: boolean; onCancel: () => void; trigger?: FocusTrigger }) {
  return <Modal eyebrow="MANUSCRIPT VERSIONS" title="Why save versions?" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="manuscript-version-help-description">
    <p id="manuscript-version-help-description">A saved version is an immutable local snapshot of the manuscript at a specific moment. It includes stories, chapters, scenes, continuous drafts, and their structured documents.</p>
    <p>Use versions to mark milestones, compare progress over time, or keep a dated record of your authorship process. Markdown notes, canvases, and presentation settings are intentionally excluded.</p>
    <p className="modal-help">These records are local evidence of your writing history; they are not a legal authorship certificate.</p>
    <div className="modal-actions"><button type="button" className="primary-button" disabled={busy} onClick={onCancel}>Got it</button></div>
  </Modal>;
}

function VersionSaveDialog({ busy, onCancel, onSubmit, trigger }: { busy: boolean; onCancel: () => void; onSubmit: (label: string) => void; trigger?: FocusTrigger }) {
  const [label, setLabel] = useState('');
  return <Modal eyebrow="MANUSCRIPT VERSIONS" title="Save a manuscript version" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="manuscript-version-save-description">
    <p id="manuscript-version-save-description">Give this milestone a memorable label. Weave will save the current manuscript locally with a timestamp.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (label.trim()) onSubmit(label.trim()); }}>
      <label className="modal-field">Version label<input autoFocus required maxLength={160} placeholder="First complete draft" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !label.trim()}>Save version</button></div>
    </form>
  </Modal>;
}

function VersionHistoryDialog({ versions, busy, onCancel, onInspect, onCompare, onRestore, trigger }: { versions: ManuscriptVersionSummary[]; busy: boolean; onCancel: () => void; onInspect: (version: ManuscriptVersionSummary) => void; onCompare: (from: ManuscriptVersionSummary, to: ManuscriptVersionSummary) => void; onRestore: (version: ManuscriptVersionSummary) => void; trigger?: FocusTrigger }) {
  const [fromId, setFromId] = useState(versions[1]?.id ?? versions[0]?.id ?? '');
  const [toId, setToId] = useState(versions[0]?.id ?? '');
  const from = versions.find((version) => version.id === fromId);
  const to = versions.find((version) => version.id === toId);
  return <Modal eyebrow="MANUSCRIPT VERSIONS" title="Saved manuscript versions" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="manuscript-version-history-description">
    <p id="manuscript-version-history-description">Each entry is a local, immutable manuscript snapshot. Notes and canvases are not part of these versions.</p>
    {versions.length === 0 ? <p className="version-empty">No manuscript versions saved yet.</p> : <>
      <div className="version-compare-picker"><label>Compare from<select aria-label="Older version" value={fromId} onChange={(event) => setFromId(event.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}</select></label><label>Compare to<select aria-label="Newer version" value={toId} onChange={(event) => setToId(event.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}</select></label><button type="button" className="secondary-button" disabled={busy || !from || !to || from.id === to.id} onClick={() => from && to && onCompare(from, to)}>Compare</button></div>
      <div className="version-history-list">{versions.map((version) => <article className="version-history-item" key={version.id}><div><strong>{version.label}</strong><span>{new Date(version.createdAt).toLocaleString()}</span></div><small>{version.wordCount.toLocaleString()} words · {version.chapterCount} chapters · {version.sceneCount} scenes</small><div className="version-item-actions"><button type="button" className="text-button" disabled={busy} onClick={() => onInspect(version)}>Details</button><button type="button" className="text-button" disabled={busy} onClick={() => onRestore(version)}>Restore</button></div></article>)}</div>
    </>}
    <div className="modal-actions"><button type="button" className="primary-button" disabled={busy} onClick={onCancel}>Close</button></div>
  </Modal>;
}

function VersionDetailDialog({ detail, busy, onCancel, onCompare, onRestore, trigger }: { detail: ManuscriptVersionDetail; busy: boolean; onCancel: () => void; onCompare: (version: ManuscriptVersionSummary) => void; onRestore: (version: ManuscriptVersionSummary) => void; trigger?: FocusTrigger }) {
  const { snapshot, summary } = detail;
  return <Modal eyebrow="MANUSCRIPT VERSION DETAIL" title={summary.label} onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="manuscript-version-detail-description">
    <p id="manuscript-version-detail-description">Saved {new Date(summary.createdAt).toLocaleString()} · {summary.wordCount.toLocaleString()} words · {summary.chapterCount} chapters · {summary.sceneCount} scenes.</p>
    <p className="modal-help">This detail view contains only stories, chapters, scenes, continuous drafts, and structured manuscript documents.</p>
    <div className="version-detail-stats"><span>{snapshot.stories.length} stories</span><span>{snapshot.chapters.length} chapters</span><span>{snapshot.scenes.length} scenes</span><span>{snapshot.documents.length} documents</span></div>
    <ul className="version-detail-list">{snapshot.stories.map((story) => <li key={story.id}><strong>{story.title}</strong><span>{snapshot.chapters.filter((chapter) => chapter.storyId === story.id).map((chapter) => chapter.title).join(' · ') || 'No chapters'}</span></li>)}</ul>
    <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={() => onCompare(summary)}>Compare with another</button><button type="button" className="danger-button" disabled={busy} onClick={() => onRestore(summary)}>Restore this version</button><button type="button" className="primary-button" disabled={busy} onClick={onCancel}>Close</button></div>
  </Modal>;
}

function VersionComparisonDialog({ comparison, busy, onCancel, trigger }: { comparison: ManuscriptVersionComparison; busy: boolean; onCancel: () => void; trigger?: FocusTrigger }) {
  const label = (change: ManuscriptVersionChange) => change.change === 'changed' ? `${change.beforeLabel ?? change.label ?? change.id} → ${change.afterLabel ?? change.label ?? change.id}` : change.label ?? change.id;
  return <Modal eyebrow="MANUSCRIPT VERSION COMPARISON" title="Compare saved versions" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="manuscript-version-comparison-description">
    <p id="manuscript-version-comparison-description"><strong>{comparison.from.label}</strong> → <strong>{comparison.to.label}</strong>. Only manuscript records are compared.</p>
    {comparison.changes.length === 0 ? <p className="version-empty">These snapshots contain no manuscript changes.</p> : <div className="version-comparison-list">{comparison.changes.map((change) => <article key={`${change.kind}-${change.id}`}><span className={`change-${change.change}`}>{change.change}</span><strong>{change.kind}</strong><span>{label(change)}</span>{change.kind === 'document' && (change.beforeDocument || change.afterDocument) && <small>{documentText(change.beforeDocument) || '∅'} → {documentText(change.afterDocument) || '∅'}</small>}</article>)}</div>}
    <div className="modal-actions"><button type="button" className="primary-button" disabled={busy} onClick={onCancel}>Close</button></div>
  </Modal>;
}

function RestoreVersionDialog({ item, busy, onCancel, onConfirm, trigger }: { item: RestoreVersionState; busy: boolean; onCancel: () => void; onConfirm: () => void; trigger?: FocusTrigger }) {
  const [confirmation, setConfirmation] = useState('');
  const ready = confirmation.trim() === 'RESTORE';
  return <Modal eyebrow="DESTRUCTIVE MANUSCRIPT ACTION" title={`Restore “${item.summary.label}”?`} onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="manuscript-version-restore-description">
    <p id="manuscript-version-restore-description">This replaces the current stories, chapters, scenes, continuous drafts, and structured manuscript documents. Weave will create a local backup before replacement.</p>
    <p className="modal-warning"><strong>Notes, Markdown notes, canvases, Worldbuilding, settings, and writing goals are not changed.</strong> Any unsaved manuscript edits must be saved or cancelled first.</p>
    {item.error && <p className="error-message" role="alert">{item.error}</p>}
    <label className="modal-field">Type <code>RESTORE</code> to confirm<input autoFocus aria-label="Type RESTORE to confirm manuscript restore" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
    <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="danger-button" disabled={busy || !ready} onClick={onConfirm}>Restore version</button></div>
  </Modal>;
}

interface FormDialogConfig { eyebrow: string; title: string; fields: Array<{ key: string; label: string; value: string; placeholder?: string; type?: 'text' | 'number' }>; onSubmit: (values: Record<string, string>) => Promise<void>; trigger?: FocusTrigger; }

function FormDialog({ config, busy, onCancel, onSubmit }: { config: FormDialogConfig; busy: boolean; onCancel: () => void; onSubmit: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(config.fields.map((field) => [field.key, field.value])));
  return <Modal eyebrow={config.eyebrow} title={config.title} onClose={onCancel} closeDisabled={busy} busy={busy} trigger={config.trigger}>
    <form onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
      {config.fields.map((field) => <label className="modal-field" key={field.key}>{field.label}<input autoFocus={field.key === config.fields[0]?.key} type={field.type ?? 'text'} value={values[field.key] ?? ''} placeholder={field.placeholder} required onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>Continue</button></div>
    </form>
  </Modal>;
}

function ChoiceDialog({ onSplit, onKeep, onCancel, busy, trigger }: { onSplit: () => void; onKeep: () => void; onCancel: () => void; busy: boolean; trigger?: FocusTrigger }) {
  return <Modal eyebrow="RETURN TO SCENES" title="What should happen to this continuous draft?" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger}>
    <p>Weave never guesses scene boundaries. Choose an explicit-marker split or keep this revision separate and recoverable.</p>
    <div className="choice-grid"><button type="button" onClick={onSplit} disabled={busy}><strong>Split automatically</strong><span>Use only paragraphs containing <code>***</code> or <code>Nova cena</code>. The old scene set stays preserved.</span></button><button type="button" onClick={onKeep} disabled={busy}><strong>Keep separate</strong><span>Leave the continuous draft and every scene document intact.</span></button></div>
    <button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button>
  </Modal>;
}

function CanvasChoiceDialog({ busy, onCancel, onSubmit, trigger }: { busy: boolean; onCancel: () => void; onSubmit: (title: string, engine: CanvasEngine) => void; trigger?: FocusTrigger }) {
  const [title, setTitle] = useState('Untitled canvas');
  const [engine, setEngine] = useState<CanvasEngine>('react-flow');
  return <Modal eyebrow="NEW CANVAS" title="Choose a canvas engine" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger}>
    <form onSubmit={(event) => { event.preventDefault(); if (title.trim()) onSubmit(title.trim(), engine); }}>
      <label className="modal-field">Canvas title<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <fieldset className="canvas-engine-choices"><legend>Canvas engine</legend><label className={engine === 'react-flow' ? 'selected' : ''}><input type="radio" name="canvas-engine" value="react-flow" checked={engine === 'react-flow'} onChange={() => setEngine('react-flow')} /><span><strong>React Flow</strong><small>Structured Markdown-note nodes, resolved wiki-link edges, and saved layout.</small></span></label><label className={engine === 'excalidraw' ? 'selected' : ''}><input type="radio" name="canvas-engine" value="excalidraw" checked={engine === 'excalidraw'} onChange={() => setEngine('excalidraw')} /><span><strong>Excalidraw</strong><small>Freeform local drawing with scene elements and files saved in this project.</small></span></label></fieldset>
      <p className="modal-help">You can cancel with Escape or the Cancel button. The choice is stored with this canvas and cannot change its engine later.</p>
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !title.trim()}>Create canvas</button></div>
    </form>
  </Modal>;
}

function NoteCreateDialog({ busy, onCancel, onSubmit, trigger }: { busy: boolean; onCancel: () => void; onSubmit: (title: string) => void; trigger?: FocusTrigger }) {
  const [value, setValue] = useState('');
  return <Modal eyebrow="NOTE" title="Create note" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger}>
    <form onSubmit={(event) => { event.preventDefault(); const title = value.trim(); if (title) onSubmit(title); }}>
      <label className="modal-field">Note name<input id="create-note-name" autoFocus required aria-label="Note name" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !value.trim()}>Create note</button></div>
    </form>
  </Modal>;
}

function NoteRenameDialog({ initialTitle, busy, onCancel, onSubmit, trigger }: { initialTitle: string; busy: boolean; onCancel: () => void; onSubmit: (title: string) => void; trigger?: FocusTrigger }) {
  const [value, setValue] = useState(initialTitle);
  useEffect(() => setValue(initialTitle), [initialTitle]);
  return <Modal eyebrow="NOTE" title="Rename note" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="rename-note-dialog-description">
    <p id="rename-note-dialog-description">Choose a new title for “{initialTitle}”. Cancel or Escape leaves the note unchanged.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
      <label className="modal-field">Note name<input autoFocus required value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !value.trim()}>Rename note</button></div>
    </form>
  </Modal>;
}

function NoteDeleteDialog({ title, phase, referenceMessage, busy, onCancel, onConfirm, trigger }: { title: string; phase: 'confirm' | 'references'; referenceMessage?: string; busy: boolean; onCancel: () => void; onConfirm: () => void; trigger?: FocusTrigger }) {
  const references = phase === 'references';
  return <Modal eyebrow="NOTE" title={references ? 'References found' : 'Delete note'} onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="delete-note-dialog-description">
    {references ? <><p id="delete-note-dialog-description"><strong>We could not delete “{title}” because it is still referenced.</strong> Deleting it with remove-references will remove its canvas placements and leave incoming Markdown links unresolved for repair. This cannot be undone.</p>{referenceMessage && <p className="modal-help">{referenceMessage}</p>}</> : <p id="delete-note-dialog-description">Are you sure you want to delete “{title}”? This permanently removes the note and its canvas placements. Cancel or Escape leaves the note unchanged.</p>}
    <div className="modal-actions"><button type="button" className="text-button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>{references ? 'Delete and remove references' : 'Delete note'}</button></div>
  </Modal>;
}

function CanvasRenameDialog({ initialTitle, busy, onCancel, onSubmit, trigger }: { initialTitle: string; busy: boolean; onCancel: () => void; onSubmit: (title: string) => void; trigger?: FocusTrigger }) {
  const [value, setValue] = useState(initialTitle);
  useEffect(() => setValue(initialTitle), [initialTitle]);
  return <Modal eyebrow="CANVAS" title="Rename canvas" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="rename-canvas-dialog-description">
    <p id="rename-canvas-dialog-description">Choose a new title for “{initialTitle}”. Canvas engine, layout, and Markdown notes remain unchanged.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
      <label className="modal-field">Canvas title<input autoFocus required value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <div className="modal-actions"><button type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !value.trim()}>Rename canvas</button></div>
    </form>
  </Modal>;
}

function CanvasDeleteDialog({ title, error, busy, onCancel, onConfirm, trigger }: { title: string; error?: string; busy: boolean; onCancel: () => void; onConfirm: () => void; trigger?: FocusTrigger }) {
  return <Modal eyebrow="CANVAS" title="Delete canvas" onClose={onCancel} closeDisabled={busy} busy={busy} trigger={trigger} descriptionId="delete-canvas-dialog-description">
    <p id="delete-canvas-dialog-description">Are you sure you want to delete “{title}”? This removes the canvas, its note placements, and edges. Markdown notes remain intact. Cancel or Escape leaves everything unchanged.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="text-button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>Delete canvas</button></div>
  </Modal>;
}

function ManuscriptDeleteDialog({ item, busy, onCancel, onConfirm }: { item: ManuscriptDeleteState; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  busyRef.current = busy;
  onCancelRef.current = onCancel;
  const [remaining, setRemaining] = useState(item.kind === 'story' ? 10 : 0);
  const titleId = `${item.kind}-delete-dialog-title`;
  const descriptionId = `${item.kind}-delete-dialog-description`;
  useEffect(() => {
    if (item.kind !== 'story') return;
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [item.kind]);
  useEffect(() => {
    const previous = item.trigger;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (canDismissWithEscape(event.key, busyRef.current)) { event.preventDefault(); onCancelRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogFocusable(dialogRef.current);
      if (!focusable.length) { event.preventDefault(); return; }
      const nextIndex = trappedFocusIndex({ currentIndex: focusable.indexOf(document.activeElement as HTMLElement), controlCount: focusable.length, shiftKey: event.shiftKey });
      if (nextIndex === undefined) return;
      event.preventDefault(); focusable[nextIndex]?.focus();
    };
    document.addEventListener('keydown', closeOnEscape);
    const focusable = dialogRef.current ? dialogFocusable(dialogRef.current) : [];
    const cancelIndex = cancelRef.current && !cancelRef.current.disabled ? focusable.indexOf(cancelRef.current) : -1;
    const initialIndex = firstEnabledFocusIndex(focusable.map((control) => !control.hasAttribute('disabled')), cancelIndex >= 0 ? cancelIndex : 0);
    focusable[initialIndex ?? 0]?.focus();
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      if (previous?.isConnected) previous.focus();
    };
  }, [item.trigger]);
  const isStory = item.kind === 'story';
  return <div className="modal-backdrop"><div ref={dialogRef} className={`modal manuscript-delete-modal ${isStory ? 'manuscript-delete-story' : ''}`} role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
    <div className="modal-heading"><p className="eyebrow">{isStory ? 'IRREVERSIBLE MANUSCRIPT ACTION' : 'MANUSCRIPT'}</p><h2 id={titleId}>{isStory ? 'Delete story permanently' : `Delete ${item.kind}`}</h2><button type="button" className="modal-close" aria-label="Close dialog without deleting" disabled={busy} onClick={onCancel}>×</button></div>
    <div id={descriptionId}>
      {isStory ? <><p className="destructive-warning"><strong>This permanently deletes “{item.title}”.</strong></p><p>There is no undo. The story, its {item.childCount} chapter{item.childCount === 1 ? '' : 's'}, and every associated scene and document will be removed from this project.</p><p>Only the final button deletes anything. Cancel, close, and Escape leave the manuscript unchanged.</p></> : <p>Are you sure you want to delete “{item.title}”? This permanently removes the {item.kind} and its {item.kind === 'chapter' ? 'scenes and documents' : 'document'}. Cancel, close, and Escape leave the manuscript unchanged.</p>}
    </div>
    {item.error && <p className="error-message" role="alert">{item.error}</p>}
    {isStory && <p className="delete-countdown" role="status" aria-live="polite">{remaining > 0 ? `The permanent delete button unlocks in ${remaining} second${remaining === 1 ? '' : 's'}.` : 'The permanent delete button is unlocked.'}</p>}
    <div className="modal-actions"><button ref={cancelRef} type="button" className="text-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className={`danger-button ${isStory ? 'danger-button-confirm' : ''}`} disabled={busy || (isStory && remaining > 0)} onClick={onConfirm}>{isStory ? (remaining > 0 ? `Delete story (${remaining})` : 'Delete story permanently') : `Delete ${item.kind}`}</button></div>
  </div></div>;
}

export default function App() {
  const repository = useMemo<ProjectRepository>(() => isDesktop ? new TauriProjectRepository() : new InMemoryProjectRepository(), []);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => readRecentProjects());
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>();
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash());
  const [selectedStoryId, setSelectedStoryId] = useState<string>();
  const [selectedChapterId, setSelectedChapterId] = useState<string>();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>();
  const [documentHead, setDocumentHead] = useState<DocumentHead>();
  const [draft, setDraft] = useState<ContinuousDraft>();
  const [mode, setMode] = useState<'scene' | 'continuous' | 'compose'>('scene');
  const [workspaceMode, setWorkspaceMode] = useState<'writing' | 'worldbuilding'>(() => routeFromHash() === 'worldbuilding' ? 'worldbuilding' : 'writing');
  const [worldbuildingTabs, setWorldbuildingTabs] = useState<WorldbuildingTab[]>([]);
  const [activeWorldbuildingTabKey, setActiveWorldbuildingTabKey] = useState<string>();
  const [editorDocument, setEditorDocument] = useState<StructuredDocument>(initialDocument());
  const [styleProfile, setStyleProfile] = useState<EditorStyleProfile>({ ...DEFAULT_EDITOR_STYLE });
  const [showReturnChoices, setShowReturnChoices] = useState<ReturnChoicesState>();
  const [manuscriptVersionDialog, setManuscriptVersionDialog] = useState<ManuscriptVersionDialogState>();
  const [restoreVersion, setRestoreVersion] = useState<RestoreVersionState>();
  const [formDialog, setFormDialog] = useState<FormDialogConfig>();
  const [canvasDialog, setCanvasDialog] = useState<{ storyId: string; trigger?: FocusTrigger }>();
  const [noteCreateDialog, setNoteCreateDialog] = useState<{ trigger?: FocusTrigger }>();
  const [noteAction, setNoteAction] = useState<NoteActionState>();
  const [canvasAction, setCanvasAction] = useState<CanvasActionState>();
  const [manuscriptDelete, setManuscriptDelete] = useState<ManuscriptDeleteState>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>({ state: 'saved', message: 'All changes saved' });
  const [integrityReport, setIntegrityReport] = useState<IntegrityReport>();
  const [lastBackup, setLastBackup] = useState<BackupRecord>();
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' }>();
  const [focusMode, setFocusMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pageContentWidth, setPageContentWidth] = useState<number>();
  const documentHeadRef = useRef<DocumentHead>();
  const editorDocumentRef = useRef(editorDocument);
  const routeRef = useRef(route);
  const pageStackRef = useRef<HTMLDivElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const latestSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const canonicalSelectionRef = useRef<CanonicalSelection>();
  const restoreFocusRef = useRef(false);
  const previousDailyWordsRef = useRef<number>();
  const noteFlushRef = useRef<{ noteId: string; flush: () => Promise<boolean> }>();
  documentHeadRef.current = documentHead;
  editorDocumentRef.current = editorDocument;
  routeRef.current = route;

  useLayoutEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onHashChange = () => {
      const next = routeFromHash();
      if (routeRef.current === 'worldbuilding' && next !== 'worldbuilding') {
        void run(async () => {
          if (!await flushActiveMarkdownNote()) {
            window.history.replaceState(null, '', `#${routeRef.current}`);
            return;
          }
          applyRoute(next);
        });
        return;
      }
      setRoute(next);
      setWorkspaceMode(next === 'worldbuilding' ? 'worldbuilding' : 'writing');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [activeWorldbuildingTabKey, worldbuildingTabs]);
  useEffect(() => {
    const onFullscreenChange = () => { if (!document.fullscreenElement) setFocusMode(false); };
    const onFocusEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && focusMode && !document.fullscreenElement) setFocusMode(false); };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onFocusEscape);
    return () => { document.removeEventListener('fullscreenchange', onFullscreenChange); document.removeEventListener('keydown', onFocusEscape); };
  }, [focusMode]);
  useEffect(() => {
    const stats = snapshot?.writingStats;
    if (!stats) return;
    const previous = previousDailyWordsRef.current;
    previousDailyWordsRef.current = stats.dailyWords;
    if (previous !== undefined && stats.dailyTarget > 0 && previous < stats.dailyTarget && stats.dailyWords >= stats.dailyTarget) {
      setToast({ message: `Daily goal reached — ${stats.dailyTarget.toLocaleString()} words written today.` });
    }
  }, [snapshot?.writingStats]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const autosave = useMemo(() => new AutosaveController(() => latestSaveRef.current(), {
    delayMs: 700,
    onStatus: (status) => { setAutosaveStatus(status); if (status.state !== 'error') setLocalError(''); }
  }), []);

  const refresh = useCallback(async (keepSelection = true) => {
    const next = await repository.snapshot();
    setSnapshot(next);
    setStyleProfile(next.styleProfile);
    const storyId = keepSelection ? (selectedStoryId && next.stories.some((item) => item.id === selectedStoryId) ? selectedStoryId : next.stories[0]?.id) : next.stories[0]?.id;
    const chapterList = next.chapters.filter((item) => item.storyId === storyId);
    const chapterId = keepSelection ? (selectedChapterId && chapterList.some((item) => item.id === selectedChapterId) ? selectedChapterId : chapterList[0]?.id) : chapterList[0]?.id;
    setSelectedStoryId(storyId); setSelectedChapterId(chapterId);
    if (chapterId) {
      const nextScenes = await repository.listScenes(chapterId);
      setScenes(nextScenes);
      if (!selectedSceneId || !nextScenes.some((item) => item.id === selectedSceneId)) setSelectedSceneId(nextScenes[0]?.id);
    } else {
      setScenes([]);
      setSelectedSceneId(undefined);
    }
  }, [repository, selectedChapterId, selectedSceneId, selectedStoryId]);

  useEffect(() => { if (snapshot) void refresh(); }, []); // desktop starts at the project chooser
  useEffect(() => { if (!snapshot) return; setWorldbuildingTabs((current) => current.filter((tab) => tab.kind === 'note' ? snapshot.markdownNotes.some((note) => note.id === tab.id) : snapshot.canvases.some((canvas) => canvas.id === tab.id))); }, [snapshot]);
  useEffect(() => { setActiveWorldbuildingTabKey((active) => worldbuildingTabs.some((tab) => worldbuildingTabKey(tab) === active) ? active : worldbuildingTabs[0] ? worldbuildingTabKey(worldbuildingTabs[0]) : undefined); }, [worldbuildingTabs]);
  useEffect(() => {
    if (!selectedChapterId) return;
    void repository.listScenes(selectedChapterId).then((nextScenes) => {
      setScenes(nextScenes);
      if (!selectedSceneId || !nextScenes.some((scene) => scene.id === selectedSceneId)) setSelectedSceneId(nextScenes[0]?.id);
    }).catch(() => undefined);
  }, [repository, selectedChapterId]);
  useEffect(() => {
    if (!selectedSceneId || mode !== 'scene') {
      if (mode === 'scene' && !selectedSceneId) {
        setDocumentHead(undefined); documentHeadRef.current = undefined;
        const empty = initialDocument(); setEditorDocument(empty); editorDocumentRef.current = empty;
      }
      return;
    }
    void repository.getDocument(scenes.find((scene) => scene.id === selectedSceneId)?.documentId ?? '').then((head) => {
      setDocumentHead(head); documentHeadRef.current = head; setEditorDocument(head.document); editorDocumentRef.current = head.document;
    }).catch(() => undefined);
  }, [mode, repository, scenes, selectedSceneId]);
  useLayoutEffect(() => {
    const element = pageStackRef.current;
    if (!element) return;
    const updateWidth = () => setPageContentWidth(element.clientWidth);
    updateWidth();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [snapshot, sidebarCollapsed]);
  useEffect(() => {
    const flush = () => { void autosave.flush(); };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => { window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', flush); };
  }, [autosave]);

  const run = async (operation: () => Promise<void>) => { setBusy(true); setLocalError(''); try { await operation(); } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const rememberProject = (project: Pick<ProjectSnapshot['project'], 'directory' | 'name'>) => setRecentProjects(rememberRecentProject(project));
  const applyRoute = (next: AppRoute) => {
    routeRef.current = next;
    setRoute(next);
    setWorkspaceMode(next === 'worldbuilding' ? 'worldbuilding' : 'writing');
    window.history.replaceState(null, '', `#${next}`);
  };
  const registerNoteFlush = useCallback((noteId: string, flush?: () => Promise<boolean>) => {
    if (flush) noteFlushRef.current = { noteId, flush };
    else if (noteFlushRef.current?.noteId === noteId) noteFlushRef.current = undefined;
  }, []);
  const flushNoteBeforeAction = async (noteId: string) => {
    const registered = noteFlushRef.current;
    if (!registered || registered.noteId !== noteId) return true;
    return registered.flush();
  };
  const flushActiveMarkdownNote = async () => {
    const active = worldbuildingTabs.find((tab) => worldbuildingTabKey(tab) === activeWorldbuildingTabKey) ?? worldbuildingTabs[0];
    return !active || active.kind !== 'note' || flushNoteBeforeAction(active.id);
  };
  const navigate = (next: AppRoute) => void run(async () => {
    await autosave.flush();
    if (next !== 'worldbuilding' && !await flushActiveMarkdownNote()) return;
    if (focusMode) {
      setFocusMode(false);
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => undefined);
    }
    applyRoute(next);
  });
  const toggleFocusMode = () => void run(async () => {
    const next = !focusMode;
    if (!next && document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => undefined);
    setFocusMode(next);
    if (next && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen().catch(() => undefined);
  });
  const latestMarkdownNote = async (noteId: string): Promise<MarkdownNote | undefined> => (await repository.listMarkdownNotes()).find((note) => note.id === noteId);
  const submitFormDialog = (values: Record<string, string>) => void run(async () => { const config = formDialog; if (!config) return; await config.onSubmit(values); setFormDialog(undefined); });

  const saveCurrentDocument = useCallback(async () => {
    const head = documentHeadRef.current;
    if (!head || mode === 'compose') return;
    const result = await repository.saveDocument(head.documentId, editorDocumentRef.current, head.revision);
    const nextHead = { documentId: head.documentId, document: result.revision.document, revision: result.revision.number, revisionId: result.revision.id };
    documentHeadRef.current = nextHead;
    editorDocumentRef.current = result.revision.document;
    setDocumentHead(nextHead); setEditorDocument(result.revision.document);
    const writingStats = await repository.getWritingStats();
    const writingActivity = await repository.getWritingActivity();
    setSnapshot((current) => current ? { ...current, writingStats, writingActivity, status: result.status } : current);
  }, [mode, repository]);
  latestSaveRef.current = saveCurrentDocument;
  const pages = useMemo<PaginatedPage[]>(() => paginateDocumentWithSources(editorDocument, styleProfile, pageContentWidth), [editorDocument, styleProfile, pageContentWidth]);
  const rememberSelection = (block: StructuredDocument['blocks'][number], selection: SelectionInfo) => {
    const paginated = block as PaginatedBlock;
    const metadata = paginated.pagination;
    const sourceBlockId = metadata?.sourceBlockId ?? block.id;
    const fragmentLength = blockText(block).length;
    const startAffinity = selection.direction === 'backward' ? 'backward' : 'forward';
    const endAffinity = selection.direction === 'backward' ? 'forward' : 'backward';
    canonicalSelectionRef.current = {
      sourceBlockId,
      start: pageOffsetToCanonical(metadata, selection.start, fragmentLength),
      end: pageOffsetToCanonical(metadata, selection.end, fragmentLength),
      startAffinity,
      endAffinity,
      direction: selection.direction
    };
    if (selection.focused) restoreFocusRef.current = true;
  };
  useLayoutEffect(() => {
    const selection = canonicalSelectionRef.current;
    if (!selection) return;
    const start = canonicalOffsetToPage(pages, selection.sourceBlockId, selection.start, selection.startAffinity);
    const end = canonicalOffsetToPage(pages, selection.sourceBlockId, selection.end, selection.endAffinity);
    if (!start || !end) return;
    const focus = selection.direction === 'backward' ? start : end;
    const textarea = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea[data-page-block-id]')).find((element) => element.dataset.pageBlockId === focus.blockId);
    if (!textarea) return;
    const sameFragment = start.blockId === end.blockId;
    const localStart = sameFragment ? start.offset : focus.offset;
    const localEnd = sameFragment ? end.offset : localStart;
    textarea.setSelectionRange(localStart, localEnd, sameFragment ? selection.direction : 'none');
    if (restoreFocusRef.current) textarea.focus();
    restoreFocusRef.current = false;
  }, [pages, editorDocument, styleProfile]);
  const updatePage = (pageIndex: number, page: StructuredDocument) => {
    const value = mergePaginatedDocument(editorDocumentRef.current, pages, pageIndex, page);
    editorDocumentRef.current = value;
    setEditorDocument(value);
    if (mode !== 'compose') autosave.markDirty();
  };
  const margins = effectiveTextMargins(styleProfile);
  const pageStyle = { '--page-width': `${pageDimensions(styleProfile.pageSize).widthPx}px`, '--page-height': `${pageDimensions(styleProfile.pageSize).heightPx}px`, '--text-margin-top': `${margins.top}px`, '--text-margin-right': `${margins.right}px`, '--text-margin-bottom': `${margins.bottom}px`, '--text-margin-left': `${margins.left}px` } as React.CSSProperties;

  const openSearchTarget = (target: SearchTarget) => void run(async () => {
    await autosave.flush();
    if (!await flushActiveMarkdownNote()) return;
    if (target.kind === 'note') {
      await openWorldbuildingTab({ kind: 'note', id: target.noteId }, { noteFlushed: true });
      return;
    }
    if (target.kind === 'story') {
      const chapter = snapshot?.chapters.find((candidate) => candidate.storyId === target.storyId);
      applyRoute('manuscript'); setWorkspaceMode('writing'); setMode('scene'); setDraft(undefined); setSelectedStoryId(target.storyId); setSelectedChapterId(chapter?.id); setSelectedSceneId(undefined);
      return;
    }
    if (target.kind === 'chapter') {
      applyRoute('manuscript'); setWorkspaceMode('writing'); setMode('scene'); setDraft(undefined); setSelectedStoryId(target.storyId); setSelectedChapterId(target.chapterId); setSelectedSceneId(undefined);
      return;
    }
    if (target.kind === 'scene') {
      applyRoute('manuscript'); setWorkspaceMode('writing'); setMode('scene'); setDraft(undefined); setSelectedStoryId(target.storyId); setSelectedChapterId(target.chapterId); setSelectedSceneId(target.sceneId);
      return;
    }
    if (target.kind === 'continuous-draft') {
      const draftRecord = await repository.getContinuousDraft(target.draftId);
      const head = await repository.getDocument(draftRecord.documentId);
      applyRoute('manuscript'); setWorkspaceMode('writing'); setDraft(draftRecord); setDocumentHead(head); documentHeadRef.current = head; setEditorDocument(head.document); editorDocumentRef.current = head.document; setMode('continuous'); setSelectedStoryId(target.storyId); setSelectedChapterId(target.chapterId); setSelectedSceneId(undefined);
    }
  });

  const createProject = () => {
    const trigger = captureFocusTrigger();
    return void run(async () => {
      await autosave.flush();
      setFormDialog({ eyebrow: 'NEW PROJECT', title: 'Create a project', fields: [
        { key: 'directory', label: 'Project directory', value: `${isDesktop ? '' : '/tmp/'}my-weave-project` },
        { key: 'name', label: 'Project name', value: 'My story' }
      ], trigger, onSubmit: async (values) => {
        const directory = validateProjectDirectory(values.directory);
        const name = values.name.trim() || 'My story';
        const project = await repository.createProject(directory, name);
        rememberProject(project);
        const story = await repository.createStory('Story 1');
        const chapter = await repository.createChapter(story.id, 'Chapter 1');
        await repository.createScene(chapter.id, 'Scene 1');
        await repository.createScene(chapter.id, 'Scene 2');
        await refresh(false);
        applyRoute('home');
      } });
    });
  };
  const openProjectAt = (directory: string, recentName?: string) => void run(async () => {
    await autosave.flush();
    const validatedDirectory = validateProjectDirectory(directory);
    // The browser fallback has no filesystem to reopen. Recent entries are
    // intentionally metadata-only, so create an in-memory shell from that
    // metadata rather than pretending localStorage contains project content.
    const project = !isDesktop && recentName
      ? await repository.createProject(validatedDirectory, recentName)
      : await repository.openProject(validatedDirectory);
    rememberProject(project);
    await refresh(false);
    applyRoute('home');
  });
  const openProject = () => {
    const trigger = captureFocusTrigger();
    return void run(async () => { await autosave.flush(); setFormDialog({ eyebrow: 'OPEN PROJECT', title: 'Open a project', fields: [{ key: 'directory', label: 'Project directory', value: '', placeholder: '/path/to/project' }], trigger, onSubmit: async (values) => { const project = await repository.openProject(validateProjectDirectory(values.directory)); rememberProject(project); await refresh(false); applyRoute('home'); } }); });
  };
  const forgetRecentProject = (directory: string) => setRecentProjects(removeRecentProject(directory));
  const addScene = () => void run(async () => { if (!selectedChapterId) return; const scene = await repository.createScene(selectedChapterId, `Scene ${scenes.length + 1}`); await refresh(); setSelectedSceneId(scene.id); });
  const addChapter = () => void run(async () => { if (!selectedStoryId) return; const chapterNumber = (snapshot?.chapters.filter((item) => item.storyId === selectedStoryId).length ?? 0) + 1; await repository.createChapter(selectedStoryId, `Chapter ${chapterNumber}`); await refresh(false); });
  const renameStory = (story: { id: string; title: string }) => {
    const trigger = captureFocusTrigger();
    return void run(async () => { await autosave.flush(); setFormDialog({ eyebrow: 'STORY', title: 'Rename story', fields: [{ key: 'title', label: 'Story title', value: story.title }], trigger, onSubmit: async (values) => { const title = values.title.trim(); if (title) { await repository.renameStory(story.id, title); await refresh(); } } }); });
  };
  const renameChapter = (chapter: Chapter) => {
    const trigger = captureFocusTrigger();
    return void run(async () => { await autosave.flush(); setFormDialog({ eyebrow: 'CHAPTER', title: 'Rename chapter', fields: [{ key: 'title', label: 'Chapter title', value: chapter.title }], trigger, onSubmit: async (values) => { const title = values.title.trim(); if (title) { await repository.renameChapter(chapter.id, title); await refresh(); } } }); });
  };
  const renameScene = (scene: Scene) => {
    const trigger = captureFocusTrigger();
    return void run(async () => { await autosave.flush(); setFormDialog({ eyebrow: 'SCENE', title: 'Rename scene', fields: [{ key: 'title', label: 'Scene title', value: scene.title }], trigger, onSubmit: async (values) => { const title = values.title.trim(); if (title) { await repository.renameScene(scene.id, title); await refresh(); } } }); });
  };
  const moveChapter = (chapter: Chapter, position: number) => void run(async () => { await autosave.flush(); await repository.reorderChapter(chapter.id, position); await refresh(); });
  const moveScene = (scene: Scene, delta: number) => void run(async () => { await autosave.flush(); await repository.reorderScene(scene.id, scene.position + delta); await refresh(); });
  const selectOutlineChapter = (story: { id: string }, chapter: Chapter) => void run(async () => { await autosave.flush(); applyRoute('manuscript'); setMode('scene'); setDraft(undefined); setSelectedStoryId(story.id); setSelectedChapterId(chapter.id); setSelectedSceneId(undefined); });
  const selectOutlineScene = (story: { id: string }, chapter: Chapter, scene: Scene) => void run(async () => { await autosave.flush(); applyRoute('manuscript'); setMode('scene'); setDraft(undefined); setSelectedStoryId(story.id); setSelectedChapterId(chapter.id); setSelectedSceneId(scene.id); });
  const requestDeleteStory = (story: { id: string; title: string }) => setManuscriptDelete({ kind: 'story', id: story.id, title: story.title, childCount: snapshot?.chapters.filter((chapter) => chapter.storyId === story.id).length ?? 0, trigger: captureFocusTrigger() });
  const requestDeleteChapter = (chapter: Chapter) => setManuscriptDelete({ kind: 'chapter', id: chapter.id, title: chapter.title, childCount: scenes.length, trigger: captureFocusTrigger() });
  const requestDeleteScene = (scene: Scene) => setManuscriptDelete({ kind: 'scene', id: scene.id, title: scene.title, childCount: 0, trigger: captureFocusTrigger() });
  const confirmManuscriptDelete = () => void run(async () => {
    const action = manuscriptDelete;
    if (!action) return;
    const draftChapter = draft && snapshot?.chapters.find((chapter) => chapter.id === draft.chapterId);
    const deletedScene = action.kind === 'scene' ? snapshot?.scenes.find((scene) => scene.id === action.id) : undefined;
    const deletedSceneInfo = deletedScene ? {
      id: deletedScene.id,
      chapterId: snapshot?.sceneSets.find((set) => set.id === deletedScene.sceneSetId)?.chapterId ?? '',
      sceneSetId: deletedScene.sceneSetId,
      documentId: deletedScene.documentId
    } : undefined;
    const impact = manuscriptDeleteImpact(action, {
      activeStoryId: snapshot?.chapters.find((chapter) => chapter.id === selectedChapterId)?.storyId,
      draftStoryId: draftChapter?.storyId,
      activeChapterId: selectedChapterId,
      activeSceneId: selectedSceneId,
      activeDocumentId: documentHead?.documentId,
      mode,
      draft,
      scene: deletedSceneInfo
    });
    try {
      await autosave.flush();
      if (action.kind === 'story') await repository.deleteStory(action.id);
      else if (action.kind === 'chapter') await repository.deleteChapter(action.id);
      else await repository.deleteScene(action.id);
      setManuscriptDelete(undefined);
      if (impact.clearDocument) {
        setMode(impact.nextMode);
        setDraft(undefined);
        setDocumentHead(undefined); documentHeadRef.current = undefined;
        const empty = initialDocument(); setEditorDocument(empty); editorDocumentRef.current = empty;
      }
      await refresh(true);
    } catch (error) {
      setManuscriptDelete((current) => current ? { ...current, error: error instanceof Error ? error.message : String(error) } : current);
      throw error;
    }
  });

  const selectScene = (scene: Scene) => void run(async () => { await autosave.flush(); applyRoute('manuscript'); setMode('scene'); setDraft(undefined); setSelectedSceneId(scene.id); });
  const openContinuous = () => void run(async () => {
    if (!selectedChapterId) return;
    await autosave.flush();
    const value = await repository.enterContinuousDraft(selectedChapterId); const head = await repository.getDocument(value.documentId);
    setDraft(value); setDocumentHead(head); documentHeadRef.current = head; setEditorDocument(head.document); editorDocumentRef.current = head.document; setMode('continuous'); await refresh();
  });
  const returnToScenes = () => {
    const trigger = captureFocusTrigger();
    return void run(async () => { await autosave.flush(); setShowReturnChoices({ trigger }); });
  };
  const split = () => void run(async () => { if (!draft) return; await autosave.flush(); const result = await repository.automaticallySplitContinuous(draft.id); setShowReturnChoices(undefined); setDraft(undefined); setMode('scene'); await refresh(false); setSelectedSceneId(result.scenes[0]?.id); });
  const keepSeparate = () => void run(async () => { if (!draft) return; await autosave.flush(); await repository.keepContinuousSeparate(draft.id); setShowReturnChoices(undefined); setDraft(undefined); setMode('scene'); await refresh(false); });
  const save = () => void run(async () => { if (!documentHeadRef.current) return; autosave.markDirty(); await autosave.flush(); });
  const compose = () => void run(async () => { if (!selectedChapterId) return; await autosave.flush(); const composed = await repository.composeChapter(selectedChapterId); setMode('compose'); setEditorDocument(composed); editorDocumentRef.current = composed; setDocumentHead(undefined); documentHeadRef.current = undefined; });
  const doExport = () => void run(async () => {
    await autosave.flush();
    const head = documentHeadRef.current;
    if (!head) { setLocalError('Save a scene or continuous draft before exporting.'); return; }
    const options = { title: snapshot?.project.name ?? 'Manuscript', header: snapshot?.project.name ?? 'Manuscript', pageNumbering: true, styleProfile };
    const files = formats.map((format) => exportCapturedRevision({ id: head.revisionId, documentId: head.documentId, number: head.revision, document: head.document, createdAt: new Date().toISOString(), reason: 'edit' }, format, options));
    for (const file of files) { await repository.writeExport(file); if (!isDesktop) { const url = URL.createObjectURL(new Blob([file.bytes as unknown as BlobPart], { type: file.mimeType })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url); } }
  });
  const checkIntegrity = () => void run(async () => {
    await autosave.flush();
    const report = await repository.integrityCheck();
    setIntegrityReport(report);
    setToast({ message: report.message, tone: report.ok ? 'success' : 'error' });
    await refresh();
  });
  const backup = () => void run(async () => {
    await autosave.flush();
    const record = await repository.createBackup();
    setLastBackup(record);
    setToast({ message: `Backup captured at ${record.path}` });
    await refresh();
  });
  // Legacy callback shape kept documented for the workspace contract: onReturnToManuscript={() => setWorkspaceMode('writing')}.
  const recoverBackup = (record: BackupRecord) => void run(async () => {
    await autosave.flush();
    const status = await repository.recoverFromBackup(record.id);
    setToast({ message: status.message });
    setMode('scene');
    setDraft(undefined);
    setDocumentHead(undefined); documentHeadRef.current = undefined;
    const empty = initialDocument(); setEditorDocument(empty); editorDocumentRef.current = empty;
    await refresh(false);
  });
  const updateStyle = (profile: EditorStyleProfile) => void run(async () => { const saved = await repository.updateStyleProfile(profile); setStyleProfile(saved); setSnapshot((current) => current ? { ...current, styleProfile: saved } : current); });
  const updateGoal = (target: number) => void run(async () => { await repository.setDailyWordTarget(target); const writingStats = await repository.getWritingStats(); setSnapshot((current) => current ? { ...current, writingStats } : current); });
  const saveManuscriptVersion = (label: string) => void run(async () => {
    await autosave.flush();
    const version = await repository.saveManuscriptVersion(label);
    setManuscriptVersionDialog(undefined);
    setSnapshot((current) => current ? { ...current, manuscriptVersions: [version, ...current.manuscriptVersions] } : current);
    setToast({ message: `Manuscript version “${version.label}” saved.` });
  });
  const openManuscriptVersionDialog = (kind: 'help' | 'save' | 'history') => setManuscriptVersionDialog({ kind, trigger: captureFocusTrigger() });
  const inspectManuscriptVersion = (version: ManuscriptVersionSummary) => void run(async () => {
    const trigger = captureFocusTrigger();
    const detail = await repository.getManuscriptVersion(version.id);
    setManuscriptVersionDialog({ kind: 'detail', detail, trigger });
  });
  const compareManuscriptVersions = (from: ManuscriptVersionSummary, to: ManuscriptVersionSummary) => void run(async () => {
    const trigger = captureFocusTrigger();
    const comparison = await repository.compareManuscriptVersions(from.id, to.id);
    setManuscriptVersionDialog({ kind: 'comparison', comparison, trigger });
  });
  const requestRestoreManuscriptVersion = (version: ManuscriptVersionSummary) => setRestoreVersion({ summary: version, trigger: captureFocusTrigger() });
  const restoreManuscriptVersion = () => void run(async () => {
    const action = restoreVersion;
    if (!action) return;
    try {
      await autosave.flush();
      const result = await repository.restoreManuscriptVersion(action.summary.id);
      setRestoreVersion(undefined);
      setManuscriptVersionDialog(undefined);
      setMode('scene');
      setDraft(undefined);
      setDocumentHead(undefined); documentHeadRef.current = undefined;
      const empty = initialDocument(); setEditorDocument(empty); editorDocumentRef.current = empty;
      setLastBackup(result.backup);
      setToast({ message: `Restored “${action.summary.label}”. Backup captured at ${result.backup.path}` });
      await refresh(false);
    } catch (error) {
      setRestoreVersion((current) => current ? { ...current, error: error instanceof Error ? error.message : String(error) } : current);
      throw error;
    }
  });
  const newStory = () => {
    const trigger = captureFocusTrigger();
    return void run(async () => { await autosave.flush(); setFormDialog({ eyebrow: 'MANUSCRIPT', title: 'New story', fields: [{ key: 'title', label: 'Story title', value: 'New story' }], trigger, onSubmit: async (values) => { const title = values.title.trim(); if (title) { await repository.createStory(title); await refresh(false); } } }); });
  };
  const retryAutosave = () => void run(async () => { await autosave.retry(); });
  const createWorldbuildingNote = () => {
    const trigger = captureFocusTrigger();
    return void run(async () => { await autosave.flush(); setNoteCreateDialog({ trigger }); });
  };
  const submitNoteCreate = (title: string) => void run(async () => {
    const name = title.trim();
    if (!name) return;
    const note = await repository.createMarkdownNote(name);
    setNoteCreateDialog(undefined);
    await refresh();
    await openWorldbuildingTab({ kind: 'note', id: note.id });
  });
  const createWorldbuildingCanvas = () => {
    const trigger = captureFocusTrigger();
    return void run(async () => { await autosave.flush(); if (!selectedStoryId) { setLocalError('Choose a manuscript story before creating a local note canvas.'); return; } setCanvasDialog({ storyId: selectedStoryId, trigger }); });
  };
  const submitCanvasChoice = (title: string, engine: CanvasEngine) => void run(async () => { const choice = canvasDialog; if (!choice) return; const canvas = await repository.createCanvas(choice.storyId, title, engine); setCanvasDialog(undefined); await refresh(); await openWorldbuildingTab({ kind: 'canvas', id: canvas.id }); });
  const openWorldbuildingTab = async (tab: WorldbuildingTab, options?: { noteFlushed?: boolean }) => {
    const current = worldbuildingTabs.find((candidate) => worldbuildingTabKey(candidate) === activeWorldbuildingTabKey) ?? worldbuildingTabs[0];
    if (!options?.noteFlushed && current && worldbuildingTabKey(current) !== worldbuildingTabKey(tab) && !await flushActiveMarkdownNote()) return;
    applyRoute('worldbuilding');
    const key = worldbuildingTabKey(tab);
    setWorldbuildingTabs((existing) => existing.some((candidate) => worldbuildingTabKey(candidate) === key) ? existing : [...existing, tab]);
    setActiveWorldbuildingTabKey(key);
  };
  const activateWorldbuildingTab = async (key: string) => {
    if (key === activeWorldbuildingTabKey) return;
    if (!await flushActiveMarkdownNote()) return;
    setActiveWorldbuildingTabKey(key);
  };
  const closeWorldbuildingTab = async (key: string) => {
    if (key === activeWorldbuildingTabKey && !await flushActiveMarkdownNote()) return;
    setWorldbuildingTabs((current) => { const index = current.findIndex((tab) => worldbuildingTabKey(tab) === key); const next = current.filter((tab) => worldbuildingTabKey(tab) !== key); setActiveWorldbuildingTabKey((active) => active === key ? (next[index] ? worldbuildingTabKey(next[index]) : next[index - 1] ? worldbuildingTabKey(next[index - 1]) : undefined) : active); return next; });
  };
  const requestRenameNote = (note: MarkdownNote) => setNoteAction({ kind: 'rename', noteId: note.id, title: note.title, trigger: captureFocusTrigger() });
  const requestDeleteNote = (note: MarkdownNote) => setNoteAction({ kind: 'delete', noteId: note.id, title: note.title, phase: 'confirm', trigger: captureFocusTrigger() });
  const requestRenameCanvas = (canvas: StoryCanvas) => setCanvasAction({ kind: 'rename', canvasId: canvas.id, title: canvas.title, trigger: captureFocusTrigger() });
  const requestDeleteCanvas = (canvas: StoryCanvas) => setCanvasAction({ kind: 'delete', canvasId: canvas.id, title: canvas.title, trigger: captureFocusTrigger() });
  const latestCanvas = async (canvasId: string) => (await repository.listCanvases()).find((canvas) => canvas.id === canvasId);
  const submitCanvasRename = (nextTitle: string) => void run(async () => {
    const action = canvasAction;
    if (!action || action.kind !== 'rename' || !nextTitle.trim()) return;
    const canvas = await latestCanvas(action.canvasId);
    if (!canvas) { setCanvasAction(undefined); await refresh(); return; }
    await repository.updateCanvas(canvas.id, { title: nextTitle.trim() }, canvas.revision);
    setCanvasAction(undefined);
    await refresh();
  });
  const confirmCanvasDelete = () => void run(async () => {
    const action = canvasAction;
    if (!action || action.kind !== 'delete') return;
    const canvas = await latestCanvas(action.canvasId);
    if (!canvas) { setCanvasAction(undefined); closeWorldbuildingTab(worldbuildingTabKey({ kind: 'canvas', id: action.canvasId })); await refresh(); return; }
    try {
      await repository.deleteCanvas(canvas.id, canvas.revision);
      setCanvasAction(undefined);
      closeWorldbuildingTab(worldbuildingTabKey({ kind: 'canvas', id: canvas.id }));
      await refresh();
    } catch (error) {
      setCanvasAction({ ...action, error: error instanceof Error ? error.message : String(error) });
    }
  });
  const submitNoteRename = (nextTitle: string) => void run(async () => {
    const action = noteAction;
    if (!action || action.kind !== 'rename' || !nextTitle.trim()) return;
    if (!await flushNoteBeforeAction(action.noteId)) return;
    const note = await latestMarkdownNote(action.noteId);
    if (!note) { setNoteAction(undefined); await refresh(); return; }
    await repository.updateMarkdownNote(note.id, { title: nextTitle.trim(), markdown: note.markdown }, note.revision);
    setNoteAction(undefined);
    await refresh();
  });
  const confirmNoteDelete = (mode: 'reject' | 'remove-references') => void run(async () => {
    const action = noteAction;
    if (!action || action.kind !== 'delete') return;
    if (!await flushNoteBeforeAction(action.noteId)) return;
    const note = await latestMarkdownNote(action.noteId);
    if (!note) { setNoteAction(undefined); closeWorldbuildingTab(worldbuildingTabKey({ kind: 'note', id: action.noteId })); await refresh(); return; }
    try {
      await repository.deleteMarkdownNote(note.id, note.revision, mode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mode === 'reject' && message.startsWith('Cannot delete')) {
        setNoteAction({ kind: 'delete', noteId: note.id, title: note.title, phase: 'references', referenceMessage: message, trigger: action.trigger });
        return;
      }
      throw error;
    }
    setNoteAction(undefined);
    closeWorldbuildingTab(worldbuildingTabKey({ kind: 'note', id: note.id }));
    await refresh();
  });

  if (route === 'ui') return <UiKit />;

  if (!snapshot) return <><main className="welcome"><div className="welcome-card"><div className="welcome-card-top"><div className="mark">W</div><ThemeControl theme={theme} onToggle={() => setTheme(toggleTheme)} /></div><p className="eyebrow">OFFLINE DESKTOP WRITING</p><h1>Make room for the story.</h1><p className="welcome-copy">Weave keeps your manuscript, revisions, SQLite database, and recovery files in a visible <code>.weave</code> project directory. No server. No network. No guesswork.</p><div className="welcome-actions"><button type="button" className="primary-button" onClick={createProject} disabled={busy}>Create project</button><button type="button" className="secondary-button" onClick={openProject} disabled={busy}>Open project</button></div>{recentProjects.length > 0 && <section className="recent-projects" aria-labelledby="recent-projects-title"><div className="recent-projects-heading"><h2 id="recent-projects-title">Recent projects</h2><span>local only</span></div><ul>{recentProjects.map((project) => <li key={project.directory}><button type="button" className="recent-project-open" onClick={() => openProjectAt(project.directory, project.name)} disabled={busy}><strong>{project.name}</strong><small>{project.directory}</small></button><button type="button" className="recent-project-remove" onClick={() => forgetRecentProject(project.directory)} disabled={busy} aria-label={`Remove ${project.name} from recent projects`}>Remove</button></li>)}</ul></section>}{localError && <p className="error-message">{localError}</p>}<p className="offline-note"><span className="status-dot" /> local-only · SQLite · revisioned</p></div></main>{formDialog && <FormDialog config={formDialog} busy={busy} onCancel={() => setFormDialog(undefined)} onSubmit={submitFormDialog} />}</>;

  const activeChapter: Chapter | undefined = snapshot.chapters.find((chapter) => chapter.id === selectedChapterId);
  const activeScene = scenes.find((scene) => scene.id === selectedSceneId);
  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${focusMode ? 'focus-mode' : ''}`}>
    {focusMode && <button type="button" className="focus-mode-exit" aria-label="Exit Focus Mode" title="Exit Focus Mode" onClick={toggleFocusMode}><Minimize2 size={17} aria-hidden="true" /></button>}
    <header className="topbar"><div className="brand-cluster"><button type="button" className="sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((current) => !current)}>☰</button><button type="button" className="brand brand-home" onClick={() => navigate('home')} aria-label="Go to Home"><span className="brand-mark">W</span><span>Weave</span><span className="offline-pill">OFFLINE</span></button></div><div className="top-actions"><button type="button" onClick={checkIntegrity} disabled={busy} title="Check project integrity">Integrity</button><button type="button" onClick={backup} disabled={busy} title="Create a recoverable backup">Backup</button><button type="button" onClick={doExport} disabled={busy || mode === 'compose'}>Export all</button><button type="button" onClick={() => navigate('settings')} disabled={busy} title="Open project settings">Settings</button><ThemeControl theme={theme} onToggle={() => setTheme(toggleTheme)} /><StatusBar status={autosaveStatus} />{autosaveStatus.state === 'error' && <button type="button" className="retry-button" onClick={retryAutosave}>Retry</button>}</div></header>
    <aside className="sidebar"><div className="workspace-navigation"><nav className="workspace-sections" role="tablist" aria-label="Primary workspaces"><button type="button" role="tab" id="manuscript-workspace-tab" aria-controls="manuscript-workspace" aria-selected={route === 'manuscript'} className={route === 'manuscript' ? 'selected' : ''} onClick={() => navigate('manuscript')}>Manuscript</button><button type="button" role="tab" id="outline-workspace-tab" aria-controls="manuscript-outline" aria-selected={route === 'outline'} className={route === 'outline' ? 'selected' : ''} onClick={() => navigate('outline')}>Outline</button><button type="button" role="tab" id="worldbuilding-workspace-tab" aria-controls="worldbuilding-workspace" aria-selected={route === 'worldbuilding'} className={route === 'worldbuilding' ? 'selected' : ''} onClick={() => navigate('worldbuilding')}>Worldbuilding</button></nav><button ref={searchTriggerRef} type="button" id="project-search-tab" aria-label="Search project" aria-haspopup="dialog" aria-controls="project-search-dialog" aria-expanded={searchOpen} className={`workspace-search-trigger ${searchOpen ? 'selected' : ''}`} onClick={() => setSearchOpen(true)}>Search</button></div>{workspaceMode === 'writing' ? <><div className="sidebar-heading"><span>MANUSCRIPT</span><div className="sidebar-heading-actions"><button type="button" className="sidebar-new-chapter secondary-button" onClick={addChapter} disabled={!selectedStoryId}>New chapter</button><button type="button" onClick={createProject} aria-label="New project">+</button><button type="button" onClick={() => setSidebarCollapsed(true)} aria-label="Collapse sidebar">‹</button></div></div>{snapshot.stories.map((story) => <div key={story.id} className="tree-group"><div className={`manuscript-tree-row ${selectedStoryId === story.id ? 'selected' : ''}`}><button type="button" className={`tree-item story ${selectedStoryId === story.id ? 'selected' : ''}`} onClick={() => void run(async () => { await autosave.flush(); applyRoute('manuscript'); setSelectedStoryId(story.id); const firstChapter = snapshot.chapters.find((chapter) => chapter.storyId === story.id); setSelectedChapterId(firstChapter?.id); setSelectedSceneId(undefined); setMode('scene'); })}>▾ <span>{story.title}</span></button><div className="manuscript-tree-actions" aria-label={`${story.title} story actions`}><button type="button" className="manuscript-tree-action" aria-label={`Rename ${story.title}`} title={`Rename ${story.title}`} onClick={(event) => { event.stopPropagation(); renameStory(story); }}><Pencil size={13} strokeWidth={2} aria-hidden="true" /></button><button type="button" className="manuscript-tree-action manuscript-tree-delete" aria-label={`Delete ${story.title}`} title={`Delete ${story.title}`} onClick={(event) => { event.stopPropagation(); requestDeleteStory(story); }}><Trash2 size={13} strokeWidth={2} aria-hidden="true" /></button></div></div>{snapshot.chapters.filter((chapter) => chapter.storyId === story.id).map((chapter) => <div key={chapter.id} className="chapter-group"><div className={`manuscript-tree-row ${selectedChapterId === chapter.id ? 'selected' : ''}`}><button type="button" className={`tree-item chapter ${selectedChapterId === chapter.id ? 'selected' : ''}`} onClick={() => void run(async () => { await autosave.flush(); applyRoute('manuscript'); setSelectedStoryId(story.id); setSelectedChapterId(chapter.id); setSelectedSceneId(undefined); setMode('scene'); })}>▾ <span>{chapter.title}</span></button><div className="manuscript-tree-actions" aria-label={`${chapter.title} chapter actions`}><button type="button" className="manuscript-tree-action" aria-label={`Rename ${chapter.title}`} title={`Rename ${chapter.title}`} onClick={(event) => { event.stopPropagation(); renameChapter(chapter); }}><Pencil size={13} strokeWidth={2} aria-hidden="true" /></button><button type="button" className="manuscript-tree-action manuscript-tree-delete" aria-label={`Delete ${chapter.title}`} title={`Delete ${chapter.title}`} onClick={(event) => { event.stopPropagation(); requestDeleteChapter(chapter); }}><Trash2 size={13} strokeWidth={2} aria-hidden="true" /></button></div></div>{selectedChapterId === chapter.id && scenes.map((scene) => <div className={`manuscript-tree-row scene-row ${selectedSceneId === scene.id && mode === 'scene' ? 'selected' : ''}`} key={scene.id}><button type="button" className={`tree-item scene ${selectedSceneId === scene.id && mode === 'scene' ? 'selected' : ''}`} onClick={() => selectScene(scene)}><span className="scene-index">{String(scene.position + 1).padStart(2, '0')}</span>{scene.title}</button><div className="manuscript-tree-actions" aria-label={`${scene.title} scene actions`}><button type="button" className="manuscript-tree-action" aria-label={`Rename ${scene.title}`} title={`Rename ${scene.title}`} onClick={(event) => { event.stopPropagation(); renameScene(scene); }}><Pencil size={13} strokeWidth={2} aria-hidden="true" /></button><button type="button" className="manuscript-tree-action manuscript-tree-delete" aria-label={`Delete ${scene.title}`} title={`Delete ${scene.title}`} onClick={(event) => { event.stopPropagation(); requestDeleteScene(scene); }}><Trash2 size={13} strokeWidth={2} aria-hidden="true" /></button></div></div>)}{selectedChapterId === chapter.id && <button type="button" className="add-scene" onClick={addScene}>+ New scene</button>}</div>)}</div>)}<button type="button" className="add-story" onClick={newStory}>+ New story</button><div className="sidebar-bottom"><button type="button" onClick={addChapter} disabled={!selectedStoryId}>+ Chapter</button><button type="button" onClick={openProject}>Open</button></div></> : <nav className="worldbuilding-sidebar" aria-label="Worldbuilding navigation"><p className="eyebrow">WORLDBUILDING</p><section className="worldbuilding-sidebar-group"><div className="worldbuilding-sidebar-heading"><h2>Notes</h2><button type="button" className="worldbuilding-create-icon" aria-label="Create new note" title="Create new note" onClick={createWorldbuildingNote}><Plus size={14} strokeWidth={2} aria-hidden="true" /></button></div>{snapshot.markdownNotes.map((note) => { const key = worldbuildingTabKey({ kind: 'note', id: note.id }); const selected = activeWorldbuildingTabKey === key; return <div className={`worldbuilding-sidebar-note-row ${selected ? 'selected' : ''}`} key={note.id}><button type="button" className={`worldbuilding-sidebar-note-title ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => openWorldbuildingTab({ kind: 'note', id: note.id })}>{note.title}</button><div className="worldbuilding-sidebar-note-actions" aria-label={`${note.title} note actions`}><button type="button" className="worldbuilding-sidebar-note-action" aria-label={`Rename ${note.title}`} title={`Rename ${note.title}`} onClick={(event) => { event.stopPropagation(); requestRenameNote(note); }}><Pencil size={14} strokeWidth={2} aria-hidden="true" /></button><button type="button" className="worldbuilding-sidebar-note-action worldbuilding-sidebar-note-delete" aria-label={`Delete ${note.title}`} title={`Delete ${note.title}`} onClick={(event) => { event.stopPropagation(); requestDeleteNote(note); }}><Trash2 size={14} strokeWidth={2} aria-hidden="true" /></button></div></div>; })}{snapshot.markdownNotes.length === 0 && <p>No notes yet.</p>}</section><section className="worldbuilding-sidebar-group"><div className="worldbuilding-sidebar-heading"><h2>Canvases</h2><button type="button" className="worldbuilding-create-icon" aria-label="Create new canvas" title="Create new canvas" onClick={createWorldbuildingCanvas}><Plus size={14} strokeWidth={2} aria-hidden="true" /></button></div>{snapshot.canvases.map((canvas) => { const key = worldbuildingTabKey({ kind: 'canvas', id: canvas.id }); const selected = activeWorldbuildingTabKey === key; return <div className={`worldbuilding-sidebar-canvas-row ${selected ? 'selected' : ''}`} key={canvas.id}><button type="button" className={`worldbuilding-sidebar-canvas-title ${selected ? 'selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={() => openWorldbuildingTab({ kind: 'canvas', id: canvas.id })}>{canvas.title}</button><div className="worldbuilding-sidebar-canvas-actions" aria-label={`${canvas.title} canvas actions`}><button type="button" className="worldbuilding-sidebar-canvas-action" aria-label={`Rename ${canvas.title}`} title={`Rename ${canvas.title}`} onClick={(event) => { event.stopPropagation(); requestRenameCanvas(canvas); }}><Pencil size={14} strokeWidth={2} aria-hidden="true" /></button><button type="button" className="worldbuilding-sidebar-canvas-action worldbuilding-sidebar-canvas-delete" aria-label={`Delete ${canvas.title}`} title={`Delete ${canvas.title}`} onClick={(event) => { event.stopPropagation(); requestDeleteCanvas(canvas); }}><Trash2 size={14} strokeWidth={2} aria-hidden="true" /></button></div></div>; })}{snapshot.canvases.length === 0 && <p>No canvases yet.</p>}</section><p className="worldbuilding-sidebar-note">Open tabs remain available when returning to Manuscript.</p></nav>}</aside>
    <ProjectSearch repository={repository} snapshot={snapshot} open={searchOpen} trigger={searchTriggerRef.current} onClose={() => setSearchOpen(false)} onNavigate={openSearchTarget} />
    {route === 'home' ? <HomePage stats={snapshot.writingStats} activity={snapshot.writingActivity} onOpenManuscript={() => navigate('manuscript')} /> : route === 'settings' ? <SettingsPage styleProfile={styleProfile} stats={snapshot.writingStats} backups={snapshot.backups} integrityReport={integrityReport} lastBackup={lastBackup} busy={busy} onSaveGoal={updateGoal} onSaveStyle={updateStyle} onCheckIntegrity={checkIntegrity} onCreateBackup={backup} onRecoverBackup={recoverBackup} /> : route === 'outline' ? <ManuscriptOutline snapshot={snapshot} selectedChapterId={selectedChapterId} selectedSceneId={selectedSceneId} onSelectChapter={selectOutlineChapter} onSelectScene={selectOutlineScene} onMoveChapter={moveChapter} onMoveScene={(scene, position) => moveScene(scene, position - scene.position)} /> : workspaceMode === 'worldbuilding' ? <WorldbuildingWorkspace repository={repository} snapshot={snapshot} tabs={worldbuildingTabs} activeTabKey={activeWorldbuildingTabKey} onOpenTab={openWorldbuildingTab} onActivateTab={activateWorldbuildingTab} onCloseTab={closeWorldbuildingTab} onCreateNote={createWorldbuildingNote} onCreateCanvas={createWorldbuildingCanvas} onRefresh={async () => { await refresh(); }} onRegisterNoteFlush={registerNoteFlush} onFlushActiveNote={flushNoteBeforeAction} onReturnToManuscript={() => navigate('manuscript')} onError={setLocalError} /> : <main id="manuscript-workspace" role="tabpanel" aria-labelledby="manuscript-workspace-tab" className="workspace"><div className="workspace-head"><div><p className="eyebrow">{activeChapter?.title ?? 'Chapter'}</p><h1>{mode === 'continuous' ? 'Continuous draft' : mode === 'compose' ? 'Composed chapter' : activeScene?.title ?? 'Choose a scene'}</h1></div><div className="workspace-manuscript-actions"><div className="manuscript-version-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => openManuscriptVersionDialog('save')}>Save version</button><button type="button" className="icon-button version-help-button" disabled={busy} aria-label="Explain manuscript versions" title="About manuscript versions" onClick={() => openManuscriptVersionDialog('help')}><CircleHelp size={16} aria-hidden="true" /></button>{snapshot.manuscriptVersions.length > 0 && <button type="button" className="text-button version-history-button" disabled={busy} onClick={() => openManuscriptVersionDialog('history')}>Versions ({snapshot.manuscriptVersions.length})</button>}</div><div className="mode-switch"><button type="button" className={mode === 'scene' ? 'active' : ''} onClick={() => activeScene && selectScene(activeScene)}>Scenes</button><button type="button" className={mode === 'compose' ? 'active' : ''} onClick={compose}>Chapter view</button><button type="button" className={mode === 'continuous' ? 'active' : ''} onClick={openContinuous}>Continuous draft</button></div></div></div>
      {localError && <div className="inline-error" role="alert">{localError}</div>}
      <GoalPanel stats={snapshot.writingStats} onSaveTarget={updateGoal} />
      <div className="page-stack" ref={pageStackRef} aria-label="Manuscript pages"><StyleControls profile={styleProfile} onChange={updateStyle} disabled={mode === 'compose'} focusMode={focusMode} onToggleFocus={toggleFocusMode} />{pages.map((page, pageIndex) => <section className="paper-page" style={pageStyle} key={`${pageIndex}-${page.document.blocks[0]?.id ?? 'empty'}`}><div className="paper-meta"><span>{mode === 'compose' ? 'NON-DESTRUCTIVE COMPOSITION' : mode === 'continuous' ? 'SEPARATE REVISION · SOURCE SNAPSHOT PRESERVED' : 'SCENE DOCUMENT'}</span><span>{pageDimensions(styleProfile.pageSize).label} · Page {pageIndex + 1} of {pages.length}</span></div><Editor document={page.document} styleProfile={styleProfile} onChange={(value) => updatePage(pageIndex, value)} onSelectionChange={rememberSelection} readOnly={mode === 'compose'} /><div className="paper-footer"><span>{mode === 'compose' ? 'Scene documents remain the source.' : 'Structured document · changes save automatically'}</span>{documentHead && pageIndex === pages.length - 1 && <span>revision {documentHead.revision}</span>}</div></section>)}</div>
      <footer className="editor-footer"><div>{mode === 'continuous' && <button type="button" className="secondary-button" onClick={returnToScenes}>Return to scenes</button>}{mode === 'scene' && activeScene && <><button type="button" className="secondary-button" onClick={() => renameScene(activeScene)}>Rename</button><button type="button" className="icon-button" onClick={() => moveScene(activeScene, -1)} aria-label="Move scene up">↑</button><button type="button" className="icon-button" onClick={() => moveScene(activeScene, 1)} aria-label="Move scene down">↓</button></>}{mode === 'compose' && <span className="guard-note">Composition is a view, never a second source.</span>}</div><div className="save-actions">{mode !== 'compose' && <button type="button" className="secondary-button" onClick={save} disabled={busy || !documentHead}>Save now</button>}</div></footer>
    </main>}
    {showReturnChoices && <ChoiceDialog onSplit={split} onKeep={keepSeparate} onCancel={() => setShowReturnChoices(undefined)} busy={busy} trigger={showReturnChoices.trigger} />}
    {manuscriptVersionDialog?.kind === 'help' && <VersionHelpDialog busy={busy} trigger={manuscriptVersionDialog.trigger} onCancel={() => setManuscriptVersionDialog(undefined)} />}
    {manuscriptVersionDialog?.kind === 'save' && <VersionSaveDialog busy={busy} trigger={manuscriptVersionDialog.trigger} onCancel={() => setManuscriptVersionDialog(undefined)} onSubmit={saveManuscriptVersion} />}
    {manuscriptVersionDialog?.kind === 'history' && <VersionHistoryDialog versions={snapshot.manuscriptVersions} busy={busy} trigger={manuscriptVersionDialog.trigger} onCancel={() => setManuscriptVersionDialog(undefined)} onInspect={inspectManuscriptVersion} onCompare={compareManuscriptVersions} onRestore={requestRestoreManuscriptVersion} />}
    {manuscriptVersionDialog?.kind === 'detail' && <VersionDetailDialog detail={manuscriptVersionDialog.detail} busy={busy} trigger={manuscriptVersionDialog.trigger} onCancel={() => setManuscriptVersionDialog(undefined)} onCompare={() => setManuscriptVersionDialog({ kind: 'history', trigger: captureFocusTrigger() })} onRestore={requestRestoreManuscriptVersion} />}
    {manuscriptVersionDialog?.kind === 'comparison' && <VersionComparisonDialog comparison={manuscriptVersionDialog.comparison} busy={busy} trigger={manuscriptVersionDialog.trigger} onCancel={() => setManuscriptVersionDialog(undefined)} />}
    {restoreVersion && <RestoreVersionDialog item={restoreVersion} busy={busy} trigger={restoreVersion.trigger} onCancel={() => setRestoreVersion(undefined)} onConfirm={restoreManuscriptVersion} />}
    {formDialog && <FormDialog config={formDialog} busy={busy} onCancel={() => setFormDialog(undefined)} onSubmit={submitFormDialog} />}
    {noteCreateDialog && <NoteCreateDialog busy={busy} onCancel={() => setNoteCreateDialog(undefined)} onSubmit={submitNoteCreate} trigger={noteCreateDialog.trigger} />}
    {canvasDialog && <CanvasChoiceDialog busy={busy} onCancel={() => setCanvasDialog(undefined)} onSubmit={submitCanvasChoice} trigger={canvasDialog.trigger} />}
    {noteAction?.kind === 'rename' && <NoteRenameDialog initialTitle={noteAction.title} busy={busy} trigger={noteAction.trigger} onCancel={() => setNoteAction(undefined)} onSubmit={submitNoteRename} />}
    {noteAction?.kind === 'delete' && <NoteDeleteDialog title={noteAction.title} phase={noteAction.phase} referenceMessage={noteAction.referenceMessage} busy={busy} trigger={noteAction.trigger} onCancel={() => setNoteAction(undefined)} onConfirm={() => confirmNoteDelete(noteAction.phase === 'references' ? 'remove-references' : 'reject')} />}
    {canvasAction?.kind === 'rename' && <CanvasRenameDialog initialTitle={canvasAction.title} busy={busy} trigger={canvasAction.trigger} onCancel={() => setCanvasAction(undefined)} onSubmit={submitCanvasRename} />}
    {canvasAction?.kind === 'delete' && <CanvasDeleteDialog title={canvasAction.title} error={canvasAction.error} busy={busy} trigger={canvasAction.trigger} onCancel={() => setCanvasAction(undefined)} onConfirm={confirmCanvasDelete} />}
    {manuscriptDelete && <ManuscriptDeleteDialog key={`${manuscriptDelete.kind}:${manuscriptDelete.id}`} item={manuscriptDelete} busy={busy} onCancel={() => setManuscriptDelete(undefined)} onConfirm={confirmManuscriptDelete} />}
    {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(undefined)} />}
  </div>;
}
