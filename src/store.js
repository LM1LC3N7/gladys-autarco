// -----------------------------------------------------------------------------
// What must survive a restart of the container (a small JSON file under
// /data, the only writable place): the instant of the last request (written
// at most once a minute), a pause asked by the service (429/5xx/403), the
// refusal of the credentials, the guards of the energy indexes, and what the
// Discovery list shows (site ids, their groups, inverter serials: nothing
// secret, no name, no address).
//
// The password is never written, nor the e-mail address: the account is kept
// as a salted scrypt fingerprint of the e-mail address (personal data, never
// in clear), so that another account starts afresh. While the credentials
// are refused, the file keeps a marker of the refused pair: a scrypt
// fingerprint truncated to 8 bits (it tells "most likely the same" after a
// restart, and can confirm no password: one in 256 of any guess matches).
// Erased by the first successful read.
//
// Written through a temporary file and a rename, one write at a time; a
// failure is logged once, never fatal. Never any text of the service.
// -----------------------------------------------------------------------------

import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { isSerial } from './autarco/model.js';
import { MAX_INVERTERS, MAX_SITES } from './constants.js';

export const DEFAULT_STATE_FILE = '/data/autarco-state.json';
const MAX_FILE = 256 * 1024;

/** A JSON file: `load()` (sync, `{}` when absent or odd) and `save(data)` (atomic). */
export function createFileStore(file = DEFAULT_STATE_FILE) {
  let queue = Promise.resolve();
  const write = async (data) => {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  };
  return {
    load() {
      try {
        const text = readFileSync(file, 'utf8');
        if (text.length > MAX_FILE) return {};
        const data = JSON.parse(text);
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      } catch {
        return {};
      }
    },
    save(data) {
      const job = queue.then(
        () => write(data),
        () => write(data),
      );
      queue = job.catch(() => {});
      return job;
    },
  };
}

/** The same in memory (tests). */
export function createMemoryStore(initial = {}) {
  let data = structuredClone(initial);
  let saves = 0;
  return {
    load: () => structuredClone(data),
    async save(next) {
      saves += 1;
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
    get saves() {
      return saves;
    },
  };
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const PAUSE_CODES = ['rate_limited', 'server', 'forbidden'];

/** A pause read back: `{ until, count, code, status }`, its end capped from now. */
export function validPause(pause, now, max) {
  if (
    !isObject(pause) ||
    finite(pause.until) === undefined ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    !PAUSE_CODES.includes(pause.code)
  ) {
    return undefined;
  }
  return {
    until: Math.min(pause.until, now + max),
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/**
 * A refusal read back: `{ status, mark }`. Final: no end, no automatic try;
 * only new credentials, or a click on the test button, read again.
 */
export function validRefusal(refusal) {
  if (
    !isObject(refusal) ||
    typeof refusal.mark !== 'string' ||
    !/^[0-9a-f]{2}$/.test(refusal.mark)
  ) {
    return undefined;
  }
  return { status: 401, mark: refusal.mark };
}

const SITE_ID = /^\d{1,13}$/;
const GROUPS = ['battery', 'meter'];

/** The sites known (Discovery after a restart): `{ [siteId]: { groups, inverters } }`. */
export function validSites(sites) {
  const out = {};
  if (!isObject(sites)) return out;
  for (const [id, site] of Object.entries(sites).slice(0, MAX_SITES)) {
    if (!SITE_ID.test(id) || !isObject(site)) continue;
    out[id] = {
      groups: Array.isArray(site.groups) ? GROUPS.filter((g) => site.groups.includes(g)) : [],
      inverters: Array.isArray(site.inverters)
        ? [...new Set(site.inverters.filter(isSerial))].slice(0, MAX_INVERTERS)
        : [],
    };
  }
  return out;
}

/**
 * The persisted state, sanitized: times capped (a request never "in the
 * future", a pause never longer than a fresh one), so a clock that jumped or
 * a hand-edited file never stops the reads for longer.
 */
export function readState(raw, now, { maxPause }) {
  const data = isObject(raw) ? raw : {};
  const salt =
    typeof data.salt === 'string' && /^[0-9a-f]{32}$/.test(data.salt)
      ? data.salt
      : randomBytes(16).toString('hex');
  const account =
    typeof data.account === 'string' && /^[0-9a-f]{32}$/.test(data.account) ? data.account : null;
  const indexes = {};
  if (isObject(data.indexes)) {
    for (const [id, state] of Object.entries(data.indexes).slice(0, MAX_SITES * 2)) {
      if (typeof id === 'string' && id.length <= 200 && isObject(state)) indexes[id] = state;
    }
  }
  return {
    salt,
    account,
    lastAttemptAt: Math.min(finite(data.lastAttemptAt) ?? 0, now),
    pause: account ? (validPause(data.pause, now, maxPause) ?? null) : null,
    refusal: account ? (validRefusal(data.refusal) ?? null) : null,
    sites: validSites(data.sites),
    indexes,
  };
}

/** The salted fingerprint of the e-mail address of the account (never the address). */
export function accountOf(salt, email) {
  return scryptSync(String(email).toLowerCase(), `${salt}:account`, 16).toString('hex');
}

/** The 8-bit marker of a REFUSED pair (never enough to find or confirm a password). */
export function refusedMark(salt, email, password) {
  return scryptSync(`${email}\n${password}`, `${salt}:refused`, 16).toString('hex').slice(0, 2);
}
