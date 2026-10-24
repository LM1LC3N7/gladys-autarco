// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Autarco API.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AutarcoApp } from '../src/app.js';
import { AutarcoClient } from '../src/autarco/client.js';
import { ACTIONS, PAUSE_MIN } from '../src/constants.js';
import { buildInverterDevice, buildSiteDevice } from '../src/devices.js';
import { createMemoryStore } from '../src/store.js';
import { createFetch, timeoutError } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import { EMAIL, NOW, PASSWORD, account, autarco, json, kpisEnergy1 } from './fixtures/autarco.js';

const SELECTOR = 'autarco';
const SITE1 = `ext:${SELECTOR}:site:1000`;
const SITE2 = `ext:${SELECTOR}:site:2000`;
const INV1 = `ext:${SELECTOR}:inverter:380016531035`;
const INV2 = `ext:${SELECTOR}:inverter:480016531099`;
const CONFIG = { email: EMAIL, password: PASSWORD };
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const POLL = 300 * SECOND;

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

/** The devices as the user created them from the discovered ones. */
function created({ index, battery = true } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const site1 = buildSiteDevice(gladys, { siteId: '1000', groups: [] });
  if (index) {
    const feature = site1.features.find((f) => f.external_id === `${SITE1}:pv_energy`);
    feature.last_value = index.value;
    feature.last_value_changed = new Date(index.at).toISOString();
  }
  const site2 = buildSiteDevice(gladys, {
    siteId: '2000',
    groups: battery ? ['battery', 'meter'] : [],
  });
  return [
    site1,
    site2,
    buildInverterDevice(gladys, { serial: '380016531035', siteId: '1000' }),
    buildInverterDevice(gladys, { serial: '480016531099', siteId: '2000' }),
  ];
}

async function setup({
  config = CONFIG,
  routes = autarco(),
  devices = [],
  store = createMemoryStore(),
  clock = { now: NOW },
  latency = 300,
} = {}) {
  // Every request takes `latency` ms on both clocks: a read is never instant.
  const fake = createFetch(routes);
  const network = fake.fetch;
  fake.fetch = async (...args) => {
    clock.now += latency;
    if (clock.mono !== undefined) clock.mono += latency;
    return network(...args);
  };
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const timers = createFakeTimers();
  const logger = createLogger();
  const app = new AutarcoApp({
    gladys,
    logger,
    now: () => clock.now,
    monotonic: () => clock.mono ?? clock.now,
    timers,
    store,
    client: new AutarcoClient({ fetchImpl: fake.fetch, now: () => clock.now }),
  });
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());
  gladys.onScanRequest(() => app.scan());
  /** `ms` later, the timer looks whether a read is due. */
  const tick = async (ms = POLL) => {
    clock.now += ms;
    if (clock.mono !== undefined) clock.mono += ms;
    await timers.runIntervals();
    await app.idle();
  };
  return { app, gladys, timers, clock, logger, fake, tick, store, routes };
}

const status = (gladys) => gladys.fake.connectionStatus;
const accountReads = (fake) => fake.calls.filter((c) => c.path === '/api/site/').length;
const last = (gladys, id) => gladys.fake.lastState(id);
const text = (message) => `${message.en} ${message.fr}`;

test('nothing configured, or a bad e-mail: the status says so, nothing is called', async () => {
  for (const [config, words] of [
    [{}, /adresse e-mail et le mot de passe/],
    [{ email: 'nobody' }, /e-mail n’est pas valide/],
    [{ email: EMAIL }, /mot de passe de votre compte/],
    [{ email: EMAIL, password: 'a\nb' }, /pas valide/],
    [{ email: 'a:b@example.com', password: PASSWORD }, /e-mail n’est pas valide/],
  ]) {
    const { app, gladys, fake } = await setup({ config });
    await app.start(config);
    await app.idle();
    assert.equal(status(gladys).connected, false);
    assert.match(status(gladys).message.fr, words);
    assert.equal(fake.calls.length, 0);
    assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), words);
  }
});

