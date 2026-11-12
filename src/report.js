// A longer gap between ticks means the Mac slept or the app was frozen; that time isn't counted.
const MAX_TICK_GAP_MS = 30 * 1000;

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

const emptyDay = (now) => ({ at: now, ms: {}, meetings: 0, inMeeting: false });

const addMs = (ms, key, delta) => ({ ...ms, [key]: (ms[key] ?? 0) + delta });

// `modes` are the modes active during this tick; time outside every mode counts only while the user is active.
const trackTick = (day, { now, modes, active }) => {
  const current = day && sameDay(day.at, now) ? day : emptyDay(now);
  const gap = now - current.at;
  const delta = day && current === day && gap > 0 && gap <= MAX_TICK_GAP_MS ? gap : 0;
  const counted = !delta ? [] : modes.length ? modes : active ? ['none'] : [];
  let ms = counted.reduce((sum, mode) => addMs(sum, mode, delta), current.ms);
  if (counted.length) ms = addMs(ms, 'active', delta);
  const inMeeting = modes.includes('meeting');
  return { at: now, ms, meetings: current.meetings + (inMeeting && !current.inMeeting ? 1 : 0), inMeeting };
};

const minutes = (ms) => Math.round((ms ?? 0) / 60000);

// `runningFocusMs` is the focus so far of a pomodoro still running, which isn't in the log yet.
const dailyReport = ({ day, pomodoroLog, sessionLog, runningFocusMs = 0, now }) => {
  const today = day && sameDay(day.at, now) ? day : emptyDay(now);
  const { ms } = today;
  const pomodoros = pomodoroLog.filter((entry) => sameDay(entry.at, now));
  const sessions = sessionLog.filter((entry) => sameDay(entry.start, now));
  const reviewed = pomodoros.filter((entry) => entry.review);
  return {
    date: now,
    activeMinutes: minutes(ms.active),
    noModeMinutes: minutes(ms.none),
    pomodoro: {
      completed: pomodoros.filter((entry) => entry.completed).length,
      stopped: pomodoros.filter((entry) => !entry.completed).length,
      focusMinutes: minutes(pomodoros.reduce((sum, entry) => sum + entry.focusedMs, runningFocusMs)),
      breakMinutes: minutes(ms.break),
      averageReview: reviewed.length
        ? Math.round((reviewed.reduce((sum, entry) => sum + entry.review.level, 0) / reviewed.length) * 10) / 10
        : null,
      tasks: [...new Set(pomodoros.map((entry) => entry.task.name))],
    },
    entertainment: {
      sessions: sessions.length,
      minutes: minutes(sessions.reduce((sum, entry) => sum + Math.max(0, Math.min(entry.end, now) - entry.start), 0)),
    },
    kidMinutes: minutes(ms.kid),
    meeting: { count: today.meetings, minutes: minutes(ms.meeting) },
    unlockedMinutes: minutes(ms.unlocked),
  };
};

module.exports = { MAX_TICK_GAP_MS, trackTick, dailyReport };
