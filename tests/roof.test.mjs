import { test } from 'node:test';
import assert from 'node:assert/strict';
import { straightSkeleton } from '../js/geom/skeleton.js';
import { buildRoofGeometry, autoGableEdges, defaultShedEdge } from '../js/geom/roof.js';
import { area, cleanPolygon, signedArea } from '../js/geom/polygon.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function quadArea(q) {
  const p = q.p;
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const u = p[i], v = p[(i + 1) % 4];
    a += u.x * v.y - v.x * u.y;
  }
  return a / 2;
}

/** Checks coverage and plane consistency of a skeleton. */
function checkSkeleton(poly, weights, sk, label = '') {
  const total = sk.quads.reduce((s, q) => s + (weights[q.edge] ? Math.abs(quadArea(q)) : 0), 0)
    + sk.caps.reduce((s, c) => s + area(c.poly), 0);
  const A = area(poly);
  assert.ok(Math.abs(total - A) / A < 1e-6, `${label} coverage ${total} vs ${A}`);
  for (const q of sk.quads) {
    const e = sk.edges[q.edge];
    for (const p of q.p) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.t), `${label} finite`);
      assert.ok(p.t >= -1e-6, `${label} t >= 0`);
      const off = p.x * e.n.x + p.y * e.n.y - e.c;
      assert.ok(Math.abs(off - e.w * p.t) < 1e-4 * Math.sqrt(A), `${label} plane consistency edge ${q.edge}: ${off} vs ${e.w * p.t}`);
    }
  }
}

const rect = (w, h, x = 0, y = 0) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const L = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
];

test('hip roof on a rectangle', () => {
  const poly = rect(10, 4);
  const w = [1, 1, 1, 1];
  const sk = straightSkeleton(poly, w);
  checkSkeleton(poly, w, sk, 'rect');
  assert.ok(near(sk.maxT, 2, 1e-9));
  const ridge = sk.ridges.find((r) => near(r.a.y, 2) && near(r.b.y, 2));
  assert.ok(ridge, 'ridge at y=2');
  assert.ok(near(Math.abs(ridge.a.x - ridge.b.x), 6, 1e-6));
});

test('pyramid on a square', () => {
  const poly = rect(6, 6);
  const sk = straightSkeleton(poly, [1, 1, 1, 1]);
  checkSkeleton(poly, [1, 1, 1, 1], sk, 'square');
  assert.ok(near(sk.maxT, 3, 1e-9));
  assert.equal(sk.arcs.length, 4);
});

test('gable roof on a rectangle has vertical gable ends', () => {
  const poly = rect(10, 4);
  const gables = autoGableEdges(poly);
  assert.deepEqual(gables, [false, true, false, true]);
  const w = gables.map((g) => (g ? 0 : 1));
  const sk = straightSkeleton(poly, w);
  checkSkeleton(poly, w, sk, 'gable');
  assert.ok(near(sk.maxT, 2, 1e-9));
  const ridge = sk.ridges.find((r) => near(r.a.y, 2) && near(r.b.y, 2));
  assert.ok(ridge && near(Math.abs(ridge.a.x - ridge.b.x), 10, 1e-6), 'full length ridge');
  const alt = autoGableEdges(poly, true);
  assert.deepEqual(alt, [true, false, true, false]);
});

test('shed roof on a rectangle and an L', () => {
  const poly = rect(10, 4);
  const low = defaultShedEdge(poly);
  assert.equal(low, 0);
  const w = [1, 0, 0, 0];
  const sk = straightSkeleton(poly, w);
  checkSkeleton(poly, w, sk, 'shed rect');
  assert.ok(near(sk.maxT, 4, 1e-9));
  const wl = [1, 0, 0, 0, 0, 0];
  const skL = straightSkeleton(L, wl);
  checkSkeleton(L, wl, skL, 'shed L');
  assert.ok(near(skL.maxT, 10, 1e-9));
});