test('the first read: the sites and inverters in Discovery, no value before creation', async () => {
  const { app, gladys, fake } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.external_id),
    [SITE1, INV1, SITE2, INV2],
  );
  assert.equal(devices[0].name, 'Autarco Roof');
  const keys = (d) => d.features.map((f) => f.external_id.split(':').at(-1));
  assert.ok(!keys(devices[0]).includes('battery_level'), 'no battery on site 1');
  assert.ok(keys(devices[2]).includes('battery_level'), 'a battery on site 2');
  assert.ok(devices.every((d) => d.features.every((f) => f.read_only)));
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /2 sites.*Découverte/);
  // Basic auth over HTTPS, GET only, never a redirect followed.
  const auth = `Basic ${Buffer.from(`${EMAIL}:${PASSWORD}`).toString('base64')}`;
  for (const call of fake.calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.redirect, 'manual');
    assert.equal(call.init.headers.Authorization, auth);
    assert.ok(call.url.startsWith('https://my.autarco.com/api/site/'));
    assert.equal(call.init.headers['User-Agent'], undefined, 'no custom User-Agent');
  }
  assert.equal(fake.calls.length, 7);
});

test('created devices get their values; the production total is the only index', async () => {
  const { app, gladys } = await setup({ devices: created() });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, `${SITE1}:pv_power`), 3323);
  assert.equal(last(gladys, `${SITE1}:pv_energy`), 29176);
  assert.equal(last(gladys, `${SITE1}:pv_energy_production`), undefined, 'computed by the core');
  assert.equal(last(gladys, `${SITE1}:pv_today`), 8);
  assert.equal(last(gladys, `${SITE1}:pv_month`), 114);
  assert.equal(last(gladys, `${SITE1}:health`), 1);
  assert.equal(last(gladys, `${SITE2}:battery_level`), 71);
  assert.equal(last(gladys, `${SITE2}:battery_power`), 777);
  assert.equal(last(gladys, `${SITE2}:battery_charged_total`), 748);
  assert.equal(last(gladys, `${SITE2}:grid_export_total`), 960);
  assert.equal(last(gladys, `${SITE2}:consumption_power`), 184);
  assert.equal(last(gladys, `${INV1}:power`), 3323);
  assert.equal(last(gladys, `${INV1}:energy_total`), 29176);
  assert.equal(last(gladys, `${INV1}:grid_turned_off`), 0);
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
  assert.match(status(gladys).message.en, /Autarco account read: 2 sites\.$/);
});

