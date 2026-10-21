const { isValidTime, scheduleLoosened, formatTime } = require('./schedule');
const { isValidPasscode, createPasscodeRecord } = require('./unlock');
const { parseBlocklist } = require('./blocklist');
const { isValidToken, parseTeamId, parseListId } = require('./clickup');

const DEFAULT_SCHEDULE = { start: '20:00', end: '08:00' };

const withDefaults = (config = {}) => ({
  schedule: { ...DEFAULT_SCHEDULE, ...config.schedule },
  passcode: config.passcode ?? null,
  blockedSites: config.blockedSites ?? [],
  blockedApps: config.blockedApps ?? [],
  clickupToken: config.clickupToken ?? null,
  clickupTeamId: config.clickupTeamId ?? null,
  clickupListId: config.clickupListId ?? null,
  whatsappRecipient: config.whatsappRecipient ?? null,
});

// International format with country code, e.g. "+44 7700 900123"; separators are dropped.
const parseRecipient = (input) => {
  const text = String(input ?? '').replace(/[\s().-]/g, '');
  return /^\+?[1-9]\d{7,14}$/.test(text) ? `+${text.replace(/^\+/, '')}` : null;
};

const isConfigured = (config) => Boolean(config.passcode);

const scheduleErrors = ({ start, end }) => {
  const errors = [];
  if (!isValidTime(start)) errors.push('Start time must be HH:MM.');
  if (!isValidTime(end)) errors.push('End time must be HH:MM.');
  if (start === end) errors.push('Start and end time must differ.');
  return errors;
};

const passcodeErrors = (current, { newPasscode = '', confirmPasscode = '' }) => {
  const errors = [];
  if (!current.passcode && !newPasscode) errors.push('Set a 4-digit passcode.');
  if (newPasscode && !isValidPasscode(newPasscode)) errors.push('Passcode must be exactly 4 digits.');
  if (newPasscode !== confirmPasscode) errors.push('New passcodes do not match.');
  return errors;
};

const tokenErrors = (token) =>
  token && !isValidToken(token) ? ['The ClickUp token should start with pk_ (Settings › Apps in ClickUp).'] : [];

const isBlank = (value) => !String(value ?? '').trim();

const clickupIds = ({ clickupTeamId = '', clickupListId = '' }) => {
  const teamId = isBlank(clickupTeamId) ? null : parseTeamId(clickupTeamId);
  const listId = isBlank(clickupListId) ? null : parseListId(clickupListId);
  const errors = [
    ...(teamId || isBlank(clickupTeamId) ? [] : ['The ClickUp workspace must be a number or a ClickUp link.']),
    ...(listId || isBlank(clickupListId) ? [] : ['The ClickUp list must be a number or a link to a ClickUp list.']),
  ];
  return { errors, clickupTeamId: teamId, clickupListId: listId };
};

// A blank token field keeps the saved token.
const applySettings = (current, input, salt) => {
  const schedule = { start: input.schedule?.start, end: input.schedule?.end };
  const { errors: blocklistErrors, blockedSites, blockedApps } = parseBlocklist(input);
  const token = String(input.clickupToken ?? '').trim();
  const ids = clickupIds(input);
  const whatsappRecipient = isBlank(input.whatsappRecipient) ? null : parseRecipient(input.whatsappRecipient);
  const recipientErrors =
    whatsappRecipient || isBlank(input.whatsappRecipient)
      ? []
      : ['The WhatsApp number needs the country code, e.g. +44 7700 900123.'];
  const errors = [
    ...scheduleErrors(schedule),
    ...passcodeErrors(current, input),
    ...blocklistErrors,
    ...tokenErrors(token),
    ...ids.errors,
    ...recipientErrors,
  ];
  if (errors.length) return { errors };
  const passcode = input.newPasscode ? createPasscodeRecord(input.newPasscode, salt) : current.passcode;
  const clickupToken = token || (current.clickupToken ?? null);
  const { clickupTeamId, clickupListId } = ids;
  return {
    errors: [],
    config: {
      schedule,
      passcode,
      blockedSites,
      blockedApps,
      clickupToken,
      clickupTeamId,
      clickupListId,
      whatsappRecipient,
    },
  };
};

const formatSchedule = ({ start, end }) => `${formatTime(start)} – ${formatTime(end)}`;

const removed = (before, after) => before.filter((entry) => !after.includes(entry));

// Changes that weaken blocking; anything else (tightening or neutral) saves without approval.
const restrictionChanges = (current, next) => {
  if (!current.passcode) return [];
  const changes = [];
  if (scheduleLoosened(current.schedule, next.schedule)) {
    changes.push(`Sleep hours: ${formatSchedule(current.schedule)} → ${formatSchedule(next.schedule)}`);
  }
  const sites = removed(current.blockedSites, next.blockedSites);
  if (sites.length) changes.push(`Unblock sites: ${sites.join(', ')}`);
  const apps = removed(current.blockedApps, next.blockedApps);
  if (apps.length) changes.push(`Unblock apps: ${apps.join(', ')}`);
  if (next.passcode !== current.passcode) changes.push('Change the passcode');
  // Whoever gets the codes can approve unlocks, so a new recipient needs approval; removing one only tightens.
  if (next.whatsappRecipient && next.whatsappRecipient !== current.whatsappRecipient) {
    changes.push(`WhatsApp codes go to ${next.whatsappRecipient}`);
  }
  return changes;
};

const toPublicSettings = (config) => ({
  schedule: config.schedule,
  hasPasscode: Boolean(config.passcode),
  blockedSites: config.blockedSites,
  blockedApps: config.blockedApps,
  hasClickupToken: Boolean(config.clickupToken),
  clickupTeamId: config.clickupTeamId,
  clickupListId: config.clickupListId,
  whatsappRecipient: config.whatsappRecipient,
});

module.exports = {
  DEFAULT_SCHEDULE,
  withDefaults,
  parseRecipient,
  isConfigured,
  applySettings,
  restrictionChanges,
  toPublicSettings,
};
