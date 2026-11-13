const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_TICK_GAP_MS, AWAY_IDLE_SECONDS, trackTick, dailyReport } = require('../src/report');

const at = (hours, minutes = 0) => new Date(2026, 10, 12, hours, minutes).getTime();
const MIN = 60 * 1000;

const ticks = (day, from, count, options) =>
  Array.from({ length: count }, (_, i) => from + (i + 1) * 5000).reduce(
    (current, now) => trackTick(current, { now, ...options }),
    day,
  );

test('the first tick of a day starts it without counting time', () => {
  const day = trackTick(null, { now: at(9), modes: ['focus'], idleSeconds: 0 });
  assert.deepEqual(day.ms, {});
  assert.equal(day.at, at(9));
});

test('time goes to each active mode and to the active total', () => {
  const start = trackTick(null, { now: at(9), modes: [], idleSeconds: 0 });
  const day = ticks(start, at(9), 12, { modes: ['focus', 'meeting'], idleSeconds: 60 });
  assert.deepEqual(day.ms, { focus: MIN, meeting: MIN, active: MIN });
});

test('time outside every mode counts only while the user is active', () => {
  const start = trackTick(null, { now: at(9), modes: [], idleSeconds: 0 });
  const active = ticks(start, at(9), 12, { modes: [], idleSeconds: 0 });
  assert.deepEqual(active.ms, { none: MIN, active: MIN });
  const idle = ticks(active, at(9, 1), 12, { modes: [], idleSeconds: 60 });
  assert.deepEqual(idle.ms, active.ms);
});

test('once the user is away only a meeting counts', () => {
  const start = trackTick(null, { now: at(9), modes: [], idleSeconds: 0 });
  const day = ticks(start, at(9), 12, { modes: ['break', 'meeting'], idleSeconds: AWAY_IDLE_SECONDS });
  assert.deepEqual(day.ms, { meeting: MIN, active: MIN });
  const alone = ticks(day, at(9, 1), 12, { modes: ['entertainment'], idleSeconds: AWAY_IDLE_SECONDS });
  assert.deepEqual(alone.ms, day.ms);
});

test('nothing counts while the screen is locked', () => {
  const start = trackTick(null, { now: at(9), modes: [], idleSeconds: 0 });
  const day = ticks(start, at(9), 12, { modes: ['focus', 'meeting'], idleSeconds: 0, screenLocked: true });
  assert.deepEqual(day.ms, {});
});

test('a long gap between ticks, like sleep, is not counted', () => {
  const start = trackTick(null, { now: at(9), modes: [], idleSeconds: 0 });
  const day = trackTick(start, { now: at(9) + MAX_TICK_GAP_MS + 1, modes: [], idleSeconds: 0 });
  assert.deepEqual(day.ms, {});
});

test('a new day starts from zero', () => {
  const yesterday = { at: at(23, 59) - 24 * 60 * MIN, ms: { none: 5 * MIN }, meetings: 2, inMeeting: true };
  const day = trackTick(yesterday, { now: at(0), modes: ['meeting'], idleSeconds: 0 });
  assert.deepEqual(day, { at: at(0), ms: {}, meetings: 1, inMeeting: true });
});

test('a meeting is counted once while it lasts', () => {
  const start = trackTick(null, { now: at(9), modes: [], idleSeconds: 0 });
  const inMeeting = ticks(start, at(9), 3, { modes: ['meeting'], idleSeconds: 0 });
  const after = ticks(inMeeting, at(9) + 15000, 1, { modes: [], idleSeconds: 0 });
  const second = ticks(after, at(9) + 20000, 2, { modes: ['meeting'], idleSeconds: 0 });
  assert.equal(inMeeting.meetings, 1);
  assert.equal(second.meetings, 2);
});

test('the daily report takes minutes from tracked time and counts from the logs', () => {
  const ms = { active: 200 * MIN, none: 90 * MIN, focus: 40 * MIN, break: 10 * MIN, meeting: 45 * MIN, entertainment: 27 * MIN, kid: 0 };
  const day = { at: at(12), ms, meetings: 2 };
  const pomodoroLog = [
    { at: at(10), focusedMs: 25 * MIN, completed: true, task: { name: 'Write' }, review: { level: 8 } },
    { at: at(11), focusedMs: 10 * MIN, completed: false, task: { name: 'Write' }, review: { level: 5 } },
    { at: at(11) - 24 * 60 * MIN, focusedMs: 25 * MIN, completed: true, task: { name: 'Old' } },
  ];
  const sessionLog = [{ start: at(11, 30), end: at(11, 55) }, { start: at(11, 58), end: at(12, 23) }];
  const result = dailyReport({ day, pomodoroLog, sessionLog, now: at(12) });
  assert.deepEqual(result, {
    date: at(12),
    activeMinutes: 200,
    noModeMinutes: 90,
    pomodoro: { completed: 1, stopped: 1, focusMinutes: 40, breakMinutes: 10, averageReview: 6.5, tasks: ['Write'] },
    entertainment: { sessions: 2, minutes: 27 },
    kidMinutes: 0,
    meeting: { count: 2, minutes: 45 },
    unlockedMinutes: 0,
  });
});

test('a report from yesterday shows nothing tracked today', () => {
  const day = { at: at(12) - 24 * 60 * MIN, ms: { active: 60 * MIN }, meetings: 1 };
  const result = dailyReport({ day, pomodoroLog: [], sessionLog: [], now: at(12) });
  assert.equal(result.activeMinutes, 0);
  assert.equal(result.meeting.count, 0);
  assert.equal(result.pomodoro.averageReview, null);
});