test('the pace: no read before the interval, whatever asks; the test button included', async () => {
  const { app, gladys, fake, tick } = await setup();
  await app.start(CONFIG);
  await app.idle();
  assert.equal(accountReads(fake), 1);
  await tick(POLL / 2);
  const answer = (await gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(text(answer), /Not asked now/);
  await app.scan();
  await app.start(CONFIG);
  await app.idle();
  assert.equal(accountReads(fake), 1, 'no read sooner than the interval');
  await tick(POLL / 2);
  assert.equal(accountReads(fake), 2);
});

test('a restart of the container waits the interval and a minute after the last request', async () => {
  const store = createMemoryStore();
  const clock = { now: NOW };
  const first = await setup({ store, clock });
  await first.app.start(CONFIG);
  await first.app.idle();
  await first.app.stop();
  clock.now += 10 * SECOND;
  const second = await setup({ store, clock });
  await second.app.start(CONFIG);
  await second.app.idle();
  assert.equal(accountReads(second.fake), 0);
  await second.tick(POLL);
  assert.equal(accountReads(second.fake), 0);
  await second.tick(MINUTE);
  assert.equal(accountReads(second.fake), 1);
});

test('refused credentials: a final stop kept in /data, never tried again by itself', async () => {
  const store = createMemoryStore();
  const clock = { now: NOW };
  const routes = autarco({ '/api/site/': () => json({ message: 'nope' }, { status: 401 }) });
  const first = await setup({ store, clock, routes });
  await first.app.start(CONFIG);
  await first.app.idle();
  assert.equal(status(first.gladys).connected, false);
  assert.match(status(first.gladys).message.fr, /refuse l’adresse e-mail ou le mot de passe/);
  for (let i = 0; i < 30; i += 1) await first.tick(HOUR);
  assert.equal(accountReads(first.fake), 1, 'never an automatic new try');
  assert.match(store.data.refusal.mark, /^[0-9a-f]{2}$/);
  await first.app.stop();
  // A restart with the same credentials: still stopped.
  const second = await setup({ store, clock, routes });
  await second.app.start(CONFIG);
  await second.app.idle();
  await second.tick(POLL + MINUTE);
  assert.equal(accountReads(second.fake), 0);
  // The test button tries once (at the pace), refused again: still stopped.
  await second.gladys.fake.action(ACTIONS.TEST);
  await second.app.idle();
  assert.equal(accountReads(second.fake), 1);
  assert.ok(store.data.refusal);
  // The right password, saved: read at once, the refusal cleared.
  second.routes['/api/site/'] = autarco()['/api/site/'];
  await second.app.start({ ...CONFIG, password: 'the-right-one' }, { fresh: true });
  await second.app.idle();
  assert.equal(accountReads(second.fake), 2);
  assert.equal(store.data.refusal, null);
  assert.equal(status(second.gladys).connected, true);
});

test('the test button reads refused credentials once, and a success clears the refusal', async () => {
  const routes = autarco({ '/api/site/': () => json({}, { status: 401 }) });
  const { app, gladys, fake, tick, store } = await setup({ routes });
  await app.start(CONFIG);
  await app.idle();
  routes['/api/site/'] = autarco()['/api/site/'];
  await tick(POLL);
  assert.equal(accountReads(fake), 1);
  const answer = (await gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(text(answer), /e-mail and password accepted/);
  assert.equal(accountReads(fake), 2);
  assert.equal(store.data.refusal, null);
});

test('429: a pause from Retry-After, kept in /data across a restart', async () => {
  const store = createMemoryStore();
  const clock = { now: NOW };
  const routes = autarco({
    '/api/site/': () => json({}, { status: 429, headers: { 'retry-after': '3600' } }),
  });
  const first = await setup({ store, clock, routes });
  await first.app.start(CONFIG);
  await first.app.idle();
  assert.equal(store.data.pause.code, 'rate_limited');
  assert.equal(store.data.pause.until, NOW + 300 + HOUR, 'from the answer (300 ms of latency)');
  assert.match(status(first.gladys).message.fr, /lectures en pause/);
  await first.app.stop();
  const second = await setup({ store, clock, routes: autarco() });
  await second.app.start(CONFIG);
  await second.tick(30 * MINUTE);
  assert.equal(accountReads(second.fake), 0);
  await second.tick(31 * MINUTE);
  assert.equal(accountReads(second.fake), 1);
  assert.equal(store.data.pause, null);
});

test('a 429 on a site stops the read and pauses; a 5xx of the account pauses too', async () => {
  for (const [path, status_, code] of [
    ['/api/site/site_key_2/kpis/power', 429, 'rate_limited'],
    ['/api/site/', 503, 'server'],
    ['/api/site/', 403, 'forbidden'],
  ]) {
    const routes = autarco({ [path]: () => json({}, { status: status_ }) });
    const { app, store, gladys } = await setup({ routes, devices: created() });
    await app.start(CONFIG);
    await app.idle();
    assert.equal(store.data.pause.code, code, path);
    assert.ok(store.data.pause.until >= NOW + Math.max(PAUSE_MIN, POLL));
    assert.equal(store.data.refusal, null, 'never a refusal');
    assert.equal(last(gladys, `${SITE1}:pv_power`), undefined);
  }
});

test('a 5xx or a refusal of one site only leaves that site out', async () => {
  const routes = autarco({
    '/api/site/site_key_1/kpis/energy': () => json({}, { status: 500 }),
    '/api/site/site_key_2/kpis/power': () => json({}, { status: 403 }),
  });
  const { app, gladys, fake, tick, store } = await setup({ routes, devices: created() });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, `${SITE1}:pv_power`), 3323);
  assert.equal(last(gladys, `${SITE1}:pv_energy`), undefined);
  assert.equal(last(gladys, `${SITE2}:battery_level`), undefined);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Lu en partie.*site 1000/);
  assert.match(status(gladys).message.fr, /Accès refusé au site 2000/);
  assert.equal(store.data.refusal, null);
  assert.equal(store.data.pause, null);
  // The denied site waits (doubled), the other is read at its pace.
  const site2 = () => fake.calls.filter((c) => c.path.includes('site_key_2')).length;
  assert.equal(site2(), 1);
  await tick(POLL);
  assert.equal(site2(), 1, 'the denied site is not asked at the next read');
  assert.equal(accountReads(fake), 2);
  await tick(POLL);
  assert.equal(site2(), 2);
});

