// opencode: sessions live in a sqlite db, not jsonl. User text is assembled
// from the text parts of the first user message. Reads open the db
// immutable/read-only and never write.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { firstTaskPrompt, safePrompt } from './common.mjs';

const exec = promisify(execFile);

export function dbPath(env = process.env) {
    const dir = env.OPENCODE_DATA_DIR || join(env.HOME ?? homedir(), '.local', 'share', 'opencode');
    return join(dir, 'opencode.db');
}

/** Pure: text of one message from its parts. */
export function userTextFromParts(parts) {
    return (parts ?? [])
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n');
}

/** Pure: first task prompt from ordered [{ role, parts }] messages. */
export function firstPromptFromMessages(messages) {
    return firstTaskPrompt(
        (messages ?? []).filter((message) => message?.role === 'user').map((message) => userTextFromParts(message.parts)),
    );
}

function parseJson(value) {
    try { return JSON.parse(value); } catch { return undefined; }
}

async function viaBuiltin(path, sessionId) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(`file:${path}?immutable=1`, { readOnly: true });
    try {
        const messages = db.prepare(
            'SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id LIMIT 50',
        ).all(sessionId);
        const partsByMessage = new Map();
        if (messages.length) {
            const parts = db.prepare(
                'SELECT message_id, data FROM part WHERE session_id = ? ORDER BY time_created, id LIMIT 500',
            ).all(sessionId);
            for (const part of parts) {
                const data = parseJson(part.data);
                if (!data) continue;
                if (!partsByMessage.has(part.message_id)) partsByMessage.set(part.message_id, []);
                partsByMessage.get(part.message_id).push(data);
            }
        }
        return messages.map((message) => ({ role: parseJson(message.data)?.role, parts: partsByMessage.get(message.id) ?? [] }));
    } finally {
        db.close();
    }
}

async function viaCli(path, sessionId) {
    const run = (sql) => exec('sqlite3', [`file:${path}?immutable=1`, sql], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    const ids = parseJson((await run(
        `SELECT json_group_array(id) FROM (SELECT id FROM message WHERE session_id = '${sessionId}' ORDER BY time_created, id LIMIT 50)`,
    )).stdout.trim()) ?? [];
    if (!Array.isArray(ids) || !ids.length) return [];
    const messages = [];
    for (const id of ids) {
        const data = parseJson((await run(`SELECT data FROM message WHERE id = '${id}'`)).stdout.trim());
        const rawParts = parseJson((await run(
            `SELECT json_group_array(data) FROM (SELECT data FROM part WHERE message_id = '${id}' ORDER BY time_created, id LIMIT 100)`,
        )).stdout.trim()) ?? [];
        messages.push({ role: data?.role, parts: (Array.isArray(rawParts) ? rawParts : []).map(parseJson).filter(Boolean) });
    }
    return messages;
}

export const opencodeAdapter = {
    id: 'opencode',
    label: 'opencode',
    promptFor: (ref, env = process.env) => safePrompt('opencode', async () => {
        if (!/^[a-zA-Z0-9_-]{8,80}$/.test(ref?.value ?? '')) return undefined;
        const path = dbPath(env);
        let messages;
        try {
            messages = await viaBuiltin(path, ref.value);
        } catch {
            messages = await viaCli(path, ref.value);
        }
        return firstPromptFromMessages(messages);
    }),
};
