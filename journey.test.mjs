// One end-to-end journey for the plugin, driven the way Herdr drives it:
// a real isolated Herdr server session, a real pane bound to a real agent
// session, the real `hook.mjs` entry point as a subprocess, and the real
// config/outcome files. No fake Herdr, no injected functions.
//
// The journey covers both features the deleted unit tests covered:
//   titles  the pane title is derived from the real task transcript,
//           published through Herdr, and cleared when the agent exits.
//   names   the agent is renamed after its task (the real `fm/...` branch).
import { spawn, execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const HOOK = fileURLToPath(new URL('./hook.mjs', import.meta.url));

// Herdr sockets live under XDG_CONFIG_HOME and a Unix socket path must fit in
// sun_path (~108 bytes), so the isolated root MUST be short. `/tmp` on Linux
// (and `/private/tmp` via `/tmp` on macOS) is the short writable base.
function shortBase() {
    for (const candidate of [process.env.HERDR_TEST_TMPDIR, '/tmp', tmpdir()]) {
        if (candidate && existsSync(candidate)) return candidate;
    }
    return tmpdir();
}

function waitFor(check, { timeout = 30_000, interval = 200 } = {}) {
    const deadline = Date.now() + timeout;
    return (async () => {
        let last;
        while (Date.now() < deadline) {
            try { if (await check()) return true; } catch (error) { last = error; }
            await new Promise((resolve) => setTimeout(resolve, interval));
        }
        throw new Error(`condition not met within ${timeout}ms${last ? `: ${last.message}` : ''}`);
    })();
}

describe('plugin journey against a real Herdr session', () => {
    const sessionId = 'journey-session-0001';
    const taskId = 'journey-task1';
    const prompt = 'Fix the auth redirect bug in login flow';

    let base;
    let env;
    let session;
    let server;
    let herdrBin;
    let paneId;

    const herdr = async (args, extra = {}) => {
        const { stdout } = await run('herdr', [...args, '--session', session], { env: { ...env, ...extra } });
        return stdout.trim();
    };
    const herdrJson = async (args, extra) => JSON.parse(await herdr(args, extra)).result;

    before(async () => {
        base = await mkdtemp(join(shortBase(), 'ht-'));
        env = {
            ...process.env,
            HOME: join(base, 'home'),
            XDG_CONFIG_HOME: join(base, 'config'),
            XDG_DATA_HOME: join(base, 'data'),
            XDG_STATE_HOME: join(base, 'state'),
            XDG_CACHE_HOME: join(base, 'cache'),
        };
        for (const dir of ['home', 'config', 'data', 'state', 'cache']) await mkdir(join(base, dir), { recursive: true });
        // A short, unique session name so the socket path stays within sun_path.
        session = `ht${process.pid}`;

        server = spawn('herdr', ['server', '--session', session], { env, stdio: 'ignore' });
        await waitFor(async () => {
            const { stdout } = await run('herdr', ['status', '--json', '--session', session], { env });
            return JSON.parse(stdout).server.running === true;
        });

        // Guard: prove the server is the isolated one, never the shared default.
        const { stdout } = await run('herdr', ['status', '--json', '--session', session], { env });
        const socket = JSON.parse(stdout).server.socket;
        assert.ok(socket.startsWith(base), `isolated socket expected under ${base}, got ${socket}`);

        // A real git repo on an `fm/<task>` branch: the name and title fallbacks read it.
        const repo = join(base, 'workdir');
        await mkdir(repo, { recursive: true });
        await run('git', ['init', '-q', repo], { env });
        await run('git', ['-C', repo, 'checkout', '-q', '-b', `fm/${taskId}`], { env });
        await writeFile(join(repo, 'work.txt'), 'work\n');
        await run('git', ['-C', repo, 'add', '-A'], { env });
        await run('git', ['-C', repo, '-c', 'user.email=journey@test', '-c', 'user.name=journey', 'commit', '-qm', 'work'], { env });

        // A real workspace + pane in the isolated server.
        const created = await herdrJson(['workspace', 'create', '--cwd', repo, '--label', 'Shell']);
        paneId = created.root_pane.pane_id;

        // Bind a real agent session the way the real integration does.
        await herdr(['pane', 'report-agent', paneId, '--source', 'test:journey', '--agent', 'journey-agent', '--state', 'working', '--seq', '1'], { HERDR_ENV: '1', HERDR_PANE_ID: paneId });
        await herdr(['pane', 'report-agent-session', paneId, '--source', 'herdr:claude', '--agent', 'claude', '--seq', '2', '--agent-session-id', sessionId], { HERDR_ENV: '1', HERDR_PANE_ID: paneId });

        // A real Claude transcript the plugin's provider adapter reads for the task.
        const claude = join(base, 'claude', 'projects', 'journey');
        await mkdir(claude, { recursive: true });
        await writeFile(join(claude, `${sessionId}.jsonl`),
            `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } })}\n`);

        // The Herdr binary the plugin shells out to: this isolated session.
        herdrBin = join(base, 'herdr-bin');
        await writeFile(herdrBin, `#!/bin/sh\nexec herdr --session ${session} "$@"\n`);
        await chmod(herdrBin, 0o755);
    });

    after(async () => {
        if (server && server.exitCode === null) {
            server.kill('SIGTERM');
            await new Promise((resolve) => {
                const timer = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000);
                server.once('exit', () => { clearTimeout(timer); resolve(); });
            });
        }
        if (base) await rm(base, { recursive: true, force: true });
    });

    const hook = async (event) => {
        await run(process.execPath, [HOOK], {
            env: {
                ...env,
                HERDR_BIN_PATH: herdrBin,
                HERDR_PLUGIN_CONFIG_DIR: join(base, 'herdr.task-titles'),
                CLAUDE_CONFIG_DIR: join(base, 'claude'),
                HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ data: event }),
            },
        });
        return JSON.parse(await readFile(join(base, 'herdr.task-titles', 'outcome.json'), 'utf8'));
    };

    it('titles the pane from the task and names the agent from its work', async () => {
        const title = await hook({ pane_id: paneId, agent_status: 'working' });
        assert.equal(title.status, 'titled');
        assert.equal(title.title, 'Fix auth redirect bug');

        await waitFor(async () => (await herdrJson(['pane', 'get', paneId])).pane.title === 'Fix auth redirect bug');
        await waitFor(async () => (await herdrJson(['agent', 'get', paneId])).agent.name === taskId);
    });

    it('clears its title when the agent exits', async () => {
        const cleared = await hook({ pane_id: paneId, agent_status: 'done' });
        assert.equal(cleared.status, 'cleared');

        await waitFor(async () => !(await herdrJson(['pane', 'get', paneId])).pane.title?.trim());
    });
});
