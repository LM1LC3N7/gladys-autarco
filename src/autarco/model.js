// -----------------------------------------------------------------------------
// The answers of the Autarco API -> our values. Pure.
//
// The paths, keys and units come from python-autarco (Klaas Schoute, MIT,
// `src/autarco/models.py` and its test answers), as Home Assistant reads them:
// - account (`/api/site/`): `data`, one entry per site: `site_id`,
//   `public_key` (the key of the site in the paths), `name`, `health`;
// - `kpis/power`: `pv_now` (W), `inverters` (by serial: `power` W, `health`,
//   `latest` the time of its last message), and with a battery or a meter
//   `battery_now`, `battery_net_charged_now`, `battery_soc` (%),
//   `grid_net_import_now`, `grid_export_now`, `consumption_now` (W);
// - `kpis/energy`: `pv_today`, `pv_month`, `pv_to_date` (kWh, whole), and
//   `battery_charged_*`, `battery_discharged_*`, `grid_import_to_date`,
//   `grid_export_to_date`, `consumption_*` (kWh);
// - `power`: `inverters` (by serial: `sn`, `out_ac_power` W,
//   `out_ac_energy_total` kWh, `grid_turned_off`, `health`, `dt_latest_msg`).
//
// Signs: the API documentation is not public and no answer of a real site
// with a battery was seen: the battery and grid powers are taken as given,
// in plain signed sensors, never split into charge / discharge or import /
// export by a guessed sign.
//
// Hostile answers: only own keys are read (never the prototype), only finite
// numbers (or strings of a plain decimal number) are taken, every value is
// checked against a range; anything else is left out, never read as 0.
// -----------------------------------------------------------------------------

import { ENERGY_MAX, MAX_INVERTERS, MAX_SITES, POWER_MAX } from '../constants.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, key) => (isObject(o) && Object.hasOwn(o, key) ? o[key] : undefined);

/** A number the service sent: a finite number, or a string of a plain decimal number. */
export function num(v) {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof v === 'string' && /^-?\d{1,12}(\.\d{1,9})?$/.test(v.trim())) {
    return Number(v.trim());
  }
  return undefined;
}

/** `key` of `o`, a number within [min, max], else undefined. */
function read(o, key, min, max) {
  const v = num(own(o, key));
  return v !== undefined && v >= min && v <= max ? v : undefined;
}

/** A public key of a site: it goes into a path, so letters, digits, `_` and `-` only. */
const PUBLIC_KEY = /^[A-Za-z0-9_-]{1,128}$/;
/** A serial number of an inverter: it becomes an external id. */
const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;
/** A name shown in Gladys: letters, digits and common punctuation, no control character. */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} '.,()&+_-]{0,59}$/u;

export const isSerial = (s) => typeof s === 'string' && SERIAL.test(s);

/** A name of the service, or undefined (never a text we cannot show). */
export function nameOf(v) {
  if (typeof v !== 'string') return undefined;
  const text = v.trim().replace(/\s+/g, ' ');
  return NAME.test(text) ? text : undefined;
}

/** `health` -> 1 when "OK", 0 for another word, undefined when absent. */
export function healthOf(v) {
  if (typeof v !== 'string' || v.length > 40) return undefined;
  const text = v.trim();
  if (!/^[A-Za-z_ -]{1,40}$/.test(text)) return undefined;
  return text.toUpperCase() === 'OK' ? 1 : 0;
}

/**
 * The account -> `{ sites, more }`: `sites` the valid sites of the first page
 * (MAX_SITES at most, a site id seen twice kept once), undefined when the
 * answer is not an account; `more` whether the account lists more.
 */
export function parseAccount(answer) {
  const data = own(answer, 'data');
  if (!Array.isArray(data)) {
    return { sites: undefined, more: false };
  }
  const sites = [];
  const seen = new Set();
  for (const raw of data.slice(0, MAX_SITES)) {
    const siteId = num(own(raw, 'site_id'));
    const publicKey = own(raw, 'public_key');
    if (
      !Number.isInteger(siteId) ||
      siteId < 1 ||
      siteId > 1e12 ||
      typeof publicKey !== 'string' ||
      !PUBLIC_KEY.test(publicKey) ||
      seen.has(siteId)
    ) {
      continue;
    }
    seen.add(siteId);
    sites.push({
      siteId: String(siteId),
      publicKey,
      name: nameOf(own(raw, 'name')),
      health: healthOf(own(raw, 'health')),
    });
  }
  const next = own(answer, 'next_page_url');
  return {
    sites,
    more: data.length > MAX_SITES || (typeof next === 'string' && next !== ''),
  };
}

/** An ISO date of the service -> ms, undefined when odd. */
function timeOf(v) {
  if (typeof v !== 'string' || v.length > 40) return undefined;
  const at = Date.parse(v);
  return Number.isFinite(at) ? at : undefined;
}

const W = [0, POWER_MAX];
const SIGNED_W = [-POWER_MAX, POWER_MAX];
const KWH = [0, ENERGY_MAX];

