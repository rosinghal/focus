const { ACTIVE_IDLE_SECONDS } = require('./schedule');
const { MAX_TICK_GAP_MS, AWAY_IDLE_SECONDS } = require('./report');

const NUDGE_AFTER_MS = 10 * 60 * 1000;

const NO_UNFOCUSED = { at: 0, ms: 0, nudgedMs: 0 };

// Any mode (a meeting too), a locked screen, sleep or leaving the Mac starts the count again; a short pause only stops it.
const trackUnfocused = (unfocused, { now, modes, idleSeconds, screenLocked }) => {
  const gap = now - unfocused.at;
  const fresh = !unfocused.at || gap <= 0 || gap > MAX_TICK_GAP_MS;
  if (modes.length || screenLocked || idleSeconds >= AWAY_IDLE_SECONDS || fresh) return { ...NO_UNFOCUSED, at: now };
  return { ...unfocused, at: now, ms: unfocused.ms + (idleSeconds < ACTIVE_IDLE_SECONDS ? gap : 0) };
};

const isNudgeDue = ({ ms, nudgedMs }) => ms - nudgedMs >= NUDGE_AFTER_MS;

const markNudged = (unfocused) => ({ ...unfocused, nudgedMs: unfocused.ms });

const unfocusedMinutes = ({ ms }) => Math.floor(ms / 60000);

const unfocusedTitle = (unfocused) => {
  const minutes = unfocusedMinutes(unfocused);
  return minutes ? `○ ${minutes}m` : '';
};

module.exports = {
  NUDGE_AFTER_MS,
  NO_UNFOCUSED,
  trackUnfocused,
  isNudgeDue,
  markNudged,
  unfocusedMinutes,
  unfocusedTitle,
};
