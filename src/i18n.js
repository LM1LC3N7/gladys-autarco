// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a text of the service nor the credentials (not even the e-mail
// address): only our own words, error codes, HTTP statuses and site numbers.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  if (ms >= 60_000) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** "18:02:05 UTC": an instant, never in the local time of a container. */
export const clock = (at) => `${new Date(at).toISOString().slice(11, 19)} UTC`;

/** Our words for an error code of src/autarco/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  refused: { en: 'e-mail or password refused', fr: 'e-mail ou mot de passe refusé' },
  forbidden: { en: 'access refused', fr: 'accès refusé' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  server: { en: 'error of the Autarco service', fr: 'erreur du service Autarco' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_json: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'answer that is not an Autarco account',
    fr: 'réponse qui n’est pas un compte Autarco',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    ['http', 'server', 'refused', 'forbidden', 'rate_limited'].includes(err?.code) &&
    Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

const INDEX = {
  pv: (site) => ({
    en: `solar production index of site ${site}`,
    fr: `index de production solaire du site ${site}`,
  }),
};

const kwh = (value) => Math.round(value * 1000) / 1000;

const sentences = (lang, list) => list.map((n) => n[lang]).join(' ');
const both = (list) => ({ en: sentences('en', list), fr: sentences('fr', list) });

const heldLine = ({ name, site, direction, from, to }) =>
  direction === 'down'
    ? {
        en: `${INDEX[name](site).en}: dropped from ${kwh(from)} to ${kwh(to)} kWh, held back (the last accepted value is sent again).`,
        fr: `${INDEX[name](site).fr} : baisse de ${kwh(from)} à ${kwh(to)} kWh, retenue (la dernière valeur acceptée est renvoyée).`,
      }
    : {
        en: `${INDEX[name](site).en}: jumped from ${kwh(from)} to ${kwh(to)} kWh, held back (not sent to the energy monitoring).`,
        fr: `${INDEX[name](site).fr} : saut de ${kwh(from)} à ${kwh(to)} kWh, retenu (non envoyé au suivi énergétique).`,
      };

const list = (sites) => sites.join(', ');

export const T = {
  problem: {
    email_missing: {
      en: 'Enter the e-mail address and the password of your Autarco account (my.autarco.com) in the configuration.',
      fr: 'Saisissez l’adresse e-mail et le mot de passe de votre compte Autarco (my.autarco.com) dans la configuration.',
    },
    email_invalid: {
      en: 'The e-mail address is not valid: enter the one you sign in with on my.autarco.com.',
      fr: 'L’adresse e-mail n’est pas valide : saisissez celle de votre connexion à my.autarco.com.',
    },
    password_missing: {
      en: 'Enter the password of your Autarco account.',
      fr: 'Saisissez le mot de passe de votre compte Autarco.',
    },
    password_invalid: {
      en: 'The password is not valid (1 to 256 characters, no line break): type it again.',
      fr: 'Le mot de passe n’est pas valide (1 à 256 caractères, sans retour à la ligne) : saisissez-le de nouveau.',
    },
  },
  connecting: {
    en: 'Reading the Autarco account…',
    fr: 'Lecture du compte Autarco…',
  },
  /** Not read yet in this start: the next read. */
  waiting: (at) => ({
    en: `Autarco: next read at ${clock(at)}.`,
    fr: `Autarco : prochaine lecture à ${clock(at)}.`,
  }),
  refused: (refusal) => ({
    en: `Autarco refuses the e-mail address or the password (HTTP ${refusal.status}): reads stopped, no new try by itself. Check them on my.autarco.com, then save them again in the configuration (or click "Test the connection" once).`,
    fr: `Autarco refuse l’adresse e-mail ou le mot de passe (HTTP ${refusal.status}) : lectures arrêtées, aucun nouvel essai automatique. Vérifiez-les sur my.autarco.com, puis enregistrez-les de nouveau dans la configuration (ou cliquez une fois sur « Tester la connexion »).`,
  }),
  failing: (err, wait) => ({
    en: `Autarco could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
    fr: `Autarco n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
  }),
  paused: (pause, wait) => ({
    en: `Autarco asks to wait (${reason(pause).en}): reads paused, new try in ${delay(wait).en}.`,
    fr: `Autarco demande d’attendre (${reason(pause).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
  }),
  ok: (count, notes = []) =>
    both([
      {
        en: `Autarco account read: ${count} site${count === 1 ? '' : 's'}.`,
        fr: `Compte Autarco lu : ${count} site${count === 1 ? '' : 's'}.`,
      },
      ...notes,
    ]),
  notes: {
    noSite: {
      en: 'The account lists no installation.',
      fr: 'Le compte ne liste aucune installation.',
    },
    noDevice: {
      en: 'Create the devices from the "Discover" tab to receive their values.',
      fr: 'Créez les appareils depuis l’onglet « Découverte » pour recevoir leurs valeurs.',
    },
    more: (max) => ({
      en: `The account lists more installations: only the first ${max} are read.`,
      fr: `Le compte liste d’autres installations : seules les ${max} premières sont lues.`,
    }),
    missing: (sites) => ({
      en: `Partly read this time (error of the service): site ${list(sites)}; the other values are up to date.`,
      fr: `Lu en partie cette fois (erreur du service) : site ${list(sites)} ; les autres valeurs sont à jour.`,
    }),
    denied: (sites) => ({
      en: `Access refused to site ${list(sites)} (the account itself is accepted): not read, tried again later, up to every hour.`,
      fr: `Accès refusé au site ${list(sites)} (le compte lui-même est accepté) : non lu, nouvel essai plus tard, jusqu’à une fois par heure.`,
    }),
    held: (held) =>
      both([
        ...held.map(heldLine),
        {
          en: 'If it is right, click "Accept the held index" twice in the configuration of the integration (the first click lists, the second accepts exactly what was listed). Saving the configuration accepts nothing.',
          fr: 'Si c’est juste, cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration (le premier clic liste, le second accepte exactement ce qui a été listé). Enregistrer la configuration n’accepte rien.',
        },
      ]),
  },
  accept: {
    nothing: {
      en: 'No index is held back: nothing to accept.',
      fr: 'Aucun index n’est retenu : rien à accepter.',
    },
    confirm: (held, within) =>
      both([
        {
          en: 'A second click accepts exactly these values:',
          fr: 'Un second clic accepte exactement ces valeurs :',
        },
        ...held.map((h) =>
          h.direction === 'down'
            ? {
                en: `${INDEX[h.name](h.site).en}: ${kwh(h.from)} → ${kwh(h.to)} kWh (a drop: 0 kWh counted).`,
                fr: `${INDEX[h.name](h.site).fr} : ${kwh(h.from)} → ${kwh(h.to)} kWh (une baisse : 0 kWh compté).`,
              }
            : {
                en: `${INDEX[h.name](h.site).en}: ${kwh(h.from)} → ${kwh(h.to)} kWh (${kwh(h.to - h.from)} kWh counted at once).`,
                fr: `${INDEX[h.name](h.site).fr} : ${kwh(h.from)} → ${kwh(h.to)} kWh (${kwh(h.to - h.from)} kWh comptés d’un coup).`,
              },
        ),
        {
          en: `Click "Accept the held index" again, after a few seconds and within ${delay(within).en}, to accept them; accept only if this energy was real.`,
          fr: `Cliquez de nouveau sur « Accepter l’index retenu », après quelques secondes et dans les ${delay(within).fr}, pour les accepter ; n’acceptez que si cette énergie est réelle.`,
        },
      ]),
    done: (accepted, changed) =>
      both([
        ...accepted.map((h) => ({
          en: `Accepted: ${INDEX[h.name](h.site).en} ${kwh(h.to)} kWh, sent at the next read.`,
          fr: `Accepté : ${INDEX[h.name](h.site).fr} ${kwh(h.to)} kWh, envoyé à la prochaine lecture.`,
        })),
        ...(changed.length > 0
          ? [
              {
                en: `Not accepted, the value changed since the first click: ${changed.map((h) => INDEX[h.name](h.site).en).join('; ')}. Click again to list it.`,
                fr: `Non accepté, la valeur a changé depuis le premier clic : ${changed.map((h) => INDEX[h.name](h.site).fr).join(' ; ')}. Cliquez de nouveau pour la lister.`,
              },
            ]
          : []),
        { en: 'A different value stays held.', fr: 'Une autre valeur reste retenue.' },
      ]),
  },
  test: {
    /** The values of the last read, in short. */
    ok: (sites) => {
      const en = [];
      const fr = [];
      for (const { siteId, values } of sites.slice(0, 5)) {
        const parts = { en: [], fr: [] };
        if (values.pvPower !== undefined) {
          parts.en.push(`solar ${Math.round(values.pvPower)} W`);
          parts.fr.push(`solaire ${Math.round(values.pvPower)} W`);
        }
        if (values.batterySoc !== undefined) {
          parts.en.push(`battery ${Math.round(values.batterySoc)} %`);
          parts.fr.push(`batterie ${Math.round(values.batterySoc)} %`);
        }
        en.push(`site ${siteId}${parts.en.length ? ` (${parts.en.join(', ')})` : ''}`);
        fr.push(`site ${siteId}${parts.fr.length ? ` (${parts.fr.join(', ')})` : ''}`);
      }
      return {
        en: `Autarco: e-mail and password accepted${en.length ? `; ${en.join('; ')}` : ''}.`,
        fr: `Autarco : e-mail et mot de passe acceptés${fr.length ? ` ; ${fr.join(' ; ')}` : ''}.`,
      };
    },
    failed: (err) => ({
      en: `Autarco: ${reason(err).en}.`,
      fr: `Autarco : ${reason(err).fr}.`,
    }),
    /** The button never reads sooner than the pace: what is known, and when the next read can be. */
    notNow: (at) => ({
      en: `Not asked now (never faster than the reading interval or a pause): next read possible at ${clock(at)}.`,
      fr: `Non interrogé maintenant (jamais plus vite que l’intervalle de lecture ou une pause) : prochaine lecture possible à ${clock(at)}.`,
    }),
    lastRead: (at) => ({
      en: `Last read at ${clock(at)}.`,
      fr: `Dernière lecture à ${clock(at)}.`,
    }),
    slow: {
      en: 'Autarco is slow to answer: look at the integration status in a minute.',
      fr: 'Autarco tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
    lines: (lines) => both(lines),
  },
};
