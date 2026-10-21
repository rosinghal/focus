const { createHash, timingSafeEqual } = require('node:crypto');

const OTP_LENGTH = 6;
const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_PATTERN = /^\d{6}$/;

const hashOtp = (code, salt) => createHash('sha256').update(`${salt}:${code}`).digest();

const formatOtp = (n) => String(n).padStart(OTP_LENGTH, '0');

const createOtpRecord = (code, salt, nowMs) => ({
  salt,
  hash: hashOtp(code, salt).toString('hex'),
  sentAt: nowMs,
  expiresAt: nowMs + OTP_TTL_MS,
});

const isOtpActive = (record, nowMs) => Boolean(record) && nowMs < record.expiresAt;

const otpMatches = (record, input, nowMs) =>
  isOtpActive(record, nowMs) &&
  typeof input === 'string' &&
  OTP_PATTERN.test(input) &&
  timingSafeEqual(Buffer.from(record.hash, 'hex'), hashOtp(input, record.salt));

const resendRemainingMs = (record, nowMs) =>
  record ? Math.max(0, record.sentAt + RESEND_COOLDOWN_MS - nowMs) : 0;

const otpMessage = (code, minutes) =>
  `Focus: someone wants ${minutes} more minutes on the computer during sleep hours. ` +
  `Unlock code: ${code} (valid ${OTP_TTL_MS / 60000} min). Only share it if it's worth it.`;

const settingsOtpMessage = (code, changes) =>
  `Focus: someone wants to loosen the settings:\n${changes.map((change) => `• ${change}`).join('\n')}\n` +
  `Approval code: ${code} (valid ${OTP_TTL_MS / 60000} min). Only share it if you agree.`;

module.exports = {
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
};
