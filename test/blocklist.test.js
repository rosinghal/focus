const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSite,
  normalizeApp,
  parseBlocklist,
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
} = require('../src/blocklist');

test('normalizeSite keeps only the domain', () => {
  assert.equal(normalizeSite('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(normalizeSite(' reddit.com:443/r/all '), 'reddit.com');
  assert.equal(normalizeSite('*.instagram.com'), 'instagram.com');
  assert.equal(normalizeSite('m.facebook.com'), 'm.facebook.com');
  assert.equal(normalizeSite('not a site'), null);
  assert.equal(normalizeSite('localhost'), null);
});

test('normalizeApp accepts names, bundles and paths', () => {
  assert.equal(normalizeApp('Discord'), 'Discord');
  assert.equal(normalizeApp('Steam.app'), 'Steam');
  assert.equal(normalizeApp('/Applications/Google Chrome.app/'), 'Google Chrome');
});

test('parseBlocklist normalises, dedupes and reports bad entries', () => {
  const ok = parseBlocklist({
    blockedSites: ['youtube.com', 'https://youtube.com/x', '', 'x.com'],
    blockedApps: ['Discord', 'discord.app', 'Steam'],
  });
  assert.deepEqual(ok, { errors: [], blockedSites: ['youtube.com', 'x.com'], blockedApps: ['Discord', 'Steam'] });

  const bad = parseBlocklist({ blockedSites: ['nope'], blockedApps: ['Focus', 'Finder.app'] });
  assert.deepEqual(bad.errors, ['"nope" is not a website address.', "Focus can't be blocked.", "Finder can't be blocked."]);
});

test('parseBlocklist treats missing lists as empty', () => {
  assert.deepEqual(parseBlocklist({}), { errors: [], blockedSites: [], blockedApps: [] });
});

test('blockedSite returns the matching domain for the domain and its subdomains only', () => {
  const sites = ['youtube.com', 'x.com'];
  assert.equal(blockedSite('https://youtube.com/', sites), 'youtube.com');
  assert.equal(blockedSite('https://m.youtube.com/watch', sites), 'youtube.com');
  assert.equal(blockedSite('http://YOUTUBE.com.:80/', sites), 'youtube.com');
  assert.equal(blockedSite('https://x.com/home', sites), 'x.com');
  assert.equal(blockedSite('https://notyoutube.com/', sites), null);
  assert.equal(blockedSite('https://example.com/?q=youtube.com', sites), null);
  assert.equal(blockedSite('https://youtube.com@evil.com/', sites), null);
  assert.equal(blockedSite('about:blank', sites), null);
  assert.equal(blockedSite(null, sites), null);
});

test('blockedPageUrl is a data page naming the site, linking back, and never blocked itself', () => {
  const url = blockedPageUrl('youtube.com', 'https://youtube.com/watch?v=1&t="2"', PAGE_STYLE, 'Entertainment mode');
  const html = decodeURIComponent(url);
  assert.match(url, /^data:text\/html/);
  assert.match(html, /youtube\.com is blocked/);
  assert.match(html, /Start Entertainment mode in the Focus window/);
  assert.match(html, /href="https:\/\/youtube\.com\/watch\?v=1&#38;t=&#34;2&#34;"/);
  assert.equal(blockedSite(url, ['youtube.com']), null);
});

test('sessions last 25 minutes and report whole minutes left', () => {
  assert.equal(SESSION_MS, 25 * 60 * 1000);
  assert.equal(isSessionActive(1000, 2000), true);
  assert.equal(isSessionActive(2000, 2000), false);
  assert.equal(isSessionActive(1000, 0), false);
  assert.equal(sessionMinutesLeft(0, SESSION_MS), 25);
  assert.equal(sessionMinutesLeft(0, 61 * 1000), 2);
  assert.equal(sessionMinutesLeft(5000, 0), 0);
});

const ps = [
  '  574 /Applications/Discord.app/Contents/MacOS/Discord',
  '  575 /Applications/Discord.app/Contents/Frameworks/Discord Helper.app/Contents/MacOS/Discord Helper',
  '  600 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '  700 /Applications/Safari.app/Contents/MacOS/Safari',
  '  800 /usr/sbin/cfprefsd',
].join('\n');

test('runningApps lists app bundles from ps output', () => {
  assert.deepEqual(runningApps(ps).map(({ pid, name }) => [pid, name]), [
    [574, 'Discord'],
    [575, 'Discord Helper'],
    [600, 'Google Chrome'],
    [700, 'Safari'],
  ]);
});

test('blockedProcesses matches app names case-insensitively', () => {
  assert.deepEqual(blockedProcesses(runningApps(ps), ['discord']).map((proc) => proc.pid), [574]);
  assert.deepEqual(blockedProcesses(runningApps(ps), []), []);
});

test('runningBrowsers finds scriptable browsers', () => {
  assert.deepEqual(runningBrowsers(runningApps(ps)), ['Safari', 'Google Chrome']);
});

const fakeBrowser = (windowUrls) => {
  const windows = windowUrls.map((urls) => {
    const tabs = urls.map((url) => ({ url }));
    return Object.assign(tabs, { url: () => tabs.map((tab) => tab.url) });
  });
  return { windows: windows.map((tabs) => ({ tabs })), urls: () => windows.map((tabs) => tabs.url()) };
};

test('appBundlePath trims the executable path to the .app bundle', () => {
  assert.equal(appBundlePath('/Applications/Discord.app/Contents/MacOS/Discord'), '/Applications/Discord.app');
});

test('sessionAllowedApps keeps blocked apps, browsers and Focus', () => {
  const allowed = sessionAllowedApps(['Discord']);
  assert.ok(['Discord', 'Safari', 'Google Chrome', 'Focus'].every((name) => allowed.includes(name)));
  assert.ok(!allowed.includes('Terminal'));
});

test('parseScriptList reads a JSON list and ignores anything else', () => {
  assert.deepEqual(parseScriptList('["youtube.com"]\n'), ['youtube.com']);
  assert.deepEqual(parseScriptList('3'), []);
  assert.deepEqual(parseScriptList(''), []);
});

const runTabsScript = (windowUrls, sites, sessionPage) => {
  const browser = fakeBrowser(windowUrls);
  let opened;
  const Application = (name) => ((opened = name), { windows: browser.windows });
  const script = enforceTabsScript('Google Chrome', sites, sessionPage);
  const hits = JSON.parse(new Function('Application', `return ${script}`)(Application));
  return { opened, hits, urls: browser.urls() };
};

test('enforceTabsScript replaces blocked tabs with the blocked page in every window', () => {
  const { opened, hits, urls } = runTabsScript(
    [
      ['https://youtube.com/a', 'https://example.com/', 'https://m.youtube.com/b'],
      ['https://x.com/', 'https://youtube.com/c'],
    ],
    ['youtube.com'],
  );
  const page = (url) => blockedPageUrl('youtube.com', url, PAGE_STYLE, 'Entertainment mode');
  assert.equal(opened, 'Google Chrome');
  assert.deepEqual(hits, ['youtube.com', 'youtube.com', 'youtube.com']);
  assert.deepEqual(urls, [
    [page('https://youtube.com/a'), 'https://example.com/', page('https://m.youtube.com/b')],
    ['https://x.com/', page('https://youtube.com/c')],
  ]);
});

test('enforceTabsScript offers Kid mode on the kid site', () => {
  const { hits, urls } = runTabsScript([['https://stick.cafe/play']], blockingSites(['youtube.com']));
  assert.deepEqual(hits, [KID_SITE]);
  assert.equal(urls[0][0], blockedPageUrl(KID_SITE, 'https://stick.cafe/play', PAGE_STYLE, 'Kid mode'));
});

test('enforceTabsScript in a session keeps allowed sites and replaces other web pages', () => {
  const { page } = sessionRules('session', { blockedSites: ['youtube.com'], blockedApps: [] });
  const { hits, urls } = runTabsScript(
    [['https://youtube.com/a', 'https://example.com/', 'chrome://newtab/'], ['https://x.com/']],
    ['youtube.com'],
    page,
  );
  const away = (url) => sessionPageUrl(page.title, page.text, PAGE_STYLE, url);
  assert.deepEqual(hits, []);
  assert.deepEqual(urls, [['https://youtube.com/a', away('https://example.com/'), 'chrome://newtab/'], [away('https://x.com/')]]);
});

test('sessionReturnUrl recovers the original URL from a session page only', () => {
  const url = 'https://example.com/a?b=1&c="-->"#d';
  assert.equal(sessionReturnUrl(sessionPageUrl('Kid mode', 'Only stick.cafe.', PAGE_STYLE, url)), url);
  assert.equal(sessionReturnUrl(blockedPageUrl('x.com', 'https://x.com/', PAGE_STYLE, 'Kid mode')), null);
  assert.equal(sessionReturnUrl('https://example.com/'), null);
  assert.equal(sessionReturnUrl('data:text/html,%E0%A4%A'), null);
});

test('enforceTabsScript after a session restores tabs, blocking any that are now blocked', () => {
  const { page } = sessionRules('session', { blockedSites: ['youtube.com'], blockedApps: [] });
  const away = (url) => sessionPageUrl(page.title, page.text, PAGE_STYLE, url);
  const { hits, urls } = runTabsScript(
    [[away('https://example.com/a'), away('https://x.com/'), 'https://github.com/']],
    ['x.com'],
  );
  assert.deepEqual(hits, ['x.com']);
  assert.deepEqual(urls, [
    ['https://example.com/a', blockedPageUrl('x.com', 'https://x.com/', PAGE_STYLE, 'Entertainment mode'), 'https://github.com/'],
  ]);
});

test('Kid mode lasts 31 minutes and allows only the kid site and browsers', () => {
  const config = { blockedSites: ['youtube.com'], blockedApps: ['Discord'] };
  const kid = sessionRules('kid', config);
  assert.equal(KID_SESSION_MS, 31 * 60 * 1000);
  assert.equal(kid.durationMs, KID_SESSION_MS);
  assert.deepEqual(kid.sites, ['stick.cafe']);
  assert.ok(kid.apps.includes('Safari') && !kid.apps.includes('Discord'));
  assert.equal(kid.page.title, 'Kid mode');
  const session = sessionRules('session', config);
  assert.equal(session.durationMs, SESSION_MS);
  assert.deepEqual(session.sites, ['youtube.com']);
  assert.ok(session.apps.includes('Discord'));
});

test('the kid site is always blocked outside a session, once', () => {
  assert.deepEqual(blockingSites([]), ['stick.cafe']);
  assert.deepEqual(blockingSites(['stick.cafe', 'x.com']), ['x.com', 'stick.cafe']);
  assert.equal(blockedPageAction('stick.cafe'), 'Kid mode');
  assert.equal(blockedPageAction('x.com'), 'Entertainment mode');
});

test('Kid mode is available once per calendar day', () => {
  const morning = new Date(2026, 9, 18, 8, 0).getTime();
  assert.equal(kidModeAvailable(new Date(2026, 9, 18, 20, 0), 0), true);
  assert.equal(kidModeAvailable(new Date(2026, 9, 18, 20, 0), morning), false);
  assert.equal(kidModeAvailable(new Date(2026, 9, 19, 0, 1), morning), true);
});

test('hideAppsScript hides visible regular apps that are not allowed', () => {
  const app = (bundle, { policy = 0, hidden = false } = {}) => ({
    bundle,
    activationPolicy: policy,
    hidden,
    bundleURL: { lastPathComponent: bundle },
    get hide() {
      this.hidden = true;
      return true;
    },
  });
  const apps = [
    app('Terminal.app'),
    app('Discord.app'),
    app('Safari.app'),
    app('Notes.app', { hidden: true }),
    app('Spotlight.app', { policy: 2 }),
  ];
  const $ = { NSWorkspace: { sharedWorkspace: { runningApplications: { count: apps.length, objectAtIndex: (i) => apps[i] } } } };
  const ObjC = { import: () => {}, unwrap: (value) => value };
  const script = hideAppsScript(sessionAllowedApps(['discord']));
  const hidden = JSON.parse(new Function('$', 'ObjC', `return ${script}`)($, ObjC));
  assert.deepEqual(hidden, ['Terminal']);
  assert.deepEqual(apps.filter((a) => a.hidden).map((a) => a.bundle), ['Terminal.app', 'Notes.app']);
});

test('unhideAppsScript unhides only the named apps that are still hidden', () => {
  const app = (bundle, hidden) => ({
    bundle,
    hidden,
    bundleURL: { lastPathComponent: bundle },
    get unhide() {
      this.hidden = false;
      return true;
    },
  });
  const apps = [app('Terminal.app', true), app('Notes.app', true), app('Mail.app', false)];
  const $ = { NSWorkspace: { sharedWorkspace: { runningApplications: { count: apps.length, objectAtIndex: (i) => apps[i] } } } };
  const ObjC = { import: () => {}, unwrap: (value) => value };
  new Function('$', 'ObjC', `return ${unhideAppsScript(['terminal', 'Mail'])}`)($, ObjC);
  assert.deepEqual(apps.map((a) => a.hidden), [false, true, false]);
});

