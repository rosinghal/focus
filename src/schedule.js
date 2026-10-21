const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isValidTime = (hhmm) => typeof hhmm === 'string' && TIME_PATTERN.test(hhmm);

const toMinutes = (hhmm) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

const minutesOfDay = (date) => date.getHours() * 60 + date.getMinutes();

const isMinuteInBlockWindow = (now, { start, end }) => {
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
};

const isInBlockWindow = (date, schedule) => isMinuteInBlockWindow(minutesOfDay(date), schedule);

const MINUTES_PER_DAY = 24 * 60;

const scheduleLoosened = (before, after) =>
  Array.from({ length: MINUTES_PER_DAY }, (_, minute) => minute).some(
    (minute) => isMinuteInBlockWindow(minute, before) && !isMinuteInBlockWindow(minute, after),
  );

const isBypassActive = (nowMs, bypassUntil) => Boolean(bypassUntil) && nowMs < bypassUntil;

const shouldLock = ({ now, schedule, bypassUntil }) =>
  isInBlockWindow(now, schedule) && !isBypassActive(now.getTime(), bypassUntil);

const blockPeriodStart = (date, schedule) => {
  if (!isInBlockWindow(date, schedule)) return null;
  const [hours, minutes] = schedule.start.split(':').map(Number);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes);
  if (start > date) start.setDate(start.getDate() - 1);
  return start.getTime();
};

// Like Screen Time, "One More Minute" can be used once per focus period.
const isGraceAvailable = ({ now, schedule, graceUsedAt }) => {
  const periodStart = blockPeriodStart(now, schedule);
  return periodStart !== null && !(graceUsedAt >= periodStart);
};

const countdownEnd = ({ now, schedule, bypassUntil, sessionUntil, pomodoroUntil = 0 }) => {
  const ends = [];
  if (shouldLock({ now, schedule, bypassUntil: 0 }) && isBypassActive(now.getTime(), bypassUntil)) ends.push(bypassUntil);
  if (sessionUntil > now.getTime()) ends.push(sessionUntil);
  if (pomodoroUntil > now.getTime()) ends.push(pomodoroUntil);
  return ends.length ? Math.min(...ends) : null;
};

const formatCountdown = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const formatTime = (hhmm) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

module.exports = {
  isValidTime,
  toMinutes,
  isInBlockWindow,
  scheduleLoosened,
  isBypassActive,
  shouldLock,
  blockPeriodStart,
  isGraceAvailable,
  formatTime,
  countdownEnd,
  formatCountdown,
};