test('the index: a jump is held, never confirmed by repetition, accepted in two clicks', async () => {
  const devices = created({ index: { value: 29176, at: NOW - MINUTE } });
  const energy = { value: 29176 };
  const routes = autarco({
    '/api/site/site_key_1/kpis/energy': () => ({ ...kpisEnergy1(), pv_to_date: energy.value }),
  });
  const { app, gladys, tick, clock } = await setup({ devices, routes });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, `${SITE1}:pv_energy`), 29176);
  energy.value = 99999;
  await tick();
  await tick();
  await tick();
  assert.equal(last(gladys, `${SITE1}:pv_energy`), 29176, 'the last accepted value is sent again');
  assert.match(status(gladys).message.fr, /index de production solaire du site 1000 : saut/);
  const first = (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message;
  assert.match(first.fr, /Un second clic accepte exactement/);
  clock.now += 10 * SECOND;
  const second = (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message;
  assert.match(second.fr, /Accepté : index de production solaire du site 1000 99999 kWh/);
  assert.doesNotMatch(second.fr, /Une autre valeur reste retenue/, 'nothing left held');
  await tick();
  assert.equal(last(gladys, `${SITE1}:pv_energy`), 99999);
});

test('the index: never 0, a drop held, a normal rise of whole kWh goes through', async () => {
  const devices = created();
  const energy = { value: 29176 };
  const routes = autarco({
    '/api/site/site_key_1/kpis/energy': () => ({ ...kpisEnergy1(), pv_to_date: energy.value }),
  });
  const { app, gladys, tick } = await setup({ devices, routes });
  await app.start(CONFIG);
  await app.idle();
  energy.value = 0;
  await tick();
  assert.equal(last(gladys, `${SITE1}:pv_energy`), 29176);
  energy.value = 29100;
  await tick();
  assert.equal(last(gladys, `${SITE1}:pv_energy`), 29176);
  energy.value = 29177;
  await tick();
  assert.equal(last(gladys, `${SITE1}:pv_energy`), 29177);
  assert.ok(
    gladys.fake.states
      .filter((s) => s.device_feature_external_id === `${SITE1}:pv_energy`)
      .every((s) => s.state > 0),
  );
});

