const { toMinutes, blockPeriodStart } = require('./schedule');

const WEEK_NIGHTS = 7;
const KEEP_DAYS = 60;

const addDays = (ms, days) => {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

const dateKey = (ms) => {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const blockDurationMs = ({ start, end }) => (((toMinutes(end) - toMinutes(start)) + 1440) % 1440) * 60000;

const latestPeriodStart = (now, { start }) => {
  const [hours, minutes] = start.split(':').map(Number);
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  if (candidate > now) candidate.setDate(candidate.getDate() - 1);
  return candidate.getTime();
};

const createUnlockEvent = ({ type, now, durationMs, schedule }) => {
  const periodStart = blockPeriodStart(now, schedule) ?? now.getTime();
  return { type, at: now.getTime(), durationMs, periodStart, periodEnd: periodStart + blockDurationMs(schedule) };
};

const usedThisPeriod = (history, type, now, schedule) => {
  const periodStart = blockPeriodStart(now, schedule);
  return periodStart !== null && history.some((event) => event.type === type && event.periodStart === periodStart);
};

const recordEvent = (history, event) => [
  ...history.filter((entry) => entry.at >= addDays(event.at, -KEEP_DAYS)),
  event,
];

const endActiveUnlock = (history, nowMs) => {
  const last = history.at(-1);
  if (!last || nowMs >= last.at + last.durationMs) return history;
  return [...history.slice(0, -1), { ...last, durationMs: Math.max(0, nowMs - last.at), endedEarly: true }];
};

// Access granted near the end of a night only counts until the night ends.
const unlockedMs = (event) => Math.max(0, Math.min(event.at + event.durationMs, event.periodEnd) - event.at);

const summarizeNight = ({ periodStart, history, trackingSince, durationMs }) => {
  const events = history.filter((event) => dateKey(event.periodStart) === dateKey(periodStart));
  const tracked = Boolean(trackingSince) && periodStart + durationMs > trackingSince;
  const unlocked = events.reduce((total, event) => total + unlockedMs(event), 0);
  return {
    date: periodStart,
    tracked,
    unlocks: events.length,
    graceUsed: events.some((event) => event.type === 'grace'),
    passcodeUnlocks: events.filter((event) => event.type === 'passcode').length,
    unlockedMinutes: Math.round(unlocked / 60000),
    score: tracked ? Math.max(0, Math.round(100 * (1 - unlocked / durationMs))) : null,
    perfect: tracked && events.length === 0,
  };
};

const countStreak = ({ newest, history, trackingSince, durationMs }) => {
  let streak = 0;
  for (let i = 0; i < KEEP_DAYS; i++) {
    const night = summarizeNight({ periodStart: addDays(newest, -i), history, trackingSince, durationMs });
    if (!night.perfect) break;
    streak++;
  }
  return streak;
};

const weeklySummary = ({ history, schedule, now, trackingSince }) => {
  const durationMs = blockDurationMs(schedule);
  const latest = latestPeriodStart(now, schedule);
  const inProgress = now.getTime() < latest + durationMs;
  const newest = inProgress ? addDays(latest, -1) : latest;
  const context = { history, trackingSince, durationMs };
  const nights = Array.from({ length: WEEK_NIGHTS }, (_, i) =>
    summarizeNight({ ...context, periodStart: addDays(newest, i - (WEEK_NIGHTS - 1)) }),
  );
  const tracked = nights.filter((night) => night.tracked);
  return {
    nights,
    trackedNights: tracked.length,
    averageScore: tracked.length
      ? Math.round(tracked.reduce((total, night) => total + night.score, 0) / tracked.length)
      : null,
    perfectNights: tracked.filter((night) => night.perfect).length,
    streak: countStreak({ ...context, newest }),
    tonight: inProgress ? summarizeNight({ ...context, periodStart: latest }) : null,
  };
};

const motivation = ({ trackedNights, averageScore, streak }) => {
  if (!trackedNights) return 'Your first focus night. Make it count.';
  if (streak >= WEEK_NIGHTS) return `${streak} perfect nights in a row. Incredible discipline.`;
  if (streak >= 2) return `${streak}-night streak. Keep it going tonight.`;
  if (streak === 1) return 'Last night was perfect. Make it two in a row.';
  if (averageScore >= 90) return 'Strong week. Tonight can be a perfect one.';
  return 'Every night is a fresh start. Make tonight a perfect one.';
};

module.exports = {
  WEEK_NIGHTS,
  KEEP_DAYS,
  blockDurationMs,
  createUnlockEvent,
  recordEvent,
  usedThisPeriod,
  endActiveUnlock,
  weeklySummary,
  motivation,
};
