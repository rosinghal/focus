const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GRACE_MS,
  BYPASS_MS,
  MAX_ATTEMPTS,
  LOCKOUT_MS,
  PASSCODE_DELAY_MS,
  NO_FAILURES,
  isValidPasscode,
  createPasscodeRecord,
  passcodeMatches,
  checkCode,
  checkPasscode,
  passcodeDelayRemainingMs,
} = require('../src/unlock');

const record = createPasscodeRecord('1234', 'salt');

test('access durations match Screen Time behaviour', () => {
  assert.equal(GRACE_MS, 60 * 1000);
  assert.equal(BYPASS_MS, 15 * 60 * 1000);
});

test('isValidPasscode accepts exactly four digits', () => {
  assert.equal(isValidPasscode('0000'), true);
  assert.equal(isValidPasscode('123'), false);
  assert.equal(isValidPasscode('12345'), false);
  assert.equal(isValidPasscode('12a4'), false);
  assert.equal(isValidPasscode(1234), false);
});

test('passcode is hashed, not stored in plain text', () => {
  assert.notEqual(record.hash, '1234');
  assert.equal(record.salt, 'salt');
  assert.notEqual(createPasscodeRecord('1234', 'other').hash, record.hash);
});

test('passcodeMatches', () => {
  assert.equal(passcodeMatches(record, '1234'), true);
  assert.equal(passcodeMatches(record, '4321'), false);
  assert.equal(passcodeMatches(record, '12345'), false);
  assert.equal(passcodeMatches(null, '1234'), false);
});

test('correct passcode succeeds and resets failures', () => {
  const result = checkPasscode(record, '1234', { failures: 3, lockedUntil: 0 }, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(result.attempts, NO_FAILURES);
});

test('wrong passcodes count down, then lock out for a minute', () => {
  let attempts = NO_FAILURES;
  for (let left = MAX_ATTEMPTS - 1; left > 0; left--) {
    const result = checkPasscode(record, '0000', attempts, 1000);
    assert.deepEqual([result.ok, result.reason, result.attemptsLeft], [false, 'wrong', left]);
    attempts = result.attempts;
  }
  const lockout = checkPasscode(record, '0000', attempts, 1000);
  assert.deepEqual([lockout.reason, lockout.waitMs], ['locked-out', LOCKOUT_MS]);

  const duringLockout = checkPasscode(record, '1234', lockout.attempts, 1000 + LOCKOUT_MS - 1);
  assert.deepEqual([duringLockout.ok, duringLockout.reason, duringLockout.waitMs], [false, 'locked-out', 1]);

  assert.equal(checkPasscode(record, '1234', lockout.attempts, 1000 + LOCKOUT_MS).ok, true);
});

test('passcode entry waits for the delay after it is requested', () => {
  assert.equal(passcodeDelayRemainingMs(0, 5000), PASSCODE_DELAY_MS);
  assert.equal(passcodeDelayRemainingMs(1000, 1000), PASSCODE_DELAY_MS);
  assert.equal(passcodeDelayRemainingMs(1000, 1000 + PASSCODE_DELAY_MS - 1), 1);
  assert.equal(passcodeDelayRemainingMs(1000, 1000 + PASSCODE_DELAY_MS), 0);
  assert.equal(passcodeDelayRemainingMs(1000, 1000 + PASSCODE_DELAY_MS * 10), 0);
});

test('checkCode shares attempts and lockout across code types', () => {
  let attempts = NO_FAILURES;
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) attempts = checkCode(() => false, attempts, 1000).attempts;
  const lockout = checkPasscode(record, '0000', attempts, 1000);
  assert.equal(lockout.reason, 'locked-out');
  let called = false;
  const during = checkCode(() => (called = true), lockout.attempts, 1001);
  assert.deepEqual([during.reason, called], ['locked-out', false]);
});
