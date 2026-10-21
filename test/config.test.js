const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  withDefaults,
  parseRecipient,
  isConfigured,
  applySettings,
  restrictionChanges,
  toPublicSettings,
} = require('../src/config');
const { createPasscodeRecord, passcodeMatches } = require('../src/unlock');
const { createStore } = require('../src/store');

const schedule = { start: '20:00', end: '08:00' };
const configured = () => ({
  schedule,
  passcode: createPasscodeRecord('1234', 'old-salt'),
  blockedSites: [],
  blockedApps: [],
  clickupToken: null,
  clickupTeamId: '1234567',
  clickupListId: '900000000001',
  whatsappRecipient: '+447700900123',
});

test('defaults to 8 PM – 8 AM and needs a passcode', () => {
  assert.deepEqual(withDefaults().schedule, schedule);
  assert.equal(isConfigured(withDefaults()), false);
  assert.equal(isConfigured(configured()), true);
});

test('ignores fields from the old email-based config', () => {
  const legacy = withDefaults({ email: 'x@y.z', smtp: { pass: 'p' }, schedule });
  assert.deepEqual(legacy, {
    schedule,
    passcode: null,
    blockedSites: [],
    blockedApps: [],
    clickupToken: null,
    clickupTeamId: null,
    clickupListId: null,
    whatsappRecipient: null,
  });
});

test('first setup requires a new passcode', () => {
  const { errors } = applySettings(withDefaults(), { schedule }, 'salt');
  assert.ok(errors.includes('Set a 4-digit passcode.'));
});

test('first setup stores a hashed passcode', () => {
  const input = { schedule, newPasscode: '5678', confirmPasscode: '5678' };
  const { errors, config } = applySettings(withDefaults(), input, 'salt');
  assert.deepEqual(errors, []);
  assert.equal(passcodeMatches(config.passcode, '5678'), true);
});

test('rejects invalid or mismatched new passcodes', () => {
  const bad = applySettings(withDefaults(), { schedule, newPasscode: '12a', confirmPasscode: '12a' }, 's');
  assert.ok(bad.errors.includes('Passcode must be exactly 4 digits.'));
  const mismatch = applySettings(withDefaults(), { schedule, newPasscode: '1111', confirmPasscode: '2222' }, 's');
  assert.ok(mismatch.errors.includes('New passcodes do not match.'));
});

test('saving no longer checks the current passcode', () => {
  const input = { schedule: { start: '22:00', end: '06:00' } };
  const { errors, config } = applySettings(configured(), input, 's');
  assert.deepEqual(errors, []);
  assert.deepEqual(config.schedule, input.schedule);
  assert.equal(passcodeMatches(config.passcode, '1234'), true);
});

test('a blank ClickUp token keeps the saved one and a bad one is rejected', () => {
  const current = { ...configured(), clickupToken: 'pk_old' };
  assert.equal(applySettings(current, { schedule }, 's').config.clickupToken, 'pk_old');
  assert.equal(applySettings(current, { schedule, clickupToken: ' pk_new_1 ' }, 's').config.clickupToken, 'pk_new_1');
  assert.equal(applySettings(current, { schedule, clickupToken: 'abc' }, 's').errors.length, 1);
  assert.deepEqual(changesFor({ clickupToken: 'pk_new' }, current), []);
});

test('ClickUp workspace and list accept ids or links and clear when blank', () => {
  const link = 'https://app.clickup.com/42/v/l/6-777-1';
  const { config } = applySettings(configured(), { schedule, clickupTeamId: link, clickupListId: link }, 's');
  assert.deepEqual([config.clickupTeamId, config.clickupListId], ['42', '777']);
  const blank = applySettings(configured(), { schedule, clickupTeamId: ' ', clickupListId: '' }, 's').config;
  assert.deepEqual([blank.clickupTeamId, blank.clickupListId], [null, null]);
  assert.equal(applySettings(configured(), { schedule, clickupTeamId: 'x', clickupListId: 'y' }, 's').errors.length, 2);
});

const changesFor = (input, current = configured()) =>
  restrictionChanges(
    current,
    applySettings(current, { schedule, whatsappRecipient: current.whatsappRecipient, ...input }, 's').config,
  );

test('WhatsApp numbers need a country code and are normalised', () => {
  assert.equal(parseRecipient('+44 7700 900123'), '+447700900123');
  assert.equal(parseRecipient('1 (555) 010-9999'), '+15550109999');
  assert.equal(parseRecipient('12345'), null);
  assert.equal(parseRecipient('+0 7700 900123'), null);
  assert.equal(parseRecipient('abc'), null);
  const saved = applySettings(configured(), { schedule, whatsappRecipient: ' +1 555 010 9999 ' }, 's').config;
  assert.equal(saved.whatsappRecipient, '+15550109999');
  assert.equal(applySettings(configured(), { schedule, whatsappRecipient: '' }, 's').config.whatsappRecipient, null);
  assert.equal(applySettings(configured(), { schedule, whatsappRecipient: '555' }, 's').errors.length, 1);
});

