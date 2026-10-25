const params = new URLSearchParams(location.search);
const kind = ['offer', 'notice', 'used'].includes(params.get('kind')) ? params.get('kind') : 'offer';
const kid = params.get('mode') === 'kid';
const minutes = params.get('minutes') ?? '';

const offerText = kid
  ? `Start ${minutes} minutes of Kid mode? Only stick.cafe will work, other apps are hidden, and it can be used once a day.`
  : `Start ${minutes} minutes of Entertainment mode? Only your entertainment sites and apps will work until it ends, and other apps are hidden.`;
const noticeText = kid
  ? `Only stick.cafe for ${minutes} more min.`
  : `Only your entertainment sites and apps for ${minutes} more min.`;

document.getElementById(kind).classList.remove('hidden');
document.querySelectorAll('.name').forEach((el) => (el.textContent = params.get('name') ?? 'This'));
document.getElementById('offer-text').textContent = offerText;
document.getElementById('start').textContent = kid ? 'Start Kid mode' : 'Start Entertainment mode';
document.getElementById('notice-title').textContent = kid ? 'Kid mode' : 'Entertainment mode';
document.getElementById('notice-text').textContent = noticeText;

if (!kid && params.has('todaySessions')) {
  const sessions = Number(params.get('todaySessions'));
  const plural = sessions === 1 ? 'session' : 'sessions';
  document.querySelectorAll('.stats').forEach((el) => {
    el.textContent = `Today: ${sessions} ${plural}, ${params.get('todayMinutes')} min`;
    el.classList.remove('hidden');
  });
}

document.getElementById('not-now').addEventListener('click', () => window.close());
document.querySelectorAll('.close').forEach((button) => button.addEventListener('click', () => window.close()));
document.getElementById('start').addEventListener('click', async () => {
  await window.focusLock.startSession();
  window.close();
});
