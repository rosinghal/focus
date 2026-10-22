const $ = (id) => document.getElementById(id);

const NEW_TASK = 'new';
const SEARCH_DELAY_MS = 400;
const MIN_GOAL_LENGTH = 3;

// Mirrors parseTaskTitle in clickup.js, which the sandboxed renderer can't load.
const HASHTAG = /(^|\s)#([\p{L}\p{N}_-]+)/gu;

let goal = '';
let searchTimer = null;
let searchId = 0;
let pendingSearch = null;
let shownTasks = [];

const goalName = () => goal.replace(HASHTAG, ' ').replace(/\s+/g, ' ').trim();
const goalTags = () => [...new Set([...goal.matchAll(HASHTAG)].map((match) => match[2].toLowerCase()))];
const hasGoal = () => goalName().length >= MIN_GOAL_LENGTH;

const span = (className, textContent) => Object.assign(document.createElement('span'), { className, textContent });

const iconButton = (className, textContent, title, onClick) => {
  const button = Object.assign(document.createElement('button'), { type: 'button', className, textContent, title });
  button.addEventListener('click', () => onClick(button));
  return button;
};

const due = (task) => {
  const label = span(task.overdue ? 'due overdue' : 'due', task.dueLabel);
  if (task.postponable) label.append(iconButton('postpone', '+1', 'Move due date to tomorrow', (button) => postpone(button, task)));
  return label;
};

const details = (task) => {
  const small = document.createElement('small');
  const parts = [
    ...(task.dueLabel ? [due(task)] : []),
    ...[task.list, task.status].filter(Boolean).map((text) => span('muted', text)),
  ];
  parts.forEach((part, index) => small.append(...(index ? [span('muted', ' · '), part] : [part])));
  return small;
};

const option = (value, title, detail, checked, action, link) => {
  const label = document.createElement('label');
  label.className = 'task';
  const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'task', value, checked });
  const text = document.createElement('span');
  const strong = Object.assign(document.createElement('strong'), { textContent: title });
  if (link) strong.append(link);
  text.append(strong, detail);
  label.append(radio, text, ...(action ? [action] : []));
  return label;
};

const NO_PRIORITY = 5;
const byPriority = (a, b) => (a.priority ?? NO_PRIORITY) - (b.priority ?? NO_PRIORITY);

const starButton = (task) => {
  const button = Object.assign(document.createElement('button'), {
    type: 'button',
    className: task.starred ? 'star starred' : 'star',
    textContent: task.starred ? '★\uFE0E' : '☆\uFE0E',
    title: task.starred ? 'Remove high priority' : 'Mark high priority',
  });
  button.setAttribute('aria-pressed', String(task.starred));
  button.addEventListener('click', () => toggleStar(button, task));
  return button;
};

const openButton = (task) =>
  iconButton('open', '↗', 'Open in ClickUp', () => window.focusLock.openPomodoroTask(task.id));

const createButton = () => {
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'create', textContent: 'Create' });
  button.addEventListener('click', createOnly);
  return button;
};

const searchStatus = (tasks) => {
  if (!hasGoal()) return tasks.length ? 'Due today and overdue' : 'Nothing due today. Write a goal to find or create a task.';
  return tasks.length ? 'Matching tasks assigned to you' : 'No matching tasks.';
};

const selected = () => new FormData($('goal-form')).get('task');

const updateStartLabel = () => {
  $('start').textContent = selected() === NEW_TASK ? 'Create and start' : 'Start';
};

const sameName = (task) => task.name.trim().toLowerCase() === goalName().toLowerCase();

const newTaskDetail = () => {
  const small = document.createElement('small');
  small.append(span('muted', 'New task, due today'), ...goalTags().map((tag) => span('tag', `#${tag}`)));
  return small;
};

const renderTasks = (tasks, preferred = selected()) => {
  const offerNew = hasGoal() && !tasks.some(sameName);
  const fallback = tasks[0]?.id ?? (offerNew ? NEW_TASK : null);
  const keep = tasks.some((task) => task.id === preferred) || (offerNew && preferred === NEW_TASK) ? preferred : fallback;
  $('tasks').replaceChildren(
    ...tasks.map((task) =>
      option(task.id, task.name, details(task), task.id === keep, starButton(task), openButton(task)),
    ),
    ...(offerNew ? [option(NEW_TASK, `“${goalName()}”`, newTaskDetail(), keep === NEW_TASK, createButton())] : []),
  );
  updateStartLabel();
};

