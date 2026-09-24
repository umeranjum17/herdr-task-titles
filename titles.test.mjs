import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { titleCandidate, titleFromRepo } from './title.mjs';
import { handleStatus } from './runtime.mjs';
import { promptFor } from './providers/index.mjs';
import { firstPromptFromMessages, opencodeAdapter } from './providers/opencode.mjs';

const root = await mkdtemp(join(tmpdir(), 'herdr-task-titles-'));
const configDir = join(root, 'herdr.task-titles');
after(() => rm(root, { recursive: true, force: true }));

function rig({ label = null, title = null, session = 'generation-one', agent = 'codex', status = 'working', cwd = '/home/user/pockit' } = {}) {
    const pane = { pane_id: 'lab:p1', agent_session: { agent, value: session }, label, title, cwd, foreground_cwd: cwd };
    const dbAgent = { pane_id: 'lab:p1', agent_session: pane.agent_session, agent_status: status, name: 'Otter', title };
    const writes = [];
    const state = { online: true, writers: [] };
    const call = async (args) => {
        if (!state.online) throw new Error('Herdr offline');
        if (args[0] === 'plugin' && args[1] === 'list') return JSON.stringify({ result: { plugins: state.writers } });
        if (args[0] === 'pane' && args[1] === 'get') return JSON.stringify({ result: { pane } });
        if (args[0] === 'agent' && args[1] === 'get') return JSON.stringify({ result: { agent: dbAgent } });
        if (args[0] === 'pane' && args[1] === 'report-metadata') {
            writes.push(args);
            pane.title = args[args.indexOf('--title') + 1];
            dbAgent.title = pane.title;
            return '{}';
        }
        throw new Error(`unexpected Herdr call: ${args.join(' ')}`);
    };
    return { pane, agent: dbAgent, writes, state, call, event: { data: { pane_id: pane.pane_id, agent_status: 'working' } } };
}

const codexTranscript = [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md\nRules' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the auth redirect bug in login flow' }] } },
].map(JSON.stringify).join('\n');

describe('task titles', () => {
    it('takes the first real task once and leaves manual ownership alone', async () => {
        const { agent, pane, writes, call, event } = rig();
        const readPrompt = async () => 'Fix the auth redirect bug in login flow';

        assert.match((await handleStatus({ event, configDir, call, readPrompt })).status, /^titled$/);
        assert.equal(writes.length, 1);
        assert.equal(agent.name, 'Otter');
        assert.equal(pane.label, null);

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

    it('keeps task titles on when only the name set is configured', async () => {
        await writeFile(join(configDir, 'settings.json'), '{ "names": "nato" }');
        const { writes, call, event } = rig({ session: 'names-only-settings' });
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth bug' })).status, 'titled');
        assert.equal(writes.length, 1);
        await writeFile(join(configDir, 'settings.json'), '{ "enabled": true }');
    });

    it('falls back to the repo directory when the prompt is boilerplate', async () => {
        const { writes, call, event } = rig({ session: 'generation-two', cwd: '/home/user/herdr-task-titles' });
        const result = await handleStatus({ event, configDir, call, readPrompt: async () => 'FIRSTMATE_OP: v1 launch-brief: You are a crewmate' });
        assert.equal(result.status, 'titled');
        assert.equal(result.title, 'Herdr task titles');
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
        assert.equal(titleFromRepo('/home/user/herdr-task-titles')?.title, 'Herdr task titles');
        assert.equal(titleFromRepo('/home/user'), undefined);
        assert.equal(titleFromRepo('/'), undefined);
    });
});

describe('provider adapters', () => {
    it('codex reads the first real task from a session file', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'codex-'));
        try {
            await writeFile(join(dir, 'abc12345.jsonl'), codexTranscript);
            const prompt = await promptFor({ agent: 'codex', value: 'abc12345' }, { ...process.env, CODEX_HOME: dir });
            assert.equal(prompt, 'Fix the auth redirect bug in login flow');
        } finally { await rm(dir, { recursive: true, force: true }); }
    });

    it('pi reads a direct transcript path and claude searches projects', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'pi-'));
        try {
            const piFile = join(dir, 'session.jsonl');
            await writeFile(piFile, [
                JSON.stringify({ type: 'message', message: { role: 'user', content: 'FIRSTMATE_OP: v1 launch-brief: noise' } }),
                JSON.stringify({ type: 'message', message: { role: 'user', content: 'Add dark mode to the Settings page' } }),
            ].join('\n'));
            assert.equal(await promptFor({ agent: 'pi', value: piFile }), 'Add dark mode to the Settings page');

            const projects = join(dir, 'projects', 'proj');
            await mkdir(projects, { recursive: true });
            await writeFile(join(projects, 'sess-9911.jsonl'), [
                JSON.stringify({ type: 'user', message: { content: 'Repair the checkout race condition' } }),
            ].join('\n'));
            const prompt = await promptFor({ agent: 'claude', value: 'sess-9911' }, { ...process.env, CLAUDE_CONFIG_DIR: join(dir, 'projects') });
            assert.equal(prompt, 'Repair the checkout race condition');
        } finally { await rm(dir, { recursive: true, force: true }); }
    });

    it('unknown providers and missing sessions resolve to nothing', async () => {
        assert.equal(await promptFor({ agent: 'nope', value: 'x' }), undefined);
        assert.equal(await promptFor({ agent: 'codex', value: 'does-not-exist' }, { ...process.env, CODEX_HOME: root }), undefined);
        assert.equal(await promptFor({ agent: 'opencode', value: 'nope!!!' }), undefined);
    });

    it('opencode assembles user text from message parts', () => {
        const messages = [
            { role: 'user', parts: [{ type: 'step-start' }, { type: 'text', text: 'FIRSTMATE_OP: v1 launch-brief: noise' }] },
            { role: 'assistant', parts: [{ type: 'text', text: 'working on it' }] },
            { role: 'user', parts: [{ type: 'text', text: 'Investigate the slow query on dashboards' }] },
        ];
        assert.equal(firstPromptFromMessages(messages), 'Investigate the slow query on dashboards');
        assert.equal(firstPromptFromMessages([{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }]), undefined);
    });

    it('opencode reads a real session database', async () => {
        let DatabaseSync;
        try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return; }
        const dir = await mkdtemp(join(tmpdir(), 'opencode-'));
        try {
            const db = new DatabaseSync(join(dir, 'opencode.db'));
            db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)');
            db.exec('CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)');
            db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run('m1', 'ses_test0001', 1, 1, JSON.stringify({ role: 'user' }));
            db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)').run('p1', 'm1', 'ses_test0001', 1, 1, JSON.stringify({ type: 'text', text: 'Migrate billing to metered plans' }));
            db.close();
            const prompt = await opencodeAdapter.promptFor({ agent: 'opencode', value: 'ses_test0001' }, { ...process.env, OPENCODE_DATA_DIR: dir });
            assert.equal(prompt, 'Migrate billing to metered plans');
        } finally { await rm(dir, { recursive: true, force: true }); }
    });
});
