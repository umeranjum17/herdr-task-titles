// Provider registry. The naming logic calls promptFor(ref) and never knows
// which client a session came from. Adding a provider means adding one
// adapter file and one line here — see README "Adding a provider".
import { claudeAdapter } from './claude.mjs';
import { codexAdapter } from './codex.mjs';
import { opencodeAdapter } from './opencode.mjs';
import { piAdapter } from './pi.mjs';

export const PROVIDERS = {
    pi: piAdapter,
    claude: claudeAdapter,
    codex: codexAdapter,
    opencode: opencodeAdapter,
};

export function adapterFor(agent) {
    return PROVIDERS[agent] ?? undefined;
}

/** First real task prompt for a Herdr agent session, or undefined. */
export async function promptFor(ref, env = process.env) {
    const adapter = adapterFor(ref?.agent);
    if (!adapter) return undefined;
    try { return await adapter.promptFor(ref, env) ?? undefined; }
    catch { return undefined; }
}
