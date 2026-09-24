// Prompt text -> short human title. No network, no guessing: unclear prose is
// rejected and the caller falls back (repo name) or leaves the name alone.
const WRAPPER = /^(?:FIRSTMATE_OP\s*:|v\d+ launch-brief\s*:|you are (?:a|the) (?:crewmate|agent)\b|#\s*(?:AGENTS\.md|INSTRUCTIONS|environment_context)\b)/i;
const BOILERPLATE = /^(?:#\s*(?:Task|Rules|Setup|Definition of done|Firstmate spec|Current worker role contract|Current no-mistakes intent contract|Herdr isolation|Firstmate instruction inbox|Project memory)\b|##?\s*(?:Captain's intent|Captain intent authorized for --intent)\b|[-*]\s*(?:Do not|Never|Run |Use |Report |If you |Keep |Stay ))/i;
const TASK_VERB = /^(?:please\s+)?(?:can you\s+|could you\s+|i want (?:you to\s+)?|help me\s+)?(build|implement|create|add|fix|repair|debug|improve|update|refactor|remove|replace|migrate|design|write|make|investigate|test|ship|integrate|support|extract|rename|simplify|audit)\b/i;
const STOP = new Set(['a', 'an', 'the', 'for', 'in', 'on', 'of', 'to', 'with', 'and', 'or', 'from', 'using', 'that', 'which', 'after', 'before', 'by']);

function cleanLine(value) {
    return value.replace(/\p{Cf}/gu, '').replace(/^[\s>*-]+/, '').replace(/[`*_\[\]{}]/g, '').replace(/\s+/g, ' ').trim();
}

function titleFromSentence(sentence) {
    const artifact = sentence.match(/\b(?:the\s+)?(?:first-class\s+)?([\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2}\s+(?:plugin|screen|page|flow|feature|bug))\b/iu);
    if (artifact && /^(?:build|implement|create|add|fix|repair|improve|update|design)\b/i.test(sentence)) {
        const verb = /^(\p{L}+)/u.exec(sentence)?.[1] ?? 'Build';
        const phrase = artifact[1].replace(/^(?:the|a|an|backend|frontend|first-class)\s+/i, '');
        const direct = `${verb} ${phrase}`;
        if (direct.length <= 60 && (direct.match(/\S+/g)?.length ?? 0) <= 6) return direct.charAt(0).toLocaleUpperCase() + direct.slice(1);
    }
    const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’+.-]*/gu) ?? [];
    if (words.length < 3) return undefined;
    const selected = words.slice(0, 6);
    while (selected.length > 2 && STOP.has(selected.at(-1).toLowerCase())) selected.pop();
    if (selected.length < 2) return undefined;
    const result = selected.join(' ').replace(/[-–—]$/u, '').trim();
    if (result.length > 60 || /\bpp_[a-z0-9]+\b|\bp:[a-z0-9]+\b/i.test(result)) return undefined;
    return result.charAt(0).toLocaleUpperCase() + result.slice(1);
}

/** Bounded, deterministic extraction. Unclear prose is rejected rather than slugged. */
export function titleCandidate(sample) {
    if (typeof sample !== 'string' || sample.trim() === '') return { confidence: 'ambiguous', reason: 'No task prompt yet.' };
    const text = sample.slice(0, 8192);
    const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    let inCaptainIntent = false;
    const candidates = [];
    for (const line of lines) {
        if (/^#{1,3}\s*Captain(?:'s)? intent\b/i.test(line)) { inCaptainIntent = true; continue; }
        if (/^#{1,3}\s/.test(line) && !/^#{1,3}\s*Captain(?:'s)? intent\b/i.test(line)) inCaptainIntent = false;
        if (WRAPPER.test(line) || BOILERPLATE.test(line) || /^\[[^\]]+\]\s*$/.test(line)) continue;
        const sentence = line.replace(/^#+\s*/, '').split(/[.!?](?:\s|$)/u)[0]?.trim() ?? '';
        const match = TASK_VERB.exec(sentence);
        if (match) candidates.push({ sentence: sentence.slice(match[0].length - match[1].length), priority: inCaptainIntent ? 2 : 1 });
    }
    const titled = (priority) => candidates.filter((c) => c.priority === priority).map(({ sentence }) => titleFromSentence(sentence)).find(Boolean);
    const intent = titled(2);
    if (intent) return { title: intent, confidence: 'clear task', source: 'first task prompt' };
    // A launch brief names its task branch; that beats a stray imperative
    // from the brief's scaffolding ("Fix both in the plugin").
    const branch = titleFromBranch(/\bgit (?:checkout -b|switch -c) ([\w./-]+)/.exec(sample.slice(0, 65536))?.[1]);
    if (branch) return { ...branch, source: 'launch brief' };
    const title = titled(1);
    return title ? { title, confidence: 'clear task', source: 'first task prompt' }
        : { confidence: 'ambiguous', reason: 'No clear task request in this prompt.' };
}

/** Task branch (`fm/tt-title-fallback1`) -> "Tt title fallback". Only
// prefixed branches count: `main` or a bare name says nothing about the task. */
export function titleFromBranch(branch) {
    const slug = typeof branch === 'string' ? /^[\w.-]+\/([\w.-]+)$/.exec(branch.trim())?.[1] : undefined;
    if (!slug || /^[0-9a-f]{7,}$/i.test(slug)) return undefined;
    const words = slug.replace(/[_.-]+/g, ' ').replace(/(\p{L})\d+$/u, '$1').replace(/\s+/g, ' ').trim();
    if (words.length < 3 || words.length > 40 || !/\p{L}{2}/u.test(words)) return undefined;
    return { title: words.charAt(0).toLocaleUpperCase() + words.slice(1), confidence: 'task branch', source: 'task branch' };
}

const GENERIC_DIRS = new Set(['home', 'user', 'users', 'code', 'src', 'work', 'projects', 'repos', 'repo', 'tmp', 'root']);

/** Weakest signal: the repo directory the pane is working in. Rejects home,
// root, dotfiles, and bare hashes so a bad guess never beats the current name. */
export function titleFromRepo(cwd) {
    if (typeof cwd !== 'string' || !cwd) return undefined;
    const base = cwd.replace(/\/+$/, '').split('/').pop() ?? '';
    if (!base || base.startsWith('.') || base.length < 2 || /^[0-9a-f]{7,}$/i.test(base)) return undefined;
    const words = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (words.length < 2 || words.length > 40 || GENERIC_DIRS.has(words.toLowerCase())) return undefined;
    return { title: words.charAt(0).toLocaleUpperCase() + words.slice(1), confidence: 'repo name', source: 'working directory' };
}
