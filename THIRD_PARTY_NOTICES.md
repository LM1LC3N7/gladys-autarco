# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## python-autarco (klaasnicolaas/python-autarco)

<https://github.com/klaasnicolaas/python-autarco>, the asynchronous Python
client of the Autarco API (published on PyPI as `autarco`, used by the Home
Assistant integration Autarco). Latest release 3.2.0 (2025-10-01), branch
`main` at commit 9867672 (2026-10-23). MIT License.

Ported to JavaScript in `src/autarco/client.js` and `src/autarco/model.js`:
the base address of the public API (`https://my.autarco.com/api/site/`), HTTP
Basic authentication with the e-mail address and the password of the account,
the 401 answer of refused credentials, the requirement of a JSON answer, the
paths of the account and of a site (`kpis/power`, `kpis/energy`, `power`), the
meaning of the keys and their units (`src/autarco/models.py`: `pv_now`,
`pv_today`, `pv_month`, `pv_to_date`, `battery_*`, the inverters with
`out_ac_power` and `out_ac_energy_total`), and the 15-second timeout. The test
answers of `test/fixtures/autarco.js` are trimmed from its `tests/fixtures`.
Changed here: read-only, only GET; no custom User-Agent; a missing or odd
value is never read as 0; the battery and grid signs are not interpreted; the
credentials are never logged; answers are bounded and no redirect is followed;
the site and inverter keys are checked before they go into a path or an id.

Its license notice, reproduced as it appears in its `LICENSE` file:

```
MIT License

Copyright (c) 2022-2026 Klaas Schoute

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gladys-sonnen, gladys-p1-monitor and gladys-zeversolar

The plausibility guard of the energy index (`src/guard.js`, the approved guard
of gladys-p1-monitor with its margin as a parameter, as in gladys-sonnen), the
structure of the integration, the pace, pauses and two-click acceptance come
from the sibling integrations
[gladys-sonnen](https://github.com/LM1LC3N7/gladys-sonnen),
[gladys-p1-monitor](https://github.com/LM1LC3N7/gladys-p1-monitor) and
[gladys-zeversolar](https://github.com/LM1LC3N7/gladys-zeversolar) (the cover
image script). Same project, Apache-2.0.
