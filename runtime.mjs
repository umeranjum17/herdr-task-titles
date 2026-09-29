// Herdr event hook: one serialized, fail-closed title per bound agent
// generation, refreshed while the agent lives when its task changes and
// cleared when it exits. Standalone: no host RPC, no settings UI. `settings.json` holds
// `{ "enabled": true|false, "names": "nato"|"elements"|"off" }`; `outcome.json` holds the latest result.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { titleCandidate, titleFromBranch, titleFromRepo } from './title.mjs';
import { promptFor } from './providers/index.mjs';

const exec = promisify(execFile);
const SOURCE = 'plugin:herdr.task-titles';
// Another naming plugin owns the session: yield. animal-namer only writes
// agent identity names, so it can coexist.
const WRITERS = /(?:renam|auto.?nam|task.?title)/i;
const DEFAULT_LABELS = new Set(['', 'Shell', 'Terminal', 'Agent', 'Claude', 'Codex', 'Pi', 'Opencode']);
// Confidence ladder for a derived title: a refresh or upgrade only ever
// replaces a published title with one at least this strong, never a weaker
// guess over a stronger one.
const CONFIDENCE_RANK = { 'repo name': 0, 'task branch': 1, 'clear task': 2 };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function herdr(args) {
    const { stdout } = await exec(process.env.HERDR_BIN_PATH || 'herdr', args, { timeout: 5000, maxBuffer: 512 * 1024 });
    return stdout.trim();
}

/** Current branch of the pane's cwd, or undefined. Never throws. */
export async function gitBranch(cwd) {
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) return undefined;
    try { return (await exec('git', ['-C', cwd, 'branch', '--show-current'], { timeout: 2000 })).stdout.trim() || undefined; }
    catch { return undefined; }
}

export function json(output) {
    const parsed = JSON.parse(output);
    if (parsed.error) throw new Error(parsed.error.message ?? 'Herdr call failed');
    return parsed.result ?? parsed;
}

export async function privateDirectory(dir) {
    if (!isAbsolute(dir) || !dir.endsWith('/herdr.task-titles')) throw new Error('Task titles config directory unavailable');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const details = await lstat(dir);
    if (!details.isDirectory() || details.isSymbolicLink() || details.uid !== process.getuid()) {
        throw new Error('Task titles config directory is not owner-controlled');
    }
    await chmod(dir, 0o700);
    return dir;
}

