# Vision

**Every agent a name. Every task a title.**

## Who it is for

Anyone who runs a few coding agents side by side in [Herdr](https://herdr.dev) — pi, Claude Code, Codex, opencode — and needs to tell them apart.

## The problem

Run a few agents side by side and they all look the same: every pane says `pi` or `claude`, every agent is unnamed, and finding the one fixing the login bug means reading terminals.

## Where we are going

A screen full of agents is easy to read at a glance. Each agent is named after its work, and each pane is titled with what that agent is doing right now. Give an agent a new task and its title and name follow; when it exits, the title is cleared.

The names and titles live in Herdr itself, so anything that shows Herdr's panes shows them as they are.

## Principles

- **Named from the work.** A name comes from the task, not a counter. Names you can say out loud (`nato`, `elements`) are a choice, not the default.
- **Plain words, never a guess.** A title is a few plain words from the strongest signal available: the task you gave, the task branch, then the repository. Unclear prose is skipped rather than guessed at.
- **Plays fair.** A name or title you set is never replaced, and the plugin steps aside if another naming plugin is enabled.
- **Local only.** Prompts are read from the agent's own session files on your machine. No network calls, and one pinned dependency.
- **Any agent you already use.** Adding a provider is one adapter file and one line.
- **For any user.** Nothing in the code, docs or defaults assumes a particular person, machine or setup.

## Quality bar

- Behaviour is proven against a real Herdr, not mocks: `npm test` runs one end-to-end journey in an isolated Herdr session it starts itself.
- The README shows real Herdr captures of each feature, in light and dark.

## What it is not

- Not an agent runner or a Herdr replacement. It only names agents and titles panes.
- Not a summariser. It does not send your prompts anywhere.
- Not the owner of your names. Your own names and titles, and another naming plugin you prefer, always win.

## What comes next

Releases and what each one shipped are on the [releases page](https://github.com/umeranjum17/herdr-task-titles/releases).
