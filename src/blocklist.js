const SCRIPTABLE_BROWSERS = [
  'Safari',
  'Safari Technology Preview',
  'Google Chrome',
  'Google Chrome Canary',
  'Brave Browser',
  'Microsoft Edge',
  'Arc',
  'Vivaldi',
  'Chromium',
];

const SESSION_MS = 25 * 60 * 1000;
const KID_SITE = 'stick.cafe';
const KID_SESSION_MS = 31 * 60 * 1000;

const PROTECTED_APPS = ['focus', 'electron', 'finder', 'dock', 'loginwindow', 'systemuiserver', 'system settings'];

const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const normalizeSite = (input) => {
  const host = String(input)
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#:]/)[0]
    .replace(/^(\*\.|www\.)/, '');
  return DOMAIN.test(host) ? host : null;
};

const normalizeApp = (input) =>
  String(input)
    .trim()
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.app$/i, '')
    .trim() ?? '';

const unique = (values, key = (value) => value) =>
  values.filter((value, index) => values.findIndex((other) => key(other) === key(value)) === index);

const nonEmpty = (list = []) => list.map((entry) => String(entry).trim()).filter(Boolean);

const parseBlocklist = ({ blockedSites, blockedApps }) => {
  const errors = [];
  const sites = nonEmpty(blockedSites).map((entry) => {
    const site = normalizeSite(entry);
    if (!site) errors.push(`"${entry}" is not a website address.`);
    return site;
  });
  const apps = nonEmpty(blockedApps).map(normalizeApp).filter(Boolean);
  apps
    .filter((name) => PROTECTED_APPS.includes(name.toLowerCase()))
    .forEach((name) => errors.push(`${name} can't be blocked.`));
  return {
    errors,
    blockedSites: unique(sites.filter(Boolean)),
    blockedApps: unique(apps, (name) => name.toLowerCase()),
  };
};

// Kept self-contained: it is also serialised into the browser automation script.
// Google sign-in hops through YouTube (accounts.youtube.com, youtube.com/signin) to set its cookies.
function isSignInUrl(url) {
  return /^https?:\/\/(?:[^@/?#]*@)?(?:accounts\.[^/?#]*|[^/?#]+\/signin(?:[/?#]|$))/i.test(url || '');
}

// Kept self-contained (apart from isSignInUrl): it is also serialised into the browser automation script.
function blockedSite(url, sites) {
  const match = /^https?:\/\/(?:[^@/?#]*@)?([^/:?#]+)/i.exec(url || '');
  if (!match || isSignInUrl(url)) return null;
  const host = match[1].toLowerCase().replace(/\.$/, '');
  return sites.find((site) => host === site || host.endsWith('.' + site)) ?? null;
}

const PAGE_STYLE = [
  'html,body{height:100%;margin:0}',
  'body{display:flex;align-items:center;justify-content:center;background:#0b1020;color:#e8ecf8;',
  'font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;padding:0 24px}',
  '.moon{font-size:56px}h1{font-size:28px;margin:16px 0 8px}p{color:#8b93b0;margin:0 0 8px}a{color:#8ab4f8}',
].join('');

// Kept self-contained: it is also serialised into the browser automation script.
// Sites are validated domains, so only the URL needs escaping.
function blockedPageUrl(site, url, style, action) {
  const href = String(url).replace(/[&"<>]/g, (char) => '&#' + char.charCodeAt(0) + ';');
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(
      `<!doctype html><title>Blocked: ${site}</title><style>${style}</style>` +
        `<main><div class="moon">🌙</div><h1>${site} is blocked</h1>` +
        `<p>Start ${action} in the Focus window, then <a href="${href}">go back to ${site}</a>.</p></main>`,
    )
  );
}

const blockedPageAction = (site) => (site === KID_SITE ? 'Kid mode' : 'Entertainment mode');

// Kept self-contained: it is also serialised into the browser automation script.
// The original URL rides along in a comment so the tab can be restored once the session ends.
function sessionPageUrl(title, text, style, url) {
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(
      `<!doctype html><!--focus-return:${encodeURIComponent(url)}--><title>${title}</title><style>${style}</style>` +
        `<main><div class="moon">🌙</div><h1>${title}</h1><p>${text}</p>` +
        `<p>This page comes back when it ends.</p></main>`,
    )
  );
}

// Kept self-contained: it is also serialised into the browser automation script.
function sessionReturnUrl(url) {
  if (!/^data:text\/html/i.test(url || '')) return null;
  try {
    const match = /<!--focus-return:([^>]*)-->/.exec(decodeURIComponent(url.slice(url.indexOf(',') + 1)));
    return match ? decodeURIComponent(match[1]) : null;
  } catch (e) {
    return null;
  }
}

const blockingSites = (blockedSites) => [...blockedSites.filter((site) => site !== KID_SITE), KID_SITE];

const isSessionActive = (now, sessionUntil) => sessionUntil > now;

const kidModeAvailable = (now, kidUsedAt) => !kidUsedAt || new Date(kidUsedAt).toDateString() !== now.toDateString();

const sessionMinutesLeft = (now, sessionUntil) => Math.max(0, Math.ceil((sessionUntil - now) / 60000));

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

const logSession = (log, start, end) => [...log.filter((entry) => sameDay(entry.start, start)), { start, end }];

const endSessionLog = (log, now) =>
  log.map((entry, i) => (i === log.length - 1 ? { ...entry, end: Math.min(entry.end, now) } : entry));

const sessionStats = (log, now) => {
  const today = log.filter((entry) => sameDay(entry.start, now));
  const usedMs = today.reduce((sum, entry) => sum + Math.max(0, Math.min(entry.end, now) - entry.start), 0);
  return { sessions: today.length, minutes: Math.round(usedMs / 60000) };
};

const runningApps = (psOutput) =>
  psOutput
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*\/([^/]+)\.app\/Contents\/MacOS\/[^/]+)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, path, name]) => ({ pid: Number(pid), path, name }));

