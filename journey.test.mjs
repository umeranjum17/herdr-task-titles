// One end-to-end journey for the plugin, driven the way Herdr drives it:
// a real isolated Herdr server session, a real pane bound to a real agent
// session, the real `hook.mjs` entry point as a subprocess, and the real
// config/outcome files. No fake Herdr, no injected functions.
//
// The journey covers both features the deleted unit tests covered:
//   titles  the pane title is derived from the real task transcript,
//           published through Herdr, and cleared when the agent exits.
//           A Firstmate worker or lead is titled from its tab label, task
//           branch, or lead home instead, never from its brief or doorbells.
//   names   the agent is renamed after its task (the real `fm/...` branch).
//
// HERDR_TEST_BIN runs the journey in an existing isolated session instead
// (a wrapper that scopes every call to it, such as a lab helper's `run`):
// no server is started or stopped.
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
    const prompt = 'Fix the auth redirect bug in login flow';
    const taskId = 'mx-scroll-fix';
    const brief = `# Task\n## Captain's intent\nMake the session list scroll past the fold.\n\n# Setup\n1. First action: create your branch: \`git checkout -b fm/${taskId} --\`\n`;
    const doorbell = ": Firstmate operational input waiting: read '~/firstmate/state/operational-inbox/1.msg' and handle its contents as Firstmate operational input.";

    let base;
    let env;
    let session;
    let server;
    let herdrBin;
    let paneId;
    let workerPane;
    let leadPane;
    let seq = 0;

    const lab = process.env.HERDR_TEST_BIN;
    const herdr = async (args, extra = {}) => {
        const { stdout } = await run(lab ?? 'herdr', lab ? args : [...args, '--session', session], { env: { ...env, ...extra } });
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

        if (!lab) {
            server = spawn('herdr', ['server', '--session', session], { env, stdio: 'ignore' });
            await waitFor(async () => {
                const { stdout } = await run('herdr', ['status', '--json', '--session', session], { env });
                return JSON.parse(stdout).server.running === true;
            });

            // Guard: prove the server is the isolated one, never the shared default.
            const { stdout } = await run('herdr', ['status', '--json', '--session', session], { env });
            const socket = JSON.parse(stdout).server.socket;
            assert.ok(socket.startsWith(base), `isolated socket expected under ${base}, got ${socket}`);
        }

        // Real git repos the name and title read: the person's own work on a
        // plain branch, a Firstmate worker's checkout on its `fm/<task>`
        // branch, and a Firstmate lead's home carrying its secondmate id.
        const repo = async (name, branch, lead) => {
            const dir = join(base, name);
            await mkdir(dir, { recursive: true });
            await run('git', ['init', '-q', dir], { env });
            await run('git', ['-C', dir, 'checkout', '-q', '-b', branch], { env });
            await writeFile(join(dir, 'work.txt'), 'work\n');
            await run('git', ['-C', dir, 'add', '-A'], { env });
            await run('git', ['-C', dir, '-c', 'user.email=journey@test', '-c', 'user.name=journey', 'commit', '-qm', 'work'], { env });
            if (lead) await writeFile(join(dir, '.fm-secondmate-home'), `${lead}\n`);
            return dir;
        };

        // A real Claude transcript per agent, which the plugin's provider adapter reads for the task.
        const claude = join(base, 'claude', 'projects', 'journey');
        await mkdir(claude, { recursive: true });
        const transcript = (id, ...prompts) => writeFile(join(claude, `${id}.jsonl`), prompts
            .map((text) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`).join(''));

        // A real pane bound to a real agent session the way a live integration
        // does. Keep it off a plain shell prompt: Herdr reaps a reported agent
        // once the pane is back at an idle shell, which is what a live agent
        // process prevents. `sleep` stands in for that live process, after
        // setting the terminal title the way Claude Code titles itself.
        const bind = async (pane, id, terminalTitle) => {
            await herdr(['pane', 'run', pane, `printf '\\033]0;${terminalTitle}\\007'; sleep 3600`]);
            await herdr(['pane', 'report-agent', pane, '--source', 'test:journey', '--agent', 'journey-agent', '--state', 'working', '--seq', `${++seq}`], { HERDR_ENV: '1', HERDR_PANE_ID: pane });
            await herdr(['pane', 'report-agent-session', pane, '--source', 'herdr:claude', '--agent', 'claude', '--seq', `${++seq}`, '--agent-session-id', id], { HERDR_ENV: '1', HERDR_PANE_ID: pane });
            await waitFor(async () => (await herdrJson(['agent', 'get', pane])).agent?.agent_session?.value === id);
        };

        const created = await herdrJson(['workspace', 'create', '--cwd', await repo('workdir', 'feature/auth'), '--label', 'Shell']);
        paneId = created.root_pane.pane_id;
        await transcript(sessionId, prompt);
        await bind(paneId, sessionId, 'claude');

        // Firstmate's own layout: one `fm-<id>` tab per worker and lead, and
        // its doorbells as the latest prompt and the terminal's own title.
        const tab = async (label, cwd) => (await herdrJson(['tab', 'create', '--workspace', created.workspace.workspace_id, '--cwd', cwd, '--label', label, '--no-focus'])).root_pane.pane_id;
        workerPane = await tab(`fm-${taskId}`, await repo('muxr', `fm/${taskId}`));
        await transcript('journey-worker-0002', brief, doorbell);
        await bind(workerPane, 'journey-worker-0002', 'Firstmate operational inbox');
        leadPane = await tab('fm-crewhouse', await repo('firstmate', 'main', 'crewhouse'));
        await transcript('journey-lead-0003', doorbell);
        await bind(leadPane, 'journey-lead-0003', 'Firstmate operational inbox handling');

        // The Herdr binary the plugin shells out to: this isolated session.
        herdrBin = lab ?? join(base, 'herdr-bin');
        if (!lab) {
            await writeFile(herdrBin, `#!/bin/sh\nexec herdr --session ${session} "$@"\n`);
            await chmod(herdrBin, 0o755);
        }
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
        assert.equal(title.status, 'titled', `outcome: ${JSON.stringify(title)}`);
        assert.equal(title.title, 'Fix auth redirect bug');

        await waitFor(async () => (await herdrJson(['pane', 'get', paneId])).pane.title === 'Fix auth redirect bug');
        await waitFor(async () => (await herdrJson(['agent', 'get', paneId])).agent.name === 'fix-auth-redirect');
    });

    it('titles Firstmate panes from their tab, never from a brief or doorbell', async () => {
        const worker = await hook({ pane_id: workerPane, agent_status: 'working' });
        assert.equal(worker.title, 'muxr: scroll fix', `outcome: ${JSON.stringify(worker)}`);
        const lead = await hook({ pane_id: leadPane, agent_status: 'working' });
        assert.equal(lead.title, 'Crewhouse lead', `outcome: ${JSON.stringify(lead)}`);

        await waitFor(async () => (await herdrJson(['pane', 'get', workerPane])).pane.title === 'muxr: scroll fix');
        await waitFor(async () => (await herdrJson(['pane', 'get', leadPane])).pane.title === 'Crewhouse lead');
        await waitFor(async () => (await herdrJson(['agent', 'get', workerPane])).agent.name === taskId);
    });

    it('clears its title when the agent exits', async () => {
        const cleared = await hook({ pane_id: paneId, agent_status: 'done' });
        assert.equal(cleared.status, 'cleared');

        await waitFor(async () => !(await herdrJson(['pane', 'get', paneId])).pane.title?.trim());
    });
});
