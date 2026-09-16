import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { firstUserPrompt, titleCandidate, titleFromRepo } from './title.mjs';
import { handleStatus } from './runtime.mjs';

const root = await mkdtemp(join(tmpdir(), 'muxr-task-titles-'));
const configDir = join(root, 'muxr.task-titles');
after(() => rm(root, { recursive: true, force: true }));

function rig({ label = null, title = null, session = 'generation-one', status = 'working', cwd = '/home/user/pockit' } = {}) {
    const pane = { pane_id: 'lab:p1', agent_session: { agent: 'codex', value: session }, label, title, cwd, foreground_cwd: cwd };
    const agent = { pane_id: 'lab:p1', agent_session: pane.agent_session, agent_status: status, name: 'Otter', title };
    const writes = [];
    const state = { online: true, writers: [] };
    const call = async (args) => {
        if (!state.online) throw new Error('Herdr offline');
        if (args[0] === 'plugin' && args[1] === 'list') return JSON.stringify({ result: { plugins: state.writers } });
        if (args[0] === 'pane' && args[1] === 'get') return JSON.stringify({ result: { pane } });
        if (args[0] === 'agent' && args[1] === 'get') return JSON.stringify({ result: { agent } });
        if (args[0] === 'pane' && args[1] === 'report-metadata') {
            writes.push(args);
            pane.title = args[args.indexOf('--title') + 1];
            agent.title = pane.title;
            return '{}';
        }
        throw new Error(`unexpected Herdr call: ${args.join(' ')}`);
    };
    return { pane, agent, writes, state, call, event: { data: { pane_id: pane.pane_id, agent_status: 'working' } } };
}

const transcript = [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md\nRules' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the auth redirect bug in login flow' }] } },
].map(JSON.stringify).join('\n');

describe('task titles', () => {
    it('takes the first real task once and leaves manual ownership alone', async () => {
        const { agent, pane, writes, call, event } = rig();
        const readPrompt = async () => firstUserPrompt('codex', transcript);

        assert.match((await handleStatus({ event, configDir, call, readPrompt })).status, /^titled$/);
        assert.equal(writes.length, 1);
        assert.equal(agent.name, 'Otter');
        assert.equal(pane.label, null);

        // A later manual rename owns both display fields; reconnect must not publish again.
        pane.label = 'My manual pane';
        pane.title = 'My manual task';
        agent.title = 'My manual task';
        agent.agent_status = 'idle';
        assert.equal((await handleStatus({ event: { data: { ...event.data, agent_status: 'idle' } }, configDir, call, readPrompt })).status, 'ignored');
        agent.agent_status = 'working';
        assert.equal((await handleStatus({ event, configDir, call, readPrompt })).status, 'already handled');
        assert.equal(writes.length, 1);
        assert.equal(agent.title, 'My manual task');
    });

    it('falls back to the repo directory when the prompt is boilerplate', async () => {
        const { writes, call, event } = rig({ session: 'generation-two', cwd: '/home/user/muxr-task-titles' });
        const result = await handleStatus({ event, configDir, call, readPrompt: async () => 'FIRSTMATE_OP: v1 launch-brief: You are a crewmate' });
        assert.equal(result.status, 'titled');
        assert.equal(result.title, 'Muxr task titles');
        assert.equal(writes.length, 1);
    });

    it('yields to other naming plugins and fails closed offline', async () => {
        const { writes, state, call, event } = rig({ session: 'generation-three' });
        state.writers = [{ plugin_id: 'herdr-plugin-renamer', name: 'Herdr Renamer', enabled: true, source: { kind: 'github' } }];
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth bug' })).status, 'conflict');
        state.writers = [];
        state.online = false;
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth bug' })).status, 'unavailable');
        assert.equal(writes.length, 0);
        assert.equal(JSON.parse(await readFile(join(configDir, 'outcome.json'), 'utf8')).status, 'unavailable');
    });

    it('derives titles from real signal, never from boilerplate', () => {
        assert.equal(titleCandidate('Fix the auth redirect bug in login flow').title, 'Fix auth redirect bug');
        assert.equal(titleCandidate('FIRSTMATE_OP: v1 launch-brief: You are a crewmate').title, undefined);
        assert.equal(titleCandidate('').reason, 'No task prompt yet.');
        assert.equal(titleFromRepo('/home/user/muxr-task-titles')?.title, 'Muxr task titles');
        assert.equal(titleFromRepo('/home/user'), undefined);
        assert.equal(titleFromRepo('/'), undefined);
    });
});
