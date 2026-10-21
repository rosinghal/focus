const $ = (id) => document.getElementById(id);

const lines = (id) => $(id).value.split('\n').map((line) => line.trim()).filter(Boolean);

let verifyMode = 'otp';
let pendingAction = 'save';
let recipient = '';

const readForm = () => ({
  schedule: { start: $('start').value, end: $('end').value },
  newPasscode: $('new').value,
  confirmPasscode: $('confirm').value,
  blockedSites: lines('sites'),
  blockedApps: lines('apps'),
  clickupToken: $('clickup-token').value,
  clickupTeamId: $('clickup-team').value,
  clickupListId: $('clickup-list').value,
  whatsappRecipient: $('wa-recipient').value,
});

const renderRecipient = () => {
  $('wa-hint').textContent = recipient
    ? `After the passcode is used, unlock codes are sent to ${recipient} from your WhatsApp account.`
    : 'Save the WhatsApp number for unlock codes above, then link your WhatsApp account to send them.';
  $('wa-link').disabled = !recipient;
};

const fillForm = (settings) => {
  $('start').value = settings.schedule.start;
  $('end').value = settings.schedule.end;
  $('sites').value = settings.blockedSites.join('\n');
  $('apps').value = settings.blockedApps.join('\n');
  $('new').value = $('confirm').value = $('clickup-token').value = '';
  $('clickup-team').value = settings.clickupTeamId ?? '';
  $('clickup-list').value = settings.clickupListId ?? '';
  $('wa-recipient').value = recipient = settings.whatsappRecipient ?? '';
  renderRecipient();
  $('clickup-label').textContent = settings.hasClickupToken ? 'ClickUp API token (saved, enter to replace)' : 'ClickUp API token';
  $('new').required = $('confirm').required = !settings.hasPasscode;
  $('new-label').textContent = settings.hasPasscode ? 'New passcode (optional)' : 'New 4-digit passcode';
};

const showTab = (name) => {
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.setAttribute('aria-selected', tab.dataset.tab === name));
  document.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== name));
};

const firstInvalidPanel = () => $('form').querySelector(':invalid')?.closest('[data-panel]')?.dataset.panel;

const showMessages = (messages, className) => {
  $('messages').replaceChildren(
    ...messages.map((text) => Object.assign(document.createElement('li'), { textContent: text, className })),
  );
};

const WHATSAPP_STATUS = {
  linked: 'Linked ✓',
  connecting: 'Connecting…',
  qr: 'Scan this QR code with WhatsApp:',
  unlinked: 'Not linked. Without it, nothing unlocks after the passcode is used.',
};

const renderWhatsApp = ({ status, qr }) => {
  $('wa-status').textContent = WHATSAPP_STATUS[status] ?? status;
  $('wa-qr').classList.toggle('hidden', !qr);
  $('wa-qr-help').classList.toggle('hidden', !qr);
  if (qr) {
    $('wa-qr').src = qr;
    $('wa-qr').scrollIntoView({ block: 'center' });
  }
  $('wa-link').classList.toggle('hidden', status !== 'unlinked');
  $('wa-unlink').classList.toggle('hidden', status !== 'linked');
};

const save = async (approval = {}) => {
  const result = await window.focusLock.saveSettings({ ...readForm(), ...approval });
  if (result.ok) {
    showMessages(['Saved.'], 'ok');
    fillForm(await window.focusLock.getSettings());
  }
  return result;
};

const approvalRequest = () => (pendingAction === 'unlink' ? { unlink: true } : readForm());

const submitApproval = (approval) =>
  pendingAction === 'unlink' ? window.focusLock.unlinkWhatsApp(approval) : save(approval);

const setVerifyMode = (whatsappAvailable) => {
  verifyMode = whatsappAvailable ? 'otp' : 'passcode';
  const code = $('code');
  code.type = whatsappAvailable ? 'text' : 'password';
  code.maxLength = whatsappAvailable ? 6 : 4;
  code.pattern = whatsappAvailable ? '\\d{6}' : '\\d{4}';
  code.placeholder = whatsappAvailable ? '6-digit code' : 'Passcode';
  $('send-code').classList.toggle('hidden', !whatsappAvailable);
  $('verify-hint').textContent = whatsappAvailable
    ? `These changes loosen blocking. Send a code to ${recipient} on WhatsApp and enter it here.`
    : "These changes loosen blocking. WhatsApp isn't linked, so enter the passcode instead.";
};

const openVerify = ({ changes, whatsapp }, action) => {
  pendingAction = action;
  $('changes').replaceChildren(...changes.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
  setVerifyMode(whatsapp);
  $('code').value = '';
  $('confirm-error').textContent = '';
  $('confirm-dialog').showModal();
};

const sendCode = async () => {
  $('send-code').disabled = true;
  const result = await window.focusLock.sendSettingsOtp(approvalRequest());
  $('confirm-error').textContent = result.ok ? '' : result.error;
  if (result.ok) $('verify-hint').textContent = `Code sent to ${recipient}. It's valid for 5 minutes.`;
  setTimeout(() => ($('send-code').disabled = false), result.resendMs ?? 0);
  $('code').focus();
};

const init = async () => {
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
  const settings = await window.focusLock.getSettings();
  fillForm(settings);
  showTab(settings.hasPasscode ? 'schedule' : 'passcode');
  renderWhatsApp(settings.whatsapp);
  window.focusLock.onWhatsAppUpdate(renderWhatsApp);
  if (!settings.editable) {
    $('locked').classList.remove('hidden');
    document.querySelectorAll('input, textarea, button:not([data-tab])').forEach((el) => (el.disabled = true));
    return;
  }

  $('wa-link').addEventListener('click', async () => {
    renderWhatsApp({ status: 'connecting' });
    const result = await window.focusLock.linkWhatsApp();
    if (!result.ok) {
      renderWhatsApp({ status: 'unlinked' });
      if (result.error) $('wa-status').textContent = result.error;
    }
  });
  $('wa-unlink').addEventListener('click', async () => {
    const result = await window.focusLock.unlinkWhatsApp({});
    if (result.reason === 'verify') openVerify(result, 'unlink');
  });

  $('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessages([], '');
    $('save').disabled = true;
    const result = await save();
    $('save').disabled = false;
    if (result.reason === 'verify') openVerify(result, 'save');
    else if (!result.ok) showMessages(result.errors, 'error');
  });

  // Hidden tabs can't show validation bubbles, so jump to the tab with the problem first.
  $('form').addEventListener(
    'invalid',
    () => {
      const panel = firstInvalidPanel();
      if (panel) showTab(panel);
    },
    true,
  );

  $('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close());
  $('send-code').addEventListener('click', sendCode);
  $('confirm-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('confirm-save').disabled = true;
    const code = $('code').value;
    const result = await submitApproval(verifyMode === 'otp' ? { otp: code } : { currentPasscode: code });
    $('confirm-save').disabled = false;
    if (result.ok) {
      $('confirm-dialog').close();
    } else if (result.reason === 'verify') {
      setVerifyMode(result.whatsapp);
      $('confirm-error').textContent = result.errors.join(' ');
      $('code').select();
    } else {
      $('confirm-dialog').close();
      showMessages(result.errors, 'error');
    }
  });
};

init();