test('inverters silent for 2 hours (time of the service): no inverter power, no solar power', async () => {
  const date = { at: NOW + 3 * HOUR };
  const routes = autarco();
  const original = routes['/api/site/site_key_1/kpis/power'];
  routes['/api/site/site_key_1/kpis/power'] = async () =>
    json(await (await original()).json(), { date: date.at });
  const { app, gladys, tick } = await setup({ routes, devices: created() });
  const published = [];
  const publish = gladys.publishChangedStates.bind(gladys);
  gladys.publishChangedStates = (states, options) => {
    published.push(...states);
    return publish(states, options);
  };
  await app.start(CONFIG);
  await app.idle();
  const pv = () => published.filter((s) => s.device_feature_external_id === `${SITE1}:pv_power`);
  assert.equal(last(gladys, `${INV1}:power`), undefined);
  assert.equal(last(gladys, `${INV1}:energy_total`), 29176);
  assert.equal(pv().length, 0, 'the sum of silent inverters is not current');
  assert.equal(last(gladys, `${SITE1}:pv_energy`), 29176, 'the index still goes');
  assert.equal(last(gladys, `${SITE2}:pv_power`), 961, 'the other site is fresh');
  const test = (await gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.doesNotMatch(test.en, /site 1000 \(solar/);
  // An inverter talking again: the solar power is back.
  date.at = NOW;
  await tick();
  assert.deepEqual(
    pv().map((s) => s.state),
    [3323],
  );
});

test('a device created later: its values at once, its index state reset', async () => {
  // A state left in /data by a deleted device of the same id (a far lower index).
  const store = createMemoryStore({
    indexes: { [`${SITE1}:pv_energy`]: { last: { value: 100, at: NOW - HOUR } } },
  });
  const { app, gladys, fake } = await setup({ store });
  await app.start(CONFIG);
  await app.idle();
  const [site1] = created();
  await gladys.fake.deviceCreated(site1);
  await app.idle();
  assert.equal(accountReads(fake), 1, 'no new request');
  // Not held as a jump from the old state: a new device starts from its first value.
  assert.equal(last(gladys, `${SITE1}:pv_energy`), 29176);
  assert.equal(last(gladys, `${SITE1}:pv_power`), 3323);
});

test('a read that ends after a new configuration publishes nothing', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const routes = autarco();
  const slow = routes['/api/site/site_key_1/kpis/power'];
  routes['/api/site/site_key_1/kpis/power'] = async () => {
    await gate;
    return slow();
  };
  const { app, gladys } = await setup({ routes, devices: created() });
  const started = app.start(CONFIG);
  await started;
  await app.stop();
  release();
  await app.idle();
  assert.equal(gladys.fake.states.length, 0);
});

test('no secret anywhere: logs, statuses, /data, test answers', async () => {
  const routes = autarco({ '/api/site/': () => json({}, { status: 401 }) });
  const { app, gladys, logger, store } = await setup({ routes });
  await app.start(CONFIG);
  await app.idle();
  const answer = (await gladys.fake.action(ACTIONS.TEST)).data;
  const everything = JSON.stringify([
    logger.lines,
    gladys.fake.connectionStatus,
    store.data,
    answer,
    gladys.fake.discoveredDevices,
  ]);
  for (const secret of [
    PASSWORD,
    EMAIL,
    'someone',
    Buffer.from(`${EMAIL}:${PASSWORD}`).toString('base64'),
  ]) {
    assert.ok(!everything.includes(secret), secret);
  }
});

/** A route held until `release(response)`; the call has started when `started` resolves. */
function gate() {
  let release;
  let started;
  const begun = new Promise((resolve) => {
    started = resolve;
  });
  const done = new Promise((resolve) => {
    release = resolve;
  });
  return {
    begun,
    release,
    handler: async () => {
      started();
      return done;
    },
  };
}

/** A read held at the account, a reconnection with the same credentials, then the answer. */
async function lateRead(answer, { store, first = autarco()['/api/site/'] } = {}) {
  const routes = autarco({ '/api/site/': () => first() });
  const ctx = await setup({ routes, store });
  await ctx.app.start(CONFIG);
  await ctx.app.idle();
  const held = gate();
  routes['/api/site/'] = held.handler;
  ctx.clock.now += POLL;
  const reading = ctx.app.run(ctx.app.generation, () => ctx.app.tick({ manual: true }));
  await held.begun;
  // Gladys reconnects meanwhile (or the form is saved with the same credentials).
  await ctx.app.start(CONFIG);
  held.release(answer());
  await reading;
  routes['/api/site/'] = autarco()['/api/site/'];
  await ctx.app.idle();
  return ctx;
}

test('a read ending in 401 after a reconnection: the refusal is kept AND shown', async () => {
  const { gladys, store, fake, tick } = await lateRead(() => json({}, { status: 401 }));
  assert.ok(store.data.refusal);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /refuse l’adresse e-mail ou le mot de passe/);
  const before = fake.calls.length;
  await tick(6 * HOUR);
  assert.equal(fake.calls.length, before, 'still stopped');
  assert.match(status(gladys).message.fr, /refuse/);
});

test('a read ending in 429 after a reconnection: the pause is kept AND shown', async () => {
  const { gladys, store } = await lateRead(() =>
    json({}, { status: 429, headers: { 'retry-after': '3600' } }),
  );
  assert.equal(store.data.pause.code, 'rate_limited');
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /lectures en pause, nouvel essai dans 60 min/);
});

