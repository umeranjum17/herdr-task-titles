// Agent names: fill blank agent names with a short, voice-friendly word.
// Herdr owns agent names; a name that is already set (including a manual
// rename) is never touched. `settings.json` `names` picks the set.
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { herdr, json, load, privateDirectory } from './runtime.mjs';

// Curated by ear for a voice assistant: 1-3 syllables, every name starts
// with different letters, and no two rhyme (one of neon/xenon/argon, one
// -dium, one -gen, ...). names.test.mjs guards the list.
export const NAME_SETS = {
    elements: [
        'neon', 'gold', 'zinc', 'cobalt', 'silver', 'helium', 'nickel', 'oxygen',
        'bismuth', 'mercury', 'chlorine', 'arsenic', 'lithium', 'sodium', 'carbon',
        'iron', 'krypton', 'platinum', 'phosphorus', 'osmium', 'thorium', 'erbium',
        'tungsten', 'hafnium', 'francium', 'strontium', 'tantalum', 'lead', 'manganese',
    ],
    nato: [
        'alfa', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
        'india', 'juliett', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
        'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
        'xray', 'yankee', 'zulu',
    ],
};

// muxr hides its internal launch names, which is what surfaces as "Unnamed agent".
const needsName = (name) => !name || name.startsWith('pp_') || name.startsWith('pph_');

/** Pick a name for `paneId`, or undefined when it must be left alone. */
export function chooseName(agents, paneId, names, random = Math.random) {
    const target = agents.find((agent) => agent?.pane_id === paneId);
    // Only name a real agent, never a plain shell pane.
    if (!target?.agent || !needsName(target.name ?? '')) return undefined;
    const taken = new Set(agents.map((agent) => agent?.name).filter(Boolean));
    if (!names.length) return undefined;
    const free = names.filter((name) => !taken.has(name));
    if (free.length) return free[Math.floor(random() * free.length)];
    for (let suffix = 2; ; suffix++) {
        const available = names.map((name) => `${name}-${suffix}`).filter((name) => !taken.has(name));
        if (available.length) return available[Math.floor(random() * available.length)];
    }
}

/** Herdr event hook: name the event's agent if it has no real name yet. */
export async function nameAgent({ event, configDir, call = herdr, random = Math.random }) {
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
        if (config.enabled === false) return { status: 'disabled' };
        const names = NAME_SETS[config.names ?? 'elements'];
        if (!names) return { status: 'disabled' };
        const agents = json(await call(['agent', 'list'])).agents;
        if (!Array.isArray(agents)) return { status: 'unavailable' };
        const name = chooseName(agents, paneId, names, random);
        if (!name) return { status: 'owned elsewhere' };
        await call(['agent', 'rename', paneId, name]);
        return { status: 'named', name };
    } finally { await rm(lock, { recursive: true, force: true }); }
}