const blockedProcesses = (processes, apps) => {
  const names = apps.map((name) => name.toLowerCase());
  return processes.filter((proc) => names.includes(proc.name.toLowerCase()));
};

const runningBrowsers = (processes) =>
  SCRIPTABLE_BROWSERS.filter((browser) => processes.some((proc) => proc.name === browser));

const appBundlePath = (procPath) => procPath.replace(/(\.app)\/Contents\/MacOS\/[^/]+$/, '$1');

const sessionAllowedApps = (blockedApps) => [...blockedApps, ...SCRIPTABLE_BROWSERS, 'Focus', 'Electron'];

const sessionRules = (kind, { blockedSites, blockedApps }) =>
  kind === 'kid'
    ? {
        durationMs: KID_SESSION_MS,
        sites: [KID_SITE],
        apps: sessionAllowedApps([]),
        page: { title: 'Kid mode', text: `Only ${KID_SITE} works until Kid mode ends.` },
      }
    : {
        durationMs: SESSION_MS,
        sites: blockedSites,
        apps: sessionAllowedApps(blockedApps),
        page: {
          title: 'Entertainment mode',
          text: 'Only your entertainment sites and apps work until Entertainment mode ends.',
        },
      };

// Without a session page, blocked tabs go to the blocked page, tabs left on a session page go back to their URL, and
// the script returns the sites it hit. With one, it does the reverse: every web page outside `sites` goes to the
// session page.
const enforceTabsScript = (browser, sites, sessionPage = null) => `(() => {
  const isSignInUrl = ${isSignInUrl.toString()};
  const blockedSite = ${blockedSite.toString()};
  const blockedPageUrl = ${blockedPageUrl.toString()};
  const sessionPageUrl = ${sessionPageUrl.toString()};
  const sessionReturnUrl = ${sessionReturnUrl.toString()};
  const sites = ${JSON.stringify(sites)};
  const actions = ${JSON.stringify(Object.fromEntries(sites.map((site) => [site, blockedPageAction(site)])))};
  const style = ${JSON.stringify(PAGE_STYLE)};
  const sessionPage = ${JSON.stringify(sessionPage)};
  const windows = Application(${JSON.stringify(browser)}).windows;
  const hits = [];
  for (let w = 0; w < windows.length; w++) {
    let urls;
    try { urls = windows[w].tabs.url(); } catch (e) { continue; }
    urls.forEach((url, t) => {
      const target = sessionPage ? url : sessionReturnUrl(url) || url;
      const site = blockedSite(target, sites);
      const page = sessionPage
        ? (!site && /^https?:/i.test(url || '') && !isSignInUrl(url) ? sessionPageUrl(sessionPage.title, sessionPage.text, style, url) : null)
        : site ? blockedPageUrl(site, target, style, actions[site]) : target !== url && target;
      if (!page) return;
      windows[w].tabs[t].url = page;
      if (site) hits.push(site);
    });
  }
  return JSON.stringify(hits);
})()`;

// NSRunningApplication.hide needs no Accessibility permission, unlike System Events.
const hideAppsScript = (allowedApps) => `(() => {
  ObjC.import('AppKit');
  const allowed = ${JSON.stringify(allowedApps.map((name) => name.toLowerCase()))};
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  const hidden = [];
  for (let i = 0; i < apps.count; i++) {
    const app = apps.objectAtIndex(i);
    if (Number(app.activationPolicy) !== 0 || app.hidden) continue;
    const bundle = ObjC.unwrap(app.bundleURL.lastPathComponent) || '';
    const name = bundle.replace(/\.app$/i, '');
    if (!name || allowed.includes(name.toLowerCase())) continue;
    app.hide;
    hidden.push(name);
  }
  return JSON.stringify(hidden);
})()`;

const unhideAppsScript = (names) => `(() => {
  ObjC.import('AppKit');
  const names = ${JSON.stringify(names.map((name) => name.toLowerCase()))};
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  for (let i = 0; i < apps.count; i++) {
    const app = apps.objectAtIndex(i);
    const name = (ObjC.unwrap(app.bundleURL.lastPathComponent) || '').replace(/\\.app$/i, '');
    if (app.hidden && names.includes(name.toLowerCase())) app.unhide;
  }
})()`;

const parseScriptList = (stdout) => {
  try {
    const list = JSON.parse(stdout);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

module.exports = {
  SCRIPTABLE_BROWSERS,
  normalizeSite,
  normalizeApp,
  parseBlocklist,
  isSignInUrl,
  blockedSite,
  blockedPageUrl,
  PAGE_STYLE,
  blockedPageAction,
  sessionPageUrl,
  sessionReturnUrl,
  SESSION_MS,
  KID_SITE,
  KID_SESSION_MS,
  blockingSites,
  isSessionActive,
  kidModeAvailable,
  sessionMinutesLeft,
  logSession,
  endSessionLog,
  sessionStats,
  runningApps,
  blockedProcesses,
  runningBrowsers,
  appBundlePath,
  sessionAllowedApps,
  sessionRules,
  enforceTabsScript,
  hideAppsScript,
  unhideAppsScript,
  parseScriptList,
};
