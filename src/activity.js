// Pure logic for judging a pomodoro: what the user did during focus (one sample per tick)
// and the prompt/verdict that DeepSeek turns into a focus level.
const MAX_SAMPLES = 720; // one sample per 5 s tick covers a whole hour of focus
const MAX_LINES = 25;
const DESCRIPTION_LIMIT = 1500;
const NOTE_LIMIT = 140;
// The lock screen and Focus's own windows sit in front without saying anything about the session.
const NEUTRAL_APPS = ['focus', 'electron'];

const NO_SAMPLE = { front: null, url: null, title: null };

const parseScan = (stdout) => {
  try {
    const scan = JSON.parse(stdout);
    return {
      front: typeof scan.front === 'string' ? scan.front : null,
      url: typeof scan.url === 'string' ? scan.url : null,
      title: typeof scan.title === 'string' ? scan.title : null,
    };
  } catch {
    return NO_SAMPLE;
  }
};

// Only the frontmost app says what the user is doing; a tab supplies the page it sat on.
const toSample = ({ front, url, title } = {}) =>
  !front || NEUTRAL_APPS.includes(front.toLowerCase())
    ? null
    : { app: front, url: url ?? null, title: title ?? null };

const sameSample = (a, b) => a.app === b.app && a.url === b.url && a.title === b.title;

// Consecutive duplicates are dropped; the timeline later counts the full stretch between changes.
const addSample = (log, sample) => (sameSample(log.at(-1) ?? {}, sample) ? log : [...log, sample].slice(-MAX_SAMPLES));

const hostOf = (url) => /^https?:\/\/([^/:?#]+)/i.exec(url ?? '')?.[1]?.replace(/^www\./, '') ?? '';

// "Page title · site.com" — the title drops the part that doubles the host.
const pageLabel = (sample) => {
  const host = /^https?:/i.test(sample.url ?? '') ? hostOf(sample.url) : '';
  const parts = [String(sample.title ?? '').trim(), host].filter(Boolean);
  const deduped = [...new Set(parts.map((part) => part.toLowerCase()))];
  return parts.filter((part) => deduped.includes(part.toLowerCase())).join(' · ');
};

const label = (sample) => {
  const page = pageLabel(sample);
  return page ? `${sample.app} – ${page}` : sample.app;
};

// One line per app and page, busiest first: `7 min · Safari – GitHub · github.com`.
const timeline = (samples, endedAt) => {
  const used = new Map();
  samples.forEach((sample, index) => {
    const until = index + 1 < samples.length ? samples[index + 1].at : endedAt;
    const { app } = sample;
    const text = label(sample);
    const entry = used.get(text) ?? { app, text, ms: 0 };
    used.set(text, { ...entry, ms: entry.ms + Math.max(0, until - sample.at) });
  });
  return (
    [...used.values()]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, MAX_LINES)
      .map(({ text, ms }) => `${Math.max(1, Math.round(ms / 60000))} min · ${text}`)
      .join('\n') || null
  );
};

const reviewPrompt = ({ task, timeline, focusedMs }) => {
  const minutes = Math.max(1, Math.round(focusedMs / 60000));
  const lines = [
    task?.name && `- name: ${task.name}`,
    task?.list && `- list: ${task.list}`,
    task?.status && `- status: ${task.status}`,
    task?.tags?.length && `- tags: ${task.tags.join(', ')}`,
    task?.description && `- description: ${String(task.description).slice(0, DESCRIPTION_LIMIT)}`,
  ].filter(Boolean);
  return [
    'You judge how well a person focused. Below is the ClickUp task they were supposed to work on, and what their',
    'Mac had in front while they did it: the frontmost app and open browser pages, sampled every 5 seconds and',
    `merged. Rate the ${minutes} minutes from the activity alone, never the person.`,
    '',
    'Task:',
    ...(lines.length ? lines : ['- unknown']),
    '',
    'Activity:',
    timeline ?? '- nothing recorded',
    '',
    'Reply with ONLY JSON, no markdown: {"level": <1-10>, "note": "<one sentence>"}',
    'level: 10 means every activity clearly served the task; 7 means mostly the task with small harmless extras',
    'such as search or notes; 4 means a half mix with unrelated apps or sites; 1 means none of it served the task.',
    `note: one sentence, at most ${NOTE_LIMIT} characters, on what pulled focus away or what kept it.`,
  ].join('\n');
};

const parseReview = (text) => {
  const json = /\{[\s\S]*\}/.exec(String(text ?? ''))?.[0];
  try {
    const parsed = JSON.parse(json);
    const note = String(parsed.note ?? '').trim();
    if (!Number.isInteger(parsed.level) || parsed.level < 1 || parsed.level > 10 || !note) return null;
    const level = parsed.level;
    return { level, note: note.slice(0, NOTE_LIMIT) };
  } catch {
    return null;
  }
};

// The front browser's front tab: Safari answers on currentTab, Chromium browsers on activeTab.
const scanScript = (browsers) => `(() => {
  ObjC.import('AppKit');
  const frontApp = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const front = frontApp ? (ObjC.unwrap(frontApp.bundleURL.lastPathComponent) || '').replace(/\\.app$/i, '') : null;
  let url = null;
  let title = null;
  if (${JSON.stringify(browsers)}.includes(front)) {
    try {
      const win = Application(front).windows[0];
      try { url = win.activeTab.url(); title = win.activeTab.title(); }
      catch (e) { url = win.currentTab.url(); title = win.currentTab.title(); }
    } catch (e) {}
  }
  return JSON.stringify({ front, url: url == null ? null : String(url), title: title == null ? null : String(title) });
})()`;

module.exports = {
  MAX_SAMPLES,
  NO_SAMPLE,
  parseScan,
  toSample,
  addSample,
  hostOf,
  timeline,
  reviewPrompt,
  parseReview,
  scanScript,
};
