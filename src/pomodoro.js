const FOCUS_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;

const startPomodoro = (task, now) => ({ phase: 'focus', startedAt: now, until: now + FOCUS_MS, task });

const isPomodoroActive = (pomodoro, now) => Boolean(pomodoro) && pomodoro.until > now;

const isFocusing = (pomodoro, now) => isPomodoroActive(pomodoro, now) && pomodoro.phase === 'focus';

// Returns the next pomodoro (or null when it is over) and which phase just ended, if any.
const advancePomodoro = (pomodoro, now) => {
  if (!pomodoro || pomodoro.until > now) return { pomodoro, ended: null };
  if (pomodoro.phase === 'focus') {
    return { pomodoro: { ...pomodoro, phase: 'break', until: pomodoro.until + BREAK_MS }, ended: 'focus' };
  }
  return { pomodoro: null, ended: 'break' };
};

// Pomodoros saved before `startedAt` existed are dated back from `until`.
const focusStart = (pomodoro) =>
  pomodoro.startedAt ?? pomodoro.until - FOCUS_MS - (pomodoro.phase === 'break' ? BREAK_MS : 0);

const focusedMs = (pomodoro, now) =>
  pomodoro.phase === 'focus' ? Math.max(0, Math.min(now, pomodoro.until) - focusStart(pomodoro)) : FOCUS_MS;

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

const todayTotals = (log, now) => {
  const today = log.filter((entry) => sameDay(entry.at, now));
  return {
    count: today.filter((entry) => entry.completed).length,
    focusedMs: today.reduce((sum, entry) => sum + entry.focusedMs, 0),
  };
};

// Ends the focus part of a pomodoro: logs it (keeping only today's entries) and builds the summary to show.
const finishFocus = (pomodoro, log, now, completed) => {
  const focused = focusedMs(pomodoro, now);
  const startedAt = focusStart(pomodoro);
  const nextLog = [...log.filter((entry) => sameDay(entry.at, now)), { at: now, focusedMs: focused, completed }];
  return {
    log: nextLog,
    summary: {
      completed,
      taskCompleted: false,
      task: pomodoro.task,
      startedAt,
      endedAt: startedAt + focused,
      focusedMs: focused,
      today: todayTotals(nextLog, now),
    },
  };
};

const publicTask = (task) => (task ? { name: task.name } : null);

const publicSummary = (summary) => summary && { ...summary, task: publicTask(summary.task) };

const timerView = (pomodoro, summary, now) => {
  if (isPomodoroActive(pomodoro, now)) {
    const focus = pomodoro.phase === 'focus';
    return {
      mode: focus ? 'Pomodoro' : 'Break',
      until: pomodoro.until,
      task: publicTask(pomodoro.task),
      summary: focus ? null : publicSummary(summary),
    };
  }
  if (!summary) return null;
  return {
    mode: summary.completed ? 'Pomodoro complete' : 'Pomodoro stopped',
    until: null,
    task: publicTask(summary.task),
    summary: publicSummary(summary),
  };
};

module.exports = {
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
};