const showTasks = (tasks) => {
  shownTasks = tasks;
  // The new-task tile was only selected because it stood alone while searching.
  renderTasks(tasks, null);
  $('search-status').textContent = searchStatus(tasks);
};

const runSearch = async (id) => {
  const result = await window.focusLock.searchTasks(hasGoal() ? goalName() : '');
  if (id !== searchId) return;
  pendingSearch = null;
  $('error').textContent = result.ok ? '' : result.error;
  if (result.ok) showTasks(result.tasks);
  else $('search-status').textContent = '';
};

const search = () => {
  clearTimeout(searchTimer);
  searchTimer = null;
  $('search-status').textContent = hasGoal() ? 'Searching…' : 'Loading tasks due today…';
  pendingSearch = runSearch(++searchId);
  return pendingSearch;
};

const onGoalInput = () => {
  const wasGoal = hasGoal();
  goal = $('goal').value.trim();
  $('error').textContent = '';
  if (!wasGoal && !hasGoal()) return;
  clearTimeout(searchTimer);
  searchId++;
  pendingSearch = null;
  shownTasks = [];
  renderTasks([]);
  $('search-status').textContent = hasGoal() ? 'Searching…' : 'Loading tasks due today…';
  searchTimer = setTimeout(search, SEARCH_DELAY_MS);
};

const createOnly = async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  $('error').textContent = '';
  const result = await window.focusLock.createTask(goal);
  button.disabled = false;
  if (!result.ok) {
    $('error').textContent = result.error;
    return;
  }
  // A search still in flight would replace the list without the new task.
  clearTimeout(searchTimer);
  searchTimer = null;
  searchId++;
  pendingSearch = null;
  shownTasks = [result.task, ...shownTasks];
  renderTasks(shownTasks, result.task.id);
  $('search-status').textContent = 'Task created in ClickUp';
};

const toggleStar = async (button, task) => {
  button.disabled = true;
  $('error').textContent = '';
  const result = await window.focusLock.starTask(task.id, !task.starred);
  button.disabled = false;
  if (!result.ok) {
    $('error').textContent = result.error;
    return;
  }
  shownTasks = shownTasks.map((shown) => (shown.id === result.task.id ? result.task : shown)).sort(byPriority);
  renderTasks(shownTasks);
};

const postpone = async (button, task) => {
  button.disabled = true;
  $('error').textContent = '';
  const result = await window.focusLock.postponeTask(task.id);
  button.disabled = false;
  if (!result.ok) {
    $('error').textContent = result.error;
    return;
  }
  // The due list only holds tasks due by today, so a postponed one leaves it.
  shownTasks = hasGoal()
    ? shownTasks.map((shown) => (shown.id === result.task.id ? result.task : shown))
    : shownTasks.filter((shown) => shown.id !== result.task.id);
  renderTasks(shownTasks);
  if (!hasGoal()) $('search-status').textContent = searchStatus(shownTasks);
};

const start = async () => {
  // Enter before results arrive shows them first rather than starting on a task you haven't seen.
  if (searchTimer || pendingSearch) {
    await (searchTimer ? search() : pendingSearch);
    return;
  }
  const value = selected();
  if (!value) {
    $('error').textContent = 'Write a goal or pick a task.';
    return;
  }
  $('start').disabled = true;
  const result = await window.focusLock.startPomodoro(value === NEW_TASK ? { create: goal } : { taskId: value });
  $('start').disabled = false;
  if (!result.ok) $('error').textContent = result.error;
};

const init = async () => {
  const status = await window.focusLock.pomodoroStatus();
  document.querySelectorAll('.close').forEach((button) => button.addEventListener('click', () => window.close()));
  if (!status.clickupReady) {
    $('no-token').classList.remove('hidden');
    return;
  }
  $('goal-hint').textContent = `${status.minutes} minutes on one ClickUp task. Pick one due today or describe your goal.`;
  $('goal-form').classList.remove('hidden');
  $('goal').addEventListener('input', onGoalInput);
  $('tasks').addEventListener('change', updateStartLabel);
  $('goal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    start();
  });
  search();
};

init();
