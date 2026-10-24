# TODO

## To check on a real account

- The sign of `battery_now`, `battery_net_charged_now`, `grid_net_import_now`
  and `grid_export_now` (python-autarco gives none; its battery answer shows
  `battery_now` = `battery_net_charged_now` = 777 while charging?). Once
  confirmed, add `charge-power` / `discharge-power` and `grid-sensor` /
  `power` as NEW features (never change the type of an existing one).
- Whether `pv_to_date` is really whole kWh and whether it can drop when an
  inverter stops talking (`no_comms`): the guard holds a drop, it comes back
  by itself above the last accepted value.
- The values of `health` besides "OK", and whether `consumption_*` of a site
  without a meter only repeats the production (the fixture of the library
  suggests so).
- Whether the API asks for a pace (429, Retry-After) at 5 minutes with several
  sites.

- Whether `pv_now`, `battery_now` and the grid powers stay frozen when the
  inverters stop talking (night, outage): `pv_now` is left out once every
  inverter with a readable time is silent for 2 h (review r1, point 3); the
  battery and the meter are not, as they may talk while the inverters sleep.
- The encoding of HTTP Basic for a password with non-ASCII characters: UTF-8
  here, latin1 in aiohttp (python-autarco); a refusal is final, the docs warn
  (review r1, point 5).

## Ideas

- A "Sensor only" option for the production index (as gladys-sonnen) if
  users already send the production of their Autarco inverters to Gladys
  through another integration.
- The next pages of the account (more than 30 sites), following
  `next_page_url` only on my.autarco.com.
