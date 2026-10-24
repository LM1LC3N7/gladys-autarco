// -----------------------------------------------------------------------------
// A fake `fetch` for the Autarco client: routes by path (under my.autarco.com),
// records every call, fails loudly on an unexpected one. No test touches the
// network. (From gladys-sonnen.)
// -----------------------------------------------------------------------------

/**
 * `routes` maps a path ("/api/site/key_1/kpis/power") to handler(call) ->
 * Response, or throw. `call`: `{ url, host, path, init }`. `offline` true:
 * every call fails as unreachable.
 */
export function createFetch(routes, { host = 'my.autarco.com' } = {}) {
  const calls = [];
  const state = { offline: false };
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const call = { url, host: parsed.host, path: parsed.pathname, init };
    calls.push(call);
    if (state.offline || parsed.host !== host) {
      throw refusedError();
    }
    const handler = routes[parsed.pathname];
    if (typeof handler !== 'function') {
      throw new Error(`Unexpected Autarco call in a test: ${parsed.pathname}`);
    }
    return handler(call);
  };
  return { fetch: fetchImpl, calls, routes, state };
}

/** What fetch throws when the service does not answer in time. */
export const timeoutError = () => {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
};

/** What fetch throws when nothing listens. */
export function refusedError() {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ECONNREFUSED' };
  return err;
}
