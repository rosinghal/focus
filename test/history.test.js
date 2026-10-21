const test = require('node:test');
const assert = require('node:assert/strict');
const {
  KEEP_DAYS,
  blockDurationMs,
  createUnlockEvent,
  recordEvent,
  usedThisPeriod,
  endActiveUnlock,
  weeklySummary,
  motivation,
} = require('../src/history');

const schedule = { start: '20:00', end: '08:00' };
const NIGHT_MS = 12 * 60 * 60 * 1000;
const at = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 9, day, h, m);
};
const longAgo = at(1, '00:00').getTime();
const unlockAt = (day, hhmm, type = 'passcode', minutes = 15) =>
  createUnlockEvent({ type, now: at(day, hhmm), durationMs: minutes * 60000, schedule });

test('blockDurationMs handles overnight and same-day windows', () => {
  assert.equal(blockDurationMs(schedule), NIGHT_MS);
  assert.equal(blockDurationMs({ start: '12:00', end: '13:30' }), 90 * 60000);
});

test('an early-morning unlock belongs to the night that started the evening before', () => {
  const event = unlockAt(15, '02:00');
  assert.equal(event.periodStart, at(14, '20:00').getTime());
  assert.equal(event.periodEnd, at(15, '08:00').getTime());
});

test('recordEvent drops events older than the retention window', () => {
  const old = { ...unlockAt(1, '21:00'), at: at(1, '21:00').getTime() };
  const recent = unlockAt(1 + KEEP_DAYS + 1, '21:00');
  assert.deepEqual(recordEvent([old], recent), [recent]);
});

test('locking early trims the active unlock to the time actually used', () => {
  const earlier = unlockAt(14, '21:00');
  const active = unlockAt(14, '23:00');
  const ended = endActiveUnlock([earlier, active], active.at + 10 * 60000);
  assert.equal(ended[0], earlier);
  assert.deepEqual(ended[1], { ...active, durationMs: 10 * 60000, endedEarly: true });

  const week = weeklySummary({ history: ended, schedule, now: at(15, '21:00'), trackingSince: longAgo });
  assert.equal(week.nights[6].unlockedMinutes, 25);
});

test('locking early leaves history alone when no unlock is active', () => {
  const event = unlockAt(14, '23:00');
  const history = [event];
  assert.equal(endActiveUnlock(history, event.at + event.durationMs), history);
  assert.deepEqual(endActiveUnlock([], 0), []);
});

test('weekly summary covers the 7 completed nights before tonight', () => {
  const week = weeklySummary({ history: [], schedule, now: at(15, '22:00'), trackingSince: longAgo });
  assert.equal(week.nights.length, 7);
  assert.equal(week.nights[0].date, at(8, '20:00').getTime());
  assert.equal(week.nights[6].date, at(14, '20:00').getTime());
  assert.equal(week.tonight.date, at(15, '20:00').getTime());
  assert.deepEqual([week.averageScore, week.perfectNights, week.trackedNights], [100, 7, 7]);
});

test('scores nights by the share of time that stayed locked', () => {
  const history = [unlockAt(14, '21:00'), unlockAt(14, '23:00', 'grace', 1), unlockAt(12, '22:00')];
  const week = weeklySummary({ history, schedule, now: at(15, '21:00'), trackingSince: longAgo });
  const lastNight = week.nights[6];
  assert.deepEqual(
    [lastNight.unlocks, lastNight.passcodeUnlocks, lastNight.graceUsed, lastNight.unlockedMinutes, lastNight.perfect],
    [2, 1, true, 16, false],
  );
  assert.equal(lastNight.score, Math.round(100 * (1 - 16 / 720)));
  assert.equal(week.nights[4].unlocks, 1);
  assert.equal(week.perfectNights, 5);
  assert.equal(week.streak, 0);
});

test('access granted just before the night ends only counts until the end', () => {
  const history = [unlockAt(15, '07:55')];
  const week = weeklySummary({ history, schedule, now: at(15, '21:00'), trackingSince: longAgo });
  assert.equal(week.nights[6].unlockedMinutes, 5);
});

test('tonight is reported separately and not counted in the week', () => {
  const history = [unlockAt(15, '21:00')];
  const week = weeklySummary({ history, schedule, now: at(15, '21:30'), trackingSince: longAgo });
  assert.equal(week.tonight.unlocks, 1);
  assert.equal(week.perfectNights, 7);
});

test('during the day the most recent night counts as completed', () => {
  const week = weeklySummary({ history: [], schedule, now: at(15, '12:00'), trackingSince: longAgo });
  assert.equal(week.nights[6].date, at(14, '20:00').getTime());
  assert.equal(week.tonight, null);
});

test('nights before tracking started are not scored', () => {
  const trackingSince = at(13, '10:00').getTime();
  const week = weeklySummary({ history: [], schedule, now: at(15, '21:00'), trackingSince });
  assert.deepEqual(
    week.nights.map((night) => night.tracked),
    [false, false, false, false, false, true, true],
  );
  assert.equal(week.nights[0].score, null);
  assert.deepEqual([week.trackedNights, week.streak], [2, 2]);
});

test('streak counts consecutive perfect nights back from last night', () => {
  const history = [unlockAt(11, '21:00')];
  const week = weeklySummary({ history, schedule, now: at(15, '21:00'), trackingSince: longAgo });
  assert.equal(week.streak, 3);
});

test('motivation adapts to progress', () => {
  assert.match(motivation({ trackedNights: 0, averageScore: null, streak: 0 }), /first focus night/);
  assert.match(motivation({ trackedNights: 7, averageScore: 100, streak: 9 }), /9 perfect nights/);
  assert.match(motivation({ trackedNights: 7, averageScore: 99, streak: 3 }), /3-night streak/);
  assert.match(motivation({ trackedNights: 7, averageScore: 99, streak: 1 }), /two in a row/);
  assert.match(motivation({ trackedNights: 7, averageScore: 95, streak: 0 }), /Strong week/);
  assert.match(motivation({ trackedNights: 7, averageScore: 60, streak: 0 }), /fresh start/);
});

test('usedThisPeriod only counts the current night and the given type', () => {
  const history = [unlockAt(14, '22:00', 'passcode'), unlockAt(15, '01:00', 'grace', 1)];
  assert.equal(usedThisPeriod(history, 'passcode', at(15, '03:00'), schedule), true);
  assert.equal(usedThisPeriod(history, 'whatsapp', at(15, '03:00'), schedule), false);
  assert.equal(usedThisPeriod(history, 'passcode', at(15, '21:00'), schedule), false);
  assert.equal(usedThisPeriod(history, 'passcode', at(15, '12:00'), schedule), false);
});
