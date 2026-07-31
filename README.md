# Weave Phase 1

Weave is an offline desktop writing vertical slice. It uses a React/TypeScript renderer behind a narrow typed Tauri command boundary and keeps each project in a visible `<project>/.weave/` directory (`project.db`, `files/`, `backups/`, and `exports/`). No server, network, Docker process, or cloud service is required.

## Run

```sh
npm install
npm test
npm run build
# desktop development (requires the Tauri 2 system toolchain)
npm run desktop:dev
```

The first launch can create or open a project directory. The starter project contains a story, chapter, and two scenes. The browser/Vite fallback uses the in-memory repository for UI work; the desktop build uses SQLite through `src-tauri/`.

## Phase 1 behavior

- Structured, versioned document JSON is canonical; HTML is not persisted.
- Scene mode is an ordered view over independent scene documents. Chapter composition is never stored as a second source.
- Continuous drafting creates a new revisioned document and source revision. Returning to scenes always offers **Split automatically** (only whole paragraphs containing `***` or `Nova cena`) or **Keep separate**.
- Automatic split creates a new scene set transactionally and preserves the previous scene set and source snapshot. No marker means no split.
- Revision conflicts, migrations, SQLite integrity checks, backups, recovery, and save state are surfaced in the UI.
- PDF, DOCX, Markdown, and plain-text exports capture one revision first and use the editorial baseline: Times New Roman, 12 pt, double spacing, header, and page numbering where supported.

## Layout

- `src/domain/` — document model, deterministic scene rules, use-case repository contract, in-memory repository.
- `src/infrastructure/` — SQLite development/recovery repository and typed Tauri command adapter.
- `src/export/` — deterministic editorial renderers and a dependency-free DOCX/PDF writer.
- `src/app/` — renderer only; it calls repository use cases and never reads SQL/files.
- `src-tauri/` — SQLite-backed desktop command implementation and filesystem safeguards.

## Scope and assumptions

This slice intentionally excludes worldbuilding, React Flow, collaboration, sync, plugins, and runtime Docker. The desktop file picker is represented by the smallest local path prompt in this slice; a native picker can replace that UI without changing the repository boundary. The editorial export writer is local-only and deterministic rather than a cloud or office conversion service.
