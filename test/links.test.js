const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/links.js'), 'utf8');
const parts = vm.runInNewContext(`${source};titleParts`, { URL });
// Objects from another context have a different prototype, so compare plain copies.
const titleParts = (text) => JSON.parse(JSON.stringify(parts(text)));

test('titleParts shows links in a title as their domain', () => {
  assert.deepEqual(titleParts('Review https://www.github.com/rosinghal/focus/pull/3 today'), [
    { text: 'Review ' },
    { text: 'github.com', url: 'https://www.github.com/rosinghal/focus/pull/3' },
    { text: ' today' },
  ]);
  assert.deepEqual(titleParts('Read (http://docs.example.org/a?b=1).'), [
    { text: 'Read (' },
    { text: 'docs.example.org', url: 'http://docs.example.org/a?b=1' },
    { text: ').' },
  ]);
  assert.deepEqual(titleParts('https://a.com and https://b.io/x'), [
    { text: 'a.com', url: 'https://a.com' },
    { text: ' and ' },
    { text: 'b.io', url: 'https://b.io/x' },
  ]);
  assert.deepEqual(titleParts('No links here'), [{ text: 'No links here' }]);
  assert.deepEqual(titleParts(''), []);
});
