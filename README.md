# Weave

Weave is an offline desktop writing and worldbuilding app. It uses a React/TypeScript renderer behind a narrow typed Tauri command boundary and keeps each project in a visible `<project>/.weave/` directory (`project.db`, `files/`, `backups/`, and `exports/`). No server, network, Docker process, or cloud service is required.

## Run

```sh
npm install
npm test
npm run build
# desktop development (requires the Tauri 2 system toolchain)
npm run desktop:dev
# desktop packaging (requires the Tauri 2 system toolchain)
npm run desktop:build
```

The first launch can create or open a project directory. The starter project contains a story, chapter, and two scenes. The browser/Vite fallback uses the in-memory repository for UI work; the desktop build uses SQLite through `src-tauri/`.

## Writing experience

- The editor uses a responsive, fixed-height document-sized page stack with comfortable margins. Long and styled content is reflowed across true page boundaries without an inner editor scroll region or clipping. The sidebar can collapse for more writing room.
- Font family, font size, line spacing, and page size (US Letter, A4, or US Legal) are available above the page and saved in the project style profile; they remain separate from canonical structured document JSON and are applied to PDF/DOCX exports.
- Project and scene naming use reusable modal dialogs; canceling a dialog leaves the current manuscript untouched.
- Writing saves automatically after a short typing pause. The saved/saving/error indicator stays visible, failed edits remain dirty for retry, and navigation, mode changes, exports, backups, and app close flush pending saves.
- The goals panel shows the local-calendar-day word target/progress and the project total. The target is persisted. Project totals count one active source per chapter: an open continuous draft replaces its scene set for counting; kept-separate/split drafts are historical and are not double-counted.

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

## Worldbuilding and story graph

- The left navigation has separate **Manuscript** and **Worldbuilding** workspaces. Manuscript behavior remains the revisioned writing slice; Worldbuilding contains its own local item, note, relationship, and canvas tools.
- Worlds, places/cities, characters, and terms have typed local properties and aliases. Relationships use stable IDs, so renaming updates every projection without breaking links.
- Users can create any number of persisted Markdown notes. Only exact `[[Target]]` and `[[Target|label]]` tokens are indexed—normal prose is never heuristically parsed. Targets resolve deterministically against exactly one title/alias (or are visibly unresolved and repairable); resolved note links and backlinks retain stable IDs across a rename.
- Outgoing links and backlinks combine typed domain relationships, Markdown wiki links, and explicit document anchors. Deleting a referenced item is refused by default; the explicit **remove references** path removes relationships/canvas placements and leaves document or Markdown links visible for repair.
- Search is entirely local and covers titles, aliases, typed properties/terms, relationship context, note titles, note Markdown, and explicit wiki-link text.
- React Flow canvases are separately user-created and persisted per story; no canvas is created implicitly. `@xyflow/react` is pinned to **12.11.2** in `package.json`/`package-lock.json`; it is the only canvas dependency. Run `npm audit --omit=dev` when updating it (the production dependency audit was clean at this pin).
- Canvas node positions and viewport are persisted separately from entities. Nodes project current domain labels; relationship edges reference validated relationship IDs. A keyboard-accessible outline lists every graph node and edge, while the graph supports focus, Delete placement removal, and Home-to-fit.

## Future roadmap

- Dark mode is planned as a future feature; the current writing palette remains intentionally light.

## Scope and assumptions

This local-only app intentionally excludes collaboration, sync, plugins, arbitrary schemas, AI extraction, hosted services, runtime Docker, general-purpose drawing tools, and any second/freeform canvas. The desktop file picker is represented by the smallest local path prompt in this slice; a native picker can replace that UI without changing the repository boundary. The editorial export writer is local-only and deterministic rather than a cloud or office conversion service.
