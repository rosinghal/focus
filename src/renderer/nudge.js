const $ = (id) => document.getElementById(id);

$('close').addEventListener('click', () => window.close());
$('later').addEventListener('click', () => window.close());
$('start').addEventListener('click', () => window.focusLock.startFromNudge());

window.focusLock.nudgeStatus().then((status) => {
  if (status?.kind === 'meeting') $('title').textContent = 'Meeting over. Start a pomodoro?';
  else if (status?.minutes) $('title').textContent = `No pomodoro for ${status.minutes} minutes`;
});
