const centered = (workArea, { width, height }) => ({
  x: Math.round(workArea.x + (workArea.width - width) / 2),
  y: Math.round(workArea.y + (workArea.height - height) / 2),
  width,
  height,
});

const topRight = (workArea, { width, height }, margin, below = null) => ({
  x: workArea.x + workArea.width - width - margin,
  y: below ? below.y + below.height + margin : workArea.y + margin,
  width,
  height,
});

const sameBounds = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

module.exports = { centered, topRight, sameBounds };
