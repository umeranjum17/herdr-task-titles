<h1 align="center">herdr-task-titles</h1>

<p align="center">
  <a href="https://github.com/umeranjum17/herdr-task-titles/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/umeranjum17/herdr-task-titles/ci.yml?style=flat&branch=main" /></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-666?style=flat" /></a>
  <img alt="Herdr 0.8.0+" src="https://img.shields.io/badge/Herdr-0.8.0%2B-111?style=flat" />
  <img alt="Linux and macOS" src="https://img.shields.io/badge/Linux%20%7C%20macOS-111?style=flat" />
</p>

<p align="center">
  <strong>Every agent a name. Every task a title.</strong><br/>
  A <a href="https://herdr.dev">Herdr</a> plugin that makes a screen full of agents easy to tell apart. Each new agent gets a short name you can say out loud, and each pane is titled with what its agent is working on, read from the task you gave it.
</p>

<h3 align="center"><a href="#install"><ins>Install</ins></a></h3>

<p align="center">
  <img src="docs/herd.png" alt="Herdr with three agents named romeo, xray and papa in the sidebar; their panes are titled Fix checkout total rounding in cart.js, Fix login redirect bug, and Csv export" width="960" />
</p>

## Why it exists

Run a few agents side by side and they all look alike: every pane says `pi` or `claude`, every agent is unnamed, and finding the one fixing the login bug means reading terminals. This plugin names and titles them for you, so you can glance at the screen, or say "romeo" out loud, and know which is which.

## See it in action

### Names you can say out loud

Every new agent gets a short, distinct name: `alpha`, `bravo`, `charlie` … `zulu` by default, or chemical elements if you prefer. No two names in a set rhyme or start the same way, so they work by voice. When every name is taken, the set continues as `alpha-2`, `bravo-2` and so on. Names you set yourself are never changed, and plain shell panes are left alone.

### A title from the task

The pane title comes from the strongest signal available, in order:

1. **The task you gave the agent**, read from its latest prompt: `Fix checkout total rounding in cart.js`.
2. **The task branch** it is working on: `feat/csv-export` becomes `Csv export`.
3. **The repository name**, when there is nothing better: `Shop`.

A title from a prompt is at most six words. Unclear prose is skipped rather than guessed at, and a title or pane label you set yourself is never replaced.

### Keeps up when the task changes

Give the agent a new task and its title follows. A first guess from the repository name is upgraded as soon as the agent's prompt can be read.

<p align="center">
  <img src="docs/task-change.png" alt="The same Claude Code pane before and after a new task: its title changes from Fix login redirect bug to Add a test for the admin" width="820" />
</p>

**Also:**

- **Local only.** Prompts are read from the agent's own session files on your machine. No network calls, no npm dependencies.
- **Plays fair.** If another naming or task-title plugin is enabled, this one leaves titles to it. Use one at a time.

## Install

You need [Herdr](https://herdr.dev) 0.8.0 or newer and [Node.js](https://nodejs.org/) 20 or newer, on Linux or macOS.

```sh
herdr plugin install umeranjum17/herdr-task-titles
```

Then:

1. Check it is enabled: `herdr plugin list` shows `herdr.task-titles`.
2. Start an agent in any Herdr pane, for example `pi` or `claude`. It gets a name in the sidebar.
3. Give it a task. Once it starts working, the pane title shows what it is working on.

## Use the agents you already have

Names work for any agent Herdr detects. Task titles read prompts from:

- pi
- Claude Code
- Codex
- opencode (needs Node.js 22.5 or newer, or the `sqlite3` command)

## Configure

Settings live in `settings.json` in the plugin's config directory:

```sh
herdr plugin config-dir herdr.task-titles
```

Choose a name set with `names`:

```json
{ "names": "elements" }
```

| `names` | Agents are named |
|---|---|
| `nato` (default) | alpha, bravo, charlie, delta … zulu |
| `elements` | neon, gold, zinc, cobalt, silver, helium … |
| `off` | not at all; task titles still work |

A changed set applies to new agents; existing names stay.

### Turn it off

Pause names and titles:

```json
{ "enabled": false }
```

Or disable or remove the plugin:

```sh
herdr plugin disable herdr.task-titles
herdr plugin uninstall herdr.task-titles
```

## Development

```sh
git clone https://github.com/umeranjum17/herdr-task-titles
cd herdr-task-titles
npm test
```

Adding a provider means one adapter file in `providers/` and one line in `providers/index.mjs`.

## License

MIT. See [LICENSE](LICENSE).