export async function load(file, fallback) {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

async function save(file, value) {
    const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
}

function key(value) { return createHash('sha256').update(value).digest('hex').slice(0, 24); }
function displayHash(value) { return createHash('sha256').update(value ?? '').digest('hex').slice(0, 16); }

async function snapshot(call, paneId) {
    const pane = json(await call(['pane', 'get', paneId])).pane;
    const agent = json(await call(['agent', 'get', paneId])).agent;
    if (!pane || !agent || pane.pane_id !== paneId || agent.pane_id !== paneId) return undefined;
    const ref = agent.agent_session;
    if (typeof ref?.value !== 'string' || !ref.value || typeof ref.agent !== 'string') return undefined;
    if (pane.agent_session?.value !== ref.value || pane.agent_session?.agent !== ref.agent) return undefined;
    return { pane, agent, generation: key(`${paneId}\0${ref.agent}\0${ref.value}`), ref };
}

function ownerMatches(before, after) {
    return after?.generation === before.generation && after.agent.agent_status === 'working'
        && after.agent.title === before.agent.title && after.pane.title === before.pane.title
        && after.pane.label === before.pane.label && after.agent.name === before.agent.name;
}

function initialOwner({ pane, agent }) {
    const title = agent.title?.trim() ?? '';
    const paneTitle = pane.title?.trim() ?? '';
    const label = pane.label?.trim() ?? '';
    return !title && !paneTitle && DEFAULT_LABELS.has(label);
}

// A title we published is still ours while neither the agent nor the pane
// title was changed to something else and the label is still default. This
// covers both the upgrade path (repo-name guess replaced once the prompt is
// readable) and refreshes (a new task in the same session).
function ownPublishedTitle({ pane, agent }, claimed) {
    return claimed?.status === 'published' && DEFAULT_LABELS.has(pane.label?.trim() ?? '')
        && [agent.title, pane.title].every((title) => !title?.trim() || title.trim() === claimed.title);
}

// Our own stale title from a previous agent session in the same pane: the
// pane is still ours, so a new generation may replace it. Anything else
// (including a manual rename) stays owned elsewhere.
function ownPriorTitle({ pane, agent }, prior) {
    return !!prior?.title && DEFAULT_LABELS.has(pane.label?.trim() ?? '')
        && [agent.title, pane.title].every((title) => !title?.trim() || title.trim() === prior.title);
}

async function writers(call) {
    const list = json(await call(['plugin', 'list', '--json'])).plugins;
    if (!Array.isArray(list)) throw new Error('Herdr plugin list unavailable');
    return list.filter((plugin) => plugin?.enabled === true && plugin.plugin_id !== 'herdr.task-titles'
        && plugin.plugin_id !== 'animal-namer'
        && (WRITERS.test(`${plugin.plugin_id} ${plugin.name ?? ''}`)
            || (plugin.events ?? []).some((event) => event.on === 'pane.agent_status_changed' && WRITERS.test(plugin.description ?? ''))))
        .map((plugin) => ({ id: plugin.plugin_id, name: plugin.name ?? plugin.plugin_id, source: plugin.source?.kind ?? 'local' }));
}

async function outcome(dir, result) {
    await save(join(dir, 'outcome.json'), { ...result, at: new Date().toISOString() });
    return result;
}

// The agent exited (`done` on the subscribed status event): clear the title
// we published so the pane falls back to the agent's name. A title that is
// no longer ours (manual rename, another writer) is left alone, as is a
// pane that already shows nothing. The session may already be unbound, so
// this checks the live titles directly instead of the bound generation.
async function clearOnExit({ paneId, dir, call }) {
    const lock = join(dir, `pane-${key(paneId)}.lock`);
    try { await mkdir(lock); } catch { return { status: 'busy' }; }
    try {
        const prior = await load(join(dir, `pane-${key(paneId)}.json`), undefined);
        if (!prior?.title) return { status: 'already handled' };
        let pane;
        try { pane = json(await call(['pane', 'get', paneId])).pane; }
        catch { return await outcome(dir, { status: 'unavailable', reason: 'Pane is gone.' }); }
        let agent;
        try { agent = json(await call(['agent', 'get', paneId])).agent; } catch { agent = undefined; }
        const shown = [pane?.title, agent?.title].filter((title) => title?.trim());
        if (!shown.length || !shown.every((title) => title.trim() === prior.title)) return { status: 'already handled' };
        await call(['pane', 'report-metadata', paneId, '--source', SOURCE, '--clear-title']);
        return await outcome(dir, { status: 'cleared', title: prior.title });
    } catch (error) {
        return await outcome(dir, { status: 'unavailable', reason: error instanceof Error ? error.message.slice(0, 120) : 'Herdr unavailable.' });
    } finally { await rm(lock, { recursive: true, force: true }); }
}

/** Herdr event hook: one serialized, fail-closed title per bound agent generation, refreshed on task change. */
export async function handleStatus({ event, configDir, call = herdr, readPrompt = promptFor, readBranch = gitBranch }) {
    const signal = event?.data?.agent_status;
    if (typeof event?.data?.pane_id !== 'string' || (signal !== 'working' && signal !== 'done')) return { status: 'ignored' };
    const dir = await privateDirectory(configDir);
    const config = await load(join(dir, 'settings.json'), { enabled: true });
    if (config.enabled === false) return { status: 'disabled' };
    const paneId = event.data.pane_id;
    if (signal === 'done') return await clearOnExit({ paneId, dir, call });
    const lock = join(dir, `pane-${key(paneId)}.lock`);
    try { await mkdir(lock); } catch { return { status: 'busy' }; }
    try {
        const active = await writers(call);
        if (active.length) return await outcome(dir, { status: 'conflict', writers: active });
        let before;
        for (let attempt = 0; attempt < 6; attempt++) {
            before = await snapshot(call, paneId).catch(() => undefined);
            if (before) break;
            await wait(250);
        }
        if (!before) return await outcome(dir, { status: 'unavailable', reason: 'Agent session is not bound.' });
        const marker = join(dir, `generation-${before.generation}.json`);
        const claimed = await load(marker, undefined);
        const prior = await load(join(dir, `pane-${key(paneId)}.json`), undefined);
        // A published title is refreshed when the agent's task changes: a
        // new latest prompt in the same session, or a new session replacing
        // our own stale title in the same pane.
        const owner = claimed ? (snap) => ownPublishedTitle(snap, claimed)
            : (snap) => initialOwner(snap) || ownPriorTitle(snap, prior);
        if (claimed && !owner(before)) return { status: 'already handled' };
        if (!owner(before)) return await outcome(dir, { status: 'owned elsewhere', reason: 'An existing title or pane label is already in use.' });
        if (!claimed) {
            const attemptFile = join(dir, `attempts-${before.generation}.json`);
            const attempts = await load(attemptFile, { count: 0 });
            if (!Number.isInteger(attempts.count) || attempts.count < 0 || attempts.count >= 2) {
                return { status: 'needs title', reason: 'Automatic title attempts are complete for this task.' };
            }
            await save(attemptFile, { count: attempts.count + 1 });
        }
        // A generation titled from a real prompt needs only one quick
        // re-read to detect a task change; the patient retry loop is for
        // generations that never saw a prompt yet (upgrade path).
        let prompt;
        const retries = claimed?.prompt == null ? 12 : 1;
        for (let attempt = 0; ; attempt++) {
            prompt = await readPrompt(before.ref).catch(() => undefined);
            if (prompt || attempt + 1 >= retries) break;
            await wait(250);
        }
        const promptHash = prompt ? displayHash(prompt) : null;
        let candidate = prompt ? titleCandidate(prompt) : undefined;
        // Weakest signal last: the repo directory. Still better than a
        // generic "Shell" label; anything worse leaves the name alone.
        if (!candidate?.title) {
            const cwd = before.pane.foreground_cwd ?? before.pane.cwd;
            candidate = titleFromBranch(await readBranch(cwd).catch(() => undefined)) ?? titleFromRepo(cwd) ?? candidate;
        }
        if (!candidate?.title) return await outcome(dir, { status: 'needs title', reason: candidate?.reason ?? 'No task prompt was available.' });
        // Same title, a weaker guess, or an unchanged prompt: nothing to do.
        if (claimed && (candidate.title === claimed.title
            || (CONFIDENCE_RANK[candidate.confidence] ?? 0) < (CONFIDENCE_RANK[claimed.confidence] ?? 0)
            || (promptHash != null && promptHash === claimed.prompt))) return { status: 'already handled' };
        // The plugin registry, agent generation, title, and pane label are all
        // checked again under our lock immediately before the non-atomic write.
        // A change that leaves the pane ours (the agent was just named) gets
        // exactly one re-check; anything else fails closed.
        for (let retry = 0; ; retry++) {
            if ((await writers(call)).length) return await outcome(dir, { status: 'conflict', reason: 'Another title writer became active.' });
            const current = await snapshot(call, paneId).catch(() => undefined);
            if (ownerMatches(before, current)) break;
            if (retry >= 1 || current?.generation !== before.generation || current.agent.agent_status !== 'working' || !owner(current)) {
                return await outcome(dir, { status: 'owned elsewhere', reason: 'Agent or title changed before publication.' });
            }
            before = current;
        }
        if ((await load(join(dir, 'settings.json'), { enabled: true })).enabled === false) return { status: 'disabled' };
        // No --ttl-ms: Herdr keeps metadata without a TTL until it is
        // replaced, cleared, or the pane closes, so a live agent's title
        // never expires. A durable claim precedes the non-atomic Herdr
        // write. If the process dies after Herdr accepts it, reconnect
        // cannot publish a second time.
        await save(marker, { status: 'publishing', at: new Date().toISOString() });
        await call(['pane', 'report-metadata', paneId, '--source', SOURCE, '--title', candidate.title,
            '--token', `herdr_task_title_hash=${displayHash(candidate.title)}`,
            '--token', `herdr_task_label_hash=${displayHash(before.pane.label ?? '')}`]);
        await save(marker, { status: 'published', title: candidate.title, source: SOURCE, confidence: candidate.confidence, prompt: promptHash, at: new Date().toISOString() });
        await save(join(dir, `pane-${key(paneId)}.json`), { generation: before.generation, title: candidate.title, at: new Date().toISOString() });
        return await outcome(dir, { status: 'titled', title: candidate.title, confidence: candidate.confidence, source: candidate.source });
    } catch (error) {
        return await outcome(dir, { status: 'unavailable', reason: error instanceof Error ? error.message.slice(0, 120) : 'Herdr unavailable.' });
    } finally { await rm(lock, { recursive: true, force: true }); }
}
