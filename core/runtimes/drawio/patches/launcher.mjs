// Specline-owned patched launch boundary for fixed @next-ai-drawio/mcp-server 0.2.3.
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const required = ['SPECLINE_SESSION_ID', 'SPECLINE_BRIDGE_ORIGIN', 'SPECLINE_BRIDGE_TOKEN', 'SPECLINE_FIXED_MCP_ENTRY'];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);
const origin = new URL(process.env.SPECLINE_BRIDGE_ORIGIN);
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password) throw new Error('REMOTE_ACCESS_BLOCKED');
const entry = path.resolve(process.env.SPECLINE_FIXED_MCP_ENTRY);
await access(entry);
// Token is intentionally process-memory-only. The fixed process receives it only through env;
// it is never included in a URL, argv, state file, artifact, stdout or stderr.
process.env.DRAWIO_BASE_URL = origin.origin;
process.env.SPECLINE_AUTHORIZATION = `Bearer ${process.env.SPECLINE_BRIDGE_TOKEN}`;
process.env.SPECLINE_BRIDGE_SESSION = process.env.SPECLINE_SESSION_ID;
delete process.env.SPECLINE_BRIDGE_TOKEN;
const health = await fetch(`${origin.origin}/api/sessions/${encodeURIComponent(process.env.SPECLINE_SESSION_ID)}/state`, { headers: { authorization: process.env.SPECLINE_AUTHORIZATION, origin: origin.origin } });
if (!health.ok) throw new Error(`AUTHENTICATED_BRIDGE_UNAVAILABLE:${health.status}`);
process.send?.({ type: 'specline-launcher-ready', sessionId: process.env.SPECLINE_SESSION_ID });
await import(pathToFileURL(entry).href);
