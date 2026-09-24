// Shared helpers for transcript adapters. An adapter is `{ id, label,
// promptFor(ref) }`: given a Herdr agent session, return the first real task
// prompt or undefined. Adapters never throw; absent or unreadable providers
// resolve to undefined and the caller falls back.
import { readFile, stat } from 'node:fs/promises';
import { titleCandidate } from '../title.mjs';

export function textBlocks(value) {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value.filter((item) => item?.type === 'text' || item?.type === 'input_text')
        .map((item) => item.text).filter((text) => typeof text === 'string').join('\n');
}

/** Launcher envelopes and harness scaffolding are not tasks. */
export function isBoilerplate(prompt) {
    return /^(?:# AGENTS\.md|<INSTRUCTIONS>|<user_instructions>|<environment_context>|<command-|<local-command)/.test(prompt.replace(/\p{Cf}/gu, '').trim());
}

/** First user text that states a real task, else undefined. */
export function firstTaskPrompt(prompts) {
    for (const prompt of prompts) {
        if (!prompt || isBoilerplate(prompt)) continue;
        if (!titleCandidate(prompt).title) continue;
        return prompt;
    }
    return undefined;
}

/** Bounded transcript read: regular files only, 2MB cap. */
export async function readTranscript(path) {
    const details = await stat(path).catch(() => undefined);
    if (!details?.isFile() || details.size > 2 * 1024 * 1024) return undefined;
    return readFile(path, 'utf8').catch(() => undefined);
}

export async function safePrompt(adapterId, action) {
    try { return await action() ?? undefined; }
    catch { return undefined; }
}
