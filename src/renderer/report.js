const $ = (id) => document.getElementById(id);

const REFRESH_MS = 5000;

const duration = (minutes) =>
  minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const row = ({ name, minutes, detail }) => {
  const item = document.createElement('li');
  item.classList.toggle('empty', !minutes);
  const label = document.createElement('span');
  label.textContent = name;
  const small = document.createElement('small');
  small.className = 'muted';
  small.textContent = detail ?? '';
  label.append(small);
  const value = document.createElement('strong');
  value.textContent = duration(minutes);
  item.append(label, value);
  return item;
};

const rows = ({ pomodoro, entertainment, meeting, kidMinutes, unlockedMinutes, noModeMinutes }) => [
  {
    name: 'Pomodoro focus',
    minutes: pomodoro.focusMinutes,
    detail: [
      plural(pomodoro.completed, 'pomodoro'),
      pomodoro.stopped ? `${pomodoro.stopped} stopped` : null,
      pomodoro.averageReview === null ? null : `focus ${pomodoro.averageReview}/10`,
    ]
      .filter(Boolean)
      .join(' · '),
  },
  { name: 'Breaks', minutes: pomodoro.breakMinutes },
  { name: 'Meetings', minutes: meeting.minutes, detail: plural(meeting.count, 'meeting') },
  { name: 'Entertainment mode', minutes: entertainment.minutes, detail: plural(entertainment.sessions, 'session') },
  { name: 'Kid mode', minutes: kidMinutes },
  { name: 'Unlocked in sleep hours', minutes: unlockedMinutes },
  { name: 'No mode', minutes: noModeMinutes, detail: 'active, outside every mode' },
];

const render = (report) => {
  if (!report) return;
  $('date').textContent = new Date(report.date).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  $('active').textContent = duration(report.activeMinutes);
  $('rows').replaceChildren(...rows(report).map(row));
  const { tasks } = report.pomodoro;
  $('tasks-section').classList.toggle('hidden', !tasks.length);
  $('tasks').replaceChildren(
    ...tasks.map((name) => {
      const item = document.createElement('li');
      item.append(...titleNodes(name));
      return item;
    }),
  );
};

const refresh = () => window.focusLock.todayReport().then(render);
refresh();
setInterval(refresh, REFRESH_MS);
