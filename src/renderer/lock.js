const $ = (id) => document.getElementById(id);
const isPrimary = new URLSearchParams(location.search).get('role') === 'primary';
const PASSCODE_LENGTH = 4;

let mode = 'passcode';
let codeLength = PASSCODE_LENGTH;
let status = null;
let entered = '';
let busy = false;
let lockoutTimer = null;
let lockoutUntil = 0;
let delayTimer = null;
let delayUntil = 0;
let resendTimer = null;

const renderClock = () => {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const renderDots = () => {
  if ($('dots').children.length !== codeLength) {
    $('dots').replaceChildren(...Array.from({ length: codeLength }, () => document.createElement('span')));
  }
  [...$('dots').children].forEach((dot, i) => dot.classList.toggle('filled', i < entered.length));
};

const setKeypadEnabled = (enabled) => {
  $('keypad').querySelectorAll('[data-digit], #delete').forEach((key) => (key.disabled = !enabled));
};

const refreshKeypad = () => setKeypadEnabled(Date.now() >= lockoutUntil && Date.now() >= delayUntil);

const startLockout = (waitMs) => {
  clearInterval(lockoutTimer);
  lockoutUntil = Date.now() + waitMs;
  setKeypadEnabled(false);
  const render = () => {
    const seconds = Math.ceil((lockoutUntil - Date.now()) / 1000);
    if (seconds > 0) {
      $('error').textContent = `Too many attempts. Try again in ${seconds}s.`;
      return;
    }
    clearInterval(lockoutTimer);
    $('error').textContent = '';
    refreshKeypad();
  };
  render();
  lockoutTimer = setInterval(render, 250);
};

const stopDelay = () => {
  clearInterval(delayTimer);
  delayUntil = 0;
  $('delay').classList.add('hidden');
};

const startDelay = (waitMs) => {
  clearInterval(delayTimer);
  delayUntil = Date.now() + waitMs;
  setKeypadEnabled(false);
  $('delay').classList.remove('hidden');
  const render = () => {
    const seconds = Math.ceil((delayUntil - Date.now()) / 1000);
    if (seconds > 0) {
      $('delay').textContent = `Is it worth it? Keypad unlocks in ${seconds}s.`;
      return;
    }
    stopDelay();
    refreshKeypad();
  };
  render();
  delayTimer = setInterval(render, 250);
};

const shake = () => {
  $('dots').classList.remove('shake');
  void $('dots').offsetWidth;
  $('dots').classList.add('shake');
};

const showPasscode = (visible) => {
  $('choices').classList.toggle('hidden', visible);
  $('passcode').classList.toggle('hidden', !visible);
  entered = '';
  renderDots();
};

const startResendCountdown = (waitMs) => {
  clearInterval(resendTimer);
  const until = Date.now() + waitMs;
  $('resend').classList.remove('hidden');
  const render = () => {
    const seconds = Math.ceil((until - Date.now()) / 1000);
    $('resend').disabled = seconds > 0;
    $('resend').textContent = seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code';
    if (seconds <= 0) clearInterval(resendTimer);
  };
  render();
  resendTimer = setInterval(render, 250);
};

const sendOtp = async () => {
  $('ask').disabled = $('resend').disabled = true;
  $('error').textContent = '';
  const result = await window.focusLock.sendOtp();
  $('ask').disabled = false;
  if (result.resendMs) startResendCountdown(result.resendMs);
  else $('resend').disabled = false;
  if (!result.ok) {
    $('error').textContent = result.error ?? 'Could not send the code.';
    if ($('passcode').classList.contains('hidden')) $('otp-note').textContent = $('error').textContent;
    return false;
  }
  status.otpPending = true;
  return true;
};

const openOtp = async () => {
  if (!$('passcode').classList.contains('hidden')) return;
  if (!status.otpPending && !(await sendOtp())) return;
  showPasscode(true);
};

const openPasscode = async () => {
  if (mode === 'otp') return openOtp();
  if (!$('passcode').classList.contains('hidden')) return;
  showPasscode(true);
  setKeypadEnabled(false);
  const { waitMs } = await window.focusLock.requestPasscode();
  if (!$('passcode').classList.contains('hidden')) startDelay(waitMs);
};

const closePasscode = () => {
  stopDelay();
  showPasscode(false);
};

const submit = async () => {
  busy = true;
  const result = mode === 'otp'
    ? await window.focusLock.submitOtp(entered)
    : await window.focusLock.submitPasscode(entered);
  busy = false;
  if (result.ok) return;
  entered = '';
  renderDots();
  shake();
  const noun = mode === 'otp' ? 'code' : 'passcode';
  if (result.reason === 'locked-out') startLockout(result.waitMs);
  else if (result.reason === 'too-soon') startDelay(result.waitMs);
  else if (result.reason === 'expired') {
    status.otpPending = false;
    $('error').textContent = 'That code expired. Send a new one.';
  } else if (result.reason === 'used') $('error').textContent = 'The passcode was already used tonight.';
  else $('error').textContent = `Wrong ${noun}. ${plural(result.attemptsLeft, 'attempt')} left.`;
};

const press = (digit) => {
  if (busy || entered.length >= codeLength || $('passcode').classList.contains('hidden')) return;
  if ($('keypad').querySelector('[data-digit]').disabled) return;
  entered += digit;
  renderDots();
  if (entered.length === codeLength) submit();
};

const backspace = () => {
  entered = entered.slice(0, -1);
  renderDots();
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const scoreClass = (night) => {
  if (!night.tracked) return 'untracked';
  if (night.perfect) return 'perfect';
  return night.score >= 90 ? 'good' : 'weak';
};

const renderNight = (night) => {
  const date = new Date(night.date);
  const column = document.createElement('div');
  column.className = `night ${scoreClass(night)}`;
  column.title = night.tracked
    ? `${date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}: ` +
      (night.unlocks ? `${plural(night.unlocks, 'unlock')}, ${night.unlockedMinutes} min` : 'no unlocks')
    : 'Not tracked yet';

  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('div');
  fill.className = 'fill';
  fill.style.height = `${night.tracked ? Math.max(night.score, 4) : 0}%`;
  bar.append(fill);

  const pct = Object.assign(document.createElement('span'), {
    className: 'pct',
    textContent: night.tracked ? (night.perfect ? '✓' : `${night.score}%`) : '–',
  });
  const day = Object.assign(document.createElement('span'), {
    className: 'day',
    textContent: date.toLocaleDateString([], { weekday: 'short' }),
  });
  column.append(pct, bar, day);
  return column;
};

const renderWeek = ({ week, motivation }) => {
  $('nights').replaceChildren(...week.nights.map(renderNight));
  $('week-stats').textContent = week.trackedNights
    ? [
        `${week.averageScore}% focused`,
        `${week.perfectNights}/${week.trackedNights} perfect`,
        week.streak ? `🔥 ${week.streak}-night streak` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  $('motivation').textContent = motivation;
  if (week.tonight) {
    $('tonight').textContent = week.tonight.unlocks
      ? `Tonight so far: ${plural(week.tonight.unlocks, 'unlock')} (${week.tonight.unlockedMinutes} min)`
      : 'Tonight so far: no unlocks';
  }
  $('week').classList.remove('hidden');
};

const renderUnlockMode = () => {
  mode = status.passcodeAvailable ? 'passcode' : 'otp';
  codeLength = mode === 'otp' ? status.otpLength : PASSCODE_LENGTH;
  const linked = status.whatsappStatus === 'linked';
  if (mode === 'passcode') {
    $('prompt').textContent = `Enter passcode for ${status.bypassMinutes} more minutes`;
    return;
  }
  $('ask').textContent = status.otpPending ? 'Enter WhatsApp Code' : 'Ask via WhatsApp';
  $('ask').disabled = !linked && !status.otpPending;
  $('otp-note').classList.remove('hidden');
  $('otp-note').textContent = linked || status.otpPending
    ? `Passcode already used tonight. A code goes to ${status.whatsappRecipient} on WhatsApp.`
    : 'Passcode already used tonight, and WhatsApp is not connected.';
  $('prompt').textContent = `Enter the code sent to ${status.whatsappRecipient} for ${status.bypassMinutes} more minutes`;
  if (status.resendMs > 0) startResendCountdown(status.resendMs);
  else if (status.otpPending) startResendCountdown(0);
};

const init = async () => {
  renderClock();
  setInterval(renderClock, 1000);

  status = await window.focusLock.status();
  renderWeek(status);

  if (!isPrimary) {
    $('choices').classList.add('hidden');
    return;
  }

  $('until').textContent = `Unlocks automatically at ${status.unlocksAt}`;
  renderUnlockMode();
  window.focusLock.onWhatsAppUpdate(({ status: whatsappStatus }) => {
    status.whatsappStatus = whatsappStatus;
    renderUnlockMode();
  });
  $('grace').classList.toggle('hidden', !status.graceAvailable);
  if (status.lockoutMs > 0) startLockout(status.lockoutMs);

  $('grace').addEventListener('click', () => {
    $('grace').disabled = true;
    window.focusLock.oneMoreMinute();
  });
  $('ask').addEventListener('click', openPasscode);
  $('cancel').addEventListener('click', closePasscode);
  $('resend').addEventListener('click', sendOtp);
  $('delete').addEventListener('click', backspace);
  $('keypad').addEventListener('click', (event) => {
    const digit = event.target.dataset?.digit;
    if (digit) press(digit);
  });

  document.addEventListener('keydown', (event) => {
    if (/^\d$/.test(event.key)) {
      if ($('passcode').classList.contains('hidden')) openPasscode();
      else press(event.key);
    } else if (event.key === 'Backspace') backspace();
    else if (event.key === 'Escape') closePasscode();
  });
};

init();
