#!/usr/bin/env node
import { handleStatus } from './runtime.mjs';
import { nameAgent } from './names.mjs';

let event;
try { event = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON ?? 'null'); } catch { event = null; }
const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR;
// Name first, so the title pass sees a stable agent name. `name` events
// (agent detected, pane focused) only name; status changes do both.
if (event) await nameAgent({ event, configDir }).catch(() => undefined);
if (event && configDir && process.argv[2] !== 'name') await handleStatus({ event, configDir });
