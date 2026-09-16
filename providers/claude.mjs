// claude: find the session jsonl under the config projects dir, then scan it.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { firstTaskPrompt, readTranscript, safePrompt, textBlocks } from './common.mjs';

function userPrompts(jsonl) {
    const prompts = [];
    for (const line of jsonl.split('\n')) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (row?.type === 'user' && row.isMeta !== true) {
            prompts.push(textBlocks(row.message?.content));
        }
    }
    return prompts;
}

async function findSession(value, root) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(value ?? '')) return undefined;
    const start = root.endsWith('/projects') ? root : join(root, 'projects');
    const queue = [start];
    let visited = 0;
    while (queue.length && visited++ < 500) {
        const dir = queue.shift();
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) queue.push(path);
            else if (entry.isFile() && entry.name.endsWith(`${value}.jsonl`)) return path;
        }
    }
    return undefined;
}

export const claudeAdapter = {
    id: 'claude',
    label: 'Claude',
    promptFor: (ref, env = process.env) => safePrompt('claude', async () => {
        const root = env.CLAUDE_CONFIG_DIR || join(env.HOME ?? '', '.claude', 'projects');
        const path = await findSession(ref?.value, root);
        if (!path) return undefined;
        const jsonl = await readTranscript(path);
        if (!jsonl) return undefined;
        return firstTaskPrompt(userPrompts(jsonl));
    }),
};
