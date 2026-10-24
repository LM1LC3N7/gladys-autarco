// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js, external id types) is
// forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * External ids: `site:<site_id>` (the number Autarco gives each installation
 * of the account) and `inverter:<serial>` (the serial number of an inverter).
 */
export const SITE_TYPE = 'site';
export const INVERTER_TYPE = 'inverter';

// --- The public API of Autarco (my.autarco.com, HTTP Basic auth with the account) ---
export const API_HOST = 'my.autarco.com';
export const API_BASE = `https://${API_HOST}/api/site/`;
/** The paths of a site, after `/api/site/<public_key>/` (python-autarco). */
export const SITE_PATHS = {
  KPIS_POWER: 'kpis/power',
  KPIS_ENERGY: 'kpis/energy',
  POWER: 'power',
};
/** The library waits 15 s. */
export const HTTP_TIMEOUT = 15_000;
/** The answers are a few KiB (the inverter list with a day of 15-minute graphs): more is not one. */
export const MAX_BODY_BYTES = 256 * 1024;
/** The sites read, at most (the first page of the account: 30 by the API). */
export const MAX_SITES = 30;
/** The inverters of a site, at most. */
export const MAX_INVERTERS = 50;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/**
 * The reading interval of the form (s): 5 min by default (the portal itself
 * refreshes its values about every 5 minutes; Home Assistant reads it so),
 * 2 min to 1 h.
 */
export const POLL_DEFAULT = 300;
export const POLL_MIN = 120;
export const POLL_MAX = 3600;
/** How often the integration looks whether a read is due (never a read by itself). */
export const TICK = 15 * SECOND;
/**
 * The instant of the last request is written to /data at most once a minute:
 * after a restart, the first read waits this long on top of the interval, so
 * that a container restarting in a loop never reads faster than the interval.
 */
export const ATTEMPT_SAVE_EVERY = MINUTE;
/** The states sent in any 60 s, at most (the core refuses a whole batch beyond 300). */
export const STATES_PER_MINUTE = 270;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** Unreachable: tried again after the interval at least, doubled up to 30 min. */
export const RETRY_MIN = MINUTE;
export const RETRY_MAX = 30 * MINUTE;
/** HTTP 429 anywhere, or 5xx of the account: a pause from 1 min to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** A site whose data refuse the (accepted) credentials: not read for the interval, doubled up to 1 h. */
export const DENIED_MAX = HOUR;
/** The test button answers within this delay. */
export const TEST_ANSWER_WITHIN = 25 * SECOND;
/** The second click of "Accept the held index" counts from 3 s to 5 min after the first. */
export const ACCEPT_CONFIRM_AFTER = 3 * SECOND;
export const ACCEPT_CONFIRM_WITHIN = 5 * MINUTE;
/** Values older than this many intervals are no longer published as current. */
export const FRESH_INTERVALS = 2;
/** The power of an inverter whose last message is older than this (service time) is not sent. */
export const INVERTER_STALE = 2 * HOUR;

// --- Energy index ---------------------------------------------------------------------
/**
 * The guard of the solar production index of a site (src/guard.js): 50 kW
 * covers a home or a small business installation; 1.5 kWh is always accepted
 * on top, as the API gives whole kWh (a step of 1 kWh, a late read).
 */
export const INDEX_LIMITS = { pv: { maxKw: 50, slackKwh: 1.5 } };

/** A power above this (W) is a glitch. */
export const POWER_MAX = 1_000_000;
/** A lifetime counter above this (kWh) is a glitch. */
export const ENERGY_MAX = 100_000_000;
