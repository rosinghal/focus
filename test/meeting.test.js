const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REMINDER_DELAY_MS,
  MEET_URL,
  NO_SCAN,
  parseScan,
  meetingKind,
  isAway,
  awaySince,
  shouldRemind,
  scanScript,
  focusMeetScript,
} = require('../src/meeting');

const proc = (name) => ({ pid: 1, path: `/Applications/${name}.app/Contents/MacOS/${name}`, name });
const scan = (front, frontUrl = null, meetBrowsers = []) => ({ front, frontUrl, meetBrowsers });

test('MEET_URL matches meeting rooms only', () => {
  assert.equal(MEET_URL.test('https://meet.google.com/abc-defg-hij'), true);
  assert.equal(MEET_URL.test('https://meet.google.com/abc-defg-hij?authuser=1'), true);
  assert.equal(MEET_URL.test('https://meet.google.com/'), false);
  assert.equal(MEET_URL.test('https://meet.google.com/landing'), false);
  assert.equal(MEET_URL.test('https://example.com/?u=https://meet.google.com/abc-defg-hij'), false);
});

test('parseScan falls back to an empty scan on bad output', () => {
  assert.deepEqual(parseScan('nope'), NO_SCAN);
  assert.deepEqual(parseScan('{"front":"Slack","meetBrowsers":"x"}'), scan('Slack'));
  assert.deepEqual(parseScan(JSON.stringify(scan('Safari', 'https://a.com', ['Safari']))), scan('Safari', 'https://a.com', ['Safari']));
});

test('meetingKind detects a Zoom meeting first, then a Meet tab', () => {
  assert.equal(meetingKind([proc('zoom.us'), proc('CptHost')], scan('Slack', null, ['Safari'])), 'zoom');
  assert.equal(meetingKind([proc('zoom.us')], scan('Slack', null, ['Safari'])), 'meet');
  assert.equal(meetingKind([proc('zoom.us')], NO_SCAN), null);
});

test('isAway for Zoom means any app but Zoom and Focus', () => {
  assert.equal(isAway('zoom', scan('zoom.us')), false);
  assert.equal(isAway('zoom', scan('Slack')), true);
  assert.equal(isAway('zoom', scan('Electron')), false);
  assert.equal(isAway('zoom', scan(null)), false);
  assert.equal(isAway(null, scan('Slack')), false);
});

test('isAway for Meet needs the front tab of a browser to be the meeting', () => {
  const room = 'https://meet.google.com/abc-defg-hij';
  assert.equal(isAway('meet', scan('Google Chrome', room, ['Google Chrome'])), false);
  assert.equal(isAway('meet', scan('Google Chrome', 'https://github.com', ['Google Chrome'])), true);
  assert.equal(isAway('meet', scan('Safari', room, ['Google Chrome'])), true);
  assert.equal(isAway('meet', scan('Slack', null, ['Google Chrome'])), true);
});

test('the reminder waits a minute away and pauses while presenting', () => {
  assert.equal(awaySince(0, { away: true, presenting: false }, 1000), 1000);
  assert.equal(awaySince(1000, { away: true, presenting: false }, 5000), 1000);
  assert.equal(awaySince(1000, { away: false, presenting: false }, 5000), 0);
  assert.equal(awaySince(1000, { away: true, presenting: true }, 5000), 0);
  assert.equal(shouldRemind(1000, 1000 + REMINDER_DELAY_MS - 1), false);
  assert.equal(shouldRemind(1000, 1000 + REMINDER_DELAY_MS), true);
  assert.equal(shouldRemind(0, 1e12), false);
});

test('browser scripts embed the browsers and the Meet pattern', () => {
  for (const script of [scanScript(['Safari', 'Google Chrome']), focusMeetScript(['Safari'])]) {
    assert.match(script, /meet\\\.google\\\.com/);
    assert.match(script, /"Safari"/);
    assert.doesNotThrow(() => new Function(`return ${script}`));
  }
});
