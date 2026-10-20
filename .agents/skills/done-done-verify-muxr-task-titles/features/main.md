# Main journey

Part of the muxr-task-titles verification map; the plugin's two behaviors: titles (the pane title comes from the agent's task, published through Herdr, cleared when the agent exits) and names (the agent is renamed after its work, from the `fm/<task>` branch).

## Sub-features

- Titles: hook.mjs titles the pane from the strongest signal (task prompt, task branch, repo name) and clears it on exit.
- Names: names.mjs names the agent after its work; a name or title the user set is never replaced.

## How to get to it (user POV)

Install the plugin (`herdr plugin install umeranjum17/herdr-task-titles`), start an agent in any pane and give it a task; its pane shows what it is working on.

## Driving it with a shell (run the launch command and read its output)

1. Run `npm test` (needs `herdr` on PATH): journey.test.mjs starts an isolated Herdr server, binds a pane to a real agent session, runs the real hook.mjs as a subprocess and asserts the title and name through Herdr.
2. Capture: save the TAP output and exit status under $DONE_DONE_EVIDENCE_ROOT, as SKILL.md's Evidence section says.
3. Nothing to stop: the journey kills its server and removes its scratch dir.

## Gotchas

- Herdr sockets must fit in sun_path, so the journey uses a short tmp base (HERDR_TEST_TMPDIR or /tmp); see the journey.test.mjs header.
- Plugin registrations are home-global, so never link the working copy into a live Herdr; run hook.mjs directly per AGENTS.md.
