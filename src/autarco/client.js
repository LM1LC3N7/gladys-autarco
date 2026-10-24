// -----------------------------------------------------------------------------
// The public API of Autarco (https://my.autarco.com/api/site/), after
// python-autarco (Klaas Schoute, MIT, see THIRD_PARTY_NOTICES.md): GET
// requests with the e-mail address and the password of the Autarco account
// in HTTP Basic, over HTTPS.
//
// READ-ONLY: only GET, only the account (list of sites) and three read paths
// of a site (SITE_PATHS). No method here writes anything: there is none to
// call.
//
// The credentials are only ever placed in the header of a request to
// my.autarco.com; a redirect is never followed (they never leave for another
// host). Errors carry our own codes, never a text of the service, never a URL,
// never the credentials. Every body is bounded and read into one buffer.
// -----------------------------------------------------------------------------

import { API_BASE, HTTP_TIMEOUT, MAX_BODY_BYTES, SITE_PATHS } from '../constants.js';
import { parseAccount } from './model.js';

export class AutarcoError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'refused'|'forbidden'|'http'|'server'|'rate_limited'|
   *   'too_large'|'not_json'|'unknown_answer'} code
   */
  constructor(code, { status, retryAfter } = {}) {
    super(code);
    this.name = 'AutarcoError';
    this.code = code;
    this.status = status;
    /** ms, from a Retry-After header (429, 503), when given. */
    this.retryAfter = retryAfter;
  }
}

function networkError(err) {
  if (err instanceof AutarcoError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new AutarcoError(timeout ? 'timeout' : 'unreachable');
}

/**
 * The body, read into ONE buffer of at most `limit` bytes (no buffer kept per
 * chunk, no concatenation): a longer one is not an answer of the service.
 */
export async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const buffer = Buffer.allocUnsafe(limit);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (size + value.byteLength > limit) {
      await reader.cancel().catch(() => {});
      throw new AutarcoError('too_large');
    }
    buffer.set(value, size);
    size += value.byteLength;
  }
  return buffer.toString('utf8', 0, size);
}

/** Retry-After in seconds (or an HTTP date) -> ms, undefined when absent or odd. */
function retryAfterOf(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) {
    return undefined;
  }
  if (/^\d{1,9}$/.test(raw.trim())) {
    return Number(raw.trim()) * 1000;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : undefined;
}

/** The time of the service (its `Date` header), undefined when absent or odd. */
function serverTimeOf(response) {
  const raw = response.headers?.get?.('date');
  const at = typeof raw === 'string' && raw.length <= 64 ? Date.parse(raw) : NaN;
  return Number.isFinite(at) ? at : undefined;
}

/** The HTTP Basic header of the account (UTF-8, as aiohttp's BasicAuth). */
export function basicAuth(email, password) {
  return `Basic ${Buffer.from(`${email}:${password}`, 'utf8').toString('base64')}`;
}

/** The paths of a site read at each read, in this order; each may fail alone. */
export const SITE_READS = [
  ['kpisPower', SITE_PATHS.KPIS_POWER],
  ['kpisEnergy', SITE_PATHS.KPIS_ENERGY],
  ['power', SITE_PATHS.POWER],
];

export class AutarcoClient {
  constructor({
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
    now = Date.now,
  } = {}) {
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.now = now;
  }

  /**
   * One GET of `path` under /api/site/: `{ answer, serverTime }`, the answer
   * a parsed JSON object. `path` is built by us only (a public key checked by
   * src/autarco/model.js and a fixed path).
   */
  async get(path, { email, password }) {
    let response;
    let text;
    try {
      response = await this.fetch(`${API_BASE}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: basicAuth(email, password) },
        // A redirect is never followed: the credentials stay on my.autarco.com.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeout),
      });
      // The body can fail too (timeout, connection cut): same errors.
      text = await readBounded(response, MAX_BODY_BYTES);
    } catch (err) {
      throw networkError(err);
    }
    const status = response.status;
    if (status === 401) {
      throw new AutarcoError('refused', { status });
    }
    if (status === 403) {
      throw new AutarcoError('forbidden', { status });
    }
    if (status === 429 || status >= 500) {
      throw new AutarcoError(status === 429 ? 'rate_limited' : 'server', {
        status,
        retryAfter: retryAfterOf(response, this.now),
      });
    }
    if (status < 200 || status >= 300) {
      throw new AutarcoError('http', { status });
    }
    const type = response.headers?.get?.('content-type') ?? '';
    if (!/application\/json/i.test(type)) {
      // As the library: anything but JSON is not an answer of the API.
      throw new AutarcoError('not_json');
    }
    let answer;
    try {
      answer = JSON.parse(text);
    } catch {
      throw new AutarcoError('not_json');
    }
    if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
      throw new AutarcoError('unknown_answer');
    }
    return { answer, serverTime: serverTimeOf(response) };
  }

  /**
   * One read: the account first (required: it proves that the credentials are
   * accepted and lists the sites), then the three paths of each site. A path
   * of a site that fails with an error of the service (5xx, an odd answer)
   * only leaves its values out (`missing`); one that refuses the credentials
   * (401/403) marks the site `denied` and skips its other paths (the account
   * just took them: they are good, only that site is closed to them). A 429
   * anywhere stops the read; a network failure stops the remaining requests
   * (kept: what came). `skip(siteId)` true leaves a site unread this time
   * (a denied site waiting). `alive()` false (a restart, a new configuration)
   * stops between two requests.
   * @returns {Promise<{ sites: Array<{ site, kpisPower?, kpisEnergy?, power?,
   *   serverTime?: number, missing: string[], denied: boolean, skipped: boolean }>,
   *   more: boolean, serverTime?: number }>} `serverTime`: the `Date` of the
   *   first answer of the site (of the account for the read)
   */
  async readAll(credentials, { alive = () => true, skip = () => false } = {}) {
    const account = await this.get('', credentials);
    const { sites, more } = parseAccount(account.answer);
    if (sites === undefined) {
      throw new AutarcoError('unknown_answer');
    }
    const result = { sites: [], more, serverTime: account.serverTime };
    let cut = false;
    for (const site of sites) {
      const entry = { site, missing: [], denied: false, skipped: false };
      result.sites.push(entry);
      if (cut || !alive()) {
        entry.missing.push(...SITE_READS.map(([name]) => name));
        continue;
      }
      if (skip(site.siteId)) {
        entry.skipped = true;
        continue;
      }
      for (const [name, path] of SITE_READS) {
        if (cut || !alive()) {
          entry.missing.push(name);
          continue;
        }
        try {
          const { answer, serverTime } = await this.get(
            `${encodeURIComponent(site.publicKey)}/${path}`,
            credentials,
          );
          entry[name] = answer;
          // The time of the service when it gave these values (staleness of an inverter).
          entry.serverTime ??= serverTime;
        } catch (err) {
          if (err.code === 'rate_limited') {
            throw err;
          }
          if (err.code === 'refused' || err.code === 'forbidden') {
            entry.denied = true;
            break;
          }
          entry.missing.push(name);
          if (err.code === 'timeout' || err.code === 'unreachable') {
            cut = true;
          }
        }
      }
    }
    return result;
  }
}
