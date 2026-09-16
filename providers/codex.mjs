// codex: find the session jsonl under the codex sessions dir, then scan it.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { firstTaskPrompt, readTranscript, safePrompt, textBlocks } from './common.mjs';

function userPrompts(jsonl) {
    const prompts = [];
    for (const line of jsonl.split('\n')) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (row?.type === 'response_item' && row.payload?.type === 'message' && row.payload.role === 'user') {
            prompts.push(textBlocks(row.payload.content));
        }
    }
    return prompts;
}

async function findSession(value, root) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(value ?? '')) return undefined;
    const queue = [root];
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

export const codexAdapter = {
    id: 'codex',
    label: 'Codex',
    promptFor: (ref, env = process.env) => safePrompt('codex', async () => {
        const root = env.CODEX_HOME || join(env.HOME ?? '', '.codex', 'sessions');
        const path = await findSession(ref?.value, root);
        if (!path) return undefined;
        const jsonl = await readTranscript(path);
        if (!jsonl) return undefined;
        return firstTaskPrompt(userPrompts(jsonl));
    }),
};
