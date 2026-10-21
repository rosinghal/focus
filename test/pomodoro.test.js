const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FOCUS_MS,
  BREAK_MS,
  startPomodoro,
  isPomodoroActive,
  isFocusing,
  advancePomodoro,
  focusedMs,
  todayTotals,
  finishFocus,
  timerView,
} = require('../src/pomodoro');

const task = { id: '1', name: 'Write report', url: 'https://app.clickup.com/t/1' };

test('a pomodoro starts with focus on the task', () => {
  const pomodoro = startPomodoro(task, 1000);
  assert.deepEqual(pomodoro, { phase: 'focus', startedAt: 1000, until: 1000 + FOCUS_MS, task });
  assert.equal(isFocusing(pomodoro, 1000), true);
  assert.equal(isPomodoroActive(null, 1000), false);
});

test('focus turns into a break, then the pomodoro ends', () => {
  const focus = startPomodoro(task, 0);
  assert.deepEqual(advancePomodoro(focus, FOCUS_MS - 1), { pomodoro: focus, ended: null });

  const { pomodoro: rest, ended } = advancePomodoro(focus, FOCUS_MS + 2000);
  assert.equal(ended, 'focus');
  assert.deepEqual(rest, { phase: 'break', startedAt: 0, until: FOCUS_MS + BREAK_MS, task });
  assert.equal(isFocusing(rest, FOCUS_MS), false);
  assert.equal(isPomodoroActive(rest, FOCUS_MS), true);

  assert.deepEqual(advancePomodoro(rest, FOCUS_MS + BREAK_MS), { pomodoro: null, ended: 'break' });
  assert.deepEqual(advancePomodoro(null, 0), { pomodoro: null, ended: null });
});

const at = (hour, minute = 0) => new Date(2026, 9, 21, hour, minute).getTime();
const minutes = (n) => n * 60000;

test('focusedMs counts up to the end of focus, and a break means focus finished', () => {
  const focus = startPomodoro(task, at(9));
  assert.equal(focusedMs(focus, at(9, 10)), minutes(10));
  assert.equal(focusedMs(focus, at(11)), FOCUS_MS);
  assert.equal(focusedMs({ ...focus, phase: 'break' }, at(9, 27)), FOCUS_MS);
  const legacy = { phase: 'focus', until: at(9, 25), task };
  assert.equal(focusedMs(legacy, at(9, 5)), minutes(5));
});

test('todayTotals counts completed pomodoros and all focused time today', () => {
  const log = [
    { at: at(9), focusedMs: minutes(25), completed: true },
    { at: at(10), focusedMs: minutes(7), completed: false },
    { at: new Date(2026, 9, 20, 22).getTime(), focusedMs: minutes(25), completed: true },
  ];
  assert.deepEqual(todayTotals(log, at(12)), { count: 1, focusedMs: minutes(32) });
});

test('finishFocus logs the pomodoro, drops earlier days and summarises it', () => {
  const old = [{ at: new Date(2026, 9, 20, 22).getTime(), focusedMs: minutes(25), completed: true }];
  const done = finishFocus(startPomodoro(task, at(9)), old, at(9, 25), true);
  assert.deepEqual(done.log, [{ at: at(9, 25), focusedMs: FOCUS_MS, completed: true }]);
  assert.deepEqual(done.summary, {
    completed: true,
    taskCompleted: false,
    task,
    startedAt: at(9),
    endedAt: at(9, 25),
    focusedMs: FOCUS_MS,
    today: { count: 1, focusedMs: FOCUS_MS },
  });
  const stopped = finishFocus(startPomodoro(task, at(10)), done.log, at(10, 12), false);
  assert.equal(stopped.summary.endedAt, at(10, 12));
  assert.deepEqual(stopped.summary.today, { count: 1, focusedMs: FOCUS_MS + minutes(12) });
});

test('timerView shows focus, then break with the summary, then the summary alone', () => {
  const focus = startPomodoro(task, at(9));
  assert.deepEqual(timerView(focus, null, at(9, 1)), {
    mode: 'Pomodoro',
    until: at(9, 25),
    task: { name: 'Write report' },
    summary: null,
  });
  const { summary } = finishFocus(focus, [], at(9, 25), true);
  const rest = advancePomodoro(focus, at(9, 25)).pomodoro;
  const breakView = timerView(rest, summary, at(9, 26));
  assert.equal(breakView.mode, 'Break');
  assert.deepEqual(breakView.summary.task, { name: 'Write report' });
  assert.equal(JSON.stringify(breakView).includes('clickup.com'), false);
  const doneView = timerView(null, summary, at(9, 31));
  assert.deepEqual([doneView.mode, doneView.until], ['Pomodoro complete', null]);
  assert.equal(timerView(null, { ...summary, completed: false }, at(9, 31)).mode, 'Pomodoro stopped');
  assert.equal(timerView(null, null, at(9, 31)), null);
});