- The battery charge and discharge counters as `charge-index` /
  `discharge-index` (guarded), once their meaning is confirmed.

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-autarco:0.1.0`), as
  for the sibling integrations; the Release workflow owns them from now on
  (the first patch release gives 0.1.1).
- **Reused project**: python-autarco (Klaas Schoute, MIT, latest release
  3.2.0 of 2025-10-01, `main` at commit 9867672, LICENSE checked: MIT,
  "Copyright (c) 2022-2026 Klaas Schoute"), cloned read-only in
  `~/code/ref/lot15/python-autarco`, ported to JavaScript: the base address,
  HTTP Basic, the paths, keys and units, the 401 of refused credentials, the
  JSON content type check, the 15 s timeout. No custom User-Agent (the
  library sends `PythonAutarco/<version>`: not imitated, Node's own fetch).
  The SDK stays the only runtime dependency. Structure, pace, pauses, store
  and two-click acceptance from gladys-sonnen; the guard from
  gladys-p1-monitor (as in gladys-sonnen, `maxKw` and `slackKwh` as
  parameters, file unchanged). The template's demo files were removed
  (`git rm`).
- **Read-only (v1)**: the API is a read API; no `onSetValue`.
- **Devices and ids**: one device per site, `site:<site_id>` (the numeric
  `site_id` of the account, stable, never the `public_key`, which goes only
  into paths after a check `[A-Za-z0-9_-]{1,128}`); one device per inverter,
  `inverter:<serial>` (`[A-Za-z0-9_-]{4,40}`, an `sn` that differs from its
  key is ignored). A site id seen twice is kept once. Site features by group:
  solar always, `battery` and `meter` once such values were seen (kept in
  `/data`, they only grow; a created device keeps all its features).
- **Energy (lot 6 rules, no double count)**: `pv_to_date` is a lifetime
  counter: the only index (`energy-production-sensor` / `index` with its
  `thirty-minutes-production`, UUID v5 ids), through the guard with
  `INDEX_LIMITS.pv`: 50 kW (a home or small business installation, the API
  gives no reliable peak power) and `slackKwh` 1.5 (the API gives whole kWh,
  a step of 1 kWh must never be held). No index is built from a counter of
  the day (`pv_today` and `pv_month` are plain sensors). Grid import and
  export, consumption, battery and inverter counters are plain sensors (kWh
  in the name): never `energy-sensor`, never an injection, never
  `publishEnergyConsumption` (tested).
- **Signs (lot 14, Zinvolt)**: battery and grid powers not confirmed: plain
  signed sensors (`unknown`, min −1 MW), the sign "as given by Autarco" in the
  name. Never split by a guessed sign.
- **Credentials refused (lots 12 and 13)**: only a 401 of the account. Final,
  persisted in `/data` (`refusal: { status, mark }`), no automatic new try.
  Lifted by new credentials (compared in memory; after a restart by an 8-bit
  scrypt marker, salted: lesson 7 of lot 14, it confirms no password; a
  collision, 1 in 256, only means the user clicks the test button) or by a
  success of the test button, which reads at the pace even when refused.
- **403 of the account**: not a refusal (it may be a firewall of the
  service): a pause like a 5xx, never shorter than its doubling.
- **A site that refuses (401/403) while the account is accepted** (lesson 14
  of lot 14): only that site is "not read", skipped for the interval doubled
  up to 1 h, listed in the status; never a refusal of the account.
- **429 anywhere, 5xx of the account**: pause `{ until, count, code, status }`
  in `/data`, from Retry-After or 1 min doubled, 1 min - 6 h, at least the
  interval, end capped when read back. A 5xx or an odd answer of a site path
  only leaves its values out; a network failure stops the remaining requests.
- **Unreachable**: the interval at least, doubled up to 30 min.
- **Pace**: 300 s by default (the portal refreshes about every 5 min), 120 to
  3600 s. The timer looks every 15 s; nothing reads sooner than the last
  request + the interval (monotonic clock); the last request written to
  `/data` at most once a minute and at a clean stop, so after a restart the
  first read waits that instant + one minute + the interval. New credentials
  are read at once. A read running is never doubled; a read of an old
  generation publishes nothing.
- **Freshness (lesson 28 of lot 14)**: the power of an inverter whose last
  message (`latest`, else `dt_latest_msg`) is more than 2 h older than the
  `Date` of the answer of its site is not sent (night, an inverter gone);
  without a readable `Date`, never "stale" (lesson of lot 13).
- **Personal data**: the e-mail address only as a salted fingerprint in
  `/data`; the site names in memory only (Discovery after a restart shows
  "Autarco site <id>" until the first read); no address, no retailer name.
- **Sites**: the first page of the account only (30), the status says when
  there are more; `next_page_url` is never followed (a URL of the service).
- **States per minute**: a sliding budget of 270 states over 60 s, whole
  devices, starting from a rotating device when one read has more.
- **No custom User-Agent**, no imitation, no Bluetooth, no network discovery.
- **Gladys version**: `>=5.2.0`, like the other energy integrations.
- **Review r1**:
  1. A read of the previous generation that ends after a (re)start with the
     same credentials keeps its refusal or pause, and a late success lifts
     refusal, pause and failures (nothing published); the status is set again
     by the current generation once that read ends.
  2. A site path without an answer in time ends that site only; the read
     stops only when Autarco is out of reach (connection refused, DNS) or two
     sites in a row do not answer. The first site read turns at each read.
     The status separates "no answer", "error of the service" and "not
     read", and says "the other sites are up to date" only when one was read
     in full.
  3. `pvPower` of a site is left out when every inverter with a readable time
     is silent for more than 2 h (`Date` of the service).
  4. Pauses and the wait after a restart run on the monotonic clock in
     memory (wall clock only for /data), the pause capped at 6 h at each use.
  5. HTTP Basic in UTF-8 (aiohttp: latin1): comment, TODO and docs.
  6. A serial number needs a digit (`__proto__` and other words refused).
  7. The `meter` group needs a grid value; `consumption_*` is kept only with
     a grid value in the same read (without a meter the API repeats the
     production there).
  8. Texts: the refusal status, the acceptance answer, the manifest and the
     pause durations of the docs.
