# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Tests: `npm test` (see `titles.test.mjs`, `names.test.mjs`); zero dependencies.
- Proving behavior against a real Herdr: plugin registrations are home-global, so an installed `herdr.task-titles` also fires in any lab session and races your code. Don't link the working copy; run `hook.mjs` directly with `HERDR_BIN_PATH` (a wrapper that scopes Herdr to the lab session), `HERDR_PLUGIN_CONFIG_DIR` (a private `.../herdr.task-titles` dir) and `HERDR_PLUGIN_EVENT_JSON`. A lab pane binds an agent session only when reported as the real integration does: `pane report-agent-session` / `report-agent` with `--source herdr:pi` and an increasing `--seq`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
