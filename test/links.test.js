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

const fakeDocument = () => ({
  createTextNode: (text) => ({ text }),
  createElement: () => {
    const listeners = {};
    const classes = new Set();
    return {
      listeners,
      attributes: {},
      set className(value) {
        value.split(' ').forEach((name) => classes.add(name));
      },
      get className() {
        return [...classes].join(' ');
      },
      classList: { add: (name) => classes.add(name) },
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener: (type, listener) => {
        listeners[type] = listener;
      },
    };
  },
});
const nodesFor = vm.runInNewContext(`${source};titleNodes`, { URL, document: fakeDocument() });

test('titleNodes links open their full URL without selecting the task', () => {
  const opened = [];
  const link = nodesFor('See https://www.github.com/a/b now', (url) => opened.push(url))[1];
  const calls = [];
  link.listeners.click({ preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') });
  assert.deepEqual(opened, ['https://www.github.com/a/b']);
  assert.deepEqual(calls, ['prevent', 'stop']);
  assert.equal(link.className, 'title-link clickable');
  assert.equal(link.attributes.role, 'link');
  link.listeners.keydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  link.listeners.keydown({ key: 'a', preventDefault() {}, stopPropagation() {} });
  assert.equal(opened.length, 2);
});

test('titleNodes links without a handler stay plain', () => {
  const link = nodesFor('https://a.com')[0];
  assert.deepEqual(Object.keys(link.listeners), []);
  assert.equal(link.className, 'title-link');
});
