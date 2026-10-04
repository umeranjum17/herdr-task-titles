// Agent names: name each agent after its work. A Firstmate worker (on an
// `fm/<task-id>` branch) is named by its task id, any other agent by a short
// slug of its task title. Herdr clears a name on relaunch and may lose it on
// restart, so the name is re-derived from the work, never drawn at random.
// A name set by a person or Firstmate is never replaced, and is remembered
// per pane so it comes back after a restart or relaunch. `settings.json`
// `names` opts into random words instead ("nato" or "elements").
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gitBranch, herdr, json, load, privateDirectory, save } from './runtime.mjs';
import { STOP, titleFromBranch, titleFromRepo } from './title.mjs';

// Curated by ear for a voice assistant: 1-3 syllables, every name starts
// with different letters, and no two rhyme (one of neon/xenon/argon, one
// -dium, one -gen, ...). names.test.mjs guards both lists.
export const NAME_SETS = {
    elements: [
        'neon', 'gold', 'zinc', 'cobalt', 'silver', 'helium', 'nickel', 'oxygen',
        'bismuth', 'mercury', 'chlorine', 'arsenic', 'lithium', 'sodium', 'carbon',
        'iron', 'krypton', 'platinum', 'phosphorus', 'osmium', 'thorium', 'erbium',
        'tungsten', 'hafnium', 'francium', 'strontium', 'tantalum', 'lead', 'manganese',
    ],
    nato: [
        'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
        'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
        'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
        'xray', 'yankee', 'zulu',
    ],
};
// Names 0.2.x drew at random before it kept a ledger: replaceable once lost,
// never pinned as someone's choice.
const LEGACY = new RegExp(`^(?:${Object.values(NAME_SETS).flat().join('|')})(?:-\\d+)?$`);

// muxr hides its internal launch names, which is what surfaces as "Unnamed agent".
const needsName = (name) => !name || name.startsWith('pp_') || name.startsWith('pph_');

/** "Fix agent naming at the root" -> "fix-agent-naming". */
export function slug(title) {
    const words = (title ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => !STOP.has(word));
    return words?.slice(0, 3).join('-') || undefined;
}

/** The work's name: Firstmate task id from its `fm/` branch, else a slug of the task title. */
async function workName(target, readBranch) {
    const cwd = target.foreground_cwd ?? target.cwd;
    const branch = await readBranch(cwd).catch(() => undefined);
    const task = /^fm\/([\w.-]+)$/.exec(branch ?? '')?.[1];
    return { task, title: slug(target.title), fallback: slug(titleFromBranch(branch)?.title ?? titleFromRepo(cwd)?.title) };
}

function unique(name, taken) {
    if (!taken.has(name)) return name;
    for (let suffix = 2; ; suffix++) if (!taken.has(`${name}-${suffix}`)) return `${name}-${suffix}`;
}

function randomName(words, taken, random) {
    for (let suffix = 1; ; suffix++) {
        const free = words.map((word) => (suffix === 1 ? word : `${word}-${suffix}`)).filter((name) => !taken.has(name));
        if (free.length) return free[Math.floor(random() * free.length)];
    }
}

/** Herdr event hook: name the event's agent after its work, unless someone else named it. */
export async function nameAgent({ event, configDir, call = herdr, random = Math.random, readBranch = gitBranch }) {
    const paneId = event?.data?.pane_id;
    if (typeof paneId !== 'string') return { status: 'ignored' };
    if (!configDir) return { status: 'unavailable' };
    const dir = await privateDirectory(configDir);
    const lock = join(dir, 'agent-names.lock');
    let locked = false;
    for (let attempt = 0; attempt < 24; attempt++) {
        try { await mkdir(lock); locked = true; break; }
        catch (error) { if (error?.code !== 'EEXIST') throw error; }
        try {
            if (Date.now() - (await stat(lock)).mtimeMs > 10_000) await rm(lock, { recursive: true, force: true });
        } catch (error) { if (error?.code !== 'ENOENT') throw error; }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!locked) return { status: 'busy' };
    try {
        const config = await load(join(dir, 'settings.json'), {});
        const set = config.names ?? 'work';
        if (config.enabled === false || (set !== 'work' && !NAME_SETS[set])) return { status: 'disabled' };
        const agents = json(await call(['agent', 'list'])).agents;
        if (!Array.isArray(agents)) return { status: 'unavailable' };
        const target = agents.find((agent) => agent?.pane_id === paneId);
        // Only name a real agent, never a plain shell pane.
        if (!target?.agent) return { status: 'ignored' };
        // Ledger per pane (pane ids survive a Herdr restart): the name we
        // issued, or the name a person or Firstmate chose, which always wins.
        const ledgerFile = join(dir, 'names.json');
        const ledger = await load(ledgerFile, {});
        const entry = ledger[paneId] ?? {};
        const current = target.name ?? '';
        if (!needsName(current) && current !== entry.issued) {
            const legacy = !entry.issued && !entry.manual && LEGACY.test(current);
            if (current !== entry.manual && !legacy) {
                ledger[paneId] = { manual: current };
                await save(ledgerFile, ledger);
            }
            return { status: 'owned elsewhere' };
        }
        const taken = new Set(agents.filter((agent) => agent?.pane_id !== paneId).map((agent) => agent?.name).filter(Boolean));
        let name = entry.manual;
        if (!name && set === 'work') {
            const work = await workName(target, readBranch);
            name = work.task ?? work.title ?? entry.issued ?? work.fallback;
        } else if (!name) name = entry.issued && !taken.has(entry.issued) ? entry.issued : randomName(NAME_SETS[set], taken, random);
        if (!name) return { status: 'needs name' };
        if (!entry.manual) name = unique(name, taken);
        if (name === current) return { status: 'already named', name };
        await call(['agent', 'rename', paneId, name]);
        if (!entry.manual) {
            ledger[paneId] = { issued: name };
            await save(ledgerFile, ledger);
        }
        return { status: 'named', name };
    } finally { await rm(lock, { recursive: true, force: true }); }
}
