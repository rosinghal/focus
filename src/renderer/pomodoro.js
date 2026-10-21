const $ = (id) => document.getElementById(id);

const NEW_TASK = 'new';
const SEARCH_DELAY_MS = 400;
const MIN_GOAL_LENGTH = 3;

let goal = '';
let searchTimer = null;
let searchId = 0;
let pendingSearch = null;

const hasGoal = () => goal.length >= MIN_GOAL_LENGTH;

const span = (className, textContent) => Object.assign(document.createElement('span'), { className, textContent });

const details = (task) => {
  const small = document.createElement('small');
  const parts = [
    ...(task.dueLabel ? [span(task.overdue ? 'due overdue' : 'due', task.dueLabel)] : []),
    ...[task.list, task.status].filter(Boolean).map((text) => span('muted', text)),
  ];
  parts.forEach((part, index) => small.append(...(index ? [span('muted', ' · '), part] : [part])));
  return small;
};

const option = (value, title, detail, checked) => {
  const label = document.createElement('label');
  label.className = 'task';
  const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'task', value, checked });
  const text = document.createElement('span');
  text.append(Object.assign(document.createElement('strong'), { textContent: title }), detail);
  label.append(radio, text);
  return label;
};

const searchStatus = (tasks) => {
  if (!hasGoal()) return tasks.length ? 'Due today and overdue' : 'Nothing due today. Write a goal to find or create a task.';
  return tasks.length ? 'Matching tasks assigned to you' : 'No matching tasks. Start creates it.';
};

const showTasks = (tasks) => {
  const checked = new FormData($('goal-form')).get('task');
  const fallback = tasks[0]?.id ?? (hasGoal() ? NEW_TASK : null);
  const keep = tasks.some((task) => task.id === checked) ? checked : fallback;
  $('tasks').replaceChildren(
    ...tasks.map((task) => option(task.id, task.name, details(task), task.id === keep)),
    ...(hasGoal()
      ? [option(NEW_TASK, `Create “${goal}”`, span('muted', 'New task, due today'), keep === NEW_TASK)]
      : []),
  );
  $('search-status').textContent = searchStatus(tasks);
};

const runSearch = async (id) => {
  const result = await window.focusLock.searchTasks(hasGoal() ? goal : '');
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
  $('search-status').textContent = hasGoal() ? 'Searching…' : 'Loading tasks due today…';
  searchTimer = setTimeout(search, SEARCH_DELAY_MS);
};

const start = async () => {
  // Enter before results arrive shows them first rather than starting on a task you haven't seen.
  if (searchTimer || pendingSearch) {
    await (searchTimer ? search() : pendingSearch);
    return;
  }
  const value = new FormData($('goal-form')).get('task');
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
  $('goal-form').addEventListener('submit', (event) => {
    event.preventDefault();
    start();
  });
  search();
};

init();
