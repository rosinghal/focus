const test = require('node:test');
const assert = require('node:assert/strict');
const { centered, topRight, sameBounds } = require('../src/placement');

const external = { x: 1512, y: -200, width: 2560, height: 1415 };
const leftOfLaptop = { x: -1920, y: 25, width: 1920, height: 1055 };

test('centred bounds sit in the middle of the given display', () => {
  assert.deepEqual(centered(external, { width: 440, height: 600 }), {
    x: 1512 + 1060,
    y: -200 + 408,
    width: 440,
    height: 600,
  });
});

test('centred bounds round half pixels', () => {
  assert.deepEqual(centered(leftOfLaptop, { width: 421, height: 330 }), { x: -1170, y: 388, width: 421, height: 330 });
});

test('top-right bounds keep a margin from the display corner', () => {
  assert.deepEqual(topRight(leftOfLaptop, { width: 300, height: 108 }, 12), {
    x: -312,
    y: 37,
    width: 300,
    height: 108,
  });
});

test('top-right bounds stack below another window', () => {
  const timer = topRight(external, { width: 300, height: 108 }, 12);
  assert.deepEqual(topRight(external, { width: 300, height: 124 }, 12, timer), {
    x: timer.x,
    y: timer.y + 108 + 12,
    width: 300,
    height: 124,
  });
});

test('sameBounds compares position and size', () => {
  const a = { x: 1, y: 2, width: 3, height: 4 };
  assert.equal(sameBounds(a, { ...a }), true);
  assert.equal(sameBounds(a, { ...a, x: 0 }), false);
  assert.equal(sameBounds(a, { ...a, height: 5 }), false);
});
