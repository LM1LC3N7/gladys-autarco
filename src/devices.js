// -----------------------------------------------------------------------------
// The Gladys devices of the Autarco account and their states. Pure.
//
// External ids (forever): site:<site_id> (the number Autarco gives each
// installation of the account) and inverter:<serial>. Feature keys (forever):
// SITE and INVERTER below.
//
// Energy rules of the Gladys core (server/utils/constants.js, the comments of
// DEVICE_FEATURE_TYPES, and the lot 6 rules of this project):
// - the ONLY index is the lifetime solar production of a site (`pv_to_date`,
//   `energy-production-sensor` / `index`, with its `thirty-minutes-production`
//   declared here, ids computed (UUID v5) so that an "Update" in Discovery
//   keeps the same rows; the integration never publishes that one). It goes
//   through the guard (src/guard.js): never 0, a jump or a drop held until the
//   user accepts it;
// - the counters of the day and of the month are plain sensors (kWh in the
//   name), never an index, never `daily-*`, never publishEnergyConsumption;
// - NO `energy-sensor` / `index` and no grid or battery index: the grid
//   import is what the main meter of the home (Linky...) already counts in
//   Gladys, and an injection never goes into `energy-sensor`. The grid,
//   consumption and battery counters are plain sensors;
// - the battery and grid powers are plain SIGNED sensors (the sign Autarco
//   uses is not confirmed): never `charge-power` / `discharge-power` nor
//   `grid-sensor` / `power` from a guessed sign;
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): % for battery-storage, W and kWh for
//   energy-production-sensor, none for unknown (the unit is then in the name).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { ENERGY_MAX, INVERTER_TYPE, POWER_MAX, SITE_TYPE } from './constants.js';

/** Feature keys of a site (forever). */
export const SITE = {
  HEALTH: 'health',
  PV_POWER: 'pv_power',
  PV_ENERGY: 'pv_energy',
  /** 30-minute production: fed by the Gladys core from the index, never by the integration. */
  PV_30MIN: 'pv_energy_production',
  PV_TODAY: 'pv_today',
  PV_MONTH: 'pv_month',
  BATTERY_LEVEL: 'battery_level',
  BATTERY_POWER: 'battery_power',
  BATTERY_NET_CHARGED: 'battery_net_charged',
  BATTERY_CHARGED_TODAY: 'battery_charged_today',
  BATTERY_DISCHARGED_TODAY: 'battery_discharged_today',
  BATTERY_CHARGED_TOTAL: 'battery_charged_total',
  BATTERY_DISCHARGED_TOTAL: 'battery_discharged_total',
  GRID_NET_IMPORT: 'grid_net_import',
  GRID_EXPORT: 'grid_export',
  GRID_IMPORT_TOTAL: 'grid_import_total',
  GRID_EXPORT_TOTAL: 'grid_export_total',
  CONSUMPTION_POWER: 'consumption_power',
  CONSUMPTION_TODAY: 'consumption_today',
  CONSUMPTION_TOTAL: 'consumption_total',
};

/** Feature keys of an inverter (forever). */
export const INVERTER = {
  POWER: 'power',
  ENERGY_TOTAL: 'energy_total',
  HEALTH: 'health',
  GRID_OFF: 'grid_turned_off',
};

/**
 * The guarded indexes of a site: their feature, the value they come from
 * (src/autarco/model.js), their limits (INDEX_LIMITS) and their name in the
 * texts (src/i18n.js).
 */
export const INDEXES = [{ name: 'pv', key: SITE.PV_ENERGY, value: 'pvTotal' }];

/** The external ids of a site and of an inverter. */
export const siteIds = (gladys, siteId) => gladys.externalIds(SITE_TYPE, siteId);
export const inverterIds = (gladys, serial) => gladys.externalIds(INVERTER_TYPE, serial);

/** Namespace of the feature ids of this integration (random, fixed forever). */
const ID_NAMESPACE = Buffer.from('3b7f0e94c21a4d58a6e9150c7d2f8b41', 'hex');

