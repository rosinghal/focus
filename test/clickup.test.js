const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_MATCHES,
  MAX_DUE,
  TASKS_TTL_MS,
  isValidToken,
  isOpenTask,
  closingStatus,
  isStarred,
  parseTeamId,
  parseListId,
  words,
  matchTasks,
  dueTasks,
  relativeDue,
  toListItem,
  assignedTasksPath,
  dueFilter,
  todayDueDate,
  tomorrowDueDate,
  parseTaskTitle,
  newTaskBody,
  createClient,
} = require('../src/clickup');

const task = (id, name, due = null, priority = null) => ({
  id,
  name,
  url: `https://app.clickup.com/t/${id}`,
  list: 'Inbox',
  status: 'to do',
  due,
  priority,
});

const ids = { token: 'pk_token', teamId: '111', listId: '222' };
const now = new Date(2026, 9, 21, 17, 30);
const day = (offset, hour = 12) => new Date(2026, 9, 21 + offset, hour).getTime();

test('isValidToken accepts personal tokens only', () => {
  assert.equal(isValidToken('pk_123_ABC'), true);
  assert.equal(isValidToken('123'), false);
  assert.equal(isValidToken('pk_12 3'), false);
});

test('ids come from bare numbers or ClickUp links', () => {
  const link = 'https://app.clickup.com/1234567/v/l/6-900000000001-1';
  assert.equal(parseTeamId(' 1234567 '), '1234567');
  assert.equal(parseTeamId(link), '1234567');
  assert.equal(parseTeamId('https://example.com/1234567/'), null);
  assert.equal(parseTeamId('abc'), null);
  assert.equal(parseListId('900000000001'), '900000000001');
  assert.equal(parseListId(link), '900000000001');
  assert.equal(parseListId('https://app.clickup.com/1234567/v/li/900000000001'), '900000000001');
  assert.equal(parseListId('https://app.clickup.com/1234567/home'), null);
});

test('isOpenTask drops done and closed tasks', () => {
  assert.equal(isOpenTask({ status: { status: 'in progress', type: 'custom' } }), true);
  assert.equal(isOpenTask({ status: { status: 'to do', type: 'open' } }), true);
  assert.equal(isOpenTask({}), true);
  assert.equal(isOpenTask({ status: { status: 'complete', type: 'done' } }), false);
  assert.equal(isOpenTask({ status: { status: 'shipped', type: 'closed' } }), false);
  assert.equal(isOpenTask({ status: { status: 'Done', type: 'custom' } }), false);
});

test('words drops short and filler words', () => {
  assert.deepEqual(words('Fix the login bug for iOS'), ['fix', 'login', 'bug', 'ios']);
});

test('matchTasks ranks tasks by the goal words they contain', () => {
  const tasks = [task('1', 'Update docs'), task('2', 'Fix login bug'), task('3', 'Login page redesign')];
  assert.deepEqual(
    matchTasks('fix the login bug', tasks).map(({ id }) => id),
    ['2', '3'],
  );
  assert.deepEqual(matchTasks('groceries', tasks), []);
  assert.deepEqual(matchTasks('a', tasks), []);
  const many = Array.from({ length: 9 }, (_, i) => task(String(i), `Review PR ${i}`));
  assert.equal(matchTasks('review', many).length, MAX_MATCHES);
});

test('matchTasks breaks ties by due date', () => {
  const tasks = [task('1', 'Login later', day(3)), task('2', 'Login undated'), task('3', 'Login overdue', day(-2))];
  assert.deepEqual(matchTasks('login', tasks).map(({ id }) => id), ['3', '1', '2']);
});

test('matchTasks shows high priority first among the best matches', () => {
  const tasks = [
    task('1', 'Fix login bug'),
    task('2', 'Login page', null, 4),
    task('3', 'Login copy', null, 2),
    ...Array.from({ length: 5 }, (_, i) => task(`u${i}`, 'Login urgent', null, 1)),
  ];
  assert.deepEqual(matchTasks('fix login bug', tasks.slice(0, 3)).map(({ id }) => id), ['3', '2', '1']);
  assert.ok(matchTasks('fix login bug', tasks).some(({ id }) => id === '1'));
});