test('hip and gable roofs on an L shape', () => {
  const w = L.map(() => 1);
  const sk = straightSkeleton(L, w);
  checkSkeleton(L, w, sk, 'hip L');
  assert.ok(near(sk.maxT, 2, 1e-9));
  const gables = autoGableEdges(L);
  assert.deepEqual(gables, [false, true, false, false, true, false]);
  const wg = gables.map((g) => (g ? 0 : 1));
  const skg = straightSkeleton(L, wg);
  checkSkeleton(L, wg, skg, 'gable L');
  assert.ok(near(skg.maxT, 2, 1e-9));
});

test('T, U, cross and chamfered footprints', () => {
  const shapes = {
    T: [{ x: 0, y: 6 }, { x: 0, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }].reverse(),
    U: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 9 }, { x: 8, y: 9 }, { x: 8, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 9 }, { x: 0, y: 9 }],
    cross: [
      { x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 4 }, { x: 12, y: 4 }, { x: 12, y: 8 }, { x: 8, y: 8 },
      { x: 8, y: 12 }, { x: 4, y: 12 }, { x: 4, y: 8 }, { x: 0, y: 8 }, { x: 0, y: 4 }, { x: 4, y: 4 },
    ],
    chamfer: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 12, y: 3 }, { x: 12, y: 8 }, { x: 0, y: 8 }],
    bay: [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: -1.2 }, { x: 7, y: -1.2 }, { x: 8, y: 0 }, { x: 12, y: 0 },
      { x: 12, y: 8 }, { x: 0, y: 8 },
    ],
  };
  for (const [name, poly0] of Object.entries(shapes)) {
    const poly = signedArea(poly0) < 0 ? poly0.slice().reverse() : poly0;
    const w = poly.map(() => 1);
    const sk = straightSkeleton(poly, w);
    checkSkeleton(poly, w, sk, name);
    const g = autoGableEdges(poly).map((x) => (x ? 0 : 1));
    const skg = straightSkeleton(poly, g);
    checkSkeleton(poly, g, skg, name + ' gable');
  }
});

test('random histogram footprints terminate with full coverage', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let trial = 0; trial < 60; trial++) {
    const cols = 2 + Math.floor(rnd() * 6);
    const pts = [{ x: 0, y: 0 }];
    const heights = [];
    for (let c = 0; c < cols; c++) heights.push(1 + Math.floor(rnd() * 5));
    pts.push({ x: cols * 2, y: 0 });
    for (let c = cols - 1; c >= 0; c--) {
      pts.push({ x: (c + 1) * 2, y: heights[c] * 2 });
      pts.push({ x: c * 2, y: heights[c] * 2 });
    }
    const poly = cleanPolygon(pts, 1e-6);
    const w = poly.map(() => 1);
    const sk = straightSkeleton(poly, w);
    checkSkeleton(poly, w, sk, 'hist' + trial);
    const g = autoGableEdges(poly).map((v) => (v ? 0 : 1));
    const skg = straightSkeleton(poly, g);
    checkSkeleton(poly, g, skg, 'hist gable' + trial);
  }
});

test('roof geometry with overhang keeps eave height at the wall line', () => {
  const roof = { points: rect(10000, 6000), kind: 'gable', pitch: 30, overhang: 500, thickness: 200 };
  const g = buildRoofGeometry(roof, 2700);
  assert.ok(g);
  const tan = Math.tan(Math.PI / 6);
  // ridge height above plate = 3000 * tan(30)
  const expectedPeak = 2700 + 3000 * tan + 200 / Math.cos(Math.PI / 6);
  assert.ok(near(g.peak, expectedPeak, 1e-6));
  // lowest soffit point at the eave = 2700 - 500 tan30
  const minZ = Math.min(...g.surfaces.flat().map((p) => p.z));
  assert.ok(near(minZ, 2700 - 500 * tan, 1e-6));
  assert.ok(g.gables.length >= 2, 'gable infill');
  for (const gb of g.gables) for (const p of gb.pts) assert.ok(p.z >= 2700 - 1e-6);
  assert.ok(g.fascia.length >= 4);
  const flat = buildRoofGeometry({ ...roof, kind: 'flat' }, 2700);
  assert.equal(flat.surfaces.length, 1);
  const hip = buildRoofGeometry({ ...roof, kind: 'hip' }, 2700);
  assert.equal(hip.gables.length, 0);
  assert.ok(hip.lines.ridges.length >= 5);
});
