# Project agent memory

- The project is local-only; preserve the Tauri 2 + React/TypeScript + Rust + SQLite boundary and do not introduce cloud, AI, network, or Docker runtime dependencies.
- Inspect the existing typed repository contract and Tauri adapter before changing persistence or commands; keep renderer persistence behind `src/domain/repository.ts` and the adapter.
- Preserve canonical structured manuscript data separately from presentation settings, and keep deterministic parsing/splitting rules explicit rather than heuristic.
- Keep React Flow projection/layout data separate from domain records and Markdown note data; React Flow is the sole canvas engine.
- Preserve autosave debounce, flush, revision, error/retry, backup, and recovery invariants when changing editing or navigation flows.
- Add focused tests for each domain, repository, export, and UI behavior change; the validation gate is `npm test && npm run build`.

## Responsibilities and authoritative files

- Manuscript models, scene rules, goals, pagination, autosave, and the repository contract belong in `src/domain/`.
- SQLite persistence and recovery belong in `src/infrastructure/sqlite-repository.ts`; desktop command translation belongs in `src/infrastructure/tauri-repository.ts` and `src-tauri/`.
- Export behavior belongs in `src/export/` and must remain deterministic.
- Renderer orchestration and presentation belong in `src/app/`; Worldbuilding UI is in `src/app/Worldbuilding.tsx`, while its persisted operations remain repository responsibilities.
- Project storage is visible under `.weave/`; use the README and the repository interfaces as the authoritative boundary descriptions.

## Durable phase status

- Completed: Phase 1 writing/persistence/export; writing UX, pagination, autosave, and goals; and Worldbuilding/React Flow with the current Markdown-notes-only clarification.
- Planned: the remaining single-sidebar UX correction; dark mode is implemented with presentation-only local preference storage.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