test('a new WhatsApp recipient needs approval, removing one does not', () => {
  assert.deepEqual(changesFor({ whatsappRecipient: '+1 555 010 9999' }), ['WhatsApp codes go to +15550109999']);
  assert.deepEqual(changesFor({ whatsappRecipient: '+447700900123' }), []);
  assert.deepEqual(changesFor({ whatsappRecipient: '' }), []);
  assert.deepEqual(changesFor({ whatsappRecipient: '+15550109999' }, { ...configured(), whatsappRecipient: null }), [
    'WhatsApp codes go to +15550109999',
  ]);
});

test('tightening or neutral changes need no approval', () => {
  assert.deepEqual(changesFor({}), []);
  assert.deepEqual(changesFor({ schedule: { start: '19:00', end: '09:00' } }), []);
  assert.deepEqual(changesFor({ blockedSites: ['reddit.com'], blockedApps: ['Steam'] }), []);
  const blocking = { ...configured(), blockedSites: ['reddit.com'], blockedApps: ['Steam'] };
  assert.deepEqual(changesFor({ blockedSites: ['www.reddit.com', 'x.com'], blockedApps: ['Steam'] }, blocking), []);
});

test('loosening changes are listed', () => {
  const blocking = { ...configured(), blockedSites: ['reddit.com', 'x.com'], blockedApps: ['Steam'] };
  assert.deepEqual(
    changesFor({ schedule: { start: '21:00', end: '08:00' }, blockedSites: ['x.com'], newPasscode: '9999', confirmPasscode: '9999' }, blocking),
    [
      'Sleep hours: 8:00 PM – 8:00 AM → 9:00 PM – 8:00 AM',
      'Unblock sites: reddit.com',
      'Unblock apps: Steam',
      'Change the passcode',
    ],
  );
});

test('shifting sleep hours counts as loosening', () => {
  assert.equal(changesFor({ schedule: { start: '21:00', end: '09:00' } }).length, 1);
});

test('first setup needs no approval', () => {
  const input = { schedule, newPasscode: '5678', confirmPasscode: '5678', blockedSites: [] };
  assert.deepEqual(restrictionChanges(withDefaults(), applySettings(withDefaults(), input, 's').config), []);
});

test('changing the passcode replaces it', () => {
  const input = { schedule, newPasscode: '9999', confirmPasscode: '9999' };
  const { config } = applySettings(configured(), input, 'new-salt');
  assert.equal(passcodeMatches(config.passcode, '9999'), true);
  assert.equal(passcodeMatches(config.passcode, '1234'), false);
});

test('saves normalised blocklists', () => {
  const input = { schedule, blockedSites: ['https://www.reddit.com/'], blockedApps: ['Steam.app'] };
  const { errors, config } = applySettings(configured(), input, 's');
  assert.deepEqual(errors, []);
  assert.deepEqual(config.blockedSites, ['reddit.com']);
  assert.deepEqual(config.blockedApps, ['Steam']);
});

test('rejects invalid blocklist entries', () => {
  const input = { schedule, blockedSites: ['nope'], blockedApps: ['Focus'] };
  assert.deepEqual(applySettings(configured(), input, 's').errors, ['"nope" is not a website address.', "Focus can't be blocked."]);
});

test('rejects invalid schedules', () => {
  const input = { schedule: { start: '09:00', end: '09:00' } };
  assert.ok(applySettings(configured(), input, 's').errors.includes('Start and end time must differ.'));
  const badTime = { schedule: { start: '25:00', end: '08:00' } };
  assert.ok(applySettings(configured(), badTime, 's').errors.includes('Start time must be HH:MM.'));
});

test('toPublicSettings never exposes the passcode hash', () => {
  assert.deepEqual(toPublicSettings(configured()), {
    schedule,
    hasPasscode: true,
    blockedSites: [],
    blockedApps: [],
    hasClickupToken: false,
    clickupTeamId: '1234567',
    clickupListId: '900000000001',
    whatsappRecipient: '+447700900123',
  });
  const withToken = { ...configured(), clickupToken: 'pk_secret' };
  assert.equal(JSON.stringify(toPublicSettings(withToken)).includes('pk_secret'), false);
  assert.equal(toPublicSettings(withToken).hasClickupToken, true);
});

test('store round-trips config, state and history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-'));
  const store = createStore(dir);
  assert.deepEqual(store.loadConfig(), withDefaults());
  assert.deepEqual(store.loadState(), {
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
  });
  assert.deepEqual(store.loadHistory(), []);
  store.saveHistory([{ type: 'grace', at: 1 }]);
  assert.deepEqual(store.loadHistory(), [{ type: 'grace', at: 1 }]);

  store.saveConfig(configured());
  assert.deepEqual(store.loadConfig(), configured());

  const saved = { bypassUntil: 123, graceUsedAt: 45, trackingSince: 6, sessionUntil: 7, sessionKind: 'kid', kidUsedAt: 8, hiddenApps: ['Notes'], pomodoro: null, pomodoroSummary: null, pomodoroLog: [] };
  store.saveState(saved);
  assert.deepEqual(store.loadState(), saved);
  fs.rmSync(dir, { recursive: true });
});
