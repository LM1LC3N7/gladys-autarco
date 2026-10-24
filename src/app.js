// -----------------------------------------------------------------------------
// The integration itself: the Autarco account of the configuration (e-mail
// address and password), read every 5 minutes by default (the account, then
// for each site its power and energy figures and its inverters), the devices
// of the sites and inverters, the solar production index of each site checked
// by its guard, the pauses and the refusal kept in /data, the test and
// accept buttons. index.js only wires the SDK handlers to it.
//
// READ-ONLY: only GET requests of the public API; nothing is ever sent to an
// installation (no onSetValue at all).
//
// Pace: nothing reads the account faster than the interval: not the timer,
// not the test button, not Discovery, not a (re)connection to Gladys, not a
// save of an unchanged configuration, not a restart of the container (the
// instant of the last request is kept in /data, written at most once a
// minute). New credentials may be read at once.
//
// Refused credentials (401 of the account): a FINAL stop kept in /data, never
// an automatic new try; only new credentials, or a click on the test button
// (at the pace), read again, and only a success clears it.
//
// A read belongs to its generation (each start/stop opens a new one): a read
// that ends after a restart or a new configuration publishes nothing and sets
// no status.
//
// Two clocks: `now` (wall clock) dates the index and what /data keeps;
// `monotonic` paces the reads, so that a wall clock set back never stops them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { AutarcoClient } from './autarco/client.js';
import { parseInverters, parseSite } from './autarco/model.js';
import { normalizeConfig } from './config.js';
import {
  ACCEPT_CONFIRM_AFTER,
  ACCEPT_CONFIRM_WITHIN,
  ATTEMPT_SAVE_EVERY,
  DENIED_MAX,
  FRESH_INTERVALS,
  INDEX_LIMITS,
  INVERTER_STALE,
  MAX_INVERTERS,
  MAX_SITES,
  PAUSE_MAX,
  PAUSE_MIN,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  STATES_PER_MINUTE,
  TEST_ANSWER_WITHIN,
  TICK,
} from './constants.js';
import {
  INDEXES,
  INVERTER_CATALOG,
  SITE_CATALOG,
  buildInverterDevice,
  buildSiteDevice,
  inverterIds,
  round,
  siteIds,
  statesOf,
} from './devices.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { accountOf, createFileStore, readState, refusedMark } from './store.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

const MINUTE = 60_000;

