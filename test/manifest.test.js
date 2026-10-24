// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. And the devices
// only use the units the core accepts for their categories.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS, POLL_DEFAULT, POLL_MAX, POLL_MIN } from '../src/constants.js';
import {
  INDEXES,
  INVERTER_CATALOG,
  SITE_CATALOG,
  buildInverterDevice,
  buildSiteDevice,
} from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics; the same version everywhere (never a fixed one)', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  // Owned by the Release workflow (0.1.0 by hand, then each release).
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-autarco:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.name, 'gladys-autarco');
  assert.deepEqual(manifest.categories, ['energy']);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.network_discovery, undefined, 'no network scan');
  assert.match(manifest.gladys_version, />=\s*5\.2\.0/);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('the docs say it was never tested with a real device', () => {
  assert.match(read('docs/fr.md'), /[Jj]amais\s+testé\s+avec\s+un\s+vrai\s+appareil/);
  assert.match(read('docs/en.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+device/);
  assert.match(read('README.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+device/);
});

test('every text is in English and French; placeholders too', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of manifest.config_schema) {
    if ('placeholder' in field) {
      assert.equal(typeof field.placeholder, 'object', `${field.key}.placeholder`);
    }
  }
});

test('the configuration matches the code; the password is a secret, kept, never shown, no default', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.deepEqual(Object.keys(fields), ['intro', 'email', 'password', 'poll_interval']);
  assert.equal(fields.email.type, 'string');
  assert.equal(fields.password.type, 'secret');
  for (const field of manifest.config_schema.filter((f) => f.type === 'secret')) {
    assert.ok(!('default' in field), `${field.key}: never a default on a secret`);
  }
  assert.match(fields.password.description.en, /Kept by Gladys in its database, never shown again/);
  assert.match(fields.password.description.fr, /Gardé par Gladys dans sa base, jamais réaffiché/);
  assert.equal(fields.poll_interval.type, 'number');
  assert.equal(fields.poll_interval.default, POLL_DEFAULT);
  assert.equal(fields.poll_interval.min, POLL_MIN);
  assert.equal(fields.poll_interval.max, POLL_MAX);
  for (const link of fields.intro.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the actions of the manifest are the handlers of the code; read-only', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  assert.ok(index.includes('onAction(ACTIONS.ACCEPT_HELD'));
  assert.ok(index.includes('onDeviceCreated'));
  assert.ok(index.includes('onScanRequest'));
  assert.ok(index.includes("on('connected'"));
  assert.ok(!index.includes('onSetValue'), 'no command: read-only');
  assert.match(manifest.actions[1].description.en, /First click: lists.*Second click/);
});

test('the licenses ship in the image; no name in LICENSE', () => {
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /python-autarco/);
  assert.match(notices, /Copyright \(c\) 2022-2026 Klaas Schoute/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
});

test('the code never feeds the energy consumption endpoint, nor publishes a scene event', () => {
  for (const file of ['index.js', 'src/app.js', 'src/devices.js']) {
    assert.doesNotMatch(read(file), /publishEnergyConsumption\(|publishSceneEvent\(/, file);
  }
});

// The units the core accepts per category (server/utils/constants.js
// DEVICE_FEATURE_UNITS_BY_CATEGORY), for the categories used here.
const UNITS_BY_CATEGORY = {
  [C.BATTERY_STORAGE]: [U.PERCENT, U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.ENERGY_PRODUCTION_SENSOR]: [U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.UNKNOWN]: [],
};

test('every feature uses a unit the core accepts for its category; keys unique', () => {
  const gladys = createFakeGladys({ selector: 'autarco' });
  const site = buildSiteDevice(gladys, { siteId: '1000', groups: ['battery', 'meter'] });
  const bare = buildSiteDevice(gladys, { siteId: '1000', groups: [] });
  const inverter = buildInverterDevice(gladys, { serial: '380016531035', siteId: '1000' });
  assert.equal(site.features.length, SITE_CATALOG.length);
  assert.ok(bare.features.length < site.features.length);
  // A created device keeps every feature it has, whatever the groups seen since.
  const kept = buildSiteDevice(gladys, { siteId: '1000', groups: [] }, { created: site });
  assert.equal(kept.features.length, site.features.length);
  const keys = new Set();
  for (const f of [...site.features, ...inverter.features]) {
    assert.ok(f.category in UNITS_BY_CATEGORY, `${f.external_id}: ${f.category}`);
    if (f.unit !== undefined) {
      assert.ok(UNITS_BY_CATEGORY[f.category].includes(f.unit), `${f.external_id}: ${f.unit}`);
    }
    assert.equal(f.read_only, true, f.external_id);
    assert.ok(!keys.has(f.external_id));
    keys.add(f.external_id);
  }
  const index = site.features.find((f) => f.external_id.endsWith(':pv_energy'));
  const half = site.features.find((f) => f.external_id.endsWith(':pv_energy_production'));
  assert.equal(half.energy_parent_id, index.id);
  assert.match(index.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('no double count: the solar index is the only index; signs never guessed', () => {
  const indexTypes = new Set([
    TYPES.ENERGY_SENSOR.INDEX,
    TYPES.ENERGY_PRODUCTION_SENSOR.INDEX,
    TYPES.GRID_SENSOR.INPUT_INDEX,
    TYPES.GRID_SENSOR.OUTPUT_INDEX,
    TYPES.HOME_OUTPUT_SENSOR.INDEX,
    TYPES.BATTERY_STORAGE.CHARGE_INDEX,
    TYPES.BATTERY_STORAGE.DISCHARGE_INDEX,
  ]);
  const all = [...SITE_CATALOG, ...INVERTER_CATALOG];
  const indexes = SITE_CATALOG.filter(
    (e) => e.spec.category !== C.UNKNOWN && indexTypes.has(e.spec.type),
  );
  assert.deepEqual(
    indexes.map((e) => e.key),
    INDEXES.map((i) => i.key),
  );
  assert.equal(indexes[0].spec.category, C.ENERGY_PRODUCTION_SENSOR);
  assert.ok(
    !INVERTER_CATALOG.some((e) => indexTypes.has(e.spec.type) && e.spec.category !== C.UNKNOWN),
  );
  assert.ok(!all.some((e) => e.spec.category === C.ENERGY_SENSOR), 'never energy-sensor');
  assert.ok(!all.some((e) => e.spec.category === C.GRID_SENSOR), 'grid sign not confirmed');
  assert.ok(!all.some((e) => /daily/.test(e.spec.type)));
  assert.ok(
    !all.some(
      (e) =>
        e.spec.type === TYPES.BATTERY_STORAGE.CHARGE_POWER ||
        e.spec.type === TYPES.BATTERY_STORAGE.DISCHARGE_POWER,
    ),
    'battery sign not confirmed',
  );
  for (const key of ['battery_power', 'battery_net_charged', 'grid_net_import', 'grid_export']) {
    const entry = SITE_CATALOG.find((e) => e.key === key);
    assert.equal(entry.spec.category, C.UNKNOWN, key);
    assert.ok(entry.spec.min < 0, `${key} is signed`);
  }
});