/** A deterministic UUID (version 5, RFC 9562) of a name (as gladys-apsystems). */
export function uuidOf(name) {
  const hash = createHash('sha1').update(ID_NAMESPACE).update(String(name), 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- The catalogs -------------------------------------------------------------------
//
// Each entry: the feature key, the value of src/autarco/model.js it shows,
// its rounding, how it is declared, and its group (`battery`, `meter`:
// declared only for a site that shows such values; undefined: always).

const def = (key, value, digits, spec, group) => ({ key, value, digits, spec, group });

const measure = (name, category, type, extra = {}) => ({ name, category, type, ...extra });
/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (name, extra = {}) => measure(name, C.UNKNOWN, T.SENSOR.DECIMAL, extra);
const signed = (name) => plain(name, { min: -POWER_MAX, max: POWER_MAX });
const watts = (name) => plain(name, { max: POWER_MAX });
const kwh = (name) => plain(name, { max: ENERGY_MAX });
const code = (name, max) => measure(name, C.UNKNOWN, T.SENSOR.INTEGER, { max });
const index = (name, type) =>
  measure(name, C.ENERGY_PRODUCTION_SENSOR, type, { unit: U.KILOWATT_HOUR, max: ENERGY_MAX });
const production = (name) =>
  measure(name, C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER, {
    unit: U.WATT,
    max: POWER_MAX,
  });

export const SITE_CATALOG = [
  def(SITE.HEALTH, 'health', 0, code('Health (1 = OK, 0 = problem reported)', 1)),
  def(SITE.PV_POWER, 'pvPower', 0, production('Solar power')),
  def(
    SITE.PV_ENERGY,
    'pvTotal',
    3,
    index('Solar production index', T.ENERGY_PRODUCTION_SENSOR.INDEX),
  ),
  // Declared only: the core computes it from the index.
  def(
    SITE.PV_30MIN,
    undefined,
    3,
    index(
      'Solar production index (30-minute production)',
      T.ENERGY_PRODUCTION_SENSOR.THIRTY_MINUTES_PRODUCTION,
    ),
  ),
  def(SITE.PV_TODAY, 'pvToday', 3, kwh('Solar production today (kWh, not counted)')),
  def(SITE.PV_MONTH, 'pvMonth', 3, kwh('Solar production this month (kWh, not counted)')),
  def(
    SITE.BATTERY_LEVEL,
    'batterySoc',
    0,
    {
      ...measure('Battery state of charge', C.BATTERY_STORAGE, T.BATTERY_STORAGE.BATTERY_LEVEL),
      unit: U.PERCENT,
      max: 100,
    },
    'battery',
  ),
  def(
    SITE.BATTERY_POWER,
    'batteryPower',
    0,
    signed('Battery power (W, sign as given by Autarco)'),
    'battery',
  ),
  def(
    SITE.BATTERY_NET_CHARGED,
    'batteryNetCharged',
    0,
    signed('Battery net charge power (W, sign as given by Autarco)'),
    'battery',
  ),
  def(
    SITE.BATTERY_CHARGED_TODAY,
    'batteryChargedToday',
    3,
    kwh('Battery charged today (kWh)'),
    'battery',
  ),
  def(
    SITE.BATTERY_DISCHARGED_TODAY,
    'batteryDischargedToday',
    3,
    kwh('Battery discharged today (kWh)'),
    'battery',
  ),
  def(
    SITE.BATTERY_CHARGED_TOTAL,
    'batteryChargedTotal',
    3,
    kwh('Battery charged, total (kWh, not counted)'),
    'battery',
  ),
  def(
    SITE.BATTERY_DISCHARGED_TOTAL,
    'batteryDischargedTotal',
    3,
    kwh('Battery discharged, total (kWh, not counted)'),
    'battery',
  ),
  def(
    SITE.GRID_NET_IMPORT,
    'gridNetImport',
    0,
    signed('Grid net import (W, sign as given by Autarco)'),
    'meter',
  ),
  def(SITE.GRID_EXPORT, 'gridExport', 0, signed('Grid export (W, as given by Autarco)'), 'meter'),
  def(
    SITE.GRID_IMPORT_TOTAL,
    'gridImportTotal',
    3,
    kwh('Grid import, total (kWh, not counted)'),
    'meter',
  ),
  def(
    SITE.GRID_EXPORT_TOTAL,
    'gridExportTotal',
    3,
    kwh('Grid export, total (kWh, not counted)'),
    'meter',
  ),
  def(SITE.CONSUMPTION_POWER, 'consumptionPower', 0, watts('Consumption (W)'), 'meter'),
  def(
    SITE.CONSUMPTION_TODAY,
    'consumptionToday',
    3,
    kwh('Consumption today (kWh, not counted)'),
    'meter',
  ),
  def(
    SITE.CONSUMPTION_TOTAL,
    'consumptionTotal',
    3,
    kwh('Consumption, total (kWh, not counted)'),
    'meter',
  ),
];

export const INVERTER_CATALOG = [
  def(INVERTER.POWER, 'power', 0, production('Inverter power')),
  def(
    INVERTER.ENERGY_TOTAL,
    'energyTotal',
    3,
    kwh('Inverter production, total (kWh, not counted)'),
  ),
  def(INVERTER.HEALTH, 'health', 0, code('Health (1 = OK, 0 = problem reported)', 1)),
  def(INVERTER.GRID_OFF, 'gridOff', 0, code('Grid turned off (0 = no, 1 = yes)', 1)),
];

/** The feature keys of a created device (its features are fixed at its creation). */
export function keysOfDevice(device) {
  return new Set(
    (device?.features ?? []).map((f) =>
      String(f.external_id ?? '')
        .split(':')
        .at(-1),
    ),
  );
}

/**
 * The catalog entries of a site: the ones of its groups, plus every one the
 * created device already has (published again, a device never loses a
 * feature: "Update" in Discovery would drop its history).
 */
export function siteEntries(groups = [], createdKeys = new Set()) {
  return SITE_CATALOG.filter((e) => !e.group || groups.includes(e.group) || createdKeys.has(e.key));
}

const featureOf = (spec, externalId) => ({
  min: 0,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...spec,
  external_id: externalId,
});

/**
 * The device of a site. `site`: `{ siteId, name, groups }`; `created`: the
 * device the user created, if any.
 */
export function buildSiteDevice(gladys, site, { created } = {}) {
  const external = siteIds(gladys, site.siteId);
  const pvIndexId = external.feature(SITE.PV_ENERGY);
  const features = siteEntries(site.groups, keysOfDevice(created)).map(({ key, spec }) => {
    const feature = featureOf(spec, external.feature(key));
    if (key === SITE.PV_ENERGY) {
      feature.id = uuidOf(pvIndexId);
    } else if (key === SITE.PV_30MIN) {
      feature.id = uuidOf(external.feature(SITE.PV_30MIN));
      feature.energy_parent_id = uuidOf(pvIndexId);
    }
    return feature;
  });
  return {
    name: site.name ? `Autarco ${site.name}` : `Autarco site ${site.siteId}`,
    external_id: external.device,
    features,
    params: [{ name: 'AUTARCO_SITE_ID', value: site.siteId }],
  };
}

/** The device of an inverter. `inverter`: `{ serial, siteId }`. */
export function buildInverterDevice(gladys, inverter) {
  const external = inverterIds(gladys, inverter.serial);
  return {
    name: `Autarco inverter ${inverter.serial}`,
    external_id: external.device,
    features: INVERTER_CATALOG.map(({ key, spec }) => featureOf(spec, external.feature(key))),
    params: [
      { name: 'AUTARCO_SERIAL', value: inverter.serial },
      { name: 'AUTARCO_SITE_ID', value: inverter.siteId },
    ],
  };
}

export const round = (value, digits) => {
  const r = Math.round(value * 10 ** digits) / 10 ** digits;
  return Object.is(r, -0) ? 0 : r;
};

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const INDEX_KEYS = new Set(INDEXES.map((i) => i.key));

/**
 * The states of a catalog. `values`: by value name; `indexes`: by feature
 * key, the values the guards let through (undefined: not published this
 * time). An index is never taken from `values` directly.
 */
export function statesOf(external, catalog, values, indexes = {}) {
  const states = [];
  for (const { key, value, digits, spec } of catalog) {
    let v;
    if (INDEX_KEYS.has(key) && catalog === SITE_CATALOG) {
      // Never 0 (the guard never lets 0 through, checked again here).
      v = isNumber(indexes[key]) && indexes[key] > 0 ? indexes[key] : undefined;
    } else if (value !== undefined) {
      v = values[value];
    }
    if (!isNumber(v)) {
      continue;
    }
    const r = round(v, digits);
    const min = spec.min ?? 0;
    if (r < min || (spec.max !== undefined && r > spec.max)) {
      continue;
    }
    states.push({ device_feature_external_id: external.feature(key), state: r });
  }
  return states;
}
