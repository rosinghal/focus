const REMINDER_DELAY_MS = 60 * 1000;
const ZOOM_APP = 'zoom.us';
// Zoom runs CptHost only while a meeting is open.
const ZOOM_MEETING_PROCESS = 'CptHost';
// Some links put the code under a prefix such as /meet/ or /_meet/.
const MEET_URL = /^https:\/\/meet\.google\.com\/(?:_?meet\/)?[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/i;
const NEUTRAL_APPS = ['focus', 'electron'];

const MEETING_NAMES = { zoom: 'Zoom', meet: 'Google Meet' };

const FULL_SCREEN_KEYS = { zoom: '⇧⌘F', meet: '⌃⌘F' };

const NO_SCAN = { front: null, frontUrl: null, frontFullScreen: null, meetBrowsers: [] };

const parseScan = (stdout) => {
  try {
    const scan = JSON.parse(stdout);
    return {
      front: typeof scan.front === 'string' ? scan.front : null,
      frontUrl: typeof scan.frontUrl === 'string' ? scan.frontUrl : null,
      frontFullScreen: typeof scan.frontFullScreen === 'boolean' ? scan.frontFullScreen : null,
      meetBrowsers: Array.isArray(scan.meetBrowsers) ? scan.meetBrowsers : [],
    };
  } catch {
    return NO_SCAN;
  }
};

const meetingKind = (processes, scan) => {
  if (processes.some((proc) => proc.name === ZOOM_MEETING_PROCESS)) return 'zoom';
  return scan.meetBrowsers.length ? 'meet' : null;
};

const onMeeting = (kind, { front, frontUrl, meetBrowsers }) =>
  kind === 'zoom' ? front === ZOOM_APP : meetBrowsers.includes(front) && MEET_URL.test(frontUrl ?? '');

// Focus's own windows don't count as leaving the meeting, and an unknown front app gives the benefit of the doubt.
const isAway = (kind, scan) => {
  if (!kind || !scan.front || NEUTRAL_APPS.includes(scan.front.toLowerCase())) return false;
  return !onMeeting(kind, scan);
};

const suggestFullScreen = ({ kind, presenting, fullScreenDismissed }, scan) =>
  Boolean(kind) && !presenting && !fullScreenDismissed && scan.frontFullScreen === false && onMeeting(kind, scan);

const reminderKind = (meetingState, scan, now) => {
  if (shouldRemind(meetingState.awaySince, now)) return 'away';
  return !meetingState.awaySince && suggestFullScreen(meetingState, scan) ? 'fullscreen' : null;
};

const awaySince = (since, { away, presenting }, now) => (away && !presenting ? since || now : 0);

const shouldRemind = (since, now) => since > 0 && now - since >= REMINDER_DELAY_MS;

// Lists browsers with a Meet tab, the front tab's URL, and whether the front app is full screen. With Accessibility
// that is AXFullScreen; without it, window bounds (no permission needed) are the fallback, and since full screen on a
// notched display leaves the strip under the menu bar empty, a window filling the area below it counts. Each browser
// asks once for Automation permission; until then it is skipped.
const scanScript = (browsers, { accessibility = false } = {}) => `(() => {
  ObjC.import('AppKit');
  ObjC.import('CoreGraphics');
  const meet = ${MEET_URL};
  const browsers = ${JSON.stringify(browsers)};
  const frontApp = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const front = frontApp ? (ObjC.unwrap(frontApp.bundleURL.lastPathComponent) || '').replace(/\\.app$/i, '') : null;
  let frontFullScreen = null;
  try {
    const pid = frontApp.processIdentifier;
    if (${accessibility}) {
      frontFullScreen = Application('System Events')
        .processes.whose({ unixId: pid })[0]
        .windows()
        .some((w) => w.attributes.byName('AXFullScreen').value() === true);
    } else {
      const screens = $.NSScreen.screens;
      const areas = [];
      for (let i = 0; i < screens.count; i++) {
        const screen = screens.objectAtIndex(i);
        const frame = screen.frame;
        const visible = screen.visibleFrame;
        const menuBar = frame.origin.y + frame.size.height - (visible.origin.y + visible.size.height);
        areas.push([frame.size.width, frame.size.height - menuBar]);
      }
      const windows = ObjC.deepUnwrap(
        ObjC.castRefToObject(
          $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID),
        ),
      );
      frontFullScreen = windows.some(
        (w) =>
          w.kCGWindowOwnerPID === pid &&
          w.kCGWindowLayer === 0 &&
          areas.some(([width, height]) => w.kCGWindowBounds.Width === width && w.kCGWindowBounds.Height >= height),
      );
    }
  } catch (e) {}
  const meetBrowsers = [];
  let frontUrl = null;
  for (const name of browsers) {
    try {
      const windows = Application(name).windows;
      for (let w = 0; w < windows.length; w++) {
        if (windows[w].tabs.url().some((url) => meet.test(url || ''))) {
          meetBrowsers.push(name);
          break;
        }
      }
      if (name === front && windows.length) {
        try { frontUrl = windows[0].activeTab.url(); } catch (e) { frontUrl = windows[0].currentTab.url(); }
      }
    } catch (e) {}
  }
  return JSON.stringify({ front, frontUrl, frontFullScreen, meetBrowsers });
})()`;

// Setting AXFullScreen through System Events needs Accessibility permission. Zoom's home window may be in front of
// the meeting, so its meeting window is preferred.
const fullScreenScript = (appName) => `(() => {
  const app = Application(${JSON.stringify(appName)});
  app.activate();
  const windows = Application('System Events').processes.byName(${JSON.stringify(appName)}).windows();
  const win = (${JSON.stringify(appName === ZOOM_APP)} && windows.find((w) => /meeting/i.test(w.name() || ''))) || windows[0];
  if (!win) return '';
  win.attributes.byName('AXFullScreen').value = true;
  return 'ok';
})()`;

// Safari has currentTab; Chromium browsers have activeTabIndex.
const focusMeetScript = (browsers) => `(() => {
  const meet = ${MEET_URL};
  for (const name of ${JSON.stringify(browsers)}) {
    try {
      const app = Application(name);
      const windows = app.windows;
      for (let w = 0; w < windows.length; w++) {
        const t = windows[w].tabs.url().findIndex((url) => meet.test(url || ''));
        if (t < 0) continue;
        const win = windows[w];
        try { win.activeTabIndex = t + 1; } catch (e) { win.currentTab = win.tabs[t]; }
        win.index = 1;
        app.activate();
        return 'ok';
      }
    } catch (e) {}
  }
  return '';
})()`;

module.exports = {
  REMINDER_DELAY_MS,
  ZOOM_APP,
  MEET_URL,
  MEETING_NAMES,
  FULL_SCREEN_KEYS,
  NO_SCAN,
  parseScan,
  meetingKind,
  isAway,
  awaySince,
  shouldRemind,
  suggestFullScreen,
  reminderKind,
  scanScript,
  fullScreenScript,
  focusMeetScript,
};
