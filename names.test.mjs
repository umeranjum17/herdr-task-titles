import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NAME_SETS, chooseName, nameAgent } from './names.mjs';

const configDir = await mkdtemp(join(tmpdir(), 'herdr-agent-names-'));
after(() => rm(configDir, { recursive: true, force: true }));

const agent = (pane_id, name, kind = 'claude') => ({ pane_id, agent: kind, name });
const first = () => 0;

describe('agent names', () => {
    it('names only real agents with a blank or internal name', () => {
        const names = ['neon', 'gold'];
        assert.equal(chooseName([agent('p1', '')], 'p1', names, first), 'neon');
        assert.equal(chooseName([agent('p1', null)], 'p1', names, first), 'neon');
        assert.equal(chooseName([agent('p1', 'pp_abc')], 'p1', names, first), 'neon');
        assert.equal(chooseName([agent('p1', 'pph_abc')], 'p1', names, first), 'neon');
        assert.equal(chooseName([agent('p1', 'my manual name')], 'p1', names, first), undefined);
        assert.equal(chooseName([agent('p1', 'gold')], 'p1', names, first), undefined);
        assert.equal(chooseName([agent('p1', '', null)], 'p1', names, first), undefined, 'plain shell pane');
        assert.equal(chooseName([agent('p2', '')], 'p1', names, first), undefined, 'pane not listed yet');
    });

    it('picks an unused name and suffixes only when the set runs out', () => {
        const names = ['neon', 'gold'];
        assert.equal(chooseName([agent('p1', ''), agent('p2', 'neon')], 'p1', names, first), 'gold');
        const full = chooseName([agent('p1', ''), agent('p2', 'neon'), agent('p3', 'gold')], 'p1', names, first);
        assert.equal(full, 'neon-2');
    });

    it('renames through Herdr and honours the configured set', async () => {
        const calls = [];
        const agents = [agent('p1', 'pp_x'), agent('p2', 'neon')];
        const call = async (args) => {
            calls.push(args);
            return JSON.stringify({ result: { agents } });
        };
        const event = { data: { pane_id: 'p1' } };
        assert.deepEqual(await nameAgent({ event, configDir, call, random: first }), { status: 'named', name: 'gold' });
        assert.deepEqual(calls.at(-1), ['agent', 'rename', 'p1', 'gold']);

        await writeFile(join(configDir, 'settings.json'), '{ "names": "nato" }');
        assert.equal((await nameAgent({ event, configDir, call, random: first })).name, 'alfa');
        await writeFile(join(configDir, 'settings.json'), '{ "names": "off" }');
        assert.equal((await nameAgent({ event, configDir, call, random: first })).status, 'disabled');
        await writeFile(join(configDir, 'settings.json'), '{ "enabled": false }');
        assert.equal((await nameAgent({ event, configDir, call, random: first })).status, 'disabled');
        assert.equal(calls.filter((args) => args[1] === 'rename').length, 2);
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
