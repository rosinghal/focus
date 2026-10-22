const API = 'https://api.clickup.com/api/v2';
const SEARCH_PAGES = 3;
const MAX_MATCHES = 5;
const MAX_DUE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const TASKS_TTL_MS = 60 * 1000;

// ClickUp priority ids: 1 urgent, 2 high, 3 normal, 4 low. A star means urgent or high.
const HIGH_PRIORITY = 2;
const NO_PRIORITY = 5;

const STOP_WORDS = ['the', 'and', 'for', 'with', 'from', 'into', 'about'];

const isValidToken = (token) => /^pk_[A-Za-z0-9_]+$/.test(token);

// Both accept a bare id or a link copied from ClickUp, e.g. https://app.clickup.com/1234567/v/l/6-900000000001-1.
const parseTeamId = (input) => {
  const text = String(input ?? '').trim();
  return /^\d+$/.test(text) ? text : (/app\.clickup\.com\/(\d+)(?:[/?#]|$)/.exec(text)?.[1] ?? null);
};

const parseListId = (input) => {
  const text = String(input ?? '').trim();
  if (/^\d+$/.test(text)) return text;
  return (/\/v\/li?\/\d+-(\d+)-\d+/.exec(text) ?? /\/v\/li\/(\d+)(?:[/?#]|$)/.exec(text))?.[1] ?? null;
};

const words = (text) =>
  String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOP_WORDS.includes(word));

const FINISHED = ['done', 'closed'];

// `include_closed` only drops the closed status, so done-type and custom "Done" statuses are filtered here.
const isOpenTask = (raw) =>
  !FINISHED.includes(String(raw.status?.type ?? '').toLowerCase()) &&
  !FINISHED.includes(String(raw.status?.status ?? '').toLowerCase());

// The closed status is named per list, so pick it by type; lists without one fall back to a done-type status.
const closingStatus = (statuses = []) =>
  (statuses.find((status) => status.type === 'closed') ?? statuses.find((status) => status.type === 'done'))?.status ??
  null;

const toTask = (raw) => ({
  id: String(raw.id),
  name: String(raw.name ?? ''),
  url: String(raw.url ?? ''),
  list: raw.list?.name ?? '',
  status: raw.status?.status ?? '',
  due: raw.due_date ? Number(raw.due_date) : null,
  priority: Number(raw.priority?.id) || null,
});

const startOfDay = (date, offsetDays = 0) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays).getTime();

const byDue = (a, b) => (a.due ?? Infinity) - (b.due ?? Infinity);

const isStarred = (task) => (task.priority ?? NO_PRIORITY) <= HIGH_PRIORITY;

const byPriority = (a, b) => (a.priority ?? NO_PRIORITY) - (b.priority ?? NO_PRIORITY);

const dueTasks = (tasks, now) =>
  tasks
    .filter((task) => isDueByToday(task.due, now))
    .sort(byDue)
    .slice(0, MAX_DUE)
    .sort(byPriority);

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const relativeDue = (due, now) => {
  // Rounding absorbs the 23- and 25-hour days around daylight saving changes.
  const days = Math.round((startOfDay(new Date(due)) - startOfDay(now)) / DAY_MS);
  if (Math.abs(days) < 14) return `Due ${RELATIVE.format(days, 'day')}`;
  if (Math.abs(days) < 60) return `Due ${RELATIVE.format(Math.round(days / 7), 'week')}`;
  return `Due ${RELATIVE.format(Math.round(days / 30), 'month')}`;
};

const isDueByToday = (due, now) => due !== null && due < startOfDay(now, 1);

const toListItem = ({ id, name, list, status, due, priority }, now) => ({
  id,
  name,
  list,
  status,
  dueLabel: due === null ? '' : relativeDue(due, now),
  overdue: due !== null && due < startOfDay(now),
  postponable: isDueByToday(due, now),
  priority: priority ?? null,
  starred: isStarred({ priority }),
});

const matchTasks = (query, tasks) => {
  const wanted = words(query);
  return tasks
    .map((task) => {
      const name = task.name.toLowerCase();
      return { task, score: wanted.filter((word) => name.includes(word)).length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || byDue(a.task, b.task))
    .slice(0, MAX_MATCHES)
    .map(({ task }) => task)
    .sort(byPriority);
};

const assignedTasksPath = (teamId, userId, page, filter = 'order_by=updated') =>
  `/team/${teamId}/task?page=${page}&assignees[]=${encodeURIComponent(userId)}&subtasks=true&${filter}`;

const dueFilter = (now) => `order_by=due_date&due_date_lt=${startOfDay(now, 1)}`;

// Noon keeps the due date on today whatever timezone ClickUp renders it in.
const todayDueDate = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();

const tomorrowDueDate = (now) => todayDueDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

const newTaskBody = (name, userId, now) => ({
  name,
  assignees: [userId],
  due_date: todayDueDate(now),
  due_date_time: false,
});

const createClient = ({ token, teamId, listId }, fetchImpl = fetch, clock = Date.now) => {
  let userId = null;
  const cache = new Map();

  const request = async (path, options = {}) => {
    const response = await fetchImpl(API + path, {
      ...options,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ClickUp returned ${response.status}`);
    return response.json();
  };

  const me = async () => (userId ??= (await request('/user')).user.id);

  const fetchAssignedTasks = async (filter) => {
    const id = await me();
    const tasks = [];
    for (let page = 0; page < SEARCH_PAGES; page++) {
      const result = await request(assignedTasksPath(teamId, id, page, filter));
      tasks.push(...(result.tasks ?? []).filter(isOpenTask).map(toTask));
      if (result.last_page !== false) break;
    }
    return tasks;
  };

  // Search runs on every pause in typing, so reuse the task list for a minute instead of paging through it each time.
  const assignedTasks = (filter) => {
    const cached = cache.get(filter);
    if (cached && clock() - cached.at < TASKS_TTL_MS) return cached.tasks;
    const entry = { at: clock(), tasks: fetchAssignedTasks(filter) };
    entry.tasks.catch(() => cache.get(filter) === entry && cache.delete(filter));
    cache.set(filter, entry);
    return entry.tasks;
  };

  return {
    // Without a searchable goal, it lists what is due today or overdue.
    searchTasks: async (query, now = new Date()) =>
      words(query).length
        ? matchTasks(query, await assignedTasks())
        : dueTasks(await assignedTasks(dueFilter(now)), now),
    createTask: async (name, now) => {
      const task = toTask(
        await request(`/list/${listId}/task`, { method: 'POST', body: JSON.stringify(newTaskBody(name, await me(), now)) }),
      );
      cache.clear();
      return task;
    },
    postponeTask: async (taskId, now) => {
      const due = tomorrowDueDate(now);
      await request(`/task/${encodeURIComponent(taskId)}`, {
        method: 'PUT',
        body: JSON.stringify({ due_date: due, due_date_time: false }),
      });
      cache.clear();
      return due;
    },
    setStarred: async (taskId, starred) => {
      // null clears the priority, so unstarring an urgent task leaves it with none.
      const priority = starred ? HIGH_PRIORITY : null;
      await request(`/task/${encodeURIComponent(taskId)}`, { method: 'PUT', body: JSON.stringify({ priority }) });
      cache.clear();
      return priority;
    },
    completeTask: async (taskId) => {
      const task = await request(`/task/${encodeURIComponent(taskId)}`);
      const status = closingStatus((await request(`/list/${encodeURIComponent(task.list?.id)}`)).statuses);
      if (!status) throw new Error('no-closing-status');
      await request(`/task/${encodeURIComponent(taskId)}`, { method: 'PUT', body: JSON.stringify({ status }) });
      cache.clear();
    },
  };
};

module.exports = {
  MAX_MATCHES,
  MAX_DUE,
  TASKS_TTL_MS,
  isValidToken,
  isOpenTask,
  closingStatus,
  isStarred,
  byPriority,
  parseTeamId,
  parseListId,
  words,
  toTask,
  matchTasks,
  dueTasks,
  relativeDue,
  toListItem,
  assignedTasksPath,
  dueFilter,
  todayDueDate,
  tomorrowDueDate,
  newTaskBody,
  createClient,
};
