# herdr-task-titles

A Herdr plugin that gives each agent task a short, readable title — one a
person reads at a glance and knows which session it is. No network, no LLM,
no dependencies: titles come from signals the session already offers.

It is useful in muxr but it is not muxr-specific: it talks only to Herdr,
works with any client, and muxr shows Herdr's own names verbatim.

## What it does

When an agent reports `working` with a bound session, and only then, the
plugin publishes display-only pane title metadata (`pane report-metadata`,
source `plugin:herdr.task-titles`, 24h TTL). It titles each agent generation
at most once.

**What a name is derived from, in fallback order:**

1. **First task prompt** — the first user message in the agent's local
   transcript that states a real task: a task verb plus a short phrase,
   capped at 60 characters / 6 words. Launcher envelopes and boilerplate
   (`FIRSTMATE_OP:`, launch briefs, `AGENTS.md` headers, `# Task / # Rules`
   scaffolding, wrapper text) are skipped, never slugged. A session whose
   transcript opens with *"Fix the auth redirect bug in login flow"*
   becomes **"Fix auth redirect bug"** — not a slug of its launcher.
2. **Working directory** — the repo basename of the pane's foreground cwd
   (`/home/user/herdr-task-titles` → **"Herdr task titles"**). Generic
   directory names (`home`, `user`, `src`, `code`, …), dotfiles, and bare
   hashes are rejected.
3. **Nothing** — if neither signal beats what Herdr already shows, the
   plugin leaves the name alone rather than replace a good name with a
   worse one.

## Supported clients

One small adapter per client behind a single interface — given a Herdr
agent session, return the first real task prompt or nothing. The naming
logic never knows which client a session came from.

| Client | Transcript source | Verified |
|---|---|---|
| pi | session file from the Herdr ref, verbatim | ✅ drove against real sessions |
| claude | `<config>/projects/**/*.jsonl` lookup by session id | ✅ drove against real sessions |
| codex | `<codex-home>/sessions/**/*.jsonl` lookup by session id | ✅ drove against real sessions |
| opencode | `opencode.db` sqlite, first user message text parts, read-only | ✅ drove against real sessions |

Overrides: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_DATA_DIR`.
An absent or unreadable provider resolves to nothing and the plugin falls
back — it never throws, never blocks, never writes a guess.

## What it will not do

- **Never replaces someone else's naming.** If another naming plugin
  (`herdr-plugin-renamer`, `auto-namer`, or anything matching
  *renam*/*auto-nam*/*task-title*) is enabled, the hook reports `conflict`
  and writes nothing. Disable that writer deliberately before enabling
  this one. (`animal-namer` only writes agent identity names and coexists.)
- **Never touches existing titles.** A non-blank agent/pane title or a
  non-generic pane label (including a manual rename) is treated as owned
  and left alone.
- **Never touches identity.** Agent names, pane labels, branches,
  workspaces, and terminal titles are never written — only display-only
  title metadata via `report-metadata`.
- **Never saves prompt text.** The config directory holds only
  `settings.json` (`{ "enabled": true|false }`), per-generation markers
  (title hash, title, source, confidence, time), and `outcome.json` with
  the latest result.
- Herdr has no atomic compare-and-set for title metadata. The hook
  serializes its own attempts per pane, re-reads the generation, titles,
  and label immediately before publishing, and fails closed on any change.
  A competing writer acting between the final read and Herdr's write
  remains a platform limitation; the active-writer check avoids known
  competing hooks.

## Install

Requires Herdr ≥ 0.8.0 and `node` ≥ 20 on `PATH` (`node:sqlite` on 22+
is used for opencode when available, otherwise the `sqlite3` CLI).

```sh
git clone https://github.com/umeranjum17/herdr-task-titles.git
herdr plugin link /path/to/herdr-task-titles
herdr plugin list   # herdr.task-titles should appear, enabled
```

Disable any other naming plugin first (`herdr plugin disable
herdr-plugin-renamer`), otherwise this plugin yields and writes nothing.
Toggle without uninstalling:

```sh
# settings.json in the printed directory: { "enabled": false }
herdr plugin config-dir herdr.task-titles
```

## Uninstall

```sh
herdr plugin unlink herdr.task-titles   # or: herdr plugin uninstall herdr.task-titles
rm -rf "$(herdr plugin config-dir herdr.task-titles)"
```

No residue: the plugin keeps no state outside its own config directory,
and published titles expire via their 24h TTL.

## Adding a provider

1. Add `providers/<name>.mjs` exporting `{ id, label, promptFor }`.
   `promptFor(ref)` returns the first task-worthy user prompt or
   `undefined`, and never throws — use `safePrompt` and
   `firstTaskPrompt` from `providers/common.mjs` for the envelope skip
   and the title-worthiness gate.
2. Register one line in `providers/index.mjs` (`PROVIDERS`).
3. Add a fixture test in `titles.test.mjs`. If you cannot drive it
   against a real session, mark it unverified in the table above —
   never claim a provider works because the code looks right.

## Develop

```sh
npm test   # node built-in runner, zero dependencies; also runs in CI on every PR
```

## License

MIT — see [LICENSE](LICENSE).
