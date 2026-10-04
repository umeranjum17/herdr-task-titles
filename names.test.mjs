import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NAME_SETS, nameAgent } from './names.mjs';

const root = await mkdtemp(join(tmpdir(), 'herdr-agent-names-'));
const configDir = join(root, 'herdr.task-titles');
after(() => rm(root, { recursive: true, force: true }));

const agent = (pane_id, name, kind = 'claude') => ({ pane_id, agent: kind, name });
const first = () => 0;

describe('agent names', () => {
    // A fake Herdr: `agent list` and `agent rename`; a restart or relaunch blanks every name.
    function herd(agents) {
        const renames = [];
        const call = async (args) => {
            if (args[1] === 'list') return JSON.stringify({ result: { agents: agents.map((entry) => ({ ...entry })) } });
            if (args[1] === 'rename') {
                renames.push(args.slice(2));
                agents.find((entry) => entry.pane_id === args[2]).name = args[3];
                return '{}';
            }
            throw new Error('unexpected call');
        };
        const restart = () => agents.forEach((entry) => { entry.name = null; });
        return { agents, renames, call, restart };
    }
    const branches = { '/work/fm': 'fm/mx-task-titles-naming1', '/work/feat': 'feat/csv-export' };
    const readBranch = async (cwd) => branches[cwd];
    const name = (pane_id, h, extra = {}) => nameAgent({ event: { data: { pane_id } }, configDir, call: h.call, readBranch, random: first, ...extra });

    it('names a fresh agent after its work and re-derives the same name after a restart', async () => {
        const h = herd([
            { ...agent('w1', ''), cwd: '/work/fm' },
            { ...agent('w2', null), cwd: '/home/umer/pockit', title: 'Fix the auth redirect bug' },
            { ...agent('w3', 'pp_abc'), cwd: '/work/feat' },
            { ...agent('w4', ''), cwd: '/home/umer/shop' },
            { ...agent('w5', ''), cwd: '/home/umer/shop' },
            { ...agent('sh', '', null), cwd: '/work/fm' },
        ]);
        for (const pane of ['w1', 'w2', 'w3', 'w4', 'w5', 'sh']) await name(pane, h);
        assert.deepEqual(h.agents.map((entry) => entry.name),
            ['mx-task-titles-naming1', 'fix-auth-redirect', 'csv-export', 'shop', 'shop-2', ''], 'task id, title slug, branch, repo; shells untouched');
        // Herdr restart or agent relaunch: names are blank again and come back from the work.
        h.restart();
        for (const pane of ['w1', 'w2', 'w3', 'w4', 'w5']) await name(pane, h);
        assert.deepEqual(h.agents.slice(0, 5).map((entry) => entry.name), ['mx-task-titles-naming1', 'fix-auth-redirect', 'csv-export', 'shop', 'shop-2']);
        // The title the plugin derives later upgrades a name it issued itself.
        h.agents[3].title = 'Add CSV export to reports';
        assert.deepEqual(await name('w4', h), { status: 'named', name: 'add-csv-export' });
        assert.deepEqual(await name('w4', h), { status: 'already named', name: 'add-csv-export' });
    });

    it('never replaces a name set by a person or Firstmate, even after a restart', async () => {
        const h = herd([{ ...agent('m1', ''), cwd: '/home/umer/shop' }, { ...agent('m2', 'my manual name'), cwd: '/work/fm' }]);
        await name('m1', h);
        h.agents[0].name = 'crewhouse'; // Firstmate's one-time rename after ours
        h.agents[0].title = 'Fix checkout rounding';
        assert.equal((await name('m1', h)).status, 'owned elsewhere');
        assert.equal((await name('m2', h)).status, 'owned elsewhere', 'even over a Firstmate branch');
        h.restart();
        assert.deepEqual(await name('m1', h), { status: 'named', name: 'crewhouse' });
        assert.deepEqual(await name('m2', h), { status: 'named', name: 'my manual name' });
        assert.equal((await name('m1', h)).status, 'owned elsewhere');
    });

    it('lets go of a random name from 0.2.x once it is lost', async () => {
        const h = herd([{ ...agent('l1', 'papa'), cwd: '/work/fm' }]);
        assert.equal((await name('l1', h)).status, 'owned elsewhere', 'a live name is left alone');
        h.restart();
        assert.deepEqual(await name('l1', h), { status: 'named', name: 'mx-task-titles-naming1' });
    });

    it('draws random words only when opted in, and keeps them across a restart', async () => {
        const h = herd([agent('r1', 'pp_x'), agent('r2', 'alpha'), agent('r3', 'neon')]);
        await writeFile(join(configDir, 'settings.json'), '{ "names": "nato" }');
        assert.deepEqual(await name('r1', h), { status: 'named', name: 'bravo' });
        h.agents[1].name = 'bravo-2';
        h.agents[0].name = null;
        assert.deepEqual(await name('r1', h, { random: () => 0.99 }), { status: 'named', name: 'bravo' }, 'the issued word comes back');
        h.agents[0].name = '';
        await writeFile(join(configDir, 'settings.json'), '{ "names": "elements" }');
        assert.equal((await name('r1', h)).name, 'bravo', 'a changed set applies to new agents');
        await writeFile(join(configDir, 'settings.json'), '{ "names": "off" }');
        assert.equal((await name('r1', h)).status, 'disabled');
        await writeFile(join(configDir, 'settings.json'), '{ "enabled": false }');
        assert.equal((await name('r1', h)).status, 'disabled');
        await rm(join(configDir, 'settings.json'));
    });

    it('serializes concurrent names across panes', async () => {
        const agents = [{ ...agent('a', ''), cwd: '/home/umer/shop' }, { ...agent('b', ''), cwd: '/home/umer/shop' }];
        let releaseList;
        let firstList;
        const listed = new Promise((resolve) => { firstList = resolve; });
        const waitForRelease = new Promise((resolve) => { releaseList = resolve; });
        let lists = 0;
        const call = async (args) => {
            if (args[1] === 'list') {
                if (++lists === 1) { firstList(); await waitForRelease; }
                return JSON.stringify({ result: { agents: agents.map((entry) => ({ ...entry })) } });
            }
            if (args[1] === 'rename') {
                agents.find((entry) => entry.pane_id === args[2]).name = args[3];
                return '{}';
            }
            throw new Error('unexpected call');
        };
        const a = nameAgent({ event: { data: { pane_id: 'a' } }, configDir, call, random: first });
        await listed;
        const b = nameAgent({ event: { data: { pane_id: 'b' } }, configDir, call, random: first });
        releaseList();
        assert.equal((await a).name, 'shop');
        assert.equal((await b).name, 'shop-2');
        assert.equal(lists, 2);
    });

    it('recovers a leftover old naming lock', async () => {
        await mkdir(configDir, { recursive: true });
        const lock = join(configDir, 'agent-names.lock');
        await mkdir(lock);
        const old = new Date(Date.now() - 11_000);
        await utimes(lock, old, old);
        const calls = [];
        const call = async (args) => {
            calls.push(args);
            return JSON.stringify({ result: { agents: [{ ...agent('stale', ''), title: 'Fix login redirect' }] } });
        };
        assert.deepEqual(await nameAgent({ event: { data: { pane_id: 'stale' } }, configDir, call, random: first }), { status: 'named', name: 'fix-login-redirect' });
        assert.deepEqual(calls.at(-1), ['agent', 'rename', 'stale', 'fix-login-redirect']);
    });

    for (const [set, names] of Object.entries(NAME_SETS)) {
        it(`${set} names are short and easy to tell apart by ear`, () => {
            const lastSyllable = (name) => /[^aeiouy]?[aeiouy]+[^aeiouy]*$/.exec(name)[0];
            assert.ok(names.length >= 20, 'enough names for a busy machine');
            for (const name of names) {
                assert.match(name, /^[a-z]+$/);
                const syllables = name.replace(/e$/, '').match(/[aeiouy]+/g).length;
                assert.ok(syllables <= 3, `${name} is too long to say`);
            }
            for (const [i, a] of names.entries()) {
                for (const b of names.slice(i + 1)) {
                    assert.notEqual(a.slice(0, 2), b.slice(0, 2), `${a} and ${b} start alike`);
                    assert.notEqual(lastSyllable(a), lastSyllable(b), `${a} and ${b} rhyme`);
                }
            }
        });
    }
});
