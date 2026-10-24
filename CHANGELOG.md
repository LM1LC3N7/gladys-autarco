# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-24

### Added

- Reading of an Autarco account through the public API of my.autarco.com
  (HTTP Basic with the e-mail address and the password, HTTPS), as the
  python-autarco library does: the account, then the power and energy figures
  and the inverters of each site, every 5 minutes by default (2 minutes to
  1 hour). Read-only: only GET requests.
- One device per site: solar power, solar production index (with its
  30-minute production), production of the day and of the month, health; with
  a battery its state of charge, powers (signed, as given) and counters; with
  a meter the grid and consumption powers (signed, as given) and counters.
  One device per inverter: power, total production, health, grid turned off.
- The lifetime solar production of each site as the only energy index,
  through the guard of gladys-p1-monitor: never 0, jumps and drops held until
  the "Accept the held index" button is clicked twice. Every other counter is
  a plain sensor: no double count with the main meter, no injection counted.
- Never a read faster than the interval: not the test button, Discovery, a
  reconnection, a save of an unchanged configuration nor a restart (the last
  request is kept in `/data`). A read that ends after a restart or a new
  configuration publishes nothing.
- Refused credentials stop the reads for good, kept in `/data` (an 8-bit
  marker only), without any automatic new try; new credentials or the test
  button try again. HTTP 429 anywhere, and 5xx or 403 of the account, pause
  the reads from 1 minute to 6 hours, kept in `/data`; an error or a refusal
  of one site only leaves that site out; a site without an answer ends only
  that site, and the first site read turns at each read. Pauses run on the
  monotonic clock. Answers bounded, no redirect followed, the credentials
  never logged.
- The solar power of a site is left out when all its inverters are silent
  for 2 hours; the consumption is kept only for a site with a meter (a grid
  value).
- "Test the connection" and "Accept the held index" buttons.
- Documentation in English and French; `LICENSE` (Apache-2.0) and
  `THIRD_PARTY_NOTICES.md` (MIT notice of python-autarco), shipped in the
  image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-autarco/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-autarco/releases/tag/v0.1.1
