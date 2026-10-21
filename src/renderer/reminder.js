const $ = (id) => document.getElementById(id);

$('close').addEventListener('click', () => window.close());
$('back').addEventListener('click', () => window.focusLock.backToMeeting());
$('presenting').addEventListener('click', () => window.focusLock.presenting());

window.focusLock.reminderStatus().then((status) => {
  $('title').textContent = status ? `You're in a ${status.meeting} meeting` : "You're in a meeting";
});