test('dueTasks sorts by priority after keeping the earliest due', () => {
  const tasks = [task('a', 'A', day(-3)), task('b', 'B', day(0), 1), task('c', 'C', day(-1), 3)];
  assert.deepEqual(dueTasks(tasks, now).map(({ id }) => id), ['b', 'c', 'a']);
});

test('isStarred means urgent or high priority', () => {
  assert.deepEqual([1, 2, 3, 4, null, undefined].map((priority) => isStarred({ priority })), [true, true, false, false, false, false]);
});

test('dueTasks keeps overdue and today, earliest first', () => {
  const tasks = [
    task('today', 'A', day(0, 23)),
    task('tomorrow', 'B', day(1, 0)),
    task('none', 'C'),
    task('late', 'D', day(-5)),
    task('yesterday', 'E', day(-1)),
  ];
  assert.deepEqual(dueTasks(tasks, now).map(({ id }) => id), ['late', 'yesterday', 'today']);
  const many = Array.from({ length: 15 }, (_, i) => task(String(i), 'X', day(-i)));
  assert.equal(dueTasks(many, now).length, MAX_DUE);
});

test('relativeDue counts calendar days, then weeks and months', () => {
  assert.equal(relativeDue(day(0, 1), now), 'Due today');
  assert.equal(relativeDue(day(-1, 23), now), 'Due yesterday');
  assert.equal(relativeDue(day(1, 0), now), 'Due tomorrow');
  assert.equal(relativeDue(day(-3), now), 'Due 3 days ago');
  assert.equal(relativeDue(day(5), now), 'Due in 5 days');
  assert.equal(relativeDue(day(-21), now), 'Due 3 weeks ago');
  assert.equal(relativeDue(day(90), now), 'Due in 3 months');
});

test('toListItem adds the due label and flags overdue tasks only', () => {
  assert.deepEqual(toListItem(task('1', 'A', day(-2)), now), {
    id: '1',
    name: 'A',
    list: 'Inbox',
    status: 'to do',
    dueLabel: 'Due 2 days ago',
    overdue: true,
    postponable: true,
    priority: null,
    starred: false,
  });
  assert.equal(toListItem(task('1', 'A', null, 2), now).starred, true);
  assert.deepEqual(
    [day(0, 23), day(1, 0), null].map((due) => toListItem(task('1', 'A', due), now).postponable),
    [true, false, false],
  );
  assert.equal(toListItem(task('1', 'A', day(0, 9)), now).overdue, false);
  assert.deepEqual([toListItem(task('1', 'A'), now).dueLabel, toListItem(task('1', 'A'), now).overdue], ['', false]);
});

test('parseTaskTitle moves hashtags out of the name', () => {
  assert.deepEqual(parseTaskTitle('Fix #bug in login #web-app'), { name: 'Fix in login', tags: ['bug', 'web-app'] });
  assert.deepEqual(parseTaskTitle('#Bug fix #bug'), { name: 'fix', tags: ['bug'] });
  assert.deepEqual(parseTaskTitle('Issue#42 and C# docs'), { name: 'Issue#42 and C# docs', tags: [] });
  assert.deepEqual(parseTaskTitle('#only'), { name: '', tags: ['only'] });
});

test('new tasks are assigned to me and due today', () => {
  const now = new Date(2026, 9, 21, 23, 30);
  assert.equal(todayDueDate(now), new Date(2026, 9, 21, 12).getTime());
  assert.deepEqual(newTaskBody('Write report', 42, now), {
    name: 'Write report',
    assignees: [42],
    due_date: todayDueDate(now),
    due_date_time: false,
  });
  assert.deepEqual(newTaskBody('Fix login #bug #Web', 42, now).tags, ['bug', 'web']);
  assert.match(assignedTasksPath('111', 42, 1), /^\/team\/111\/task\?page=1&assignees\[\]=42&.*order_by=updated$/);
  assert.equal(dueFilter(now), `order_by=due_date&due_date_lt=${new Date(2026, 9, 22).getTime()}`);
});

