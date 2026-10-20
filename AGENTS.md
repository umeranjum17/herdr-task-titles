# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Tests: `npm ci` first (one pinned dependency, `@byokit/herdr`); `npm test` then runs `journey.test.mjs`, one end-to-end journey against a real, isolated Herdr server it starts itself (needs `herdr` on PATH).
- Proving behavior against a real Herdr: plugin registrations are home-global, so an installed `herdr.task-titles` also fires in any lab session and races your code. Don't link the working copy; run `hook.mjs` directly with `HERDR_BIN_PATH` (a wrapper that scopes Herdr to the lab session), `HERDR_PLUGIN_CONFIG_DIR` (a private `.../herdr.task-titles` dir) and `HERDR_PLUGIN_EVENT_JSON`. A lab pane binds a pi session only when reported as the real integration does: the pane's foreground process must look like pi (`bash -c 'exec -a pi sleep 3600'`), then `pane report-agent-session --source herdr:pi --session-start-source startup --agent-session-path <file>` before `report-agent`, with an increasing `--seq` (see `journey.test.mjs`). In a lab HOME the `node` mise shim fails as a plugin command (untrusted config); link a scratch copy whose manifest uses an absolute node path.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
