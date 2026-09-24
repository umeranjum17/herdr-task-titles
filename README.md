# herdr-task-titles

A Herdr plugin for all agent naming: each agent gets a short name you can
say out loud, and each agent task gets a short, readable title — one a
person reads at a glance and knows which session it is. No network, no LLM,
no dependencies: titles come from signals the session already offers.

It is useful in muxr but it is not muxr-specific: it talks only to Herdr,
works with any client, and muxr shows Herdr's own names verbatim.

## Agent names

When Herdr detects an agent, the agent's status changes, or its pane is
focused, the plugin gives that agent a name — but only if its Herdr name is
empty or starts with muxr's internal `pp_`/`pph_` launch prefixes. It:

- never renames an agent whose name is already set, including a manual
  rename;
- never names a plain shell pane, only panes running an agent;
- picks a random name no other agent is using, and adds a number
  (`bravo-2`) only once every name in the set is taken.

Names are picked to be easy to say and hear apart, for talking to agents
through a voice assistant: 1–3 syllables, no two starting with the same two
letters, no two that rhyme. `names.test.mjs` guards both lists.

| `names` | Names |
|---|---|
| `nato` (default) | alpha, bravo, charlie, delta, … juliet, … zulu (26 NATO phonetic alphabet words, familiar spellings) |
| `elements` | neon, gold, zinc, cobalt, silver, helium, nickel, oxygen, … (29 chemical elements) |
| `off` | agent naming off; task titles keep working |

Set it in `settings.json` in the plugin's config directory:

```sh
herdr plugin config-dir herdr.task-titles   # prints the directory
# settings.json: { "names": "elements" }
```

Naming is best effort: a manual rename landing at the same instant can be overwritten; rename again.

Changing the set names new agents only; existing names stay.

### Replacing a separate agent namer

If you already run a local plugin that names agents (for example an
`animal-namer` linked from `~/.herdr-plugins`), remove it once this plugin
is linked, so two plugins don't race to name the same agent:

```sh
herdr plugin list                  # find the old namer's id
herdr plugin unlink animal-namer   # or: herdr plugin disable animal-namer
```

Agents it already named keep their names; this plugin only fills blank ones.

## Task titles

When an agent reports `working` with a bound session, and only then, the
plugin publishes display-only pane title metadata (`pane report-metadata`,
source `plugin:herdr.task-titles`, 24h TTL). It titles each agent generation
once. The one exception: a repo-name title (written because the transcript
was not readable yet) is replaced once by a better title on a later
`working` event, provided nobody else has written over it.

**What a name is derived from, in fallback order:**

1. **First task prompt** — the first user message in the agent's local
   transcript that states a real task: a task verb plus a short phrase,
   capped at 60 characters / 6 words. Launcher envelopes and boilerplate
   (`FIRSTMATE_OP:`, launch briefs, `AGENTS.md` headers, `# Task / # Rules`
   scaffolding, wrapper text) are skipped, never slugged. A session whose
   transcript opens with *"Fix the auth redirect bug in login flow"*
   becomes **"Fix auth redirect bug"** — not a slug of its launcher.
   For a launch brief, a clear ask in its *Captain's intent* section wins;
   otherwise the task branch the brief creates (`git checkout -b
   fm/tt-title-fallback1` → **"Tt title fallback"**) names it, so agents
   launched in one repo get distinct titles.
2. **Task branch**: the pane's current git branch, when it is a prefixed
   task branch (`fm/checkout-race2` → **"Checkout race"**). `main` and
   other unprefixed branches say nothing about the task and are skipped.
3. **Working directory** — the repo basename of the pane's foreground cwd
   (`/home/user/herdr-task-titles` → **"Herdr task titles"**). Generic
   directory names (`home`, `user`, `src`, `code`, …), dotfiles, and bare
   hashes are rejected.
4. **Nothing** — if neither signal beats what Herdr already shows, the
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
  this one. This check is for task titles; a separate agent namer does not
  block titles, but see *Replacing a separate agent namer* above.
- **Never touches existing titles.** A non-blank agent/pane title or a
  non-generic pane label (including a manual rename) is treated as owned
  and left alone.
- **Titles never touch identity.** Titling never writes pane labels,
  branches, workspaces, or terminal titles — only display-only title
  metadata via `report-metadata`. The only identity it writes is a blank
  agent name (see Agent names).
- **Never saves prompt text.** The config directory holds only
  `settings.json` (`{ "enabled": true|false, "names": "nato" }`), per-generation markers
  (title hash, title, source, confidence, time), and `outcome.json` with
  the latest result.
- Herdr has no atomic compare-and-set for title metadata. The hook
  serializes its own attempts per pane, re-reads the generation, titles,
  and label immediately before publishing, and fails closed on any change.
  A competing writer acting between the final read and Herdr's write
  remains a platform limitation; the active-writer check avoids known
  competing hooks. A change that leaves the pane untitled (typically the
  agent being named at the same moment) gets exactly one re-check before
  giving up; it never loops.

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
Toggle the whole plugin (names and titles) without uninstalling:

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
and published titles expire via their 24h TTL. Agent names it gave are
ordinary Herdr names; rename them as usual.

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
