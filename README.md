# muxr-task-titles

A Herdr plugin that gives each agent task a short, readable title — one a
person reads at a glance and knows which session it is. No network, no LLM,
no dependencies: titles come from signals the session already offers.

`muxr` itself shows Herdr's own names verbatim and does not bundle naming;
this plugin is the recommended third-party alternative.

## What it does

When an agent reports `working` with a bound session, and only then, the
plugin publishes display-only pane title metadata (`pane report-metadata`,
source `plugin:muxr.task-titles`, 24h TTL). It titles each agent generation
at most once.

**What a name is derived from, in fallback order:**

1. **First task prompt** — the first user message in the agent's local
   transcript (pi, claude, or codex) that states a real task: a task verb
   plus a short phrase, capped at 60 characters / 6 words.
   Launcher envelopes and boilerplate (`FIRSTMATE_OP:`, launch briefs,
   `AGENTS.md` headers, `# Task / # Rules` scaffolding, Captain's-intent
   wrapper text) are skipped, never slugged. Example: a session whose
   transcript opens with *"Fix the auth redirect bug in login flow"*
   becomes **"Fix auth redirect bug"** — not
   *"firstmate-op-v1-launch-brief-current"*.
2. **Working directory** — the repo basename of the pane's foreground cwd
   (`/home/user/muxr-task-titles` → **"Muxr task titles"**). Generic
   directory names (`home`, `user`, `src`, `code`, …), dotfiles, and bare
   hashes are rejected.
3. **Nothing** — if neither signal beats what Herdr already shows, the
   plugin leaves the name alone rather than replace a good name with a
   worse one.

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

Requires Herdr ≥ 0.8.0 and `node` ≥ 20 on `PATH`.

```sh
git clone https://github.com/umeranjum17/muxr-task-titles.git
herdr plugin link /path/to/muxr-task-titles
herdr plugin list   # task-titles should appear, enabled
```

Disable any other naming plugin first (`herdr plugin disable
herdr-plugin-renamer`), otherwise this plugin yields and writes nothing.
Toggle without uninstalling:

```sh
# settings.json in the printed directory: { "enabled": false }
herdr plugin config-dir muxr.task-titles
```

## Uninstall

```sh
herdr plugin unlink muxr.task-titles   # or: herdr plugin uninstall muxr.task-titles
rm -rf "$(herdr plugin config-dir muxr.task-titles)"
```

No residue: the plugin keeps no state outside its own config directory,
and published titles expire via their 24h TTL.

## Develop

```sh
npm test   # node built-in runner, zero dependencies
```

## License

MIT — see [LICENSE](LICENSE).
