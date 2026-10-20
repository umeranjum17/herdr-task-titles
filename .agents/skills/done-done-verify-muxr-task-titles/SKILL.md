---
name: done-done-verify-muxr-task-titles
description: Drive the muxr-task-titles Herdr plugin the way Herdr does (`npm test`: the journey test against a real isolated Herdr session) and capture proof it works. Use when proving a muxr-task-titles change, capturing evidence, or keeping the feature map honest.
---

# done-done-verify-muxr-task-titles

Scaffolded by `done-done init` from this repo's own files, corrected to the real drive (a Herdr plugin: no server, page or CLI of its own).

## Launch

There is nothing to start by hand: `npm ci` restores the one pinned dependency (`@byokit/herdr`), then `npm test` runs journey.test.mjs, which starts its own isolated Herdr server session and tears it down afterwards.
It needs `herdr` on PATH (Herdr 0.8.0 or newer) and Node.js 22.18 or newer.
Ready when `npm test` exits 0; never kill by process name.

## Doctor

Read-only: is this instance worth driving? Process up, right build, port owned by us, auth valid. each run uses its own invocation; never drive a shared session the user owns.

## Drive

Harness: a shell (run the launch command and read its output). Prefer the repo's real handles (routes, commands, labels) over coordinates:

- Main journey: the plugin journey in journey.test.mjs - a real Herdr session, a pane bound to a real agent session the way the live integration binds it, the real hook.mjs entry point as a subprocess. Run `npm test` and read its TAP output.

## Evidence

Capture screenshots of a page it shows, or its output saved as text when the outcome is text. Exercise the real user path, not internal setters; done-done's judge checks every capture in the run folder against the outcome, so save only captures of the resulting state there and keep any of earlier steps outside it; verify side effects alongside what is visible. Evidence goes to the run folder `done-done run` prints. Every drive uses these done-done primitives:

- Matrix: when .done-done.yaml sets a matrix block, each journey runs once per theme x width x form cell with DONE_DONE_THEME, DONE_DONE_WIDTH, DONE_DONE_FORM and DONE_DONE_CELL set: name each capture with its cell suffix, so every cell is captured or skipped with a reason, never silently missing.
- DOM: when .done-done.yaml sets a dom block, write next to each capture its page-check record, the capture's name with .dom.json for its extension (home.dark.390w.png -> home.dark.390w.dom.json): {"url": "<page url>", "overflow": <true when content is wider than the viewport>, "overflowing": ["<element>", ...], "console_errors": ["<message>", ...], "failed_requests": [{"url": "<url>", "status": <HTTP status, 0 when none>}], "squashed_text": [{"element": "<element>", "text": "<text>", "chars": <width in characters>, "lines": <n>, "words": <n>}]}; with your browser tool (for example chrome-devtools-axi): overflow from eval "() => { const w = document.documentElement.clientWidth; return { overflow: document.documentElement.scrollWidth > w, overflowing: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1).slice(0, 10).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')) } }", console errors from console --type error, failed requests (status 400 or more, or no response) from network, squashed_text from eval "() => { const ctx = document.createElement('canvas').getContext('2d'); const out = []; for (const e of document.querySelectorAll('body *')) { const nodes = [...e.childNodes].filter((n) => n.nodeType === 3 && n.data.trim()); const text = nodes.map((n) => n.data).join(' ').replace(/\s+/g, ' ').trim(); const s = getComputedStyle(e); const w = e.offsetWidth; const h = e.offsetHeight; if (!(e instanceof HTMLElement) || !text || !e.getClientRects().length || ((w <= 1 || h <= 1) && s.overflow !== 'visible') || s.visibility !== 'visible') continue; ctx.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const chars = w / (ctx.measureText('abcdefghijklmnopqrstuvwxyz').width / 26); const words = text.split(' ').length; const tops = new Set(); for (const n of nodes) { const r = document.createRange(); r.selectNodeContents(n); for (const b of r.getClientRects()) if (b.width) tops.add(Math.round(b.top)); } if ((chars < 8 && ctx.measureText(text).width > w + 1) || tops.size > words) out.push({ element: e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList[0] ? '.' + e.classList[0] : ''), text: text.slice(0, 40), chars: Math.round(chars * 10) / 10, lines: tops.size, words }); } return out; }" exactly as written (in every frame, an embedded one too).
- Text: for a text outcome, save the CLI output, log or JSON itself as a .txt, .log or .json capture; the check needs it to hold text and JSON to parse.
- Secrets: never write a secret (key, token, password, Bearer header) into evidence or logs; verify scans them and fails the run on a hit.
- Spends: a journey with `spends:` runs only after the user approves the spend at verify's gate; never run it another way.
- Before/after: with `base_ref` set, verify also drives the base ref into the run folder's before/; save the same captures under the same names there, so each pairs with its base capture.

## Cleanup

Stop the instances this run started and remove scratch state. Evidence survives cleanup: never delete the run folder.
