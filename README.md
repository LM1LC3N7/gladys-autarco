# gladys-autarco

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for
**Autarco** solar inverters and batteries. It reads the installations of an
Autarco account through the public API of my.autarco.com (e-mail address and
password of the account, HTTPS) every 5 minutes by default: solar power,
production of the day, of the month and in total, each inverter, and with a
battery or a meter its state of charge, powers and counters. The total
production of each installation is its solar production index for the Gladys
energy monitoring. **Read-only**: nothing is ever sent to an installation.

**Never tested with a real device.** Not affiliated with Autarco.

- User guide: [English](docs/en.md), [français](docs/fr.md).
- Requirements: Gladys 5.2.0 or later, Internet access, an Autarco account.

## How it works

- Every read: `GET /api/site/` (the account: the credentials check and the
  list of sites), then `kpis/power`, `kpis/energy` and `power` of each site,
  with HTTP Basic, as the
  [python-autarco](https://github.com/klaasnicolaas/python-autarco) library
  (MIT) does. Ported to JavaScript, see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The lifetime solar production of each site (`pv_to_date`) is the only energy
  index; it passes the guard of gladys-p1-monitor (`src/guard.js`): never 0,
  jumps and drops held until the "Accept the held index" button is clicked
  twice. Counters of the day, grid, consumption and battery counters are plain
  sensors; battery and grid powers are plain signed sensors (sign not
  confirmed).
- Never a read faster than the interval, across reconnections, saves and
  restarts (`/data`); refused credentials stop the reads for good (kept in
  `/data`, no automatic new try); 429 and 5xx pause the reads; the credentials
  are never logged.

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npm run audit
npm run cover
```

See [CLAUDE.md](CLAUDE.md) for the project rules, [TODO.md](TODO.md) for the
decisions and what is left to check on a real account.

## License

Apache-2.0, see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
