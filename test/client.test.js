// -----------------------------------------------------------------------------
// The HTTP client: our error codes, bounded bodies, never a redirect, GET only.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutarcoClient, AutarcoError, basicAuth } from '../src/autarco/client.js';
import { MAX_BODY_BYTES } from '../src/constants.js';
import { createFetch, timeoutError } from './helpers/fakeFetch.js';
import { EMAIL, NOW, PASSWORD, account, autarco, json } from './fixtures/autarco.js';

const CREDENTIALS = { email: EMAIL, password: PASSWORD };
const clientOf = (routes) => {
  const fake = createFetch(routes);
  return { fake, client: new AutarcoClient({ fetchImpl: fake.fetch, now: () => NOW }) };
};
const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof AutarcoError);
    return err;
  }
  assert.fail('no error');
};

test('basic auth in UTF-8, as the library', () => {
  assert.equal(
    basicAuth('a@b.c', 'pässword'),
    `Basic ${Buffer.from('a@b.c:pässword', 'utf8').toString('base64')}`,
  );
});

test('statuses become our codes; Retry-After read; never a text of the service', async () => {
  for (const [status, code] of [
    [401, 'refused'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [500, 'server'],
    [503, 'server'],
    [404, 'http'],
    [302, 'http'],
  ]) {
    const { client } = clientOf({
      '/api/site/': () =>
        json({ message: 'secret text' }, { status, headers: { 'retry-after': '120' } }),
    });
    const err = await codeOf(client.get('', CREDENTIALS));
    assert.equal(err.code, code, String(status));
    assert.equal(err.status, status);
    assert.doesNotMatch(err.message, /secret text/);
    if (code === 'rate_limited' || code === 'server') assert.equal(err.retryAfter, 120_000);
  }
});

test('never a redirect followed; a timeout and a network failure are ours', async () => {
  const { client, fake } = clientOf({ '/api/site/': () => json(account()) });
  await client.get('', CREDENTIALS);
  assert.equal(fake.calls[0].init.redirect, 'manual');
  assert.equal(fake.calls[0].init.method, 'GET');
  const timeout = new AutarcoClient({
    fetchImpl: async () => {
      throw timeoutError();
    },
  });
  assert.equal((await codeOf(timeout.get('', CREDENTIALS))).code, 'timeout');
  fake.state.offline = true;
  assert.equal((await codeOf(client.get('', CREDENTIALS))).code, 'unreachable');
});

test('only JSON objects within the size limit', async () => {
  const cases = [
    [() => new Response('<html>', { headers: { 'content-type': 'text/html' } }), 'not_json'],
    [() => new Response('{', { headers: { 'content-type': 'application/json' } }), 'not_json'],
    [() => json([1, 2]), 'unknown_answer'],
    [() => json(null), 'unknown_answer'],
    [
      () =>
        new Response('x'.repeat(MAX_BODY_BYTES + 1), {
          headers: { 'content-type': 'application/json' },
        }),
      'too_large',
    ],
  ];
  for (const [make, code] of cases) {
    const { client } = clientOf({ '/api/site/': make });
    assert.equal((await codeOf(client.get('', CREDENTIALS))).code, code);
  }
  const { client } = clientOf({ '/api/site/': () => json({ data: 'x' }) });
  assert.equal((await codeOf(client.readAll(CREDENTIALS))).code, 'unknown_answer');
});

test('readAll: the account first, then three paths per site; an odd public key never in a path', async () => {
  const routes = autarco({
    '/api/site/': () => ({
      data: [
        ...account().data,
        { site_id: 3000, public_key: '../../admin', name: 'x', health: 'OK' },
        { site_id: 1000, public_key: 'site_key_9', name: 'dup', health: 'OK' },
      ],
    }),
  });
  const { client, fake } = clientOf(routes);
  const result = await client.readAll(CREDENTIALS);
  assert.deepEqual(
    result.sites.map((s) => s.site.siteId),
    ['1000', '2000'],
  );
  assert.equal(fake.calls.length, 7);
  assert.ok(fake.calls.every((c) => !c.path.includes('admin') && !c.path.includes('site_key_9')));
  assert.equal(result.sites[0].serverTime, NOW);
});

test('readAll: a refusal of a site skips its other paths; a 429 stops; the network cuts the rest', async () => {
  const denied = clientOf(
    autarco({ '/api/site/site_key_1/kpis/power': () => json({}, { status: 401 }) }),
  );
  const result = await denied.client.readAll(CREDENTIALS);
  assert.equal(result.sites[0].denied, true);
  assert.equal(result.sites[0].kpisEnergy, undefined);
  assert.ok(result.sites[1].kpisPower);
  assert.equal(denied.fake.calls.filter((c) => c.path.includes('site_key_1')).length, 1);

  const limited = clientOf(
    autarco({ '/api/site/site_key_1/kpis/energy': () => json({}, { status: 429 }) }),
  );
  assert.equal((await codeOf(limited.client.readAll(CREDENTIALS))).code, 'rate_limited');

  const routes = autarco();
  routes['/api/site/site_key_1/kpis/energy'] = () => {
    throw timeoutError();
  };
  const cut = clientOf(routes);
  const partial = await cut.client.readAll(CREDENTIALS);
  assert.deepEqual(partial.sites[0].missing, ['kpisEnergy', 'power']);
  assert.deepEqual(partial.sites[1].missing, ['kpisPower', 'kpisEnergy', 'power']);
  assert.equal(cut.fake.calls.length, 3);

  const skipped = clientOf(autarco());
  const some = await skipped.client.readAll(CREDENTIALS, { skip: (id) => id === '2000' });
  assert.equal(some.sites[1].skipped, true);
  assert.equal(skipped.fake.calls.length, 4);
});
