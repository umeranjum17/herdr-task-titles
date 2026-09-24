// Herdr event hook: one serialized, fail-closed title attempt per bound agent
// generation. Standalone: no host RPC, no settings UI. `settings.json` holds
// `{ "enabled": true|false, "names": "elements"|"nato"|"off" }`; `outcome.json` holds the latest result.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { titleCandidate, titleFromRepo } from './title.mjs';
import { promptFor } from './providers/index.mjs';

const exec = promisify(execFile);
const SOURCE = 'plugin:herdr.task-titles';
// Another naming plugin owns the session: yield. animal-namer only writes
// agent identity names, so it can coexist.
const WRITERS = /(?:renam|auto.?nam|task.?title)/i;
const DEFAULT_LABELS = new Set(['', 'Shell', 'Terminal', 'Agent', 'Claude', 'Codex', 'Pi', 'Opencode']);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function herdr(args) {
    const { stdout } = await exec(process.env.HERDR_BIN_PATH || 'herdr', args, { timeout: 5000, maxBuffer: 512 * 1024 });
    return stdout.trim();
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

/** Herdr event hook: one serialized, fail-closed title attempt per bound agent generation. */
export async function handleStatus({ event, configDir, call = herdr, readPrompt = promptFor }) {
    if (event?.data?.agent_status !== 'working' || typeof event.data.pane_id !== 'string') return { status: 'ignored' };
    const dir = await privateDirectory(configDir);
    const config = await load(join(dir, 'settings.json'), { enabled: true });
    if (config.enabled === false) return { status: 'disabled' };
    const paneId = event.data.pane_id;
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
        if (await load(marker, undefined)) return { status: 'already handled' };
        if (!initialOwner(before)) return await outcome(dir, { status: 'owned elsewhere', reason: 'An existing title or pane label is already in use.' });
        const attemptFile = join(dir, `attempts-${before.generation}.json`);
        const attempts = await load(attemptFile, { count: 0 });
        if (!Number.isInteger(attempts.count) || attempts.count < 0 || attempts.count >= 2) {
            return { status: 'needs title', reason: 'Automatic title attempts are complete for this task.' };
        }
        await save(attemptFile, { count: attempts.count + 1 });
        let prompt;
        for (let attempt = 0; attempt < 12; attempt++) {
            prompt = await readPrompt(before.ref).catch(() => undefined);
            if (prompt) break;
            await wait(250);
        }
        let candidate = prompt ? titleCandidate(prompt) : undefined;
        // Weakest signal last: the repo directory. Still better than a
        // generic "Shell" label; anything worse leaves the name alone.
        if (!candidate?.title) {
            candidate = titleFromRepo(before.pane.foreground_cwd ?? before.pane.cwd) ?? candidate;
        }
        if (!candidate?.title) return await outcome(dir, { status: 'needs title', reason: candidate?.reason ?? 'No first task prompt was available.' });
        // The plugin registry, agent generation, title, and pane label are all
        // checked again under our lock immediately before the non-atomic write.
        if ((await writers(call)).length) return await outcome(dir, { status: 'conflict', reason: 'Another title writer became active.' });
        const current = await snapshot(call, paneId);
        if (!ownerMatches(before, current)) return await outcome(dir, { status: 'owned elsewhere', reason: 'Agent or title changed before publication.' });
        if ((await load(join(dir, 'settings.json'), { enabled: true })).enabled === false) return { status: 'disabled' };
        // A durable claim precedes the non-atomic Herdr write. If the process
        // dies after Herdr accepts it, reconnect cannot publish a second time.
        await save(marker, { status: 'publishing', at: new Date().toISOString() });
        await call(['pane', 'report-metadata', paneId, '--source', SOURCE, '--title', candidate.title,
            '--token', `herdr_task_title_hash=${displayHash(candidate.title)}`,
            '--token', `herdr_task_label_hash=${displayHash(before.pane.label ?? '')}`,
            '--ttl-ms', '86400000']);
        await save(marker, { status: 'published', title: candidate.title, source: SOURCE, confidence: candidate.confidence, at: new Date().toISOString() });
        return await outcome(dir, { status: 'titled', title: candidate.title, confidence: candidate.confidence, source: candidate.source });
    } catch (error) {
        return await outcome(dir, { status: 'unavailable', reason: error instanceof Error ? error.message.slice(0, 120) : 'Herdr unavailable.' });
    } finally { await rm(lock, { recursive: true, force: true }); }
}
