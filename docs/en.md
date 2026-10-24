# Autarco

**Unofficial** integration, not affiliated with Autarco. It reads the
installations of your **Autarco** account (solar inverters, and batteries
when there are some) through the public API of my.autarco.com, with the
e-mail address and the password of the account. Internet is needed.

**Never tested with a real device**: the integration was written from the
[python-autarco](https://github.com/klaasnicolaas/python-autarco) library
(the one Home Assistant uses) and its test answers, without an Autarco
account at hand. Your feedback is welcome.

## Read-only

The integration **only reads** (GET requests of the public API). It changes
nothing on your installation nor in your account.

## What you get

One device per **installation** (site) of the account, named after it:

- solar power (W) and **the solar production index** (the total production of
  the installation, in kWh), for the Gladys energy monitoring, with its
  30-minute production computed by Gladys;
- production of the day and of the month (kWh, plain sensors, never counted);
- health of the installation (1 = OK, 0 = a problem reported by Autarco).

With a battery (the values appear only when Autarco gives them):

- state of charge (%);
- battery power and net charge power (W), **as given by Autarco**: their sign
  (charge or discharge) has not been confirmed on a real installation, so
  they are plain signed sensors, never split into charge and discharge;
- energy charged and discharged today and in total (kWh, plain sensors).

With a meter: grid net import and export (W, signs as given), grid import and
export totals (kWh), consumption (W, today, total). All plain sensors.

One device per **inverter**: power (W), total production (kWh, plain
sensor), health, grid turned off (0/1). The power of an inverter whose last
message is more than 2 hours old (by the clock of the service) is not sent.

### No double count

Only the **total solar production** of each installation feeds the Gladys
energy monitoring, as an index. The counters of the day and of the month, the
grid import (the main meter of your home, Linky..., already counts it), the
injection and the battery counters are **plain sensors**: they are never
counted nor billed by Gladys, and the integration never sends a daily
consumption. If another integration already sends the same solar production
to Gladys, create only one of the two production indexes.

The API gives whole kWh: the index rises by steps of 1 kWh.

## Requirements

- Gladys 5.2.0 or later, with Internet access.
- An Autarco account on my.autarco.com (the one of the Autarco app).

## Configuration

1. Install the integration from the Gladys store.
2. **E-mail address** and **Password** of your Autarco account. The password
   is kept by Gladys in its database, never shown again, sent only to
   my.autarco.com (HTTPS, in the header of its requests), never logged.
3. **Reading interval**: 300 s by default (the pace at which the portal
   refreshes), 120 to 3600 s. Each read is one request for the account, then
   three per installation.
4. After the first read, create the devices from the **Discover** tab.

The **Test the connection** button reads the account once if the interval has
passed; otherwise it shows the last read and when the next one can be.

Only the first 30 installations of the account are read (the first page of
the API); the status says so when there are more.

## Pace of the reads

Nothing reads the account faster than the interval: not the test button, not
the Discover tab, not a reconnection to Gladys, not a save of an unchanged
configuration, not a restart of the container (the time of the last read is
kept in `/data`, written at most once a minute and at a clean stop: after a
restart, the first read waits the interval plus a minute). New credentials
are tried at once.

## Held index

Gladys counts every rise of an index in full. So that no fictive energy is
ever counted, the solar production index of each installation goes through a
guard:

- a value of 0 is never sent;
- a drop, or a rise faster than 50 kW on average (plus 1.5 kWh), is **held
  back**: the last accepted value is sent again, and the status of the
  integration shows it. Neither time nor repetition confirms it; a drop that
  comes back up is taken again as soon as it passes the last accepted value;
- if it is right, click **Accept the held index** **twice**: the first click
  lists what is held and accepts nothing, the second, 3 seconds to 5 minutes
  later, accepts exactly what was listed (a jump is then counted at once, a
  drop counts nothing). Saving the configuration accepts nothing.

## Errors

- **E-mail or password refused** (HTTP 401 of the account): the reads
  **stop**, the status says so, and **no new try is ever made by itself**
  (this stop is kept in `/data` across a restart). Check your credentials on
  my.autarco.com, then save them again: new credentials are tried at once.
  The **Test the connection** button also tries once (at the pace of the
  reads); only a success lifts the stop. To recognise the refused credentials
  after a restart, `/data` keeps only an 8-bit marker of them (it can confirm
  no password), erased by the first successful read.
- **HTTP 429** (too many requests), anywhere: the reads pause, from the delay
  asked by Autarco (or 1 minute, doubled at each new one) up to 6 hours, kept
  in `/data`. An **HTTP 5xx** or **403** of the account pauses the same way.
- An error of one installation (5xx, an odd answer) only leaves its values
  out: the others are published. An installation that refuses access (401 or 403) while the account is accepted is left out, tried again later (the
  interval doubled, up to once an hour); the status lists it.
- Autarco unreachable: new try after the interval, doubled up to 30 minutes.

## Privacy

The integration talks only to my.autarco.com, over HTTPS, and follows no
redirect: your credentials never go elsewhere. Neither the e-mail address nor
the password is ever written to the logs, to the status or to `/data` (the
account is kept there as a salted fingerprint only). The names of the
installations are kept in memory only.
