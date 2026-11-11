const $ = (id) => document.getElementById(id);

$('close').addEventListener('click', () => window.close());
$('back').addEventListener('click', () => window.focusLock.backToMeeting());
$('presenting').addEventListener('click', () => window.focusLock.presenting());

$('fullscreen').addEventListener('click', async () => {
  $('fullscreen').disabled = true;
  const result = await window.focusLock.fullScreen();
  if (result.ok) return;
  $('fullscreen').disabled = false;
  $('text').textContent =
    result.reason === 'permission'
      ? 'Allow Focus under Accessibility, then try again.'
      : "Couldn't go full screen. Try the shortcut.";
});

window.focusLock.reminderStatus().then((status) => {
  if (status?.kind === 'fullscreen') {
    $('title').textContent = "Meeting isn't full screen";
    $('text').textContent = `Fewer distractions in full screen (${status.keys}).`;
    $('fullscreen').classList.remove('hidden');
    return;
  }
  $('title').textContent = status ? `You're in a ${status.meeting} meeting` : "You're in a meeting";
  $('back').classList.remove('hidden');
});
