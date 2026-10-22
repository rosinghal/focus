const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes, randomInt } = require('node:crypto');
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  systemPreferences,
} = require('electron');
const {
  isInBlockWindow,
  isBypassActive,
  isGraceAvailable,
  shouldLock,
  formatTime,
  countdownEnd,
  formatCountdown,
} = require('./schedule');
const QRCode = require('qrcode');
const unlock = require('./unlock');
const otp = require('./otp');
const whatsapp = require('./whatsapp');
const { isConfigured, applySettings, restrictionChanges, toPublicSettings } = require('./config');
const { createStore } = require('./store');
const {
  createUnlockEvent,
  recordEvent,
  usedThisPeriod,
  endActiveUnlock,
  weeklySummary,
  motivation,
} = require('./history');
const { moonBitmap } = require('./icon');
const blocklist = require('./blocklist');
const pomodoro = require('./pomodoro');
const clickup = require('./clickup');
const meeting = require('./meeting');

const TICK_MS = 5000;
const TITLE_TICK_MS = 1000;
const WAKE_SETTLE_MS = 1500;
const RELOCK_WARNING_MS = 60 * 1000;
const BLOCK_SCRIPT_TIMEOUT_MS = 4000;
const PRELOAD = path.join(__dirname, 'preload.js');
const RENDERER = path.join(__dirname, 'renderer');

let store;
let config;
let state = {
  bypassUntil: 0,
  graceUsedAt: 0,
  trackingSince: 0,
  sessionUntil: 0,
  sessionKind: 'session',
  kidUsedAt: 0,
  hiddenApps: [],
  pomodoro: null,
  pomodoroSummary: null,
  pomodoroLog: [],
};
let history = [];
let attempts = unlock.NO_FAILURES;
let passcodeRequestedAt = 0;
let otpRecord = null;
let settingsOtp = null;
let whatsappClient = null;
let whatsappQr = null;
let lockWindows = [];
let settingsWindow = null;
let blockedWindow = null;
let quitWindow = null;
let pomodoroWindow = null;
let timerWindow = null;
let reminderWindow = null;
let meetingState = { kind: null, awaySince: 0, presenting: false };
let meetingBrowsers = [];
// Every task shown in the window, since searches run as you type and can resolve out of order.
let pomodoroMatches = new Map();
let clickupClient = null;
let quitAllowed = false;
let sessionOffer = null;
let tray = null;
let relockWarned = false;
let systemShuttingDown = false;
let enforcingBlocklist = false;
// What was open when a mode ended gets blocked without offering another mode straight away.
let offersPaused = false;

const run = promisify(execFile);

const inBlockWindow = () => isInBlockWindow(new Date(), config.schedule);
const settingsEditable = () => !isConfigured(config) || !inBlockWindow();
const isLockSender = (event) => lockWindows.some((win) => win.webContents === event.sender);
const isSettingsSender = (event) => settingsWindow?.webContents === event.sender;
const isBlockedSender = (event) => blockedWindow?.webContents === event.sender;
const isQuitSender = (event) => quitWindow?.webContents === event.sender;
const isPomodoroSender = (event) => pomodoroWindow?.webContents === event.sender;
const isTimerSender = (event) => timerWindow?.webContents === event.sender;
const isReminderSender = (event) => reminderWindow?.webContents === event.sender;
const inSession = () => blocklist.isSessionActive(Date.now(), state.sessionUntil);
const isKidSession = () => state.sessionKind === 'kid';
const sessionRules = () => blocklist.sessionRules(state.sessionKind, config);
const pomodoroActive = () => pomodoro.isPomodoroActive(state.pomodoro, Date.now());
const focusing = () => pomodoro.isFocusing(state.pomodoro, Date.now());

const clickupFor = ({ clickupToken: token, clickupTeamId: teamId, clickupListId: listId }) => {
  const key = JSON.stringify([token, teamId, listId]);
  if (clickupClient?.key !== key) clickupClient = { key, ...clickup.createClient({ token, teamId, listId }) };
  return clickupClient;
};

const clickupReady = () => Boolean(config.clickupToken && config.clickupTeamId);
const CLICKUP_SETUP_ERROR = 'Add a ClickUp token and workspace in Settings.';

const passcodeAvailable = () => !usedThisPeriod(history, 'passcode', new Date(), config.schedule);

const whatsappAuthDir = () => path.join(app.getPath('userData'), 'whatsapp-auth');

// Without a recipient there is nobody to send codes to, so the lock screen treats WhatsApp as unlinked.
const lockWhatsAppStatus = () => (config.whatsappRecipient ? whatsappClient.status : 'unlinked');

const sendWhatsAppUpdate = () => {
  const update = { status: lockWhatsAppStatus() };
  lockWindows.forEach((win) => !win.isDestroyed() && win.webContents.send('whatsapp:update', update));
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    const { status } = whatsappClient;
    settingsWindow.webContents.send('whatsapp:update', { status, qr: status === 'qr' ? whatsappQr : null });
  }
};

const updateState = (changes) => {
  state = { ...state, ...changes };
  store.saveState(state);
};

