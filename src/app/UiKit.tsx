const colorTokens = [
  ['Ink', '--ink'],
  ['Muted', '--muted'],
  ['Accent', '--accent'],
  ['Accent tint', '--accent-tint'],
  ['Paper', '--paper'],
  ['Panel', '--panel'],
  ['Line', '--line'],
  ['Error', '--error'],
] as const;

const spacingTokens = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-8', '--space-10'];

export function UiKit() {
  return <main className="ui-kit" aria-labelledby="ui-kit-title">
    <header className="ui-kit-header">
      <p className="eyebrow">INTERNAL REFERENCE</p>
      <h1 id="ui-kit-title">Weave UI kit</h1>
      <p>Existing visual language for the offline writing workspace. This page is intentionally available by direct URL only.</p>
    </header>

    <div className="ui-kit-sections">
      <section className="ui-kit-section" aria-labelledby="ui-kit-colors">
        <p className="eyebrow">TOKENS</p>
        <h2 id="ui-kit-colors">Colors</h2>
        <div className="ui-kit-color-grid">{colorTokens.map(([label, token]) => <div className="ui-kit-color" key={token}><span className="ui-kit-swatch" style={{ background: `var(${token})` }} aria-label={`${label} color`} /><span><strong>{label}</strong><code>{token}</code></span></div>)}</div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-type">
        <p className="eyebrow">TYPE SCALE</p>
        <h2 id="ui-kit-type">Typography</h2>
        <div className="ui-kit-type-samples"><p className="ui-kit-type-xl">Make room for the story.</p><p className="ui-kit-type-lg">Chapter and scene headings</p><p className="ui-kit-type-body">Readable body copy keeps attention on the manuscript and its structure.</p><p className="ui-kit-type-meta">META · LOCAL · REVISIONED</p></div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-spacing">
        <p className="eyebrow">LAYOUT TOKENS</p>
        <h2 id="ui-kit-spacing">Spacing</h2>
        <div className="ui-kit-spacing-list">{spacingTokens.map((token) => <div className="ui-kit-spacing-row" key={token}><code>{token}</code><span className="ui-kit-spacing-bar" style={{ width: `var(${token})` }} /><small>var({token})</small></div>)}</div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-buttons">
        <p className="eyebrow">ACTIONS</p>
        <h2 id="ui-kit-buttons">Buttons</h2>
        <div className="ui-kit-row"><button type="button" className="primary-button">Primary action</button><button type="button" className="secondary-button">Secondary action</button><button type="button" className="text-button">Text action</button><button type="button" className="danger-button">Destructive action</button><button type="button" className="secondary-button" disabled>Disabled</button></div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-fields">
        <p className="eyebrow">INPUTS</p>
        <h2 id="ui-kit-fields">Fields</h2>
        <div className="ui-kit-field-grid"><label className="ui-kit-field">Project name<input type="text" defaultValue="My story" /></label><label className="ui-kit-field">Page size<select defaultValue="letter"><option value="letter">US Letter</option><option value="a4">A4</option></select></label><label className="ui-kit-field ui-kit-field-wide">Notes<textarea defaultValue="A calm, focused writing surface." rows={3} /></label></div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-states">
        <p className="eyebrow">FEEDBACK</p>
        <h2 id="ui-kit-states">States</h2>
        <div className="ui-kit-state-grid"><p className="ui-kit-state ui-kit-state-success" role="status"><span aria-hidden="true">✓</span> All changes saved</p><p className="ui-kit-state ui-kit-state-saving" role="status"><span aria-hidden="true">●</span> Saving locally…</p><p className="ui-kit-state ui-kit-state-error" role="alert"><span aria-hidden="true">!</span> Could not save this revision.</p></div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-surfaces">
        <p className="eyebrow">CONTAINERS</p>
        <h2 id="ui-kit-surfaces">Surfaces</h2>
        <div className="ui-kit-surface-grid"><article className="ui-kit-surface ui-kit-surface-page"><strong>Page</strong><span>Workspace background</span></article><article className="ui-kit-surface ui-kit-surface-panel"><strong>Panel</strong><span>Grouped controls and navigation</span></article><article className="ui-kit-surface ui-kit-surface-paper"><strong>Paper</strong><span>Manuscript and note pages</span></article></div>
      </section>

      <section className="ui-kit-section" aria-labelledby="ui-kit-modal">
        <p className="eyebrow">DIALOGS</p>
        <h2 id="ui-kit-modal">Modal</h2>
        <div className="ui-kit-modal-preview" role="dialog" aria-labelledby="ui-kit-modal-title" aria-describedby="ui-kit-modal-description"><div className="ui-kit-modal-heading"><div><p className="eyebrow">MANUSCRIPT VERSIONS</p><h3 id="ui-kit-modal-title">Save a manuscript version</h3></div><button type="button" className="modal-close" aria-label="Close dialog preview">×</button></div><p id="ui-kit-modal-description">A labelled, local snapshot preserves the current manuscript.</p><label className="modal-field">Version label<input defaultValue="First complete draft" /></label><div className="modal-actions"><button type="button" className="text-button">Cancel</button><button type="button" className="primary-button">Save version</button></div></div>
      </section>

      <section className="ui-kit-section ui-kit-editor-section" aria-labelledby="ui-kit-editor">
        <p className="eyebrow">WRITING SURFACE</p>
        <h2 id="ui-kit-editor">Editor</h2>
        <div className="ui-kit-editor" aria-label="Editor pattern preview"><div className="ui-kit-editor-tools"><select aria-label="Block style" defaultValue="paragraph"><option value="paragraph">Paragraph</option><option value="heading">Heading 1</option></select><button type="button" className="format-button" aria-label="Toggle bold"><strong>B</strong></button><button type="button" className="format-button" aria-label="Toggle italic"><em>I</em></button><button type="button" className="format-button" aria-label="Toggle underline"><u>U</u></button></div><h3>Focused writing, predictable controls</h3><p>Editor controls stay available when a block receives focus, while the page remains quiet when moving the pointer across the manuscript.</p></div>
      </section>
    </div>
  </main>;
}

export default UiKit;
