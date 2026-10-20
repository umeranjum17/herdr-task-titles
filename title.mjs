// Prompt text -> short human title. No network, no guessing: unclear prose is
// rejected and the caller falls back (repo name) or leaves the name alone.
const WRAPPER = /^(?:FIRSTMATE_OP\s*:|:?\s*Firstmate (?:operational input|instruction) waiting\b|v\d+ launch-brief\s*:|you are (?:a|the) (?:crewmate|agent)\b|#\s*(?:AGENTS\.md|INSTRUCTIONS|environment_context)\b)/i;
const BOILERPLATE = /^(?:#\s*(?:Task|Rules|Setup|Definition of done|Firstmate spec|Current worker role contract|Current no-mistakes intent contract|Herdr isolation|Firstmate instruction inbox|Project memory)\b|##?\s*(?:Captain's intent|Captain intent authorized for --intent)\b|[-*]\s*(?:Do not|Never|Run |Use |Report |If you |Keep |Stay ))/i;
const TASK_VERB = /^(?:please\s+)?(?:can you\s+|could you\s+|i (?:want|need) (?:you to\s+)?|help me\s+|we (?:need|have|want) to\s+|we should\s+|let'?s\s+)?(align|unify|rework|redesign|polish|restore|prevent|handle|finish|build|implement|create|add|fix|repair|debug|improve|update|refactor|remove|replace|migrate|design|write|make|investigate|test|ship|integrate|support|extract|rename|simplify|audit)\b/i;
// A "why is X happening?" question states the problem when no ask does.
const WHY = /^why (?:is|are|does|do|did|isn't|aren't|doesn't|don't|can't|won't) (?:the |an? )?/i;
export const STOP = new Set(['a', 'an', 'the', 'for', 'in', 'on', 'of', 'to', 'with', 'and', 'or', 'from', 'using', 'that', 'which', 'after', 'before', 'by']);

function cleanLine(value) {
    return value.replace(/\p{Cf}/gu, '').replace(/^[\s>*-]+/, '').replace(/[`*_\[\]{}]/g, '').replace(/\s+/g, ' ').trim();
}

function titleFromSentence(sentence) {
    const leading = /^(?:build|implement|create|add|fix|repair|improve|update|design)\b/i.exec(sentence);
    if (leading) {
        const verb = /^(\p{L}+)/u.exec(sentence)?.[1] ?? 'Build';
        const rest = sentence.slice(leading[0].length).trim();
        const artifact = rest.match(/\b(?:the\s+)?(?:first-class\s+)?([\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2}\s+(?:plugin|screen|page|flow|feature|bug))\b/iu);
        if (artifact) {
            const phrase = artifact[1].replace(/^(?:the|a|an|backend|frontend|first-class)\s+/i, '');
            const direct = `${verb} ${phrase}`;
            if (direct.length <= 60 && (direct.match(/\S+/g)?.length ?? 0) <= 6) return direct.charAt(0).toLocaleUpperCase() + direct.slice(1);
        }
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
        // The captain's intent is prose: every sentence counts, not just the first.
        const sentences = line.replace(/^#+\s*/, '').split(/[.!?](?:\s|$)/u).map((part) => part.trim());
        for (const sentence of inCaptainIntent ? sentences.slice(0, 8) : sentences.slice(0, 1)) {
            const match = TASK_VERB.exec(sentence);
            if (match) candidates.push({ sentence: sentence.slice(match[0].length - match[1].length), priority: inCaptainIntent ? 3 : 1 });
            else if (inCaptainIntent && WHY.test(sentence)) candidates.push({ sentence: sentence.replace(WHY, ''), priority: 2 });
        }
    }
    const titled = (priority) => candidates.filter((c) => c.priority === priority).map(({ sentence }) => titleFromSentence(sentence)).find(Boolean);
    const intent = titled(3) ?? titled(2);
    if (intent) return { title: intent, confidence: 'clear task', source: 'task prompt' };
    // A launch brief names its task branch; that beats a stray imperative
    // from the brief's scaffolding ("Fix both in the plugin").
    const branch = titleFromBranch(/\bgit (?:checkout -b|switch -c) ([\w./-]+)/.exec(sample.slice(0, 65536))?.[1]);
    if (branch) return { ...branch, source: 'launch brief' };
    const title = titled(1);
    return title ? { title, confidence: 'clear task', source: 'task prompt' }
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

/** A short task-id prefix that abbreviates the repo: `mx` for muxr, `ht` for herdr-task-titles. */
function abbreviates(prefix, repo) {
    const letters = repo.toLowerCase();
    let at = 0;
    for (const letter of prefix.toLowerCase()) if ((at = letters.indexOf(letter, at) + 1) === 0) return false;
    return /^\p{L}{2,4}$/u.test(prefix) && letters.startsWith(prefix.charAt(0).toLowerCase());
}

/** Firstmate pane -> its title, from what Firstmate itself named it. A lead's
// home carries its secondmate id ("Crewhouse lead"); a worker's tab is
// `fm-<task-id>` and its branch `fm/<task-id>` ("muxr: scroll fix"). Any
// other pane is not Firstmate's: undefined. A tab someone relabeled by hand
// keeps that label as its title. */
export function titleFromFirstmate({ lead, label, branch, repo }) {
    const tab = label?.trim() ?? '';
    const task = /^fm-([\w.-]+)$/.exec(tab)?.[1] ?? /^fm\/([\w.-]+)$/.exec(branch?.trim() ?? '')?.[1];
    const id = /^[\w.-]{1,40}$/.test(lead ?? '') ? lead.replace(/[_.-]+/g, ' ').replace(/ lead$/i, '').trim() : '';
    if (!task && !id) return undefined;
    if (tab && !tab.startsWith('fm-') && !/^\d+$/.test(tab)) return { title: tab, confidence: 'firstmate task', source: 'tab label' };
    if (id) return { title: `${id.charAt(0).toLocaleUpperCase()}${id.slice(1)} lead`, confidence: 'firstmate task', source: 'firstmate lead' };
    const parts = task.replace(/(\p{L})\d+$/u, '$1').split(/[_.-]+/).filter(Boolean);
    if (!parts.length) return undefined;
    if (repo && parts.length > 2 && (parts[0] === repo || abbreviates(parts[0], repo))) parts.shift();
    const words = parts.join(' ');
    return { title: repo ? `${repo}: ${words}` : words.charAt(0).toLocaleUpperCase() + words.slice(1), confidence: 'firstmate task', source: 'firstmate task' };
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
