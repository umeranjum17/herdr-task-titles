// pi: the session ref is a direct transcript path. Nothing to search.
import { isAbsolute } from 'node:path';
import { firstTaskPrompt, readTranscript, safePrompt, textBlocks } from './common.mjs';

function userPrompts(jsonl) {
    const prompts = [];
    for (const line of jsonl.split('\n')) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (row?.type === 'message' && row.message?.role === 'user') {
            prompts.push(textBlocks(row.message.content));
        }
    }
    return prompts;
}

export const piAdapter = {
    id: 'pi',
    label: 'pi',
    promptFor: (ref) => safePrompt('pi', async () => {
        if (!isAbsolute(ref?.value ?? '')) return undefined;
        const jsonl = await readTranscript(ref.value);
        if (!jsonl) return undefined;
        return firstTaskPrompt(userPrompts(jsonl));
    }),
};
