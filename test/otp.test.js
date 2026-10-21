const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OTP_LENGTH,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  formatOtp,
  createOtpRecord,
  isOtpActive,
  otpMatches,
  resendRemainingMs,
  otpMessage,
  settingsOtpMessage,
} = require('../src/otp');

const record = createOtpRecord('042917', 'salt', 1000);

test('formatOtp pads to the code length', () => {
  assert.equal(formatOtp(42), '000042');
  assert.equal(formatOtp(999999).length, OTP_LENGTH);
});

test('record stores a hash, not the code', () => {
  assert.equal(JSON.stringify(record).includes('042917'), false);
  assert.equal(record.expiresAt, 1000 + OTP_TTL_MS);
});

test('otpMatches accepts the right code while active', () => {
  assert.equal(otpMatches(record, '042917', 1000), true);
  assert.equal(otpMatches(record, '042918', 1000), false);
  assert.equal(otpMatches(record, '42917', 1000), false);
  assert.equal(otpMatches(record, 42917, 1000), false);
  assert.equal(otpMatches(null, '042917', 1000), false);
});

test('otp expires after its time to live', () => {
  assert.equal(isOtpActive(record, 1000 + OTP_TTL_MS - 1), true);
  assert.equal(isOtpActive(record, 1000 + OTP_TTL_MS), false);
  assert.equal(otpMatches(record, '042917', 1000 + OTP_TTL_MS), false);
});

test('resend waits for the cooldown', () => {
  assert.equal(resendRemainingMs(null, 1000), 0);
  assert.equal(resendRemainingMs(record, 1000), RESEND_COOLDOWN_MS);
  assert.equal(resendRemainingMs(record, 1000 + RESEND_COOLDOWN_MS), 0);
});

test('otpMessage includes the code and minutes', () => {
  const message = otpMessage('042917', 15);
  assert.match(message, /042917/);
  assert.match(message, /15 more minutes/);
});

test('settingsOtpMessage lists the changes and the code', () => {
  const message = settingsOtpMessage('123456', ['Unblock sites: reddit.com', 'Change the passcode']);
  assert.match(message, /• Unblock sites: reddit\.com\n• Change the passcode/);
  assert.match(message, /123456/);
});
