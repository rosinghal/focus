const { scryptSync, timingSafeEqual } = require('node:crypto');

const GRACE_MS = 60 * 1000;
const BYPASS_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60 * 1000;
const PASSCODE_DELAY_MS = 30 * 1000;
const PASSCODE_PATTERN = /^\d{4}$/;

const isValidPasscode = (passcode) => typeof passcode === 'string' && PASSCODE_PATTERN.test(passcode);

const hashPasscode = (passcode, salt) => scryptSync(passcode, salt, 32).toString('hex');

const createPasscodeRecord = (passcode, salt) => ({ salt, hash: hashPasscode(passcode, salt) });

const passcodeMatches = (record, input) => {
  if (!record || !isValidPasscode(input)) return false;
  return timingSafeEqual(Buffer.from(record.hash, 'hex'), Buffer.from(hashPasscode(input, record.salt), 'hex'));
};

const passcodeDelayRemainingMs = (requestedAt, nowMs) =>
  requestedAt ? Math.max(0, requestedAt + PASSCODE_DELAY_MS - nowMs) : PASSCODE_DELAY_MS;

const NO_FAILURES = { failures: 0, lockedUntil: 0 };

const lockoutRemainingMs = (attempts, nowMs) => Math.max(0, attempts.lockedUntil - nowMs);

const registerFailure = (attempts, nowMs) => {
  const failures = attempts.failures + 1;
  return failures >= MAX_ATTEMPTS
    ? { failures: 0, lockedUntil: nowMs + LOCKOUT_MS }
    : { failures, lockedUntil: attempts.lockedUntil };
};

const checkCode = (matches, attempts, nowMs) => {
  const waitMs = lockoutRemainingMs(attempts, nowMs);
  if (waitMs > 0) return { ok: false, reason: 'locked-out', waitMs, attempts };
  if (matches()) return { ok: true, attempts: NO_FAILURES };
  const next = registerFailure(attempts, nowMs);
  const nextWaitMs = lockoutRemainingMs(next, nowMs);
  return nextWaitMs > 0
    ? { ok: false, reason: 'locked-out', waitMs: nextWaitMs, attempts: next }
    : { ok: false, reason: 'wrong', attemptsLeft: MAX_ATTEMPTS - next.failures, attempts: next };
};

const checkPasscode = (record, input, attempts, nowMs) =>
  checkCode(() => passcodeMatches(record, input), attempts, nowMs);

module.exports = {
  GRACE_MS,
  BYPASS_MS,
  MAX_ATTEMPTS,
  LOCKOUT_MS,
  PASSCODE_DELAY_MS,
  NO_FAILURES,
  isValidPasscode,
  createPasscodeRecord,
  passcodeMatches,
  lockoutRemainingMs,
  passcodeDelayRemainingMs,
  checkCode,
  checkPasscode,
};
