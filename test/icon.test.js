const test = require('node:test');
const assert = require('node:assert/strict');
const { moonBitmap } = require('../src/icon');

test('moonBitmap produces a BGRA crescent with transparent corners', () => {
  const size = 16;
  const bitmap = moonBitmap(size, [10, 20, 30]);
  assert.equal(bitmap.length, size * size * 4);
  assert.deepEqual([...bitmap.subarray(0, 4)], [30, 20, 10, 0]);
  const alphaAt = (x, y) => bitmap[(y * size + x) * 4 + 3];
  assert.ok(alphaAt(3, 10) > 200, 'left side of the moon is lit');
  assert.ok(alphaAt(12, 5) < 50, 'upper right is cut out');
});