const fakeFetch = (routes) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const route = routes.find(([pattern]) => pattern.test(url));
    return route ? { ok: true, json: async () => route[1](url, options) } : { ok: false, status: 404 };
  };
  return { calls, fetchImpl };
};

test('searchTasks looks up me once and pages through my tasks', async () => {
  const { calls, fetchImpl } = fakeFetch([
    [/\/user$/, () => ({ user: { id: 7 } })],
    [/page=0/, () => ({ tasks: [{ id: 1, name: 'Fix login bug', url: 'u1', list: { name: 'Web' } }], last_page: false })],
    [
      /page=1/,
      () => ({
        tasks: [
          { id: 2, name: 'Login copy', url: 'u2' },
          { id: 3, name: 'Login done', url: 'u3', status: { status: 'complete', type: 'done' } },
        ],
        last_page: true,
      }),
    ],
  ]);
  const client = createClient(ids, fetchImpl);
  const found = await client.searchTasks('login');
  assert.deepEqual(found, [
    { id: '1', name: 'Fix login bug', url: 'u1', list: 'Web', status: '', due: null, priority: null },
    { id: '2', name: 'Login copy', url: 'u2', list: '', status: '', due: null, priority: null },
  ]);
  await client.searchTasks('login');
  assert.equal(calls.filter(({ url }) => url.endsWith('/user')).length, 1);
  assert.equal(calls.filter(({ url }) => url.includes('page=')).length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'pk_token');
  assert.match(calls[1].url, /\/team\/111\/task\?.*assignees\[\]=7/);
});

test('an empty goal lists tasks due by tomorrow from ClickUp', async () => {
  const { calls, fetchImpl } = fakeFetch([
    [/\/user$/, () => ({ user: { id: 7 } })],
    [/due_date_lt=/, () => ({ tasks: [{ id: 1, name: 'Old', due_date: String(day(-4)) }, { id: 2, name: 'Today', due_date: String(day(0)) }], last_page: true })],
  ]);
  const found = await createClient(ids, fetchImpl).searchTasks('', now);
  assert.deepEqual(found.map(({ id }) => id), ['1', '2']);
  assert.ok(calls.some(({ url }) => url.includes(dueFilter(now))));
});

test('the task list is reused for a minute and refetched after a new task', async () => {
  let now = 0;
  const { calls, fetchImpl } = fakeFetch([
    [/\/user$/, () => ({ user: { id: 7 } })],
    [/page=0/, () => ({ tasks: [], last_page: true })],
    [/\/list\/\d+\/task$/, () => ({ id: 'abc', name: 'x' })],
  ]);
  const pages = () => calls.filter(({ url }) => url.includes('page=0')).length;
  const client = createClient(ids, fetchImpl, () => now);
  await client.searchTasks('report');
  now = TASKS_TTL_MS - 1;
  await client.searchTasks('report draft');
  assert.equal(pages(), 1);
  now = TASKS_TTL_MS;
  await client.searchTasks('report');
  assert.equal(pages(), 2);
  await client.createTask('Report', new Date());
  await client.searchTasks('report');
  assert.equal(pages(), 3);
  await client.searchTasks('report');
  assert.equal(pages(), 3);
});

test('a failed fetch is not cached', async () => {
  let fail = true;
  const fetchImpl = async (url) =>
    fail ? { ok: false, status: 500 } : { ok: true, json: async () => (url.endsWith('/user') ? { user: { id: 7 } } : { tasks: [{ id: 1, name: 'Report' }], last_page: true }) };
  const client = createClient(ids, fetchImpl);
  await assert.rejects(client.searchTasks('report'));
  fail = false;
  assert.equal((await client.searchTasks('report')).length, 1);
});

