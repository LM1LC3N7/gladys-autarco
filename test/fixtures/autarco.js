// -----------------------------------------------------------------------------
// Answers of the Autarco API, from the test answers of python-autarco (Klaas
// Schoute, MIT, see THIRD_PARTY_NOTICES.md), trimmed and made consistent:
// two sites, the second with a battery and a meter. Fake keys, fake names.
// -----------------------------------------------------------------------------

export const EMAIL = 'someone@example.com';
export const PASSWORD = 'not-a-real-password';
/** 2024-09-11 12:20:00 UTC, the time of the answers. */
export const NOW = Date.parse('2024-09-11T12:20:00Z');

export const account = () => ({
  current_page: 1,
  data: [
    {
      mock: 0,
      name_end_user: 'My Autarco',
      name_retailer: 'Retailer',
      public_key: 'site_key_1',
      site_id: 1000,
      nominal_power: 4600,
      health: 'OK',
      name: 'Roof',
    },
    {
      mock: 0,
      name_end_user: 'My Autarco',
      name_retailer: 'Retailer',
      public_key: 'site_key_2',
      site_id: 2000,
      nominal_power: 5000,
      health: 'OK',
      name: 'Barn',
    },
  ],
  next_page_url: null,
  per_page: 30,
});

/** Site 1: solar only. */
export const kpisPower1 = () => ({
  inverters: {
    380016531035: {
      latest: '2024-09-11T12:12:48+00:00',
      power: 3323,
      health: 'OK',
      error: null,
    },
  },
  pv_now: 3323,
  is_daytime: true,
});

export const kpisEnergy1 = () => ({
  is_daytime: true,
  pv_today: 8,
  pv_to_date: 29176,
  pv_month: 114,
  co2_today: 2,
  co2_month: 31,
  co2_to_date: 7808,
});

export const power1 = () => ({
  dt_config_changed: '2017-11-13T14:14:07+00:00',
  inverters: {
    380016531035: {
      sn: '380016531035',
      dt_latest_msg: '2024-09-11T12:12:48+00:00',
      out_ac_power: 3323,
      out_ac_energy_total: 29176,
      error: null,
      grid_turned_off: false,
      health: 'OK',
    },
  },
  stats: { graphs: { pv_power: {}, no_comms: [] }, kpis: { pv_now: 3323 } },
});

/** Site 2: solar, battery and meter (python-autarco tests/fixtures/battery). */
export const kpisPower2 = () => ({
  inverters: {
    480016531099: {
      latest: '2024-09-11T12:12:48+00:00',
      power: 961,
      health: 'OK',
      error: null,
    },
  },
  pv_now: 961,
  is_daytime: true,
  consumed_now: 0,
  grid_net_import_now: 0,
  grid_export_now: 0,
  consumption_now: 184,
  self_consumption_now: 100,
  self_sufficiency_now: 100,
  battery_now: 777,
  battery_net_charged_now: 777,
  battery_soc: 71,
});

export const kpisEnergy2 = () => ({
  is_daytime: true,
  pv_today: 1,
  pv_to_date: 4008,
  pv_month: 141,
  grid_net_import_to_date: -787,
  grid_import_to_date: 173,
  grid_export_to_date: 960,
  battery_soc: 56,
  battery_discharged_today: 2,
  battery_discharged_to_date: 696,
  battery_charged_today: 1,
  battery_charged_to_date: 748,
  consumption_today: 2,
  consumption_month: 102,
  consumption_to_date: 3169,
});

export const power2 = () => ({
  inverters: {
    480016531099: {
      sn: '480016531099',
      dt_latest_msg: '2024-09-11T12:12:48+00:00',
      out_ac_power: 961,
      out_ac_energy_total: 4008,
      error: null,
      grid_turned_off: false,
      health: 'OK',
    },
  },
  stats: { graphs: {}, kpis: {} },
});

/** A JSON answer, with the `Date` header of the service. */
export const json = (body, { status = 200, headers = {}, date = NOW } = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      date: new Date(date).toUTCString(),
      ...headers,
    },
  });

/** The routes of the account; `answers` overrides a body by its path. */
export function autarco(answers = {}) {
  const body = {
    '/api/site/': account,
    '/api/site/site_key_1/kpis/power': kpisPower1,
    '/api/site/site_key_1/kpis/energy': kpisEnergy1,
    '/api/site/site_key_1/power': power1,
    '/api/site/site_key_2/kpis/power': kpisPower2,
    '/api/site/site_key_2/kpis/energy': kpisEnergy2,
    '/api/site/site_key_2/power': power2,
    ...answers,
  };
  const routes = {};
  for (const [path, make] of Object.entries(body)) {
    routes[path] = () => {
      const value = make();
      return value instanceof Response ? value : json(value);
    };
  }
  return routes;
}
