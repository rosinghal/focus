const { ACTIVE_IDLE_SECONDS } = require('./schedule');

// A longer gap between ticks means the Mac slept or the app was frozen; that time isn't counted.
const MAX_TICK_GAP_MS = 30 * 1000;
// Past this the user has left the Mac, though it may stay awake. A meeting still counts: you can listen without typing.
const AWAY_IDLE_SECONDS = 5 * 60;

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

const emptyDay = (now) => ({ at: now, ms: {}, meetings: 0, inMeeting: false });

const addMs = (ms, key, delta) => ({ ...ms, [key]: (ms[key] ?? 0) + delta });

// Time outside every mode counts only while the user is active.
const countedModes = ({ modes, idleSeconds, screenLocked }) => {
  if (screenLocked) return [];
  if (idleSeconds >= AWAY_IDLE_SECONDS) return modes.filter((mode) => mode === 'meeting');
  if (modes.length) return modes;
  return idleSeconds < ACTIVE_IDLE_SECONDS ? ['none'] : [];
};

const trackTick = (day, { now, modes, idleSeconds, screenLocked }) => {
  const current = day && sameDay(day.at, now) ? day : emptyDay(now);
  const gap = now - current.at;
  const delta = day && current === day && gap > 0 && gap <= MAX_TICK_GAP_MS ? gap : 0;
  const counted = delta ? countedModes({ modes, idleSeconds, screenLocked }) : [];
  let ms = counted.reduce((sum, mode) => addMs(sum, mode, delta), current.ms);
  if (counted.length) ms = addMs(ms, 'active', delta);
  const inMeeting = modes.includes('meeting');
  return { at: now, ms, meetings: current.meetings + (inMeeting && !current.inMeeting ? 1 : 0), inMeeting };
};

const minutes = (ms) => Math.round((ms ?? 0) / 60000);

// Minutes come from tracked ticks rather than the logs' start and end times, so sleep and time away don't count.
const dailyReport = ({ day, pomodoroLog, sessionLog, now }) => {
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
      focusMinutes: minutes(ms.focus),
      breakMinutes: minutes(ms.break),
      averageReview: reviewed.length
        ? Math.round((reviewed.reduce((sum, entry) => sum + entry.review.level, 0) / reviewed.length) * 10) / 10
        : null,
      tasks: [...new Set(pomodoros.map((entry) => entry.task.name))],
    },
    entertainment: {
      sessions: sessions.length,
      minutes: minutes(ms.entertainment),
    },
    kidMinutes: minutes(ms.kid),
    meeting: { count: today.meetings, minutes: minutes(ms.meeting) },
    unlockedMinutes: minutes(ms.unlocked),
  };
};

module.exports = { MAX_TICK_GAP_MS, AWAY_IDLE_SECONDS, trackTick, dailyReport };
