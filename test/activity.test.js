const test = require('node:test');
const assert = require('node:assert/strict');
const activity = require('../src/activity');

const sample = (app, at, url = null, title = null) => ({ app, url, title, at });

test('toSample drops missing and neutral fronts', () => {
  assert.equal(activity.toSample(activity.NO_SAMPLE), null);
  assert.equal(activity.toSample({ front: 'Electron' }), null);
  assert.equal(activity.toSample({ front: 'Focus' }), null);
  assert.deepEqual(activity.toSample({ front: 'Safari', url: 'https://a.com', title: 'Home' }), {
    app: 'Safari',
    url: 'https://a.com',
    title: 'Home',
  });
  // A non-browser app comes through without page info; the timeline shows the app alone.
  assert.deepEqual(activity.toSample({ front: 'Code' }), { app: 'Code', url: null, title: null });
});

test('addSample drops runs on the same page and only keeps the latest stretch', () => {
  let log = activity.addSample([], sample('Code', 0));
  log = activity.addSample(log, sample('Code', 5000));
  assert.deepEqual(log, [sample('Code', 0)]);
  log = activity.addSample(log, sample('Safari', 10000, 'https://news.com', 'Home'));
  assert.deepEqual(log, [sample('Code', 0), sample('Safari', 10000, 'https://news.com', 'Home')]);
  for (let i = 0; i <= activity.MAX_SAMPLES; i++) {
    log = activity.addSample(log, sample(`App ${i}`, 20000 + i));
  }
  assert.equal(log.length, activity.MAX_SAMPLES);
  assert.equal(log.at(-1).app, `App ${activity.MAX_SAMPLES}`);
});

test('timeline groups the same page and lists the busiest first', () => {
  const minute = 60 * 1000;
  const samples = [
    sample('Code', 0),
    sample('Safari', 10 * minute, 'https://github.com/rosinghal/focus/pulls', 'Pull requests'),
    sample('Safari', 12 * minute, 'https://youtube.com/watch?v=x', 'Vlog'),
  ];
  assert.deepEqual(activity.timeline(samples, 15 * minute), [
    '10 min · Code',
    '3 min · Safari – Vlog · youtube.com',
    '2 min · Safari – Pull requests · github.com',
  ].join('\n'));
});

test('timeline returns null when nothing was recorded', () => {
  assert.equal(activity.timeline([], 1000), null);
});

test('reviewPrompt passes the task through as-is and asks for bare JSON', () => {
  const prompt = activity.reviewPrompt({
    task: {
      name: 'Fix the login API',
      list: 'Web',
      status: 'In progress',
      tags: ['bug', 'web'],
      description: 'The /login route 500s.',
      id: '1',
    },
    timeline: '10 min · Code',
    focusedMs: 12 * 60 * 1000,
  });
  assert.match(prompt, /name: Fix the login API/);
  assert.match(prompt, /list: Web/);
  assert.match(prompt, /status: In progress/);
  assert.match(prompt, /tags: bug, web/);
  assert.match(prompt, /description: The \/login route 500s\./);
  assert.match(prompt, /10 min · Code/);
  assert.match(prompt, /\{"level": <1-10>, "note": "<one sentence>"\}/);
  assert.match(prompt, /12 minutes/);
  assert.doesNotMatch(prompt, /id: 1/);
  assert.match(activity.reviewPrompt({ focusedMs: 12 * 60 * 1000 }), /- unknown/);
  assert.match(activity.reviewPrompt({ focusedMs: 12 * 60 * 1000 }), /- nothing recorded/);
});

test('parseReview reads the verdict from the text and rejects bad ones', () => {
  assert.deepEqual(activity.parseReview('{"level": 8, "note": "Mostly on task."}'), {
    level: 8,
    note: 'Mostly on task.',
  });
  assert.deepEqual(
    activity.parseReview('Here you go:\n```json\n{"level": 4, "note": "Half way on YouTube."}\n```'),
    { level: 4, note: 'Half way on YouTube.' },
  );
  assert.deepEqual(activity.parseReview('"note" is trimmed {"level": 10, "note": "  Perfect.  "} '), {
    level: 10,
    note: 'Perfect.',
  });
  assert.equal(activity.parseReview('{"level": 8}'), null);
  assert.equal(activity.parseReview('{"level": "8", "note": "x"}'), null);
  assert.equal(activity.parseReview('{"level": 11, "note": "x"}'), null);
  assert.deepEqual(activity.parseReview('{"level": 8, "note": 5}'), { level: 8, note: '5' });
  assert.equal(activity.parseReview('8 out of 10'), null);
  assert.equal(activity.parseReview(null), null);
});

test('the scan script embeds the browsers and returns JSON', () => {
  const script = activity.scanScript(['Safari', 'Google Chrome']);
  assert.match(script, /"Safari"/);
  assert.match(script, /Google Chrome/);
  assert.doesNotThrow(() => new Function(`return ${script}`));
});
