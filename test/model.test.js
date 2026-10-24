// -----------------------------------------------------------------------------
// The answers -> values (pure), the configuration and what /data keeps.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  healthOf,
  nameOf,
  num,
  parseAccount,
  parseInverters,
  parseSite,
} from '../src/autarco/model.js';
import { normalizeConfig } from '../src/config.js';
import { MAX_SITES } from '../src/constants.js';
import { accountOf, readState, refusedMark } from '../src/store.js';
import {
  account,
  kpisEnergy1,
  kpisEnergy2,
  kpisPower1,
  kpisPower2,
  power1,
} from './fixtures/autarco.js';

test('numbers: strict, never a blank read as 0, never the prototype', () => {
  assert.equal(num(''), undefined);
  assert.equal(num(' '), undefined);
  assert.equal(num('12.5'), 12.5);
  assert.equal(num('1e3'), undefined);
  assert.equal(num(Infinity), undefined);
  assert.equal(num(null), undefined);
  const { values } = parseSite({ kpisPower: JSON.parse('{"__proto__": {"pv_now": 5}}') });
  assert.equal(values.pvPower, undefined);
});

test('the account: valid sites only, bounded, the names checked', () => {
  const { sites, more } = parseAccount(account());
  assert.deepEqual(sites, [
    { siteId: '1000', publicKey: 'site_key_1', name: 'Roof', health: 1 },
    { siteId: '2000', publicKey: 'site_key_2', name: 'Barn', health: 1 },
  ]);
  assert.equal(more, false);
  const many = parseAccount({
    data: Array.from({ length: 40 }, (_, i) => ({ site_id: i + 1, public_key: `k${i}` })),
  });
  assert.equal(many.sites.length, MAX_SITES);
  assert.equal(many.more, true);
  assert.equal(parseAccount({ data: [], next_page_url: 'https://x' }).more, true);
  assert.equal(parseAccount({}).sites, undefined);
  assert.equal(nameOf('A\u0000b'), undefined);
  assert.equal(nameOf('  Mon   toit  '), 'Mon toit');
  assert.equal(nameOf('<script>'), undefined);
  assert.equal(healthOf('OK'), 1);
  assert.equal(healthOf('ERROR'), 0);
  assert.equal(healthOf(3), undefined);
});

test('a site without battery: solar values, the meter group from the consumption', () => {
  const { values, groups } = parseSite({
    site: { health: 1 },
    kpisPower: kpisPower1(),
    kpisEnergy: kpisEnergy1(),
  });
  assert.deepEqual(values, { health: 1, pvPower: 3323, pvToday: 8, pvMonth: 114, pvTotal: 29176 });
  assert.deepEqual(groups, []);
});

test('a site with a battery: signs as given, never split', () => {
  const { values, groups } = parseSite({ kpisPower: kpisPower2(), kpisEnergy: kpisEnergy2() });
  assert.equal(values.batterySoc, 71, 'the power answer first');
  assert.equal(values.batteryPower, 777);
  assert.equal(values.gridNetImport, 0);
  assert.equal(values.gridImportTotal, 173);
  assert.equal(values.consumptionTotal, 3169);
  assert.deepEqual(groups, ['battery', 'meter']);
  const negative = parseSite({ kpisPower: { battery_now: -500, grid_net_import_now: -200 } });
  assert.equal(negative.values.batteryPower, -500);
  assert.equal(negative.values.gridNetImport, -200);
  assert.equal(parseSite({ kpisEnergy: { pv_to_date: -5 } }).values.pvTotal, undefined);
});

test('inverters: both answers merged by serial, a mismatching sn never mixed', () => {
  const list = parseInverters(kpisPower1(), power1());
  assert.deepEqual(list, [
    {
      serial: '380016531035',
      power: 3323,
      latest: Date.parse('2024-09-11T12:12:48+00:00'),
      health: 1,
      energyTotal: 29176,
      gridOff: 0,
    },
  ]);
  const odd = parseInverters(
    {},
    { inverters: { 123456: { sn: '999999', out_ac_energy_total: 5 }, 'a/b': {} } },
  );
  assert.deepEqual(odd, []);
});

test('the configuration: e-mail, password and interval checked, nothing echoed', () => {
  assert.equal(normalizeConfig({}).problem, 'email_missing');
  assert.equal(normalizeConfig({ email: 'x' }).problem, 'email_invalid');
  assert.equal(normalizeConfig({ email: 'a@b.c' }).problem, 'password_missing');
  assert.equal(normalizeConfig({ email: 'a@b.c', password: 'a\r\nb' }).problem, 'password_invalid');
  const ok = normalizeConfig({ email: ' a@b.c ', password: ' p w ', poll_interval: '60' });
  assert.deepEqual(ok, {
    email: 'a@b.c',
    password: ' p w ',
    pollInterval: 120,
    problem: undefined,
  });
  assert.equal(
    normalizeConfig({ email: 'a@b.c', password: 'p', poll_interval: 99999 }).pollInterval,
    3600,
  );
  assert.equal(
    normalizeConfig({ email: 'a@b.c', password: 'p', poll_interval: '' }).pollInterval,
    300,
  );
  assert.equal(normalizeConfig({ email: 'a@b.c', password: 'x' }).problem, undefined);
});

test('/data: no e-mail, no password; times capped; the refused mark only 8 bits', () => {
  const salt = '0123456789abcdef0123456789abcdef';
  const acc = accountOf(salt, 'A@B.C');
  assert.equal(acc, accountOf(salt, 'a@b.c'));
  assert.match(acc, /^[0-9a-f]{32}$/);
  assert.match(refusedMark(salt, 'a@b.c', 'pw'), /^[0-9a-f]{2}$/);
  const now = 1_000_000_000;
  const state = readState(
    {
      salt,
      account: acc,
      lastAttemptAt: now + 1e9,
      pause: { until: now + 1e12, count: 99, code: 'server', status: 503 },
      refusal: { mark: 'ab', status: 403 },
      sites: { 1000: { groups: ['battery', 'x'], inverters: ['380016531035', '../x'] }, x: {} },
    },
    now,
    { maxPause: 1000 },
  );
  assert.equal(state.lastAttemptAt, now);
  assert.equal(state.pause.until, now + 1000);
  assert.equal(state.pause.count, 32);
  assert.deepEqual(state.refusal, { status: 401, mark: 'ab' });
  assert.deepEqual(state.sites, { 1000: { groups: ['battery'], inverters: ['380016531035'] } });
  // Without an account, no pause nor refusal is kept.
  const bare = readState({ pause: state.pause, refusal: state.refusal }, now, { maxPause: 1000 });
  assert.equal(bare.pause, null);
  assert.equal(bare.refusal, null);
  // 8 bits: one guess in 256 matches any mark, so the file confirms no password.
  assert.equal(refusedMark(salt, 'a@b.c', 'pw').length, 2);
});
