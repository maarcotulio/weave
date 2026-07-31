# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Phase 1 architecture, scope, and run commands are documented in `README.md`; keep renderer persistence behind `src/domain/repository.ts` and the Tauri adapter.
- Validation gate is `npm test && npm run build`; desktop packaging additionally requires the Tauri 2 system toolchain.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
