/* PERSONAL-BRIDGE: pull-trigger queue. Boots the real server.js in a child
   with a temp DATA_DIR (same harness as server-pairing.test.js) and drives
   the two endpoints with a minted session cookie. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');

function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = (uid, sv) => ({ Cookie: `gymsid=${mintSession(uid, sv)}` });

const USERS = [{ id: 'u_bridge_1', name: 'Bridge', created: new Date().toISOString() }];

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-bridge-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: '', log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  return h;
}

test('bridge endpoints: strangers refused, pull queues once, status reports', async t => {
  const h = await startServer(t);
  const get = (p, headers) => fetch(`${h.api}${p}`, { headers });
  const post = (p, headers, body) => fetch(`${h.api}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body || {}),
  });

  // No session: both endpoints refuse without touching the disk.
  assert.equal((await post('/api/bridge/pull', {}, {})).status, 401);
  assert.equal((await get('/api/bridge/status')).status, 401);
  assert.ok(!fs.existsSync(path.join(h.dataDir, 'bridge')));

  // Signed in, no runner yet: pull queues, status says so honestly.
  const pull = await post('/api/bridge/pull', cookie('u_bridge_1', 0), { sources: ['technogym'] });
  assert.equal(pull.status, 200);
  const job = (await pull.json()).job;
  assert.deepEqual(job.sources, ['technogym']);
  const onDisk = JSON.parse(fs.readFileSync(
    path.join(h.dataDir, 'bridge', 'jobs', `job-${job.id}.json`), 'utf8'));
  assert.equal(onDisk.status, 'pending');

  // An impatient second tap coalesces onto the pending job, no duplicate.
  const again = await post('/api/bridge/pull', cookie('u_bridge_1', 0), {});
  assert.equal((await again.json()).coalesced, true);

  const status = await (await get('/api/bridge/status', cookie('u_bridge_1', 0))).json();
  assert.equal(status.runner, false);
  assert.equal(status.pending.length, 1);

  // Unknown sources are refused, not queued.
  assert.equal(
    (await post('/api/bridge/pull', cookie('u_bridge_1', 0), { sources: ['nope'] })).status, 400);
});
