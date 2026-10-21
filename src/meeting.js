const REMINDER_DELAY_MS = 60 * 1000;
const ZOOM_APP = 'zoom.us';
// Zoom runs CptHost only while a meeting is open.
const ZOOM_MEETING_PROCESS = 'CptHost';
const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/i;
const NEUTRAL_APPS = ['focus', 'electron'];

const MEETING_NAMES = { zoom: 'Zoom', meet: 'Google Meet' };

const NO_SCAN = { front: null, frontUrl: null, meetBrowsers: [] };

const parseScan = (stdout) => {
  try {
    const scan = JSON.parse(stdout);
    return {
      front: typeof scan.front === 'string' ? scan.front : null,
      frontUrl: typeof scan.frontUrl === 'string' ? scan.frontUrl : null,
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

// Focus's own windows don't count as leaving the meeting, and an unknown front app gives the benefit of the doubt.
const isAway = (kind, { front, frontUrl, meetBrowsers }) => {
  if (!kind || !front || NEUTRAL_APPS.includes(front.toLowerCase())) return false;
  if (kind === 'zoom') return front !== ZOOM_APP;
  return !(meetBrowsers.includes(front) && MEET_URL.test(frontUrl ?? ''));
};

const awaySince = (since, { away, presenting }, now) => (away && !presenting ? since || now : 0);

const shouldRemind = (since, now) => since > 0 && now - since >= REMINDER_DELAY_MS;

// Lists browsers with a Meet tab and the front tab's URL. Each browser asks once for Automation permission; until
// then it is skipped.
const scanScript = (browsers) => `(() => {
  ObjC.import('AppKit');
  const meet = ${MEET_URL};
  const browsers = ${JSON.stringify(browsers)};
  const frontApp = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const front = frontApp ? (ObjC.unwrap(frontApp.bundleURL.lastPathComponent) || '').replace(/\\.app$/i, '') : null;
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
  return JSON.stringify({ front, frontUrl, meetBrowsers });
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
  NO_SCAN,
  parseScan,
  meetingKind,
  isAway,
  awaySince,
  shouldRemind,
  scanScript,
  focusMeetScript,
};