/**
 * The inverters of a site, from `kpis/power` and `power` (by serial):
 * `[{ serial, power, latest, energyTotal, health, gridOff }]`, MAX_INVERTERS
 * at most, sorted by serial. A power older than INVERTER_STALE is decided by
 * the caller (src/app.js), from `latest` and the time of the service.
 */
export function parseInverters(kpisPower, power) {
  const bySerial = new Map();
  const entry = (serial) => {
    if (!bySerial.has(serial)) {
      if (bySerial.size >= MAX_INVERTERS) return undefined;
      bySerial.set(serial, { serial });
    }
    return bySerial.get(serial);
  };
  const fromKpis = own(kpisPower, 'inverters');
  if (isObject(fromKpis)) {
    for (const serial of Object.keys(fromKpis).slice(0, MAX_INVERTERS * 2)) {
      const raw = fromKpis[serial];
      if (!isSerial(serial) || !isObject(raw)) continue;
      const e = entry(serial);
      if (!e) break;
      e.power = read(raw, 'power', ...W);
      e.latest = timeOf(own(raw, 'latest'));
      e.health = healthOf(own(raw, 'health'));
    }
  }
  const fromPower = own(power, 'inverters');
  if (isObject(fromPower)) {
    for (const serial of Object.keys(fromPower).slice(0, MAX_INVERTERS * 2)) {
      const raw = fromPower[serial];
      if (!isSerial(serial) || !isObject(raw)) continue;
      // `sn`, when given, must be the key: never mix two inverters.
      const sn = own(raw, 'sn');
      if (sn !== undefined && String(sn) !== serial) continue;
      const e = entry(serial);
      if (!e) break;
      e.energyTotal = read(raw, 'out_ac_energy_total', ...KWH);
      const gridOff = own(raw, 'grid_turned_off');
      e.gridOff = typeof gridOff === 'boolean' ? (gridOff ? 1 : 0) : undefined;
      if (e.power === undefined && e.latest === undefined) {
        e.power = read(raw, 'out_ac_power', ...W);
        e.latest = timeOf(own(raw, 'dt_latest_msg'));
      }
      e.health ??= healthOf(own(raw, 'health'));
    }
  }
  return [...bySerial.values()].sort((a, b) => (a.serial < b.serial ? -1 : 1));
}

/**
 * The values of a site, `{ name: number }`, only what came, checked; the
 * groups it shows (`battery`, `meter`). Powers in W, energies in kWh.
 */
export function parseSite({ site = {}, kpisPower, kpisEnergy } = {}) {
  const v = {};
  v.health = site.health;
  // --- solar
  v.pvPower = read(kpisPower, 'pv_now', ...W);
  v.pvToday = read(kpisEnergy, 'pv_today', ...KWH);
  v.pvMonth = read(kpisEnergy, 'pv_month', ...KWH);
  v.pvTotal = read(kpisEnergy, 'pv_to_date', ...KWH);
  // --- battery (signs as given: not confirmed)
  v.batterySoc = read(kpisPower, 'battery_soc', 0, 100) ?? read(kpisEnergy, 'battery_soc', 0, 100);
  v.batteryPower = read(kpisPower, 'battery_now', ...SIGNED_W);
  v.batteryNetCharged = read(kpisPower, 'battery_net_charged_now', ...SIGNED_W);
  v.batteryChargedToday = read(kpisEnergy, 'battery_charged_today', ...KWH);
  v.batteryDischargedToday = read(kpisEnergy, 'battery_discharged_today', ...KWH);
  v.batteryChargedTotal = read(kpisEnergy, 'battery_charged_to_date', ...KWH);
  v.batteryDischargedTotal = read(kpisEnergy, 'battery_discharged_to_date', ...KWH);
  // --- meter (signs as given: not confirmed)
  v.gridNetImport = read(kpisPower, 'grid_net_import_now', ...SIGNED_W);
  v.gridExport = read(kpisPower, 'grid_export_now', ...SIGNED_W);
  v.gridImportTotal = read(kpisEnergy, 'grid_import_to_date', ...KWH);
  v.gridExportTotal = read(kpisEnergy, 'grid_export_to_date', ...KWH);
  v.consumptionPower = read(kpisPower, 'consumption_now', ...W);
  v.consumptionToday = read(kpisEnergy, 'consumption_today', ...KWH);
  v.consumptionTotal = read(kpisEnergy, 'consumption_to_date', ...KWH);
  for (const key of Object.keys(v)) {
    if (v[key] === undefined) delete v[key];
  }
  const groups = [];
  if (BATTERY_VALUES.some((k) => k in v)) groups.push('battery');
  if (METER_VALUES.some((k) => k in v)) groups.push('meter');
  return { values: v, groups };
}

export const BATTERY_VALUES = [
  'batterySoc',
  'batteryPower',
  'batteryNetCharged',
  'batteryChargedToday',
  'batteryDischargedToday',
  'batteryChargedTotal',
  'batteryDischargedTotal',
];
export const METER_VALUES = [
  'gridNetImport',
  'gridExport',
  'gridImportTotal',
  'gridExportTotal',
  'consumptionPower',
  'consumptionToday',
  'consumptionTotal',
];
