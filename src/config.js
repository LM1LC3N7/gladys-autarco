// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// The password is a secret: it is never logged, never shown, never written to
// /data, and only ever sent to my.autarco.com, in the Authorization header
// (HTTP Basic, over HTTPS) of a GET.
// -----------------------------------------------------------------------------

import { POLL_DEFAULT, POLL_MAX, POLL_MIN } from './constants.js';

/**
 * The e-mail address of the Autarco account: printable, no space, no colon
 * (HTTP Basic splits the user and the password at the first colon), one @.
 */
const EMAIL = /^[^\s:@\p{Cc}]{1,64}@[^\s:@\p{Cc}]{1,190}$/u;

/**
 * The password: 1 to 256 characters, no control character (it goes into a
 * header: never a line break). Anything else is refused before any request,
 * without being echoed.
 */
const PASSWORD = /^[^\p{Cc}]{1,256}$/u;

/** The reading interval (s): a number from 120 to 3600, else 300. */
function pollOf(raw) {
  const value = typeof raw === 'string' && /^\d{1,6}$/.test(raw.trim()) ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return POLL_DEFAULT;
  }
  return Math.min(POLL_MAX, Math.max(POLL_MIN, Math.round(value)));
}

/**
 * `{ email, password, pollInterval, problem }`: `email` and `password` are
 * undefined when missing or invalid; `problem` is 'email_missing',
 * 'email_invalid', 'password_missing', 'password_invalid' or undefined.
 */
export function normalizeConfig(raw = {}) {
  const emailText = typeof raw?.email === 'string' ? raw.email.trim() : '';
  // The password is taken as typed (a space may belong to it), only bounded.
  const password = typeof raw?.password === 'string' ? raw.password : '';
  let problem;
  if (emailText === '') problem = 'email_missing';
  else if (!EMAIL.test(emailText)) problem = 'email_invalid';
  else if (password === '') problem = 'password_missing';
  else if (!PASSWORD.test(password)) problem = 'password_invalid';
  return {
    email: problem ? undefined : emailText,
    password: problem ? undefined : password,
    pollInterval: pollOf(raw?.poll_interval),
    problem,
  };
}
