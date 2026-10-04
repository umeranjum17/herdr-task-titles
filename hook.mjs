#!/usr/bin/env node
import { handleStatus } from './runtime.mjs';
import { nameAgent } from './names.mjs';

let event;
try { event = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON ?? 'null'); } catch { event = null; }
const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR;
// Title first, so the name pass can name the agent after its task. `name`
// events (pane focused) only name; agent events do both.
if (event && configDir && process.argv[2] !== 'name') await handleStatus({ event, configDir });
if (event) await nameAgent({ event, configDir }).catch(() => undefined);
