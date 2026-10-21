const $ = (id) => document.getElementById(id);

$('cancel').addEventListener('click', () => window.close());
$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('quit').disabled = true;
  const result = await window.focusLock.quit($('passcode').value);
  $('quit').disabled = false;
  if (result.ok) return;
  $('error').textContent = result.errors.join(' ');
  $('passcode').select();
});
