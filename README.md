# Weave

Weave is a local-only Tauri 2 desktop writing and worldbuilding application built with a React/TypeScript renderer and a Rust backend.
The renderer talks through the typed repository contract and Tauri adapter; Rust persists project data in SQLite and applies filesystem safeguards.
Each opened project visibly stores its data in `<project>/.weave/`, including `project.db`, `files/`, `backups/`, and `exports/`.
There is no cloud service, sync, AI, Docker runtime, or network dependency.

## Completed phases

- **Phase 1 — writing, persistence, and export:** canonical versioned structured documents, scene/chapter operations, SQLite persistence, revision checks, migrations, integrity checks, backups/recovery, and deterministic PDF, DOCX, Markdown, and plain-text export are implemented.
- **Writing UX, pagination, autosave, and goals:** document-sized reflowed pages, responsive editing, style settings, dialogs, debounced local autosave with retry/flush and recovery status, and persisted daily/project word goals are implemented.
- **Worldbuilding, page notes, and selectable canvases:** local Markdown notes open in persistent page-oriented writing surfaces, while each new story canvas explicitly chooses React Flow or Excalidraw. React Flow projections and Excalidraw scene state are persisted locally.
- **Markdown-notes-only React Flow clarification:** React Flow canvases limit nodes to Markdown notes and resolved Markdown links; previous generic worldbuilding entities, scene nodes, relationships, and freeform drawing are not part of that projection.
- **Dark mode:** the renderer supports persisted light/dark themes with token-driven surfaces, editor controls, dialogs, and React Flow overrides.

## Product patterns

Canonical structured manuscript data is persisted separately from presentation settings such as font, spacing, and page size.
Continuous-to-scene splitting is deterministic and recognizes only whole paragraphs containing `***` or `Nova cena`; no marker means no split.
Autosave is local, revision-aware, and flushed on navigation, mode changes, exports, backups, and close; failed saves remain retryable.
Markdown notes recognize only exact `[[Target]]` and `[[Target|label]]` links, with unique local-note resolution and repairable unresolved links. Notes keep Markdown as their canonical source while their editor is presented as paginated writing paper.
Each canvas persists an explicit `react-flow` or `excalidraw` engine. Existing records migrate to `react-flow`; React Flow positions/viewport remain projection/layout data separate from note Markdown, while Excalidraw stores JSON-safe elements, app state, and local files with revision checks.
The theme choice is presentation-only: it is stored in browser/webview local storage under `weave.theme`, never in the project repository, and defaults to light when absent or unavailable. The inline bootstrap applies a valid saved choice before the renderer loads to avoid a light-mode flash.

## Run and validate

```sh
npm install
npm test
npm run build
npm run desktop:dev    # requires the Tauri 2 system toolchain
npm run desktop:build  # requires the Tauri 2 system toolchain
```

The Vite/browser fallback uses the in-memory repository for UI work; the desktop build uses SQLite through `src-tauri/`.

Excalidraw uses the maintained `@excalidraw/excalidraw` **0.18.1** package (MIT license; peer-compatible with React 18). Its package-bundled CSS and font assets are shipped locally with the desktop bundle, so no runtime network or collaboration service is required. The engine is intentionally not tldraw or another substitute.

## Authoritative boundaries

- `src/domain/` contains document types, deterministic scene rules, goals, pagination, autosave, and the repository contract.
- `src/infrastructure/` contains the SQLite repository and typed Tauri adapter.
- `src/export/` contains deterministic editorial exporters.
- `src/app/` contains renderer and UI behavior, including the Worldbuilding workspace and React Flow projection.
- `src-tauri/` contains the Rust commands and desktop filesystem/SQLite integration.

## Planned roadmap

- Complete the remaining single-sidebar UX correction and verify it across all workspace states.
- Revisit native file-picker UX and other scope expansions only as separately implemented work; they are not current features.
