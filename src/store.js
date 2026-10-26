const fs = require('node:fs');
const path = require('node:path');
const { withDefaults } = require('./config');

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
};

const createStore = (dir) => {
  const configFile = path.join(dir, 'config.json');
  const stateFile = path.join(dir, 'state.json');
  const historyFile = path.join(dir, 'history.json');
  return {
    loadConfig: () => withDefaults(readJson(configFile)),
    saveConfig: (config) => writeJson(configFile, config),
    loadState: () => ({
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
      sessionLog: [],
      morningPromptedAt: 0,
      ...readJson(stateFile),
    }),
    saveState: (state) => writeJson(stateFile, state),
    loadHistory: () => readJson(historyFile).events ?? [],
    saveHistory: (events) => writeJson(historyFile, { events }),
  };
};

module.exports = { createStore };
