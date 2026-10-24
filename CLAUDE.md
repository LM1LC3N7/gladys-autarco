# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads the installations of an **Autarco account** through the public API
of my.autarco.com (`https://my.autarco.com/api/site/`, HTTP Basic with the
e-mail address and the password, HTTPS): the account (the sites), then
`kpis/power`, `kpis/energy` and `power` of each site. The paths, keys and
units are ported from
[python-autarco](https://github.com/klaasnicolaas/python-autarco) (MIT, see
`THIRD_PARTY_NOTICES.md`). Unofficial: not affiliated with Autarco.
**Read-only**: never `onSetValue`, only GET. Siblings: `gladys-sonnen` (the
structure, pace, pauses, refusal), `gladys-p1-monitor` (the guard),
`gladys-zeversolar` (another inverter, the cover).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png, 800 x 534, plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        AutarcoApp: pace, reads, indexes, refusal, pauses, buttons
src/autarco/client.js             the only HTTP access (GET only, bounded body, errors in our words)
src/autarco/model.js              the answers -> values (pure)
src/guard.js                      plausibility of an energy index, from gladys-p1-monitor (pure)
src/store.js                      what /data keeps across restarts
src/devices.js                    the devices, feature keys, catalogs, states (pure)
src/config.js                     e-mail, password and interval, normalized
src/constants.js                  paths, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
scripts/cover.mjs                 the cover image
gladys-assistant-integration.json manifest: name, config_schema, actions...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and a fake API
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Read-only.** No `onSetValue`, only GET requests of the account and of
  `SITE_PATHS`. A command, if one is ever added, is a `button` disabled by
  default behind an option, never a `switch`.
- **The credentials** are never logged, never shown (the e-mail address
  neither), never written to `/data` (only a salted fingerprint of the e-mail
  address, and an 8-bit marker of REFUSED credentials, erased by the first
  success), only sent to my.autarco.com; no redirect followed. The password
  field is described as "kept by Gladys in its database, never shown again".
- **Refused credentials** (401 of the account): a FINAL stop in `/data`, never
  an automatic new try; only new credentials or the test button (at the pace)
  read again, and only a success clears it. A 401/403 of a SITE, the account
  accepted, only leaves that site out (doubled wait up to 1 h).
- **Pace**: never a read faster than the interval, whatever asks (test
  button, Discovery, connection, save, restart: `/data` keeps the last
  request, written at most once a minute and at a clean stop). A read of an
  old generation publishes nothing and sets no status.
- **Pauses**: 429 anywhere, 5xx or 403 of the account: 1 min (never less than
  the interval) to 6 h, measured on the monotonic clock in memory, kept in
  `/data` (end capped when read back); a reconnection clears neither a pause
  nor a refusal.
- **Energy monitoring**: `pv_energy` (`energy-production-sensor` / `index`,
  from `pv_to_date`, with its `thirty-minutes-production` declared with UUID
  v5 ids) is the only index, one per site, through `IndexGuard`
  (`src/guard.js`, taken as it is): never 0, a drop and a jump never confirmed
  by repetition nor by time, only by `accept_held_index` clicked twice. Every
  other counter (day, month, grid, consumption, battery, inverter) is a plain
  sensor: never `energy-sensor`, never `daily-*`, never
  `publishEnergyConsumption`. Battery and grid powers are plain SIGNED sensors
  (sign not confirmed): never `charge-power` / `discharge-power` /
  `grid-sensor` from a guessed sign. Do not change `src/guard.js` without the
  same change in gladys-p1-monitor and a review.
- **Hostile answers**: bodies bounded to 256 KiB in one buffer, JSON content
  type required, own keys only, strict numbers, ranges checked; a public key
  checked before it goes into a path, a serial before it becomes an id. Never
  a text of the service in a message.
- **External ids are forever**: `site:<site_id>`, `inverter:<serial>`, the
  `SITE` and `INVERTER` keys of `src/devices.js`, the manifest keys. A device
  published again never loses a feature (groups only grow; a created device
  keeps all its features).
- **Units**: only those of `DEVICE_FEATURE_UNITS_BY_CATEGORY` in the core
  (`test/manifest.test.js`).
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/autarco-state.json`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language. Never a
  `default` on a secret field.
- **User-facing text** is bilingual (English and French), kept in sync. Files
  are UTF-8 without BOM nor control byte (`test/encoding.test.js`, sources
  included).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is not
  a bug in the code.