/** The index Gladys already holds for a feature of the created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

export class AutarcoApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'autarco' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    client,
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.client = client ?? new AutarcoClient({ now });
    this.store = store;
    /** What /data keeps (src/store.js readState), read once. */
    this.kept = readState(store.load(), now(), { maxPause: PAUSE_MAX });
    /** The instant of the last request as written in /data (written at most once a minute). */
    this.savedAttemptAt = this.kept.lastAttemptAt;
    const now0 = now();
    const mono0 = monotonic();
    /**
     * After a restart of the container: the first read waits the interval
     * and the minute the last request may have come after the one written.
     * Kept on the monotonic clock (the wall clock only dates /data): a wall
     * clock set back afterwards never lengthens the wait.
     */
    this.restartMono =
      this.kept.lastAttemptAt > 0 ? mono0 - Math.max(0, now0 - this.kept.lastAttemptAt) : undefined;
    /** The end of a pause on the monotonic clock (its wall end only for /data), capped. */
    this.pauseEndMono = this.kept.pause
      ? mono0 + Math.min(Math.max(0, this.kept.pause.until - now0), PAUSE_MAX)
      : 0;
    /** Reads started in this process: the first site read turns with it. */
    this.reads = 0;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** The credentials of the last start (memory only): other ones may be tried at once. */
    this.knownCredentials = undefined;
    /** Monotonic time of the last request started, in this process. */
    this.lastAttemptMono = undefined;
    /** Unreachable / odd answer: failures in a row, the monotonic time of the next try. */
    this.failures = 0;
    this.retryAtMono = 0;
    this.lastError = undefined;
    /** The last good read: `{ sites, more }`, its monotonic and wall times. */
    this.last = undefined;
    this.valuesAt = undefined;
    this.readAt = undefined;
    /** The names of the sites (memory only: never in /data). */
    this.names = new Map();
    /** By site id: a site that refused the (good) credentials, `{ count, untilMono }`. */
    this.denied = new Map();
    /** By index feature external id: IndexGuard. */
    this.guards = new Map();
    /** The first click of "Accept the held index": `{ at, listedAt, list }`, in memory only. */
    this.pendingAccept = undefined;
    this.publishedDevices = undefined;
    /** The states sent in the last minute: `[{ at, count }]`, monotonic (STATES_PER_MINUTE). */
    this.sent = [];
    /** Which device the next publication starts with (more states than a minute allows). */
    this.rotation = 0;
    /** By index feature external id: the hold last logged (`direction:from`). */
    this.loggedHolds = new Map();
    this.timer = undefined;
    this.busy = undefined;
    this.firstRun = Promise.resolve();
    this.lastStatus = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `fresh`: the user saved the form (not a reconnection). It accepts no index held back. */
  start(raw = {}, { fresh = false } = {}) {
    return this.serialize(() => this.doStart(raw, { fresh }));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the read after it are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.firstRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw, { fresh = false } = {}) {
    await this.doStop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    const { email, password } = this.config;
    let changed = false;
    if (email) {
      const account = accountOf(this.kept.salt, email);
      if (account !== this.kept.account) {
        // Another account: its pace, pause, refusal and sites start afresh
        // (the devices and their indexes stay in Gladys).
        Object.assign(this.kept, {
          account,
          lastAttemptAt: 0,
          pause: null,
          refusal: null,
          sites: {},
        });
        this.savedAttemptAt = 0;
        this.restartMono = undefined;
        this.forgetPace();
        this.last = undefined;
        this.names.clear();
        this.denied.clear();
        changed = true;
      }
    }
    if (email && password) {
      const credentials = `${email}\n${password}`;
      const refusal = this.kept.refusal;
      const other =
        this.knownCredentials !== undefined
          ? this.knownCredentials !== credentials
          : Boolean(refusal) && refusal.mark !== refusedMark(this.kept.salt, email, password);
      this.knownCredentials = credentials;
      if (other) {
        // New credentials: tried at once (a pause asked by the service stays).
        if (this.kept.refusal) {
          this.kept.refusal = null;
          changed = true;
        }
        this.restartMono = undefined;
        this.forgetPace();
      }
    }
    if (changed) {
      await this.saveState();
    }
    // The core keeps the connection status and the Discovery list in memory:
    // a restarted Gladys has lost them, so they are always sent again.
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    if (!fresh) {
      // A (re)connection: every value again at the next read.
      this.gladys.forgetPublishedStates?.();
    }
    await this.discover();
    await this.updateStatus({ starting: true });
    // Always armed, whatever the first read gives: never a dead integration.
    this.timer = this.timers.setInterval(() => this.run(generation, () => this.tick()), TICK);
    const late = this.busy;
    this.firstRun = this.run(generation, () => this.tick());
    if (late) {
      // A read of the previous generation still running: its result (a
      // refusal, a pause, a success with the same credentials) is kept, and
      // the status is set again for THIS generation once it ends.
      this.firstRun = late
        .catch(() => {})
        .then(() => this.run(generation, () => this.updateStatus()));
    }
  }

  forgetPace() {
    this.lastAttemptMono = undefined;
    this.failures = 0;
    this.retryAtMono = 0;
    this.lastError = undefined;
  }

  async doStop() {
    this.generation += 1;
    if (this.timer !== undefined) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
    // /data written at a clean stop too (the last request, the guards).
    await this.saveState({ attemptNow: true });
  }

  /** Run a job of a generation: nothing after a restart. */
  async run(generation, job) {
    if (generation !== this.generation) {
      return undefined;
    }
    try {
      return await job();
    } catch (err) {
      this.logger.error(`Autarco: unexpected error (${err?.name ?? 'Error'})`);
      return undefined;
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Devices --------------------------------------------------------------------

  /** The created Gladys device of an external id, undefined until the user creates it. */
  createdDevice(externalId) {
    return (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
  }

  /** The site id of a site device external id, by its shape alone (`...:site:<digits>`). */
  siteIdOf(externalId) {
    const prefix = siteIds(this.gladys, '0').device.slice(0, -1);
    const id = typeof externalId === 'string' ? externalId.slice(prefix.length) : '';
    return externalId?.startsWith?.(prefix) && /^\d{1,13}$/.test(id) ? id : undefined;
  }

  devicesToPublish() {
    if (!this.config.email || this.kept.account === null) return [];
    const devices = [];
    for (const [siteId, site] of Object.entries(this.kept.sites)) {
      const created = this.createdDevice(siteIds(this.gladys, siteId).device);
      devices.push(
        buildSiteDevice(
          this.gladys,
          { siteId, name: this.names.get(siteId), groups: site.groups },
          { created },
        ),
      );
      for (const serial of site.inverters) {
        devices.push(buildInverterDevice(this.gladys, { serial, siteId }));
      }
    }
    return devices;
  }

  async discover({ force = false } = {}) {
    const devices = this.devicesToPublish();
    const json = JSON.stringify(devices);
    if (!force && json === this.publishedDevices) {
      return;
    }
    this.publishedDevices = json;
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) => this.logger.warn(`Publishing the Autarco devices failed: ${err.message}`));
  }

  /** The Discover tab: the devices known, published again; never a request to the service. */
  async scan() {
    await this.discover({ force: true });
    await this.updateStatus();
  }

  isFresh() {
    return (
      this.last !== undefined &&
      this.monotonic() - this.valuesAt <= FRESH_INTERVALS * this.config.pollInterval * 1000
    );
  }

  /** A device just created: the values of the last read now (no new request). */
  async onDeviceCreated(device) {
    const siteId = this.siteIdOf(device?.external_id);
    if (siteId !== undefined) {
      // A new device: no reference of its index yet (nor a state kept in
      // /data for a deleted device of the same id).
      const external = siteIds(this.gladys, siteId);
      for (const { key } of INDEXES) {
        const id = external.feature(key);
        this.guards.delete(id);
        delete this.kept.indexes[id];
      }
      this.savedKey = undefined;
      await this.saveState();
    }
    await this.publishLast();
  }

  async onDeviceUpdated() {
    await this.publishLast();
  }

  async publishLast() {
    const generation = this.generation;
    if (!this.isFresh()) return;
    const prepared = this.prepare(this.last);
    await this.saveState();
    if (prepared.length > 0 && generation === this.generation) {
      await this.send(prepared);
      if (generation === this.generation) await this.updateStatus();
    }
  }

  // --- /data -------------------------------------------------------------------------

  /**
   * Keeps the state in /data when it changed. The instant of the last request
   * is written at most once a minute (the one already written otherwise),
   * and at a clean stop.
   */
  async saveState({ attemptNow = false } = {}) {
    const indexes = { ...this.kept.indexes };
    for (const [id, guard] of this.guards) {
      indexes[id] = guard.state();
    }
    this.kept.indexes = indexes;
    const now = this.now();
    const attempt =
      this.kept.lastAttemptAt !== this.savedAttemptAt &&
      (attemptNow || this.savedAttemptAt === 0 || now - this.savedAttemptAt >= ATTEMPT_SAVE_EVERY)
        ? this.kept.lastAttemptAt
        : this.savedAttemptAt;
    const state = {
      salt: this.kept.salt,
      account: this.kept.account,
      lastAttemptAt: attempt,
      pause: this.kept.pause,
      refusal: this.kept.refusal,
      sites: this.kept.sites,
      indexes,
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
      this.savedAttemptAt = attempt;
    } catch (err) {
      this.logger.warn(`Saving the Autarco state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Reads -------------------------------------------------------------------------

  intervalMs() {
    return this.config.pollInterval * 1000;
  }

  /** The wait after a failure: never faster than a read, doubled up to 30 min. */
  retryWait(failures) {
    const first = Math.max(RETRY_MIN, this.intervalMs());
    return Math.min(first * 2 ** failures, Math.max(RETRY_MAX, first));
  }

  /**
   * The earliest instant (wall clock) of the next read, whatever asks for it.
   * Refused credentials: never by itself (Infinity); `manual` (the test
   * button) at the pace only.
   */
  nextReadAt({ manual = false } = {}) {
    if (!manual && this.kept.refusal) return Infinity;
    const now = this.now();
    const mono = this.monotonic();
    const at = [now];
    if (this.lastAttemptMono !== undefined) {
      at.push(now + this.lastAttemptMono + this.intervalMs() - mono);
    }
    if (this.retryAtMono > mono) at.push(now + this.retryAtMono - mono);
    if (this.restartMono !== undefined) {
      at.push(now + this.restartMono + ATTEMPT_SAVE_EVERY + this.intervalMs() - mono);
    }
    if (this.kept.pause) at.push(now + this.pauseLeft());
    return Math.max(...at);
  }

  /** What is left of a pause (ms, monotonic clock, never more than PAUSE_MAX); 0 without one. */
  pauseLeft() {
    if (!this.kept.pause) return 0;
    return Math.min(Math.max(0, this.pauseEndMono - this.monotonic()), PAUSE_MAX);
  }

  due(options) {
    return Boolean(this.config.password) && this.nextReadAt(options) <= this.now();
  }

  /**
   * One look: a read when one is due. A read still running is never doubled,
   * whatever its generation (a reconnection during a read starts no other).
   */
  tick({ manual = false } = {}) {
    if (this.busy) {
      return this.busy;
    }
    if (!this.due({ manual })) {
      return undefined;
    }
    const generation = this.generation;
    this.busy = this.read(generation).finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read(generation) {
    const { email, password } = this.config;
    const alive = () => generation === this.generation;
    const now = this.now();
    // Recorded first: neither a reconnection, a save nor a restart reads sooner.
    const startedMono = this.monotonic();
    this.lastAttemptMono = startedMono;
    this.restartMono = undefined;
    this.kept.lastAttemptAt = now;
    await this.saveState();
    let answers;
    try {
      // One clock reading for the whole read: the start decides which denied
      // site waits, and its wait is counted from that same start (digest).
      answers = await this.client.readAll(
        { email, password },
        {
          alive,
          skip: (siteId) => (this.denied.get(siteId)?.untilMono ?? 0) > startedMono,
          start: this.reads++,
        },
      );
    } catch (err) {
      await this.failed(err, { email, password, alive });
      return;
    }
    const same = this.config.email === email && this.config.password === password;
    if (!alive()) {
      // Late: an old configuration or a restart. Nothing published, no status
      // (the new generation sets it). With the same credentials, the success
      // still lifts a refusal, a pause and the failures.
      if (same) {
        this.clearErrors();
        await this.saveState();
      }
      return;
    }
    this.clearErrors();
    this.last = this.digest(answers, startedMono);
    this.valuesAt = this.monotonic();
    this.readAt = this.now();
    const prepared = this.prepare(this.last);
    // Saved BEFORE Gladys gets the values: a crash in between never sends an
    // index /data does not know.
    await this.saveState();
    if (!alive()) return;
    if (prepared.length > 0) await this.send(prepared);
    if (!alive()) return;
    await this.discover();
    if (!alive()) return;
    await this.updateStatus();
  }

  /**
   * The answers of a read -> `{ sites: [{ siteId, values, inverters, missing,
   * denied, skipped }], more }`; the sites known (Discovery) updated: groups
   * and inverters only grow, a site gone from the account leaves the list.
   */
  digest(answers, startedMono = this.monotonic()) {
    const sites = [];
    const known = {};
    for (const entry of answers.sites) {
      const { siteId, name } = entry.site;
      if (name) this.names.set(siteId, name);
      else this.names.delete(siteId);
      const before = this.kept.sites[siteId] ?? { groups: [], inverters: [] };
      if (entry.denied) {
        const count = (this.denied.get(siteId)?.count ?? 0) + 1;
        const wait = Math.min(
          this.intervalMs() * 2 ** count,
          Math.max(DENIED_MAX, this.intervalMs()),
        );
        this.denied.set(siteId, { count: Math.min(count, 32), untilMono: startedMono + wait });
        this.logger.warn(`Autarco site ${siteId}: access refused, not read`);
      } else if (!entry.skipped) {
        this.denied.delete(siteId);
      }
      const read = !entry.denied && !entry.skipped;
      const { values, groups } = read ? parseSite(entry) : { values: {}, groups: [] };
      const inverters = read ? parseInverters(entry.kpisPower, entry.power) : [];
      if (read) {
        // The power of an inverter silent for 2 h (the time of the service)
        // is not current: left out. Without a readable time, never "stale".
        const serverTime = entry.serverTime ?? answers.serverTime;
        const dated =
          serverTime === undefined ? [] : inverters.filter((i) => i.latest !== undefined);
        for (const inverter of dated) {
          if (serverTime - inverter.latest > INVERTER_STALE) {
            inverter.power = undefined;
          }
        }
        // The solar power of the site is the sum of its inverters (the answers
        // of the library): when every inverter with a readable time is silent
        // for 2 h, it is not a current value either. Never applied to the
        // battery or the meter (they may talk while the inverters sleep).
        if (dated.length > 0 && dated.every((i) => serverTime - i.latest > INVERTER_STALE)) {
          delete values.pvPower;
        }
      }
      known[siteId] = {
        groups: [...new Set([...before.groups, ...groups])].sort(),
        inverters: [...new Set([...before.inverters, ...inverters.map((i) => i.serial)])]
          .sort()
          .slice(0, MAX_INVERTERS),
      };
      sites.push({
        siteId,
        values,
        inverters,
        missing: entry.missing.length > 0,
        timedOut: entry.timedOut === true,
        unread: entry.unread === true,
        denied: entry.denied || (entry.skipped && this.denied.has(siteId)),
      });
    }
    this.kept.sites = known;
    for (const id of this.names.keys()) {
      if (!(id in known)) this.names.delete(id);
    }
    return { sites, more: answers.more };
  }

  /** A success: no failure, no pause, no refusal (its marker goes with it). */
  clearErrors() {
    this.failures = 0;
    this.retryAtMono = 0;
    this.lastError = undefined;
    this.kept.pause = null;
    this.pauseEndMono = 0;
    this.kept.refusal = null;
  }

  async failed(err, { email, password, alive }) {
    const code = err?.code ?? 'error';
    // A late failure of other credentials is dropped; a pause or a refusal of
    // the same credentials is still kept.
    const same = this.config.email === email && this.config.password === password;
    if (!alive() && !same) return;
    // Our own words only (AutarcoError codes): never a text of the service, never a credential.
    this.logger.warn(`Autarco read failed: ${code}${err?.status ? ` ${err.status}` : ''}`);
    const now = this.now();
    const mono = this.monotonic();
    if (code === 'refused') {
      // Final: no end, no automatic try (only new credentials or the test button).
      this.kept.refusal = { status: 401, mark: refusedMark(this.kept.salt, email, password) };
    } else if (code === 'rate_limited' || code === 'server' || code === 'forbidden') {
      const count = (this.kept.pause?.count ?? 0) + 1;
      const asked = err.retryAfter ?? PAUSE_MIN * 2 ** (count - 1);
      const doubled = PAUSE_MIN * 2 ** (count - 1);
      // A 403 is never shorter than its doubling (a Retry-After does not lift it sooner).
      const wanted = code === 'forbidden' ? Math.max(asked, doubled) : asked;
      const wait = Math.min(Math.max(wanted, PAUSE_MIN, this.intervalMs()), PAUSE_MAX);
      this.pauseEndMono = mono + wait;
      this.kept.pause = {
        until: now + wait,
        count: Math.min(count, 32),
        code,
        status: err.status ?? null,
      };
    } else {
      this.retryAtMono = mono + this.retryWait(this.failures);
      this.failures += 1;
    }
    this.lastError = err;
    await this.saveState();
    if (alive()) {
      await this.updateStatus();
    }
  }

  /** The guard of an index of a created device, from Gladys and /data. */
  guardOf(created, id, limits) {
    if (!this.guards.has(id)) {
      this.guards.set(
        id,
        new IndexGuard(lastValueOf(created, id), this.kept.indexes[id], this.now(), limits),
      );
    }
    return this.guards.get(id);
  }

  /**
   * The states of a read, each index through its guard (not sent yet: `send`
   * does it, after /data is saved), grouped by created device.
   * @returns {Array<Array<object>>} one list of states per device
   */
  prepare(last) {
    const batches = [];
    const now = this.now();
    for (const site of last?.sites ?? []) {
      const external = siteIds(this.gladys, site.siteId);
      const created = this.createdDevice(external.device);
      if (created) {
        const indexes = {};
        for (const { name, key, value } of INDEXES) {
          const id = external.feature(key);
          const guard = this.guardOf(created, id, INDEX_LIMITS[name]);
          const total = site.values[value] === undefined ? undefined : round(site.values[value], 3);
          if (total === undefined) {
            indexes[key] = guard.held ? guard.last?.value : undefined;
            continue;
          }
          const plausible = guard.accept(total, now);
          const held = guard.held ? `${guard.held.direction}:${guard.held.from}` : undefined;
          if (held && this.loggedHolds.get(id) !== held) {
            this.logger.warn(
              `Autarco site ${site.siteId} ${name} index ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held index" button takes it`,
            );
          }
          if (held) this.loggedHolds.set(id, held);
          else this.loggedHolds.delete(id);
          // While a value is held, the last accepted one is sent again (no delta for the core).
          indexes[key] = plausible ? total : guard.held ? guard.last?.value : undefined;
        }
        const features = new Set((created.features ?? []).map((f) => f.external_id));
        const states = statesOf(external, SITE_CATALOG, site.values, indexes).filter((s) =>
          features.has(s.device_feature_external_id),
        );
        if (states.length > 0) batches.push(states);
      }
      for (const inverter of site.inverters) {
        const ids = inverterIds(this.gladys, inverter.serial);
        const device = this.createdDevice(ids.device);
        if (!device) continue;
        const features = new Set((device.features ?? []).map((f) => f.external_id));
        const states = statesOf(ids, INVERTER_CATALOG, inverter).filter((s) =>
          features.has(s.device_feature_external_id),
        );
        if (states.length > 0) batches.push(states);
      }
    }
    return batches;
  }

  /**
   * The states, within STATES_PER_MINUTE over any 60 s: whole devices, from a
   * device that changes at each publication (none is starved when an account
   * has more than a minute allows), the rest at the next read. The room is
   * taken BEFORE the publication (two publications at once never both pass).
   */
  async send(batches) {
    const mono = this.monotonic();
    this.sent = this.sent.filter((s) => mono - s.at < MINUTE);
    let room = STATES_PER_MINUTE - this.sent.reduce((sum, s) => sum + s.count, 0);
    const start = this.rotation % batches.length;
    const states = [];
    let taken = 0;
    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[(start + i) % batches.length];
      if (batch.length > room) break;
      states.push(...batch);
      room -= batch.length;
      taken += 1;
    }
    if (taken < batches.length) {
      this.rotation = start + Math.max(1, taken);
      this.logger.debug('Autarco: some values kept for the next read (states per minute)');
    }
    if (states.length === 0) return;
    const entry = { at: mono, count: states.length };
    this.sent.push(entry);
    try {
      const result = await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT });
      if (Number.isInteger(result?.count) && result.count >= 0 && result.count <= states.length) {
        entry.count = result.count;
      }
    } catch (err) {
      this.logger.warn(`Publishing the Autarco values failed: ${err.message}`);
    }
  }

  // --- Status ------------------------------------------------------------------------

  /** Every index held back: `{ id, name, site, direction, from, to }`. */
  heldList() {
    const list = [];
    for (const siteId of Object.keys(this.kept.sites)) {
      const external = siteIds(this.gladys, siteId);
      const created = this.createdDevice(external.device);
      if (!created) continue;
      for (const { name, key } of INDEXES) {
        const id = external.feature(key);
        const held = this.guardOf(created, id, INDEX_LIMITS[name]).held;
        if (held) list.push({ id, name, site: siteId, ...held });
      }
    }
    return list;
  }

  async updateStatus({ starting = false } = {}) {
    const { problem } = this.config;
    if (problem) {
      await this.setStatus(false, T.problem[problem]);
      return;
    }
    const now = this.now();
    const mono = this.monotonic();
    const { pause, refusal } = this.kept;
    if (refusal) {
      await this.setStatus(false, T.refused(refusal));
      return;
    }
    if (pause && this.pauseLeft() > 0) {
      await this.setStatus(false, T.paused(pause, this.pauseLeft()));
      return;
    }
    if (this.lastError) {
      const wait = Math.max(0, this.retryAtMono - mono);
      await this.setStatus(false, T.failing(this.lastError, wait));
      return;
    }
    if (!this.last) {
      const at = this.nextReadAt();
      if (starting && at <= now) {
        await this.setStatus(false, T.connecting);
      } else {
        // After a restart, an account read before (no refusal, no pause, no
        // error) is shown connected until its next read.
        await this.setStatus(Object.keys(this.kept.sites).length > 0, T.waiting(at));
      }
      return;
    }
    const notes = [];
    const { sites, more } = this.last;
    if (sites.length === 0) notes.push(T.notes.noSite);
    else if (!this.devicesToPublish().some((d) => this.createdDevice(d.external_id))) {
      notes.push(T.notes.noDevice);
    }
    if (more) notes.push(T.notes.more(MAX_SITES));
    const ids = (filter) => sites.filter((s) => !s.denied && filter(s)).map((s) => s.siteId);
    const unread = ids((s) => s.unread);
    const timedOut = ids((s) => !s.unread && s.timedOut);
    const errors = ids((s) => !s.unread && !s.timedOut && s.missing);
    if (timedOut.length > 0) notes.push(T.notes.noAnswer(timedOut));
    if (errors.length > 0) notes.push(T.notes.missing(errors));
    if (unread.length > 0) notes.push(T.notes.unread(unread));
    if (unread.length + timedOut.length + errors.length > 0) {
      const whole = sites.some((s) => !s.missing && !s.denied);
      notes.push(whole ? T.notes.othersOk : T.notes.noneWhole);
    }
    const denied = sites.filter((s) => s.denied).map((s) => s.siteId);
    if (denied.length > 0) notes.push(T.notes.denied(denied));
    const held = this.heldList();
    if (held.length > 0) notes.push(T.notes.held(held));
    await this.setStatus(true, T.ok(sites.length, notes));
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * "Accept the held index", in two clicks: the first lists every index held
   * (nothing is accepted), the second, from 3 s to 5 min later, accepts
   * exactly what the first listed, and only when it still shows that value
   * (or what may have come since, src/guard.js). A save of the form never accepts.
   */
  async acceptHeldIndex() {
    const list = this.heldList();
    const mono = this.monotonic();
    const now = this.now();
    const pending = this.pendingAccept;
    this.pendingAccept = undefined;
    const elapsed = pending ? mono - pending.at : undefined;
    if (!pending || elapsed > ACCEPT_CONFIRM_WITHIN || elapsed < ACCEPT_CONFIRM_AFTER) {
      if (list.length === 0) {
        return T.accept.nothing;
      }
      this.pendingAccept = { at: mono, listedAt: now, list };
      return T.accept.confirm(list, ACCEPT_CONFIRM_WITHIN);
    }
    const accepted = [];
    const changed = [];
    for (const entry of pending.list) {
      const guard = this.guards.get(entry.id);
      const held = guard?.held;
      const margin = guard ? guard.margin(pending.listedAt, now) : 0;
      const same =
        held &&
        held.direction === entry.direction &&
        held.from === entry.from &&
        (entry.direction === 'up'
          ? held.to >= entry.to && held.to - entry.to <= margin
          : Math.abs(held.to - entry.to) <= margin);
      if (same && guard.acceptHeld()) {
        accepted.push({ ...entry, to: held.to });
      } else if (held) {
        changed.push(entry);
      }
    }
    if (accepted.length === 0 && changed.length === 0) {
      return T.accept.nothing;
    }
    for (const { name, site, direction } of accepted) {
      this.logger.info(
        `Autarco site ${site} ${name} index ${direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
      );
    }
    await this.saveState();
    // Published at the next read (never a read sooner than the interval).
    const taken = new Set(accepted.map((h) => h.id));
    const stillHeld = this.heldList().some((h) => !taken.has(h.id));
    return T.accept.done(accepted, changed, stillHeld);
  }

  /**
   * The test button: a read when one is due (the interval passed; refused
   * credentials are tried again then, once per click), else what is known and
   * when the next read can be. Never a request a pause or the pace forbids.
   */
  async testConnection() {
    const { problem } = this.config;
    if (problem) {
      return T.problem[problem];
    }
    const generation = this.generation;
    const job = this.busy ?? this.tick({ manual: true });
    if (job) {
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(() => resolve('late'), TEST_ANSWER_WITHIN);
      });
      try {
        if ((await Promise.race([job.then(() => 'done'), late])) === 'late') {
          return T.test.slow;
        }
      } finally {
        this.timers.clearTimeout(timer);
      }
    }
    if (generation !== this.generation) {
      return T.test.slow;
    }
    const lines = [];
    const fresh = this.isFresh();
    if (this.kept.refusal) {
      lines.push(T.test.failed({ code: 'refused', status: this.kept.refusal.status }));
    } else if (this.kept.pause && this.pauseLeft() > 0) {
      lines.push(T.test.failed(this.kept.pause));
    } else if (this.lastError) {
      lines.push(T.test.failed(this.lastError));
    } else if (fresh) {
      lines.push(T.test.ok(this.last.sites));
    }
    if (fresh && this.readAt !== undefined) lines.push(T.test.lastRead(this.readAt));
    if (!job) lines.push(T.test.notNow(this.nextReadAt({ manual: true })));
    return T.test.lines(lines);
  }
}
