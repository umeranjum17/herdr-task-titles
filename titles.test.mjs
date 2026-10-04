import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { titleCandidate, titleFromBranch, titleFromRepo } from './title.mjs';
import { handleStatus } from './runtime.mjs';
import { promptFor } from './providers/index.mjs';
import { lastPromptFromMessages, opencodeAdapter } from './providers/opencode.mjs';

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
            if (args.includes('--clear-title')) {
                pane.title = '';
                dbAgent.title = '';
            } else {
                pane.title = args[args.indexOf('--title') + 1];
                dbAgent.title = pane.title;
            }
            return '{}';
        }
        throw new Error(`unexpected Herdr call: ${args.join(' ')}`);
    };
    return { pane, agent: dbAgent, writes, state, call, event: { data: { pane_id: pane.pane_id, agent_status: 'working' } } };
}

const codexTranscript = [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md\nRules' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the auth redirect bug in login flow' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Add dark mode to the Settings page' }] } },
].map(JSON.stringify).join('\n');

describe('task titles', () => {
    it('takes the latest real task once and leaves manual ownership alone', async () => {
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

    it('publishes titles without expiry so long-lived agents keep them', async () => {
        const { writes, call, event } = rig({ session: 'no-expiry' });
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth bug' })).status, 'titled');
        assert.equal(writes.length, 1);
        assert(!writes[0].includes('--ttl-ms'), 'title report must not carry a TTL');
    });

    it('restores a title lost to a Herdr restart when the agent resumes', async () => {
        const { pane, agent, writes, call, event } = rig({ session: 'resumed-session' });
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth redirect bug in login flow' })).status, 'titled');
        // Restart: Herdr keeps the pane and resumes the same session, but not the metadata.
        pane.title = '';
        agent.title = '';
        agent.agent_status = 'idle';
        const detected = { data: { pane_id: 'lab:p1', type: 'pane_agent_detected', agent: 'codex', released: false } };
        assert.deepEqual(await handleStatus({ event: detected, configDir, call }), { status: 'restored', title: 'Fix auth redirect bug' });
        assert.equal(pane.title, 'Fix auth redirect bug');
        assert.equal((await handleStatus({ event: detected, configDir, call })).status, 'ignored');
        assert(writes.every((args) => !args.includes('--ttl-ms')));
    });

    it('keeps task titles on when only the name set is configured', async () => {
        await writeFile(join(configDir, 'settings.json'), '{ "names": "elements" }');
        const { writes, call, event } = rig({ session: 'names-only-settings' });
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth bug' })).status, 'titled');
        assert.equal(writes.length, 1);
        await writeFile(join(configDir, 'settings.json'), '{ "enabled": true }');
    });

    it('falls back to the repo directory when the prompt is boilerplate', async () => {
        const { writes, call, event } = rig({ session: 'generation-two', cwd: '/home/user/herdr-task-titles' });
        const result = await handleStatus({ event, configDir, call, readPrompt: async () => 'FIRSTMATE_OP: v1 launch-brief: You are a crewmate', readBranch: async () => 'main' });
        assert.equal(result.status, 'titled');
        assert.equal(result.title, 'Herdr task titles');
        assert.equal(writes.length, 1);
    });

    it('gives brief-launched agents in one repo distinct titles', async () => {
        const brief = (task, intent) => `\u2063FIRSTMATE_OP: v1 launch-brief: # Current worker role contract\nYou are a crewmate.\n# Task\n## Captain's intent\n${intent}\n## Firstmate spec\nFix both in the plugin.\n# Setup\n1. First action: create your branch: \`git checkout -b fm/${task}\``;
        const titles = [];
        const cases = [
            ['tt-title-fallback1', "Why is everyone showing the name pockit? We need to align Herdr's title and name concepts properly, and have proper coverage of the naming plugins as well."],
            ['pock-lavish-proof1', 'Why does the lavish board flicker on open?'],
            ['pock-lrf1', 'Status update please.'],
        ];
        for (const [task, intent] of cases) {
            const { call, event } = rig({ session: `brief-${task}` });
            const result = await handleStatus({ event, configDir, call, readPrompt: async () => brief(task, intent), readBranch: async () => undefined });
            assert.equal(result.status, 'titled');
            titles.push(result.title);
        }
        // The intent's ask wins, then its "why" question; the branch only when the intent has neither.
        assert.deepEqual(titles, ["Align Herdr's title and name concepts", 'Lavish board flicker on open', 'Pock lrf']);
        assert.equal(titleCandidate(brief('tt-x1', 'Fix the auth redirect bug in login flow')).title, 'Fix auth redirect bug');
    });

    it('uses the task branch before the repo name when the prompt says nothing', async () => {
        const { call, event } = rig({ session: 'branch-fallback' });
        const result = await handleStatus({ event, configDir, call, readPrompt: async () => undefined, readBranch: async () => 'fm/checkout-race2' });
        assert.equal(result.title, 'Checkout race');
        assert.equal(titleFromBranch('main'), undefined);
        assert.equal(titleFromBranch('fm/0123abcd'), undefined);
    });

    it('re-checks a title raced by a naming write exactly once', async () => {
        const { agent, writes, call, event } = rig({ session: 'raced-once' });
        // The agent gets its name between our first read and the publish check.
        const readPrompt = async () => { agent.name = 'neon'; return 'Fix the auth bug'; };
        const result = await handleStatus({ event, configDir, call, readPrompt });
        assert.equal(result.status, 'titled');
        assert.equal(writes.length, 1);

        const busy = rig({ session: 'raced-forever' });
        let gets = 0;
        const churn = async (args) => {
            if (args[0] === 'agent' && args[1] === 'get') busy.agent.name = `name-${gets++}`;
            return busy.call(args);
        };
        assert.equal((await handleStatus({ event: busy.event, configDir, call: churn, readPrompt: async () => 'Fix the auth bug' })).status, 'owned elsewhere');
        assert.equal(gets, 3);
        assert.equal(busy.writes.length, 0);
    });

    it('upgrades its own repo-name title once the prompt is readable', async () => {
        const { agent, writes, call, event } = rig({ session: 'late-transcript' });
        const readBranch = async () => undefined;
        const first = await handleStatus({ event, configDir, call, readPrompt: async () => undefined, readBranch });
        assert.equal(first.title, 'Pockit');
        const second = await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth redirect bug in login flow', readBranch });
        assert.equal(second.title, 'Fix auth redirect bug');
        assert.equal(agent.title, 'Fix auth redirect bug');
        assert.equal(writes.length, 2);
    });

    it('refreshes the title when the same session reports a new task', async () => {
        const { agent, writes, call, event } = rig({ session: 'changed-task' });
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth redirect bug in login flow' })).title, 'Fix auth redirect bug');
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth redirect bug in login flow' })).status, 'already handled');
        const refreshed = await handleStatus({ event, configDir, call, readPrompt: async () => 'Add dark mode' });
        assert.equal(refreshed.status, 'titled');
        assert.equal(refreshed.title, 'Add dark mode');
        assert.equal(agent.title, 'Add dark mode');
        assert.equal(writes.length, 2);
        assert(writes.every((args) => !args.includes('--ttl-ms')), 'refresh must not reintroduce a TTL');
    });

    it('lets a new session replace our own stale title in the same pane', async () => {
        const first = rig({ session: 'stale-session' });
        assert.equal((await handleStatus({ event: first.event, configDir, call: first.call, readPrompt: async () => 'Fix the auth redirect bug in login flow' })).status, 'titled');
        const second = rig({ session: 'next-session', title: 'Fix auth redirect bug', label: null });
        second.pane.title = 'Fix auth redirect bug';
        const result = await handleStatus({ event: second.event, configDir, call: second.call, readPrompt: async () => 'Add dark mode' });
        assert.equal(result.status, 'titled');
        assert.equal(result.title, 'Add dark mode');
        assert.equal(second.writes.length, 1);
    });

    it('clears its own title when the agent exits and leaves foreign titles alone', async () => {
        const { pane, agent, writes, call, event } = rig({ session: 'exiting-agent' });
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth redirect bug in login flow' })).status, 'titled');
        assert.equal(writes.length, 1);
        const done = { data: { pane_id: 'lab:p1', agent_status: 'done' } };
        const cleared = await handleStatus({ event: done, configDir, call });
        assert.equal(cleared.status, 'cleared');
        assert.equal(cleared.title, 'Fix auth redirect bug');
        assert(writes.some((args) => args.includes('--clear-title')), 'exit must clear the published title');
        assert.equal(pane.title, '');
        assert.equal(agent.title, '');
        assert.equal((await handleStatus({ event: done, configDir, call })).status, 'already handled');
        // A title cleared on purpose is not "restored" by a later agent event,
        // but comes back once the agent works again (a relaunch resuming it).
        const detected = { data: { pane_id: 'lab:p1', type: 'pane_agent_detected', agent: 'codex', released: false } };
        assert.equal((await handleStatus({ event: detected, configDir, call })).status, 'ignored');
        assert.equal(pane.title, '');
        agent.agent_status = 'working';
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth redirect bug in login flow' })).title, 'Fix auth redirect bug');
        assert.equal(pane.title, 'Fix auth redirect bug');
        assert.equal((await handleStatus({ event: done, configDir, call })).status, 'cleared');

        pane.title = 'My manual task';
        agent.title = 'My manual task';
        const before = writes.length;
        assert.equal((await handleStatus({ event: done, configDir, call })).status, 'already handled');
        assert.equal(writes.length, before);
        assert.equal(pane.title, 'My manual task');
    });

    it('clears its own title when the detector releases the agent or the pane exits', async () => {
        const { pane, agent, writes, call, event } = rig({ session: 'released-agent' });
        assert.equal((await handleStatus({ event, configDir, call, readPrompt: async () => 'Fix the auth redirect bug in login flow' })).status, 'titled');
        // A plain detection (agent still there) must not touch anything.
        const before = writes.length;
        assert.equal((await handleStatus({ event: { data: { pane_id: 'lab:p1', type: 'pane_agent_detected', agent: 'codex', released: false } }, configDir, call })).status, 'ignored');
        assert.equal(writes.length, before);
        // The detector released the agent: the pane keeps our title, the agent record is gone.
        agent.title = undefined;
        const released = { data: { pane_id: 'lab:p1', type: 'pane_agent_detected', agent: null, released: true } };
        const cleared = await handleStatus({ event: released, configDir, call });
        assert.equal(cleared.status, 'cleared');
        assert.equal(cleared.title, 'Fix auth redirect bug');
        assert(writes.some((args) => args.includes('--clear-title')), 'release must clear the published title');
        assert.equal(pane.title, '');
        assert.equal((await handleStatus({ event: released, configDir, call })).status, 'already handled');

        // Same clearing when the pane process exits, even without a release flag.
        const second = rig({ session: 'exited-pane' });
        assert.equal((await handleStatus({ event: second.event, configDir, call: second.call, readPrompt: async () => 'Add dark mode' })).status, 'titled');
        const exited = { data: { pane_id: 'lab:p1', type: 'pane_exited', workspace_id: 'w1' } };
        assert.equal((await handleStatus({ event: exited, configDir, call: second.call })).status, 'cleared');
        assert.equal(second.pane.title, '');
        assert(second.writes.some((args) => args.includes('--clear-title')), 'exit must clear the published title');

        // A null agent outside a status event also signals the agent is gone.
        const third = rig({ session: 'null-agent' });
        assert.equal((await handleStatus({ event: third.event, configDir, call: third.call, readPrompt: async () => 'Fix the auth bug' })).status, 'titled');
        assert.equal((await handleStatus({ event: { data: { pane_id: 'lab:p1', agent: null } }, configDir, call: third.call })).status, 'cleared');
        assert.equal(third.pane.title, '');
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
    it('codex reads the latest real task from a session file', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'codex-'));
        try {
            await writeFile(join(dir, 'abc12345.jsonl'), codexTranscript);
            const prompt = await promptFor({ agent: 'codex', value: 'abc12345' }, { ...process.env, CODEX_HOME: dir });
            assert.equal(prompt, 'Add dark mode to the Settings page');
        } finally { await rm(dir, { recursive: true, force: true }); }
    });

    it('pi reads a direct transcript path and claude searches projects', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'pi-'));
        try {
            const piFile = join(dir, 'session.jsonl');
            await writeFile(piFile, [
                JSON.stringify({ type: 'message', message: { role: 'user', content: 'FIRSTMATE_OP: v1 launch-brief: noise' } }),
                JSON.stringify({ type: 'message', message: { role: 'user', content: 'Add dark mode to the Settings page' } }),
                JSON.stringify({ type: 'message', message: { role: 'user', content: 'Write release notes for version 0.3' } }),
            ].join('\n'));
            assert.equal(await promptFor({ agent: 'pi', value: piFile }), 'Write release notes for version 0.3');

            const projects = join(dir, 'projects', 'proj');
            await mkdir(projects, { recursive: true });
            await writeFile(join(projects, 'sess-9911.jsonl'), [
                JSON.stringify({ type: 'user', message: { content: 'Repair the checkout race condition' } }),
                JSON.stringify({ type: 'user', message: { content: 'Add dark mode to the Settings page' } }),
            ].join('\n'));
            const prompt = await promptFor({ agent: 'claude', value: 'sess-9911' }, { ...process.env, CLAUDE_CONFIG_DIR: join(dir, 'projects') });
            assert.equal(prompt, 'Add dark mode to the Settings page');
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
            { role: 'user', parts: [{ type: 'text', text: 'Add dark mode to the Settings page' }] },
        ];
        assert.equal(lastPromptFromMessages(messages), 'Add dark mode to the Settings page');
        assert.equal(lastPromptFromMessages([{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }]), undefined);
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
