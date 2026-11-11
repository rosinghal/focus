const $ = (id) => document.getElementById(id);

$('close').addEventListener('click', () => window.close());
$('back').addEventListener('click', () => window.focusLock.backToMeeting());
$('presenting').addEventListener('click', () => window.focusLock.presenting());

window.focusLock.reminderStatus().then((status) => {
  if (status?.kind === 'fullscreen') {
    $('title').textContent = 'Go full screen';
    $('text').textContent = `Press ${status.keys} for fewer distractions.`;
    return;
  }
  $('title').textContent = status ? `You're in a ${status.meeting} meeting` : "You're in a meeting";
  $('back').classList.remove('hidden');
});
