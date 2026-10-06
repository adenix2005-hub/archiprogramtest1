import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recognizeStroke } from '../js/geom/sketch.js';

// Scale: 0.1 px per mm (1 px = 10 mm), typical zoomed-out plan view.
const SCALE = 0.1;
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = (amtPx) => (rnd() - 0.5) * 2 * amtPx / SCALE;

function strokeFrom(points, stepMm = 40, noisePx = 2.5) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / stepMm));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t + jitter(noisePx), y: a.y + (b.y - a.y) * t + jitter(noisePx) });
    }
  }
  const last = points[points.length - 1];
  out.push({ x: last.x + jitter(noisePx), y: last.y + jitter(noisePx) });
  return out;
}

const isAxis = (s) => Math.abs(s.a.x - s.b.x) < 1e-6 || Math.abs(s.a.y - s.b.y) < 1e-6;

test('noisy horizontal line becomes one straight wall on the grid', () => {
  const res = recognizeStroke(strokeFrom([{ x: 1030, y: 2040 }, { x: 5980, y: 2110 }]), { scale: SCALE, grid: 100 });
  assert.ok(res);
  assert.equal(res.segments.length, 1);
  const s = res.segments[0];
  assert.equal(s.bulge, 0);
  assert.ok(Math.abs(s.a.y - s.b.y) < 1e-9, 'horizontal');
  assert.equal(s.a.y % 100, 0);
  assert.equal(s.a.x % 100, 0);
  assert.equal(s.b.x % 100, 0);
  assert.equal(res.closed, false);
});

test('rough rectangle becomes a closed, squared room', () => {
  const pts = strokeFrom([
    { x: 0, y: 0 }, { x: 5200, y: 120 }, { x: 5100, y: 4000 }, { x: -80, y: 3900 }, { x: 60, y: 150 },
  ]);
  const res = recognizeStroke(pts, { scale: SCALE, grid: 100 });
  assert.ok(res);
  assert.equal(res.closed, true);
  assert.equal(res.segments.length, 4);
  for (const s of res.segments) {
    assert.ok(isAxis(s), 'axis aligned');
    assert.equal(s.bulge, 0);
  }
  for (let i = 0; i < 4; i++) {
    const a = res.segments[i], b = res.segments[(i + 1) % 4];
    assert.ok(Math.hypot(a.b.x - b.a.x, a.b.y - b.a.y) < 1e-6, 'connected');
  }
});

test('L-shaped polyline keeps its corners', () => {
  const res = recognizeStroke(strokeFrom([{ x: 0, y: 0 }, { x: 4000, y: 60 }, { x: 4050, y: 3000 }, { x: 7000, y: 2950 }]), { scale: SCALE, grid: 50 });
  assert.equal(res.segments.length, 3);
  assert.equal(res.closed, false);
  for (const s of res.segments) assert.ok(isAxis(s));
});

test('a curved stroke becomes an arc wall', () => {
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = Math.PI * (i / 60) * 0.8 + Math.PI * 0.1;
    pts.push({ x: 3000 + 2500 * Math.cos(t) + jitter(1.5), y: 2500 * Math.sin(t) + jitter(1.5) });
  }
  const res = recognizeStroke(pts, { scale: SCALE });
  assert.equal(res.segments.length, 1);
  assert.ok(Math.abs(res.segments[0].bulge) > 500, 'has curvature ' + res.segments[0].bulge);
});

test('a circle becomes four arc walls', () => {
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const t = (2 * Math.PI * i) / 80;
    pts.push({ x: 2000 * Math.cos(t) + jitter(2), y: 2000 * Math.sin(t) + jitter(2) });
  }
  const res = recognizeStroke(pts, { scale: SCALE, grid: 100 });
  assert.ok(res.circle);
  assert.equal(res.segments.length, 4);
  assert.ok(Math.abs(res.circle.r - 2000) <= 100);
});

test('rotated rectangle keeps right angles', () => {
  const ang = (22 * Math.PI) / 180;
  const rot = (p) => ({ x: p.x * Math.cos(ang) - p.y * Math.sin(ang), y: p.x * Math.sin(ang) + p.y * Math.cos(ang) });
  const pts = strokeFrom([{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }, { x: 0, y: 0 }].map(rot));
  const res = recognizeStroke(pts, { scale: SCALE, angleSnap: 45 });
  assert.equal(res.closed, true);
  assert.equal(res.segments.length, 4);
  for (let i = 0; i < 4; i++) {
    const a = res.segments[i], b = res.segments[(i + 1) % 4];
    const d1 = { x: a.b.x - a.a.x, y: a.b.y - a.a.y }, d2 = { x: b.b.x - b.a.x, y: b.b.y - b.a.y };
    const c = (d1.x * d2.x + d1.y * d2.y) / (Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y));
    assert.ok(Math.abs(c) < 1e-6, 'perpendicular');
  }
});

test('snapping re-anchors to existing geometry', () => {
  const target = { x: 2000, y: 1000 };
  const res = recognizeStroke(strokeFrom([{ x: 2050, y: 960 }, { x: 7000, y: 1040 }]), {
    scale: SCALE,
    grid: 100,
    snap: (p) => (Math.hypot(p.x - target.x, p.y - target.y) < 300 ? target : null),
  });
  assert.equal(res.segments.length, 1);
  assert.deepEqual(res.segments[0].a, target);
  assert.equal(res.segments[0].b.y, 1000);
});

test('tiny strokes are ignored', () => {
  assert.equal(recognizeStroke([{ x: 0, y: 0 }, { x: 50, y: 20 }], { scale: SCALE }), null);
});