test('a late success with the same credentials lifts a refusal and a pause', async () => {
  const { gladys, store, fake, tick } = await lateRead(() => json(account()), {
    first: () => json({}, { status: 401 }),
  });
  assert.equal(store.data.refusal, null);
  assert.equal(store.data.pause, null);
  assert.doesNotMatch(status(gladys).message.fr, /refuse/);
  const before = fake.calls.length;
  await tick(POLL);
  assert.ok(fake.calls.length > before, 'the reads go on at their pace');
  assert.equal(status(gladys).connected, true);
});

test('a site that never answers: the other site (index included) is read at every read', async () => {
  const routes = autarco();
  routes['/api/site/site_key_1/kpis/power'] = () => {
    throw timeoutError();
  };
  const { app, gladys, tick, fake } = await setup({ routes, devices: created() });
  await app.start(CONFIG);
  await app.idle();
  for (let i = 0; i < 4; i += 1) {
    const before = fake.calls.filter((c) => c.path.includes('site_key_2')).length;
    if (i > 0) await tick();
    assert.equal(
      fake.calls.filter((c) => c.path.includes('site_key_2')).length,
      i === 0 ? 3 : before + 3,
    );
  }
  assert.equal(last(gladys, `${SITE2}:pv_energy`), 4008);
  assert.equal(last(gladys, `${SITE2}:battery_level`), 71);
  assert.equal(last(gladys, `${SITE1}:pv_energy`), undefined, 'site 1 ends at its first path');
  assert.match(status(gladys).message.fr, /Pas de réponse à temps cette fois : site 1000/);
  assert.match(status(gladys).message.fr, /Les autres sites sont à jour/);
});

test('a pause runs on the monotonic clock: a wall clock set back never lengthens it', async () => {
  const clock = { now: NOW, mono: 1_000_000 };
  const routes = autarco({
    '/api/site/': () => json({}, { status: 429, headers: { 'retry-after': String(6 * 3600) } }),
  });
  const { app, gladys, fake, tick } = await setup({ routes, clock });
  await app.start(CONFIG);
  await app.idle();
  routes['/api/site/'] = autarco()['/api/site/'];
  clock.now -= 2 * 24 * HOUR; // NTP sets the wall clock back two days
  await tick(5 * HOUR);
  assert.equal(accountReads(fake), 1);
  assert.match(status(gladys).message.fr, /pause/);
  await tick(HOUR + MINUTE);
  assert.equal(accountReads(fake), 2, 'read 6 h (monotonic) after the 429');
});

test('the wait after a restart runs on the monotonic clock too', async () => {
  const store = createMemoryStore();
  const clock = { now: NOW, mono: 5_000 };
  const first = await setup({ store, clock });
  await first.app.start(CONFIG);
  await first.app.idle();
  await first.app.stop();
  const second = await setup({ store, clock });
  await second.app.start(CONFIG);
  await second.app.idle();
  clock.now -= 2 * 24 * HOUR;
  await second.tick(POLL + MINUTE);
  assert.equal(accountReads(second.fake), 1);
});

test('a refused site is read again 2 intervals after the START of its read (not one more)', async () => {
  const clock = { now: NOW, mono: 0 };
  const asked = [];
  // The refusal of site 2 is slow (20 s): its wait must not start at the end of the read.
  const routes = autarco({
    '/api/site/site_key_2/kpis/power': () => {
      asked.push(clock.mono);
      clock.now += 20_000;
      clock.mono += 20_000;
      return json({}, { status: 403 });
    },
  });
  const config = { ...CONFIG, poll_interval: 120 };
  const { app, timers } = await setup({ routes, clock, config, latency: 300 });
  await app.start(config);
  await app.idle();
  assert.equal(asked.length, 1);
  const start = 0;
  // The timer of the integration looks every 15 s.
  while (clock.mono < 400_000 && asked.length < 2) {
    clock.now += 15_000;
    clock.mono += 15_000;
    await timers.runIntervals();
    await app.idle();
  }
  // Interval 120 s, first refusal: 2 x 120 s from the start of the read (at 0),
  // so the first read starting from 240 s asks it again (one look of 15 s at most).
  assert.ok(
    asked[1] >= start + 240_000 && asked[1] < start + 240_000 + 15_000 + 1_000,
    `asked again at ${asked[1]} ms`,
  );
});
