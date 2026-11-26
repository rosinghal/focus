const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NUDGE_AFTER_MS,
  NO_UNFOCUSED,
  trackUnfocused,
  isNudgeDue,
  markNudged,
  unfocusedMinutes,
  unfocusedTitle,
} = require('../src/nudge');
const { MAX_TICK_GAP_MS, AWAY_IDLE_SECONDS } = require('../src/report');

const START = new Date(2026, 10, 26, 10).getTime();
const MIN = 60 * 1000;
const ACTIVE = { modes: [], idleSeconds: 0, screenLocked: false };

const ticks = (unfocused, count, options = ACTIVE) =>
  Array.from({ length: count }, (_, i) => unfocused.at + (i + 1) * 5000).reduce(
    (current, now) => trackUnfocused(current, { now, ...options }),
    unfocused,
  );

const begin = () => trackUnfocused(NO_UNFOCUSED, { now: START, ...ACTIVE });

test('active time outside every mode adds up', () => {
  assert.equal(begin().ms, 0);
  assert.equal(ticks(begin(), 12).ms, MIN);
});

test('a short pause stops the count without resetting it', () => {
  const worked = ticks(begin(), 12);
  const paused = ticks(worked, 12, { ...ACTIVE, idleSeconds: 60 });
  assert.equal(paused.ms, MIN);
});

test('any mode, including a meeting, resets the count', () => {
  const worked = ticks(begin(), 12);
  for (const mode of ['focus', 'break', 'entertainment', 'kid', 'meeting', 'unlocked']) {
    assert.equal(ticks(worked, 1, { ...ACTIVE, modes: [mode] }).ms, 0, mode);
  }
});

test('leaving the Mac, a locked screen or sleep resets the count', () => {
  const worked = ticks(begin(), 12);
  assert.equal(ticks(worked, 1, { ...ACTIVE, idleSeconds: AWAY_IDLE_SECONDS }).ms, 0);
  assert.equal(ticks(worked, 1, { ...ACTIVE, screenLocked: true }).ms, 0);
  assert.equal(trackUnfocused(worked, { now: worked.at + MAX_TICK_GAP_MS + 1, ...ACTIVE }).ms, 0);
});

test('the nudge is due after ten minutes and again ten minutes after the last one', () => {
  const nine = ticks(begin(), 12 * 9);
  assert.equal(isNudgeDue(nine), false);
  const ten = ticks(nine, 12);
  assert.equal(ten.ms, NUDGE_AFTER_MS);
  assert.equal(isNudgeDue(ten), true);
  const nudged = markNudged(ten);
  assert.equal(isNudgeDue(nudged), false);
  assert.equal(isNudgeDue(ticks(nudged, 12 * 9)), false);
  assert.equal(isNudgeDue(ticks(nudged, 12 * 10)), true);
});

test('a reset clears the last nudge too', () => {
  const nudged = markNudged(ticks(begin(), 12 * 10));
  const reset = ticks(nudged, 1, { ...ACTIVE, modes: ['meeting'] });
  assert.equal(reset.nudgedMs, 0);
});

test('the tray title shows whole unfocused minutes', () => {
  assert.equal(unfocusedTitle(begin()), '');
  assert.equal(unfocusedTitle(ticks(begin(), 11)), '');
  const twelve = ticks(begin(), 12 * 12 + 6);
  assert.equal(unfocusedMinutes(twelve), 12);
  assert.equal(unfocusedTitle(twelve), '○ 12m');
});