const grantAccess = (type, durationMs) => {
  const now = new Date();
  history = recordEvent(history, createUnlockEvent({ type, now, durationMs, schedule: config.schedule }));
  store.saveHistory(history);
  updateState({ bypassUntil: now.getTime() + durationMs });
  relockWarned = durationMs <= RELOCK_WARNING_MS;
  tick();
};

const lockNow = () => {
  const now = Date.now();
  if (!isBypassActive(now, state.bypassUntil)) return;
  history = endActiveUnlock(history, now);
  store.saveHistory(history);
  updateState({ bypassUntil: now });
  tick();
};

const createLockWindow = (display, isPrimary) => {
  const win = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    // Native fullscreen moves the window to its own Space, which macOS can leave behind after sleep.
    simpleFullscreen: true,
    backgroundColor: '#0b1020',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('close', (event) => event.preventDefault());
  win.isPrimaryLock = isPrimary;
  if (isPrimary) {
    win.setKiosk(true);
    win.on('blur', () => !win.isDestroyed() && win.focus());
  }
  win.once('ready-to-show', () => {
    win.show();
    win.shownOnce = true;
    if (isPrimary) win.focus();
  });
  win.loadFile(path.join(RENDERER, 'lock.html'), {
    query: { role: isPrimary ? 'primary' : 'secondary' },
  });
  return win;
};

const showLock = () => {
  if (lockWindows.length) return;
  settingsWindow?.destroy();
  blockedWindow?.destroy();
  pomodoroWindow?.destroy();
  const primaryId = screen.getPrimaryDisplay().id;
  lockWindows = screen
    .getAllDisplays()
    .map((display) => createLockWindow(display, display.id === primaryId));
};

const hideLock = () => {
  lockWindows.forEach((win) => {
    if (win.isDestroyed()) return;
    win.setKiosk(false);
    win.destroy();
  });
  lockWindows = [];
};

const rebuildLock = () => {
  if (!lockWindows.length) return;
  hideLock();
  showLock();
};

const isLockWindowBroken = (win) =>
  win.isDestroyed() ||
  (win.shownOnce && (!win.isVisible() || win.isMinimized() || (win.isPrimaryLock && !win.isKiosk())));

const repairLock = () => {
  if (lockWindows.some(isLockWindowBroken)) rebuildLock();
};

const bringLockToFront = () => {
  const primary = lockWindows.find((win) => !win.isDestroyed() && win.isPrimaryLock);
  if (!primary) return;
  lockWindows.forEach((win) => !win.isDestroyed() && win.moveTop());
  app.focus({ steal: true });
  primary.focus();
};

// Displays and Spaces are re-created on wake, so start from fresh windows rather than trusting the old ones.
const relockAfterWake = () =>
  setTimeout(() => {
    rebuildLock();
    tick();
  }, WAKE_SETTLE_MS);

const openSettings = () => {
  if (!settingsEditable()) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 620,
    title: 'Focus Settings',
    resizable: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  settingsWindow.on('closed', () => (settingsWindow = null));
  settingsWindow.loadFile(path.join(RENDERER, 'settings.html'));
  app.focus({ steal: true });
};

