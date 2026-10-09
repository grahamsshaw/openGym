/* PERSONAL-BRIDGE: phone-button pull triggers.
 *
 * Lets the phone app (or any signed-in client) ask the server to pull gym
 * data, without handing the phone any credentials: POST /api/bridge/pull
 * writes a job file under DATA_DIR/bridge/jobs/, and a bridge runner (the
 * Python service that owns the Technogym login and the Wii/Health Connect
 * paths — see documentation/BRIDGE-API.md) consumes it. Pure filesystem
 * queue: survives restarts, visible in backups, no new daemon in this
 * process. Upstream's "API spawns nothing" posture is unchanged.
 *
 * Pure functions of the data dir; server.js only wires auth + HTTP around
 * them, so this file is unit-testable without booting anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Sources the runner knows how to pull. Anything else is refused. */
export const SOURCES = ['technogym', 'wii_fit', 'health_connect'];

/** A runner heartbeat fresher than this counts as "a runner is watching". */
const RUNNER_FRESH_MS = 10 * 60 * 1000;

/** Largest phone file accepted, and which names may land in the inbox. */
export const INBOX_MAX_BYTES = 5 * 1024 * 1024;
const INBOX_OK = ['.csv', '.json', '.xml'];

const dir = () => process.env.DATA_DIR || '/data';
const bridgeDir = () => path.join(dir(), 'bridge');
const jobsDir = () => path.join(bridgeDir(), 'jobs');
const resultFile = () => path.join(bridgeDir(), 'result.json');
const runnerFile = () => path.join(bridgeDir(), 'runner.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function pendingJobs() {
  let files = [];
  try {
    files = fs.readdirSync(jobsDir()).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return files
    .map((f) => ({ file: f, ...readJson(path.join(jobsDir(), f), null) }))
    .filter((j) => j && j.status === 'pending');
}

/**
 * Queue a pull. A pending job is returned as-is (coalesced) rather than
 * stacking duplicates from an impatient button — one pull covers everything
 * since the last one anyway.
 */
export function requestPull({ userId, sources }) {
  const wanted = Array.isArray(sources) && sources.length ? sources : SOURCES;
  const bad = wanted.filter((s) => !SOURCES.includes(s));
  if (bad.length) return { error: `unknown sources: ${bad.join(', ')}` };
  fs.mkdirSync(jobsDir(), { recursive: true });
  const pending = pendingJobs();
  if (pending.length) return { job: pending[0], coalesced: true };
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    userId,
    sources: wanted,
    at: new Date().toISOString(),
    status: 'pending',
  };
  fs.writeFileSync(path.join(jobsDir(), `job-${job.id}.json`), JSON.stringify(job));
  return { job, coalesced: false };
}

/** Queue depth, last runner result, and whether a runner is watching. */
export function pullStatus() {
  const runner = readJson(runnerFile(), null);
  const fresh = !!runner && Date.now() - Date.parse(runner.at || 0) < RUNNER_FRESH_MS;
  return {
    runner: fresh,
    pending: pendingJobs().map((j) => ({ id: j.id, sources: j.sources, at: j.at })),
    last: readJson(resultFile(), null),
  };
}

function inboxDir() {
  return path.join(bridgeDir(), 'inbox');
}

/**
 * Accept one uploaded phone file into the inbox the pull chain consumes.
 * Returns `{ file }` or `{ error }` — never throws for bad input, so the
 * route maps straight to 200/400. Names are sanitised to a flat safe
 * basename (no directories, no odd extensions); collisions gain a timestamp
 * rather than overwriting.
 */
export function inboxFile({ filename, content }) {
  const base = path.basename(String(filename || '')).replace(/[^A-Za-z0-9_.-]/g, '_');
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')).toLowerCase() : '';
  if (!base || base === '.' || base === '..' || base.startsWith('.') || !INBOX_OK.includes(ext)) {
    return { error: 'only .csv, .json or .xml files are accepted' };
  }
  const text = typeof content === 'string' ? content : '';
  if (Buffer.byteLength(text, 'utf8') > INBOX_MAX_BYTES) {
    return { error: 'file too large (5 MB max)' };
  }
  fs.mkdirSync(inboxDir(), { recursive: true });
  let target = path.join(inboxDir(), base);
  if (fs.existsSync(target)) {
    target = path.join(inboxDir(), `${Date.now()}-${base}`);
  }
  fs.writeFileSync(target, text);
  return { file: path.basename(target), bytes: Buffer.byteLength(text, 'utf8') };
}