test('createTask posts to the pomodoro list', async () => {
  const { calls, fetchImpl } = fakeFetch([
    [/\/user$/, () => ({ user: { id: 7 } })],
    [/\/list\/\d+\/task$/, (_url, options) => ({ id: 'abc', name: JSON.parse(options.body).name, url: 'https://app.clickup.com/t/abc' })],
  ]);
  const created = await createClient(ids, fetchImpl).createTask('Write report', new Date(2026, 9, 21, 9));
  assert.equal(created.id, 'abc');
  const post = calls.find(({ options }) => options.method === 'POST');
  assert.ok(post.url.endsWith('/list/222/task'));
  assert.deepEqual(JSON.parse(post.options.body).assignees, [7]);
});

test('toTask reads the priority id', async () => {
  const { fetchImpl } = fakeFetch([
    [/\/user$/, () => ({ user: { id: 7 } })],
    [/\/team\//, () => ({ tasks: [{ id: 'a', name: 'Report', priority: { id: '2', priority: 'high' } }, { id: 'b', name: 'Report', priority: null }] })],
  ]);
  const found = await createClient(ids, fetchImpl).searchTasks('report');
  assert.deepEqual(found.map(({ id, priority }) => [id, priority]), [['a', 2], ['b', null]]);
});

test('postponeTask moves the due date to tomorrow noon', async () => {
  const { calls, fetchImpl } = fakeFetch([[/\/task\/abc$/, () => ({})]]);
  const late = new Date(2026, 9, 31, 23, 30);
  assert.equal(tomorrowDueDate(late), new Date(2026, 10, 1, 12).getTime());
  assert.equal(await createClient(ids, fetchImpl).postponeTask('abc', late), tomorrowDueDate(late));
  assert.deepEqual(JSON.parse(calls[0].options.body), { due_date: tomorrowDueDate(late), due_date_time: false });
});

test('setStarred sets high priority or clears it', async () => {
  const { calls, fetchImpl } = fakeFetch([[/\/task\/abc$/, () => ({})]]);
  const client = createClient(ids, fetchImpl);
  assert.equal(await client.setStarred('abc', true), 2);
  assert.equal(await client.setStarred('abc', false), null);
  assert.deepEqual(calls.map(({ options }) => [options.method, JSON.parse(options.body)]), [['PUT', { priority: 2 }], ['PUT', { priority: null }]]);
});

test('closingStatus prefers the closed status, then a done one', () => {
  const open = { status: 'to do', type: 'open' };
  assert.equal(closingStatus([open, { status: 'shipped', type: 'done' }, { status: 'Closed', type: 'closed' }]), 'Closed');
  assert.equal(closingStatus([open, { status: 'complete', type: 'done' }]), 'complete');
  assert.equal(closingStatus([open]), null);
  assert.equal(closingStatus(undefined), null);
});

test('completeTask sets the task to its list\'s closed status', async () => {
  const { calls, fetchImpl } = fakeFetch([
    [/\/task\/abc$/, (_url, options) => (options.method === 'PUT' ? {} : { id: 'abc', list: { id: '55' } })],
    [/\/list\/55$/, () => ({ statuses: [{ status: 'to do', type: 'open' }, { status: 'Shipped', type: 'closed' }] })],
  ]);
  await createClient(ids, fetchImpl).completeTask('abc');
  const put = calls.find(({ options }) => options.method === 'PUT');
  assert.ok(put.url.endsWith('/task/abc'));
  assert.deepEqual(JSON.parse(put.options.body), { status: 'Shipped' });
});

test('completeTask fails without a closing status and changes nothing', async () => {
  const { calls, fetchImpl } = fakeFetch([
    [/\/task\/abc$/, () => ({ id: 'abc', list: { id: '55' } })],
    [/\/list\/55$/, () => ({ statuses: [{ status: 'to do', type: 'open' }] })],
  ]);
  await assert.rejects(createClient(ids, fetchImpl).completeTask('abc'), /no-closing-status/);
  assert.equal(calls.some(({ options }) => options.method === 'PUT'), false);
});

test('ClickUp errors are thrown', async () => {
  const { fetchImpl } = fakeFetch([]);
  await assert.rejects(createClient(ids, fetchImpl).searchTasks('report'), /ClickUp returned 404/);
});
