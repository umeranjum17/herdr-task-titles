# herdr-task-titles

A [Herdr](https://herdr.dev) plugin that makes your agents easy to tell apart.

- **Every new agent gets a name** you can say out loud: `alpha`, `bravo`, `charlie`…
- **Every task gets a title** from what the agent is working on.

```text
bravo     Fix auth redirect bug
charlie   Add CSV export
delta     Checkout race
```

Titles come from the task you gave the agent, its git branch, or its repo
name. Everything runs locally, with no network calls and no dependencies.
Names and titles you set yourself are never changed.

Works with pi, Claude Code, Codex and opencode.

## Install

Requires Herdr 0.8.0 or later and Node.js 20 or later.

```sh
herdr plugin install umeranjum17/herdr-task-titles
```

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

Every name is short and sounds distinct, so they work well by voice. A
changed set applies to new agents; existing names stay.

Use one naming plugin at a time. If another is enabled, this one leaves task
titles to it.

## Turn it off

Pause names and titles:

```json
{ "enabled": false }
```

Or disable or remove the plugin:

```sh
herdr plugin disable herdr.task-titles
herdr plugin uninstall herdr.task-titles
```

## Develop

```sh
npm test
```

## License

MIT. See [LICENSE](LICENSE).