const openQuit = () => {
  if (!isConfigured(config)) {
    quitAllowed = true;
    app.quit();
    return;
  }
  if (quitWindow && !quitWindow.isDestroyed()) {
    quitWindow.focus();
    return;
  }
  quitWindow = new BrowserWindow({
    width: 360,
    height: 320,
    title: 'Quit Focus',
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    backgroundColor: '#0b1020',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  quitWindow.on('closed', () => (quitWindow = null));
  quitWindow.loadFile(path.join(RENDERER, 'quit.html'));
  app.focus({ steal: true });
};

const openPomodoro = () => {
  if (focusing() || inSession()) return;
  if (pomodoroWindow && !pomodoroWindow.isDestroyed()) {
    pomodoroWindow.focus();
    return;
  }
  pomodoroMatches = new Map();
  pomodoroWindow = new BrowserWindow({
    width: 440,
    height: 600,
    title: 'Pomodoro',
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#0b1020',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  pomodoroWindow.on('closed', () => (pomodoroWindow = null));
  pomodoroWindow.loadFile(path.join(RENDERER, 'pomodoro.html'));
  app.focus({ steal: true });
};

const POMODORO_SHORTCUT = 'Alt+Command+P';

const showPomodoro = () => {
  if (lockWindows.length) return;
  if (pomodoroActive()) showTimer();
  else if (isConfigured(config) && !inSession()) openPomodoro();
};

const TIMER_WIDTH = 300;
const TIMER_MARGIN = 12;

const timerView = () => pomodoro.timerView(state.pomodoro, state.pomodoroSummary, Date.now());

const timerBounds = (view) => {
  const { workArea } = screen.getPrimaryDisplay();
  const button = view?.summary && !view.summary.taskCompleted ? 62 : 0;
  const height = view?.summary ? (view.until ? 172 : 128) + button : 108;
  return { x: workArea.x + workArea.width - TIMER_WIDTH - TIMER_MARGIN, y: workArea.y + TIMER_MARGIN, width: TIMER_WIDTH, height };
};

// Reuses the open timer window so a new pomodoro replaces what it shows.
const showTimer = () => {
  const view = timerView();
  if (timerWindow && !timerWindow.isDestroyed()) {
    timerWindow.setBounds(timerBounds(view));
    timerWindow.webContents.send('timer:update', view);
    timerWindow.showInactive();
    return;
  }
  timerWindow = new BrowserWindow({
    ...timerBounds(view),
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0b1020',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  timerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  timerWindow.on('closed', () => (timerWindow = null));
  timerWindow.once('ready-to-show', () => timerWindow.showInactive());
  timerWindow.loadFile(path.join(RENDERER, 'timer.html'));
};

const updateTimer = () => {
  if (!timerWindow || timerWindow.isDestroyed()) return;
  const view = timerView();
  timerWindow.setBounds(timerBounds(view));
  timerWindow.webContents.send('timer:update', view);
};

const finishFocus = (completed) => {
  const { log, summary } = pomodoro.finishFocus(state.pomodoro, state.pomodoroLog, Date.now(), completed);
  updateState({ pomodoroLog: log, pomodoroSummary: summary });
};

const startPomodoro = (task) => {
  updateState({ pomodoro: pomodoro.startPomodoro(task, Date.now()), pomodoroSummary: null });
  pomodoroMatches = new Map();
  pomodoroWindow?.destroy();
  showTimer();
  tick();
};

const createPomodoroTask = async (input) => {
  const name = String(input ?? '').trim();
  if (!name) return { ok: false, error: 'Pick a task or create a new one.' };
  if (!config.clickupListId) return { ok: false, error: 'Set the ClickUp list for new tasks in Settings.' };
  try {
    const task = await clickupFor(config).createTask(name, new Date());
    pomodoroMatches.set(task.id, task);
    return { ok: true, task };
  } catch {
    return { ok: false, error: 'Could not create the ClickUp task. Try again.' };
  }
};

const stopPomodoro = () => {
  if (focusing()) finishFocus(false);
  updateState({ pomodoro: null });
  updateTimer();
  tick();
};

const advancePomodoro = () => {
  const { pomodoro: next, ended } = pomodoro.advancePomodoro(state.pomodoro, Date.now());
  if (!ended) return;
  if (ended === 'focus') finishFocus(true);
  updateState({ pomodoro: next });
  updateTimer();
  if (ended === 'focus') notify(`Pomodoro done: ${state.pomodoro.task.name}. Take a ${pomodoro.BREAK_MS / 60000}-minute break.`);
  else notify('Break is over. Start another pomodoro when you are ready.');
};

const openTask = () => {
  const url = (state.pomodoro ?? state.pomodoroSummary)?.task.url;
  if (/^https:\/\//.test(url ?? '')) shell.openExternal(url);
};

const clockTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const statusLabel = (now) => {
  if (!isConfigured(config)) return 'Not set up — open Settings';
  if (isBypassActive(now.getTime(), state.bypassUntil) && isInBlockWindow(now, config.schedule)) {
    return `Unlocked until ${clockTime(state.bypassUntil)}`;
  }
  if (isInBlockWindow(now, config.schedule)) return 'Locked';
  return `Locks at ${formatTime(config.schedule.start)}`;
};

const updateTrayTitle = () => {
  const now = new Date();
  const end = isConfigured(config)
    ? countdownEnd({
        now,
        schedule: config.schedule,
        bypassUntil: state.bypassUntil,
        sessionUntil: state.sessionUntil,
        pomodoroUntil: state.pomodoro?.until ?? 0,
      })
    : null;
  const title = end ? formatCountdown(end - now.getTime()) : '';
  tray.setTitle(title, { fontType: 'monospacedDigit' });
};

const shorten = (text, length = 40) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

const pomodoroMenu = () => {
  if (!pomodoroActive()) {
    return [
      {
        label: 'Start Pomodoro…',
        enabled: isConfigured(config) && !inSession(),
        accelerator: POMODORO_SHORTCUT,
        registerAccelerator: false,
        click: openPomodoro,
      },
    ];
  }
  const { phase, until, task } = state.pomodoro;
  return phase === 'focus'
    ? [
        { label: `Pomodoro until ${clockTime(until)}: ${shorten(task.name)}`, enabled: false },
        { label: 'Open Task in ClickUp', click: openTask },
        { label: 'Stop Pomodoro', click: stopPomodoro },
      ]
    : [
        { label: `Break until ${clockTime(until)}`, enabled: false },
        { label: 'End Break', click: stopPomodoro },
      ];
};

const updateTray = (now) => {
  const editable = settingsEditable();
  const unlocked =
    isConfigured(config) &&
    isInBlockWindow(now, config.schedule) &&
    isBypassActive(now.getTime(), state.bypassUntil);
  tray.setToolTip(`Focus — ${statusLabel(now)}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusLabel(now), enabled: false },
      ...(unlocked ? [{ label: 'Lock Now', click: lockNow }] : []),
      ...(inSession()
        ? [
            { type: 'separator' },
            {
              label: `${isKidSession() ? 'Kid mode' : 'Entertainment mode'} until ${clockTime(state.sessionUntil)}`,
              enabled: false,
            },
            { label: isKidSession() ? 'End Kid Mode' : 'End Entertainment Mode', click: endSession },
          ]
        : []),
      ...(meetingState.kind
        ? [
            { type: 'separator' },
            { label: `Meeting mode: ${meeting.MEETING_NAMES[meetingState.kind]}`, enabled: false },
            {
              label: 'Presenting (pause reminders)',
              type: 'checkbox',
              checked: meetingState.presenting,
              click: (item) => setPresenting(item.checked),
            },
          ]
        : []),
      { type: 'separator' },
      ...pomodoroMenu(),
      { type: 'separator' },
      { label: 'Settings…', enabled: editable, click: openSettings },
      { type: 'separator' },
      { label: editable ? 'Quit…' : 'Quit (disabled during sleep hours)', enabled: editable, click: () => app.quit() },
    ]),
  );
};

const notify = (body) => Notification.isSupported() && new Notification({ title: 'Focus', body }).show();

const warnBeforeRelock = (now) => {
  const remaining = state.bypassUntil - now.getTime();
  if (remaining <= 0 || remaining > RELOCK_WARNING_MS || relockWarned) return;
  if (!isInBlockWindow(new Date(state.bypassUntil), config.schedule)) return;
  relockWarned = true;
  notify('Locking again in 1 minute. Save your work.');
};

const showBlockedWindow = (query) => {
  if (lockWindows.length) return;
  if (blockedWindow && !blockedWindow.isDestroyed() && blockedWindow.query === JSON.stringify(query)) {
    blockedWindow.focus();
    return;
  }
  blockedWindow?.destroy();
  blockedWindow = new BrowserWindow({
    width: 420,
    height: 300,
    title: 'Focus',
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    backgroundColor: '#0b1020',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  blockedWindow.query = JSON.stringify(query);
  blockedWindow.on('closed', () => (blockedWindow = null));
  blockedWindow.loadFile(path.join(RENDERER, 'blocked.html'), { query });
  app.focus({ steal: true });
};

const offerSession = (name, appPath = null) => {
  if (name !== blocklist.KID_SITE) {
    sessionOffer = { kind: 'session', appPath };
    showBlockedWindow({ kind: 'offer', mode: 'session', name, minutes: String(blocklist.SESSION_MS / 60000) });
  } else if (blocklist.kidModeAvailable(new Date(), state.kidUsedAt)) {
    sessionOffer = { kind: 'kid', appPath };
    showBlockedWindow({ kind: 'offer', mode: 'kid', name, minutes: String(blocklist.KID_SESSION_MS / 60000) });
  } else {
    sessionOffer = null;
    showBlockedWindow({ kind: 'used', name });
  }
};

const startSession = () => {
  const { kind, appPath } = sessionOffer;
  const now = Date.now();
  const { durationMs } = blocklist.sessionRules(kind, config);
  updateState({
    sessionUntil: now + durationMs,
    sessionKind: kind,
    ...(kind === 'kid' ? { kidUsedAt: now } : {}),
  });
  if (appPath) run('open', [appPath]).catch(() => {});
  sessionOffer = null;
  tick();
};

const endSession = () => {
  const kid = isKidSession();
  updateState({ sessionUntil: 0 });
  offersPaused = true;
  notify(kid ? 'Kid mode is over for today.' : 'Entertainment mode is over. Your entertainment sites and apps are blocked again.');
  tick();
};

const quitBlockedApps = (processes, offer) =>
  blocklist.blockedProcesses(processes, config.blockedApps).forEach((proc) => {
    try {
      process.kill(proc.pid);
      if (offer) offerSession(proc.name, blocklist.appBundlePath(proc.path));
    } catch {}
  });

const hideOtherApps = async () => {
  const script = blocklist.hideAppsScript(sessionRules().apps);
  const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', script], { timeout: BLOCK_SCRIPT_TIMEOUT_MS });
  const hidden = blocklist.parseScriptList(stdout);
  if (!hidden.length) return;
  updateState({ hiddenApps: [...new Set([...state.hiddenApps, ...hidden])] });
  const minutes = blocklist.sessionMinutesLeft(Date.now(), state.sessionUntil);
  showBlockedWindow({ kind: 'notice', mode: state.sessionKind, minutes: String(minutes) });
};

// Each browser asks once for Automation permission; until it is granted the script fails and is skipped.
const unhideApps = async () => {
  if (!state.hiddenApps.length) return;
  const script = blocklist.unhideAppsScript(state.hiddenApps);
  await run('osascript', ['-l', 'JavaScript', '-e', script], { timeout: BLOCK_SCRIPT_TIMEOUT_MS });
  updateState({ hiddenApps: [] });
};

const enforceTabs = async (processes, session, offer) => {
  const { sites, page } = session
    ? sessionRules()
    : { sites: blocklist.blockingSites(config.blockedSites), page: null };
  for (const browser of blocklist.runningBrowsers(processes)) {
    const script = blocklist.enforceTabsScript(browser, sites, page);
    const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', script], {
      timeout: BLOCK_SCRIPT_TIMEOUT_MS,
    }).catch(() => ({ stdout: '' }));
    const [site] = blocklist.parseScriptList(stdout);
    if (site && offer) offerSession(site);
  }
};

const REMINDER_SIZE = { width: 300, height: 124 };

const reminderBounds = () => {
  const { workArea } = screen.getPrimaryDisplay();
  const below = timerWindow && !timerWindow.isDestroyed() ? timerWindow.getBounds() : null;
  return {
    ...REMINDER_SIZE,
    x: workArea.x + workArea.width - REMINDER_SIZE.width - TIMER_MARGIN,
    y: below ? below.y + below.height + TIMER_MARGIN : workArea.y + TIMER_MARGIN,
  };
};

const showReminder = () => {
  if (reminderWindow && !reminderWindow.isDestroyed()) return;
  const win = new BrowserWindow({
    ...reminderBounds(),
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0b1020',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  reminderWindow = win;
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Closing it yourself snoozes the reminder for another minute away.
  win.on('closed', () => {
    if (reminderWindow !== win) return;
    reminderWindow = null;
    meetingState = { ...meetingState, awaySince: meetingState.awaySince && Date.now() };
  });
  win.once('ready-to-show', () => win.showInactive());
  win.loadFile(path.join(RENDERER, 'reminder.html'));
};

const hideReminder = () => {
  const win = reminderWindow;
  reminderWindow = null;
  win?.destroy();
};

const setPresenting = (presenting) => {
  meetingState = { ...meetingState, presenting, awaySince: 0 };
  hideReminder();
  updateTray(new Date());
};

const backToMeeting = (browsers) => {
  hideReminder();
  meetingState = { ...meetingState, awaySince: meetingState.awaySince && Date.now() };
  if (meetingState.kind === 'zoom') return run('open', ['-a', meeting.ZOOM_APP]).catch(() => {});
  const script = meeting.focusMeetScript(browsers);
  return run('osascript', ['-l', 'JavaScript', '-e', script], { timeout: BLOCK_SCRIPT_TIMEOUT_MS }).catch(() => {});
};

const watchMeeting = async (processes) => {
  const browsers = blocklist.runningBrowsers(processes);
  const scan = await run('osascript', ['-l', 'JavaScript', '-e', meeting.scanScript(browsers)], {
    timeout: BLOCK_SCRIPT_TIMEOUT_MS,
  })
    .then(({ stdout }) => meeting.parseScan(stdout))
    .catch(() => meeting.NO_SCAN);
  const kind = lockWindows.length ? null : meeting.meetingKind(processes, scan);
  if (kind !== meetingState.kind) {
    meetingState = { kind, awaySince: 0, presenting: false };
    updateTray(new Date());
  }
  const now = Date.now();
  const away = meeting.isAway(kind, scan);
  meetingState = { ...meetingState, awaySince: meeting.awaySince(meetingState.awaySince, { ...meetingState, away }, now) };
  meetingBrowsers = browsers;
  if (meeting.shouldRemind(meetingState.awaySince, now)) showReminder();
  else if (!meetingState.awaySince) hideReminder();
};

const enforceBlocklist = async () => {
  if (enforcingBlocklist || process.platform !== 'darwin' || !isConfigured(config)) return;
  enforcingBlocklist = true;
  const session = inSession();
  try {
    const { stdout } = await run('ps', ['-axo', 'pid=,comm=']);
    const processes = blocklist.runningApps(stdout);
    const offer = !session && !offersPaused && !focusing();
    if (session) await hideOtherApps().catch(() => {});
    else {
      quitBlockedApps(processes, offer);
      await unhideApps().catch(() => {});
    }
    await enforceTabs(processes, session, offer);
    if (!session) offersPaused = false;
    await watchMeeting(processes);
  } catch {
    // ps failed; try again next tick.
  } finally {
    enforcingBlocklist = false;
  }
};

const tick = () => {
  const now = new Date();
  if (state.sessionUntil && !inSession()) endSession();
  advancePomodoro();
  const locked =
    isConfigured(config) && shouldLock({ now, schedule: config.schedule, bypassUntil: state.bypassUntil });
  if (locked) {
    showLock();
    repairLock();
  } else hideLock();
  warnBeforeRelock(now);
  updateTray(now);
  updateTrayTitle();
  enforceBlocklist();
};

const createTray = () => {
  const isMac = process.platform === 'darwin';
  const color = isMac ? [0, 0, 0] : [138, 180, 248];
  const icon = nativeImage.createFromBitmap(moonBitmap(16, color), { width: 16, height: 16 });
  icon.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: moonBitmap(32, color) });
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
};

const lockoutError = (waitMs) => `Too many attempts. Try again in ${Math.ceil(waitMs / 1000)}s.`;

const passcodeErrors = (input) => {
  const waitMs = unlock.lockoutRemainingMs(attempts, Date.now());
  if (waitMs > 0) return [lockoutError(waitMs)];
  const check = unlock.checkPasscode(config.passcode, String(input ?? ''), attempts, Date.now());
  attempts = check.attempts;
  if (check.reason === 'locked-out') return [lockoutError(check.waitMs)];
  if (check.ok) return null;
  return [`Wrong passcode. ${check.attemptsLeft} attempt${check.attemptsLeft === 1 ? '' : 's'} left.`];
};

const whatsappAvailable = () => whatsappClient.status === 'linked' && Boolean(config.whatsappRecipient);

const otpErrors = (input, changes) => {
  const now = Date.now();
  if (!otp.isOtpActive(settingsOtp?.record, now)) return ['The code expired. Send a new one.'];
  if (settingsOtp.changesKey !== JSON.stringify(changes)) return ['The settings changed. Send a new code.'];
  const check = unlock.checkCode(() => otp.otpMatches(settingsOtp.record, String(input), now), attempts, now);
  attempts = check.attempts;
  if (check.reason === 'locked-out') return [lockoutError(check.waitMs)];
  if (check.ok) return null;
  return [`Wrong code. ${check.attemptsLeft} attempt${check.attemptsLeft === 1 ? '' : 's'} left.`];
};

// Loosening needs a WhatsApp code; the passcode is the backup only while WhatsApp isn't linked.
const looseningErrors = (input, changes) => {
  if (input.otp) return otpErrors(input.otp, changes);
  if (input.currentPasscode && !whatsappAvailable()) return passcodeErrors(input.currentPasscode);
  return [];
};

const UNLINK_CHANGES = ['Unlink WhatsApp'];

const pendingSettings = (input) => {
  const { config: next, errors } = applySettings(config, input, randomBytes(16).toString('hex'));
  return errors.length ? { errors } : { next, changes: restrictionChanges(config, next) };
};

const approvalChanges = (input) => (input?.unlink ? { changes: UNLINK_CHANGES } : pendingSettings(input));

const registerIpc = () => {
  ipcMain.handle('lock:status', (event) => {
    if (!isLockSender(event)) return null;
    const week = weeklySummary({
      history,
      schedule: config.schedule,
      now: new Date(),
      trackingSince: state.trackingSince,
    });
    return {
      week,
      motivation: motivation(week),
      unlocksAt: formatTime(config.schedule.end),
      graceAvailable: isGraceAvailable({ now: new Date(), schedule: config.schedule, graceUsedAt: state.graceUsedAt }),
      bypassMinutes: unlock.BYPASS_MS / 60000,
      lockoutMs: unlock.lockoutRemainingMs(attempts, Date.now()),
      passcodeAvailable: passcodeAvailable(),
      whatsappStatus: lockWhatsAppStatus(),
      whatsappRecipient: config.whatsappRecipient,
      otpLength: otp.OTP_LENGTH,
      otpPending: otp.isOtpActive(otpRecord, Date.now()),
      resendMs: otp.resendRemainingMs(otpRecord, Date.now()),
    };
  });

  ipcMain.handle('lock:grace', (event) => {
    if (!isLockSender(event)) return { ok: false };
    const now = new Date();
    if (!isGraceAvailable({ now, schedule: config.schedule, graceUsedAt: state.graceUsedAt })) {
      return { ok: false, error: 'One More Minute was already used tonight.' };
    }
    updateState({ graceUsedAt: now.getTime() });
    grantAccess('grace', unlock.GRACE_MS);
    return { ok: true };
  });

  ipcMain.handle('lock:request-passcode', (event) => {
    if (!isLockSender(event) || !passcodeAvailable()) return null;
    passcodeRequestedAt = Date.now();
    return { waitMs: unlock.PASSCODE_DELAY_MS };
  });

  ipcMain.handle('lock:passcode', (event, input) => {
    if (!isLockSender(event)) return { ok: false };
    if (!passcodeAvailable()) return { ok: false, reason: 'used' };
    const delayMs = unlock.passcodeDelayRemainingMs(passcodeRequestedAt, Date.now());
    if (delayMs > 0) return { ok: false, reason: 'too-soon', waitMs: delayMs };
    const result = unlock.checkPasscode(config.passcode, String(input), attempts, Date.now());
    attempts = result.attempts;
    if (result.ok) {
      passcodeRequestedAt = 0;
      grantAccess('passcode', unlock.BYPASS_MS);
    }
    return { ok: result.ok, reason: result.reason, attemptsLeft: result.attemptsLeft, waitMs: result.waitMs };
  });

  ipcMain.handle('lock:send-otp', async (event) => {
    if (!isLockSender(event)) return { ok: false };
    const now = Date.now();
    if (passcodeAvailable()) return { ok: false, error: 'Use your passcode first.' };
    if (!whatsappAvailable()) return { ok: false, error: 'WhatsApp is not connected.' };
    const resendMs = otp.resendRemainingMs(otpRecord, now);
    if (resendMs > 0) return { ok: false, error: 'Code already sent.', resendMs };
    const code = otp.formatOtp(randomInt(10 ** otp.OTP_LENGTH));
    try {
      await whatsappClient.sendText(config.whatsappRecipient, otp.otpMessage(code, unlock.BYPASS_MS / 60000));
    } catch {
      return { ok: false, error: 'Could not send the WhatsApp message. Try again.' };
    }
    otpRecord = otp.createOtpRecord(code, randomBytes(16).toString('hex'), now);
    return { ok: true, resendMs: otp.RESEND_COOLDOWN_MS };
  });

  ipcMain.handle('lock:otp', (event, input) => {
    if (!isLockSender(event)) return { ok: false };
    const now = Date.now();
    if (!otp.isOtpActive(otpRecord, now)) return { ok: false, reason: 'expired' };
    const result = unlock.checkCode(() => otp.otpMatches(otpRecord, String(input), now), attempts, now);
    attempts = result.attempts;
    if (result.ok) {
      otpRecord = null;
      grantAccess('whatsapp', unlock.BYPASS_MS);
    }
    return { ok: result.ok, reason: result.reason, attemptsLeft: result.attemptsLeft, waitMs: result.waitMs };
  });

  ipcMain.handle('blocked:start-session', (event) => {
    if (!isBlockedSender(event) || inSession() || focusing() || !sessionOffer) return { ok: false };
    if (sessionOffer.kind === 'kid' && !blocklist.kidModeAvailable(new Date(), state.kidUsedAt)) return { ok: false };
    startSession();
    return { ok: true };
  });

  ipcMain.handle('reminder:status', (event) =>
    isReminderSender(event) && meetingState.kind ? { meeting: meeting.MEETING_NAMES[meetingState.kind] } : null,
  );

  ipcMain.handle('reminder:back', (event) => {
    if (isReminderSender(event)) backToMeeting(meetingBrowsers);
  });

  ipcMain.handle('reminder:presenting', (event) => {
    if (isReminderSender(event)) setPresenting(true);
  });

  ipcMain.handle('timer:status', (event) => (isTimerSender(event) ? timerView() : null));

  ipcMain.handle('timer:open-task', (event) => {
    if (isTimerSender(event)) openTask();
  });

  ipcMain.handle('timer:complete-task', async (event) => {
    const summary = state.pomodoroSummary;
    if (!isTimerSender(event) || !summary || !config.clickupToken) return { ok: false, error: 'Nothing to complete.' };
    try {
      await clickupFor(config).completeTask(summary.task.id);
    } catch (error) {
      return {
        ok: false,
        error:
          error.message === 'no-closing-status'
            ? 'Its list has no closed status.'
            : "Couldn't update ClickUp. Try again.",
      };
    }
    if (state.pomodoroSummary === summary) {
      updateState({ pomodoroSummary: { ...summary, taskCompleted: true } });
      updateTimer();
    }
    return { ok: true };
  });

  ipcMain.handle('pomodoro:status', (event) => {
    if (!isPomodoroSender(event)) return null;
    return { clickupReady: clickupReady(), minutes: pomodoro.FOCUS_MS / 60000 };
  });

  ipcMain.handle('pomodoro:search', async (event, query) => {
    if (!isPomodoroSender(event) || !clickupReady()) return { ok: false, error: CLICKUP_SETUP_ERROR };
    const now = new Date();
    try {
      const tasks = await clickupFor(config).searchTasks(String(query ?? ''), now);
      tasks.forEach((task) => pomodoroMatches.set(task.id, task));
      return { ok: true, tasks: tasks.map((task) => clickup.toListItem(task, now)) };
    } catch {
      return { ok: false, error: 'Could not reach ClickUp. Check the token and your connection.' };
    }
  });

  ipcMain.handle('pomodoro:start', async (event, input = {}) => {
    if (!isPomodoroSender(event) || !clickupReady()) return { ok: false, error: CLICKUP_SETUP_ERROR };
    if (focusing() || inSession()) return { ok: false, error: 'Finish the current mode first.' };
    const picked = pomodoroMatches.get(input.taskId);
    if (picked) {
      startPomodoro(picked);
      return { ok: true };
    }
    const created = await createPomodoroTask(input.create);
    if (created.ok) startPomodoro(created.task);
    return { ok: created.ok, error: created.error };
  });

  ipcMain.handle('pomodoro:star', async (event, taskId, starred) => {
    if (!isPomodoroSender(event) || !clickupReady()) return { ok: false, error: CLICKUP_SETUP_ERROR };
    const task = pomodoroMatches.get(taskId);
    if (!task) return { ok: false, error: 'Pick a task from the list.' };
    try {
      const priority = await clickupFor(config).setStarred(task.id, Boolean(starred));
      pomodoroMatches.set(task.id, { ...task, priority });
      return { ok: true, task: clickup.toListItem({ ...task, priority }, new Date()) };
    } catch {
      return { ok: false, error: 'Could not change the priority in ClickUp. Try again.' };
    }
  });

  ipcMain.handle('pomodoro:create', async (event, name) => {
    if (!isPomodoroSender(event) || !clickupReady()) return { ok: false, error: CLICKUP_SETUP_ERROR };
    const created = await createPomodoroTask(name);
    return created.ok ? { ok: true, task: clickup.toListItem(created.task, new Date()) } : created;
  });

  ipcMain.handle('settings:whatsapp-link', (event) => {
    if (!isSettingsSender(event) || !settingsEditable()) return { ok: false };
    if (!config.whatsappRecipient) return { ok: false, error: 'Save the WhatsApp number that gets the codes first.' };
    if (['linked', 'qr'].includes(whatsappClient.status)) return { ok: true };
    whatsappClient.connect();
    return { ok: true };
  });

  ipcMain.handle('settings:whatsapp-unlink', async (event, input = {}) => {
    if (!isSettingsSender(event) || !settingsEditable()) return { ok: false };
    if (isConfigured(config)) {
      const rejected = looseningErrors(input, UNLINK_CHANGES);
      if (rejected) {
        return { ok: false, reason: 'verify', changes: UNLINK_CHANGES, whatsapp: whatsappAvailable(), errors: rejected };
      }
      settingsOtp = null;
    }
    await whatsappClient.logout();
    return { ok: true };
  });

  ipcMain.handle('settings:get', (event) => {
    if (!isSettingsSender(event)) return null;
    return {
      ...toPublicSettings(config),
      editable: settingsEditable(),
      whatsapp: { status: whatsappClient.status },
      version: app.getVersion(),
    };
  });

  ipcMain.handle('settings:save', (event, input) => {
    if (!isSettingsSender(event) || !settingsEditable()) {
      return { ok: false, errors: ['Settings are locked during sleep hours.'] };
    }
    const { next, changes, errors } = pendingSettings(input);
    if (errors) return { ok: false, errors };
    if (changes.length) {
      const rejected = looseningErrors(input, changes);
      if (rejected) return { ok: false, reason: 'verify', changes, whatsapp: whatsappAvailable(), errors: rejected };
      settingsOtp = null;
    }
    config = next;
    store.saveConfig(config);
    if (!state.trackingSince) updateState({ trackingSince: Date.now() });
    tick();
    return { ok: true };
  });

  ipcMain.handle('settings:send-otp', async (event, input) => {
    if (!isSettingsSender(event) || !settingsEditable()) return { ok: false, error: 'Settings are locked.' };
    const { changes, errors } = approvalChanges(input);
    if (errors) return { ok: false, error: errors.join(' ') };
    if (!changes.length) return { ok: false, error: 'These changes need no approval.' };
    if (!whatsappAvailable()) return { ok: false, error: 'WhatsApp is not connected.' };
    const now = Date.now();
    const resendMs = otp.resendRemainingMs(settingsOtp?.record, now);
    if (resendMs > 0) return { ok: false, error: 'Code already sent.', resendMs };
    const code = otp.formatOtp(randomInt(10 ** otp.OTP_LENGTH));
    try {
      await whatsappClient.sendText(config.whatsappRecipient, otp.settingsOtpMessage(code, changes));
    } catch {
      return { ok: false, error: 'Could not send the WhatsApp message. Try again.' };
    }
    settingsOtp = {
      record: otp.createOtpRecord(code, randomBytes(16).toString('hex'), now),
      changesKey: JSON.stringify(changes),
    };
    return { ok: true, resendMs: otp.RESEND_COOLDOWN_MS };
  });

  ipcMain.handle('quit:confirm', (event, input) => {
    if (!isQuitSender(event)) return { ok: false, errors: [] };
    if (!settingsEditable()) return { ok: false, errors: ['Quit is disabled during sleep hours.'] };
    const rejected = passcodeErrors(input);
    if (rejected) return { ok: false, errors: rejected };
    quitAllowed = true;
    app.quit();
    return { ok: true };
  });
};

const start = () => {
  app.on('second-instance', openSettings);
  app.on('window-all-closed', () => {});
  app.on('before-quit', (event) => {
    if (systemShuttingDown || quitAllowed) return;
    event.preventDefault();
    if (settingsEditable()) openQuit();
  });

  app.whenReady().then(() => {
    app.dock?.hide();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        {
          role: 'windowMenu',
          submenu: [{ label: 'Close Window', accelerator: 'CmdOrCtrl+W', click: (_item, win) => win?.close() }],
        },
      ]),
    );
    if (app.isPackaged && process.platform !== 'linux') {
      app.setLoginItemSettings({ openAtLogin: true });
    }

    store = createStore(app.getPath('userData'));
    config = store.loadConfig();
    state = store.loadState();
    history = store.loadHistory();
    if (isConfigured(config) && !state.trackingSince) updateState({ trackingSince: Date.now() });

    whatsappClient = whatsapp.createClient({
      authDir: whatsappAuthDir(),
      onStatus: sendWhatsAppUpdate,
      onQr: async (qr) => {
        whatsappQr = await QRCode.toDataURL(qr, { margin: 1, width: 240 });
        sendWhatsAppUpdate();
      },
    });
    if (whatsappClient.status !== 'unlinked') whatsappClient.connect();

    registerIpc();
    createTray();
    globalShortcut.register(POMODORO_SHORTCUT, showPomodoro);

    powerMonitor.on('resume', relockAfterWake);
    powerMonitor.on('unlock-screen', relockAfterWake);
    if (process.platform === 'darwin') {
      systemPreferences.subscribeWorkspaceNotification('NSWorkspaceActiveSpaceDidChangeNotification', bringLockToFront);
      // Catch apps switched to mid-session without waiting for the next tick.
      systemPreferences.subscribeWorkspaceNotification('NSWorkspaceDidActivateApplicationNotification', () => {
        if (inSession()) enforceBlocklist();
      });
    }
    powerMonitor.on('shutdown', () => (systemShuttingDown = true));
    screen.on('display-added', rebuildLock);
    screen.on('display-removed', rebuildLock);

    tick();
    if (pomodoroActive()) showTimer();
    setInterval(tick, TICK_MS);
    setInterval(updateTrayTitle, TITLE_TICK_MS);
    if (!isConfigured(config)) openSettings();
  });
};

if (app.requestSingleInstanceLock()) start();
else app.quit();
