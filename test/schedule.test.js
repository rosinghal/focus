const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidTime,
  isInBlockWindow,
  shouldLock,
  blockPeriodStart,
  isGraceAvailable,
  formatTime,
  scheduleLoosened,
  countdownEnd,
  formatCountdown,
} = require('../src/schedule');

const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 9, 8, h, m);
};

const overnight = { start: '20:00', end: '08:00' };

test('overnight window blocks evenings and early mornings', () => {
  assert.equal(isInBlockWindow(at('20:00'), overnight), true);
  assert.equal(isInBlockWindow(at('23:59'), overnight), true);
  assert.equal(isInBlockWindow(at('00:00'), overnight), true);
  assert.equal(isInBlockWindow(at('07:59'), overnight), true);
});

test('overnight window allows daytime', () => {
  assert.equal(isInBlockWindow(at('08:00'), overnight), false);
  assert.equal(isInBlockWindow(at('12:00'), overnight), false);
  assert.equal(isInBlockWindow(at('19:59'), overnight), false);
});

test('same-day window', () => {
  const lunch = { start: '12:00', end: '13:00' };
  assert.equal(isInBlockWindow(at('11:59'), lunch), false);
  assert.equal(isInBlockWindow(at('12:30'), lunch), true);
  assert.equal(isInBlockWindow(at('13:00'), lunch), false);
});

test('identical start and end never blocks', () => {
  assert.equal(isInBlockWindow(at('09:00'), { start: '09:00', end: '09:00' }), false);
});

test('active bypass prevents locking until it expires', () => {
  const now = at('21:00');
  const schedule = overnight;
  assert.equal(shouldLock({ now, schedule, bypassUntil: 0 }), true);
  assert.equal(shouldLock({ now, schedule, bypassUntil: now.getTime() + 1 }), false);
  assert.equal(shouldLock({ now, schedule, bypassUntil: now.getTime() }), true);
  assert.equal(shouldLock({ now: at('10:00'), schedule, bypassUntil: 0 }), false);
});

test('blockPeriodStart finds the start of the current overnight period', () => {
  assert.equal(blockPeriodStart(at('22:00'), overnight), at('20:00').getTime());
  const yesterday8pm = at('20:00');
  yesterday8pm.setDate(yesterday8pm.getDate() - 1);
  assert.equal(blockPeriodStart(at('03:00'), overnight), yesterday8pm.getTime());
  assert.equal(blockPeriodStart(at('12:00'), overnight), null);
});

test('One More Minute is available once per focus period', () => {
  const schedule = overnight;
  assert.equal(isGraceAvailable({ now: at('21:00'), schedule, graceUsedAt: 0 }), true);
  assert.equal(isGraceAvailable({ now: at('23:00'), schedule, graceUsedAt: at('21:00').getTime() }), false);

  const lastNight = at('22:00');
  lastNight.setDate(lastNight.getDate() - 1);
  assert.equal(isGraceAvailable({ now: at('21:00'), schedule, graceUsedAt: lastNight.getTime() }), true);
  assert.equal(isGraceAvailable({ now: at('03:00'), schedule, graceUsedAt: lastNight.getTime() }), false);
  assert.equal(isGraceAvailable({ now: at('12:00'), schedule, graceUsedAt: 0 }), false);
});

test('isValidTime', () => {
  assert.equal(isValidTime('20:00'), true);
  assert.equal(isValidTime('08:05'), true);
  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidTime('8:00'), false);
  assert.equal(isValidTime(undefined), false);
});

test('formatTime renders 12-hour clock', () => {
  assert.equal(formatTime('08:00'), '8:00 AM');
  assert.equal(formatTime('20:05'), '8:05 PM');
  assert.equal(formatTime('00:00'), '12:00 AM');
  assert.equal(formatTime('12:30'), '12:30 PM');
});

test('scheduleLoosened is true only when a blocked minute becomes unblocked', () => {
  const night = { start: '20:00', end: '08:00' };
  assert.equal(scheduleLoosened(night, night), false);
  assert.equal(scheduleLoosened(night, { start: '19:30', end: '08:30' }), false);
  assert.equal(scheduleLoosened(night, { start: '20:01', end: '08:00' }), true);
  assert.equal(scheduleLoosened(night, { start: '20:00', end: '07:59' }), true);
  assert.equal(scheduleLoosened(night, { start: '08:00', end: '20:00' }), true);
  assert.equal(scheduleLoosened({ start: '13:00', end: '14:00' }, night), true);
});

test('formatCountdown shows minutes and seconds left, rounded up', () => {
  assert.equal(formatCountdown(25 * 60 * 1000), '25:00');
  assert.equal(formatCountdown(61 * 1000 - 1), '1:01');
  assert.equal(formatCountdown(9000), '0:09');
  assert.equal(formatCountdown(-5000), '0:00');
});

test('countdownEnd picks the unlock or mode that ends first', () => {
  const night = { start: '20:00', end: '08:00' };
  const now = new Date(2026, 9, 20, 22, 0);
  const t = now.getTime();
  const minutes = (n) => t + n * 60000;
  assert.equal(countdownEnd({ now, schedule: night, bypassUntil: 0, sessionUntil: 0 }), null);
  assert.equal(countdownEnd({ now, schedule: night, bypassUntil: minutes(15), sessionUntil: 0 }), minutes(15));
  assert.equal(countdownEnd({ now, schedule: night, bypassUntil: 0, sessionUntil: minutes(25) }), minutes(25));
  assert.equal(countdownEnd({ now, schedule: night, bypassUntil: minutes(15), sessionUntil: minutes(10) }), minutes(10));
  assert.equal(countdownEnd({ now, schedule: night, bypassUntil: minutes(-1), sessionUntil: 0 }), null);
  assert.equal(countdownEnd({ now, schedule: night, bypassUntil: minutes(15), sessionUntil: 0, pomodoroUntil: minutes(5) }), minutes(5));
  assert.equal(countdownEnd({ now, schedule: night, bypassUntil: 0, sessionUntil: 0, pomodoroUntil: minutes(-1) }), null);
  const day = new Date(2026, 9, 20, 12, 0);
  assert.equal(countdownEnd({ now: day, schedule: night, bypassUntil: day.getTime() + 60000, sessionUntil: 0 }), null);
});
