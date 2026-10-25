const $ = (id) => document.getElementById(id);

let view = null;

const countdown = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const duration = (ms) => {
  const minutes = Math.round(ms / 60000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const showTime = () => {
  if (view?.until) $('time').textContent = countdown(view.until - Date.now());
};

const render = (next) => {
  view = next;
  if (!view) return;
  $('mode').textContent = view.mode;
  $('time').classList.toggle('hidden', !view.until);
  showTime();
  $('task').replaceChildren(...titleNodes(view.task?.name ?? ''));
  const { summary } = view;
  $('summary').classList.toggle('hidden', !summary);
  if (!summary) return;
  $('summary-focus').textContent = `Focused ${duration(summary.focusedMs)} · ${clock(summary.startedAt)} – ${clock(summary.endedAt)}`;
  $('summary-today').textContent =
    `Today: ${plural(summary.today.count, 'pomodoro')} · ${duration(summary.today.focusedMs)} focused`;
  $('task-done').classList.toggle('hidden', !summary.taskCompleted);
  $('complete-row').classList.toggle('hidden', summary.taskCompleted);
};

$('close').addEventListener('click', () => window.close());
$('task').addEventListener('click', (event) => {
  event.preventDefault();
  window.focusLock.openTimerTask();
});
$('complete').addEventListener('click', async () => {
  $('complete').disabled = true;
  $('complete').textContent = 'Completing…';
  $('complete-error').textContent = '';
  const result = await window.focusLock.completeTimerTask();
  $('complete').disabled = false;
  $('complete').textContent = 'Mark task complete';
  if (!result.ok) $('complete-error').textContent = result.error;
});
new ResizeObserver(([entry]) => window.focusLock.resizeTimer(entry.target.getBoundingClientRect().height)).observe(
  document.querySelector('.timer'),
);
window.focusLock.onTimerUpdate(render);
window.focusLock.timerStatus().then(render);
setInterval(showTime, 1000);
