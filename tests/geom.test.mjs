import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength, formatLength, parseAngle, formatArea } from '../js/core/units.js';
import { makePath, sagittaFrom3, LinePath, ArcPath } from '../js/geom/path.js';
import { computeWallGeoms, wallOutline } from '../js/geom/joins.js';
import { detectRooms, outlineFootprint } from '../js/geom/rooms.js';
import { signedArea, area, pointInPolygon } from '../js/geom/polygon.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const nearPt = (p, q, eps = 1e-6) => near(p.x, q.x, eps) && near(p.y, q.y, eps);

let seq = 0;
function wall(ax, ay, bx, by, opts = {}) {
  return { id: 'w' + ++seq, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 200, height: 2700, bulge: 0, ...opts };
}

test('parseLength handles units and expressions', () => {
  assert.equal(parseLength('3600', 'mm'), 3600);
  assert.equal(parseLength('3.6', 'm'), 3600);
  assert.equal(parseLength('3.6m', 'mm'), 3600);
  assert.equal(parseLength('360cm', 'mm'), 3600);
  assert.equal(parseLength('3000+600', 'mm'), 3600);
  assert.equal(parseLength('1200*3', 'mm'), 3600);
  assert.equal(parseLength('1.2*3', 'm'), 3600);
  assert.equal(parseLength('(3000+600)/2', 'mm'), 1800);
  assert.ok(near(parseLength(`11'6"`, 'ftin'), (11 * 12 + 6) * 25.4));
  assert.ok(near(parseLength(`11' 6 1/2"`, 'ftin'), (11 * 12 + 6.5) * 25.4));
  assert.ok(near(parseLength(`11'-6`, 'ftin'), (11 * 12 + 6) * 25.4));
  assert.ok(near(parseLength('12', 'ftin'), 12 * 304.8));
  assert.ok(near(parseLength('12 6', 'ftin'), (12 * 12 + 6) * 25.4));
  assert.ok(near(parseLength('6 1/2"', 'mm'), 6.5 * 25.4));
  assert.ok(near(parseLength('3m+200mm', 'mm'), 3200));
  assert.ok(Number.isNaN(parseLength('abc', 'mm')));
  assert.ok(Number.isNaN(parseLength('', 'mm')));
});

test('formatLength formats each unit system', () => {
  assert.equal(formatLength(3600, 'mm'), '3600');
  assert.equal(formatLength(3600, 'm'), '3.60');
  assert.equal(formatLength(3600, 'cm'), '360');
  assert.equal(formatLength((11 * 12 + 6.5) * 25.4, 'ftin'), `11'-6 1/2"`);
  assert.equal(formatLength(6 * 25.4, 'ftin'), `6"`);
  assert.equal(formatLength(12 * 304.8, 'ftin'), `12'-0"`);
  assert.equal(formatArea(12.5e6, 'mm'), '12.50 m²');
});

test('parseAngle accepts degrees and rise:run', () => {
  assert.equal(parseAngle('30'), 30);
  assert.equal(parseAngle('30°'), 30);
  assert.ok(near(parseAngle('12:12'), 45));
  assert.ok(near(parseAngle('6/12'), (Math.atan(0.5) * 180) / Math.PI));
});

test('arc path geometry', () => {
  const p = makePath({ x: 0, y: 0 }, { x: 2000, y: 0 }, 1000); // semicircle bulging up (left)
  assert.ok(p instanceof ArcPath);
  assert.ok(near(p.radius, 1000));
  assert.ok(nearPt(p.center, { x: 1000, y: 0 }));
  assert.ok(near(p.length, Math.PI * 1000, 1e-6));
  assert.ok(nearPt(p.pointAt(p.length / 2), { x: 1000, y: 1000 }, 1e-6));
  // left normal on a left-bulging arc points outward
  const n = p.normalAt(p.length / 2);
  assert.ok(nearPt(n, { x: 0, y: 1 }, 1e-9));
  assert.ok(nearPt(p.offsetAt(p.length / 2, 100), { x: 1000, y: 1100 }, 1e-6));
  // projection
  const pr = p.project({ x: 1000, y: 1500 });
  assert.ok(near(pr.s, p.length / 2, 1e-6));
  assert.equal(pr.side, 1);
  // sagitta from three points
  const s = sagittaFrom3({ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 2000, y: 0 });
  assert.ok(near(s, 1000, 1e-6));
  const s2 = sagittaFrom3({ x: 0, y: 0 }, { x: 1000, y: -300 }, { x: 2000, y: 0 });
  assert.ok(near(s2, -300, 1e-6));
  // major arc
  const s3 = sagittaFrom3({ x: 0, y: 0 }, { x: 1000, y: 1500 }, { x: 2000, y: 0 });
  const p3 = makePath({ x: 0, y: 0 }, { x: 2000, y: 0 }, s3);
  assert.ok(p3.project({ x: 1000, y: 1500 }).dist < 1e-6);
  assert.ok(Math.abs(p3.sweep) > Math.PI);
  assert.ok(near(p.paramOf(p.pointAt(0)), 0, 1e-6));
  assert.ok(near(p3.paramOf(p3.pointAt(p3.length)), p3.length, 1e-6));
});

test('L corner joins with a shared mitre', () => {
  const w1 = wall(0, 0, 4000, 0);
  const w2 = wall(4000, 0, 4000, 3000);
  const { geoms } = computeWallGeoms([w1, w2]);
  const g1 = geoms.get(w1.id), g2 = geoms.get(w2.id);
  // outer corner (4100, -100), inner corner (3900, 100)
  assert.ok(nearPt(g1.end.right, { x: 4100, y: -100 }));
  assert.ok(nearPt(g1.end.left, { x: 3900, y: 100 }));
  assert.ok(nearPt(g2.start.right, { x: 4100, y: -100 }));
  assert.ok(nearPt(g2.start.left, { x: 3900, y: 100 }));
  assert.equal(g1.end.center, null);
  // free ends are square
  assert.ok(nearPt(g1.start.left, { x: 0, y: 100 }));
  assert.ok(nearPt(g1.start.right, { x: 0, y: -100 }));
  const outline = wallOutline(g1);
  assert.equal(outline.length, 1);
  assert.ok(signedArea(outline[0]) > 0);
  // area: trapezoid from x=0..4100 (outer) and 0..3900 (inner), 200 thick
  assert.ok(near(area(outline[0]), ((4100 + 3900) / 2) * 200, 1e-3));
});

test('T junction trims against the host face', () => {
  const host = wall(0, 0, 6000, 0);
  const branch = wall(3000, 0, 3000, 3000, { thickness: 100 });
  const { geoms } = computeWallGeoms([host, branch]);
  const gb = geoms.get(branch.id);
  assert.equal(gb.start.kind, 'tee');
  assert.equal(gb.start.host, host.id);
  // branch goes +y; its own left is -x side
  assert.ok(nearPt(gb.start.left, { x: 2950, y: 100 }));
  assert.ok(nearPt(gb.start.right, { x: 3050, y: 100 }));
  const gh = geoms.get(host.id);
  assert.equal(gh.start.kind, 'free');
});

test('three-way node uses the centre point', () => {
  const a = wall(0, 0, 3000, 0);
  const b = wall(3000, 0, 6000, 0);
  const c = wall(3000, 0, 3000, 3000);
  const { geoms } = computeWallGeoms([a, b, c]);
  const ga = geoms.get(a.id);
  assert.ok(nearPt(ga.end.center, { x: 3000, y: 0 }));
  // collinear continuation: square-ish corners on the bottom side
  assert.ok(nearPt(ga.end.right, { x: 3000, y: -100 }));
  // inner corner with c
  assert.ok(nearPt(ga.end.left, { x: 2900, y: 100 }));
});

test('outline with opening cut produces two pieces', () => {
  const w = wall(0, 0, 4000, 0);
  const { geoms } = computeWallGeoms([w]);
  const g = geoms.get(w.id);
  const pieces = wallOutline(g, [{ s0: 1000, s1: 1900 }]);
  assert.equal(pieces.length, 2);
  const total = pieces.reduce((s, p) => s + area(p), 0);
  assert.ok(near(total, (4000 - 900) * 200, 1e-3));
});

test('curved wall joined to straight walls', () => {
  const w1 = wall(0, 0, 4000, 0);
  const arc = wall(4000, 0, 4000, 4000, { bulge: -800 }); // bulges right (east)
  const w2 = wall(4000, 4000, 0, 4000);
  const w3 = wall(0, 4000, 0, 0);
  const { geoms } = computeWallGeoms([w1, arc, w2, w3]);
  const ga = geoms.get(arc.id);
  assert.equal(ga.start.kind, 'node');
  assert.equal(ga.end.kind, 'node');
  // corners lie on the arc offset curves
  const p = ga.path;
  const rl = Math.hypot(ga.start.left.x - p.center.x, ga.start.left.y - p.center.y);
  assert.ok(near(rl, p.offsetRadius(100), 1e-6));
  const { rooms } = detectRooms([w1, arc, w2, w3]);
  assert.equal(rooms.length, 1);
  // area = square + circular segment
  const r = p.radius, theta = Math.abs(p.sweep);
  const seg = 0.5 * r * r * (theta - Math.sin(theta));
  assert.ok(Math.abs(rooms[0].area - (16e6 + seg)) / (16e6 + seg) < 0.01);
});

test('room detection on a two-room plan with a dangling wall', () => {
  const walls = [
    wall(0, 0, 8000, 0),
    wall(8000, 0, 8000, 5000),
    wall(8000, 5000, 0, 5000),
    wall(0, 5000, 0, 0),
    wall(4000, 0, 4000, 5000, { thickness: 100 }),
    wall(1000, 2500, 2500, 2500, { thickness: 100 }), // dangling inside room 1
  ];
  const { rooms, outlines } = detectRooms(walls);
  assert.equal(rooms.length, 2);
  for (const r of rooms) {
    assert.ok(near(r.area, 20e6, 1));
    // net: (4000 - 100 - 50) x (5000 - 200)
    assert.ok(near(r.netArea, 3850 * 4800, 1));
  }
  assert.equal(outlines.length, 1);
  assert.ok(near(outlines[0].area, 40e6, 1));
  const fp = outlineFootprint(outlines[0]);
  assert.ok(near(area(fp), 8200 * 5200, 1));
  assert.ok(signedArea(fp) > 0);
});

test('crossing walls split into four rooms', () => {
  const walls = [
    wall(0, 0, 6000, 0), wall(6000, 0, 6000, 6000), wall(6000, 6000, 0, 6000), wall(0, 6000, 0, 0),
    wall(3000, -500, 3000, 6500), wall(-500, 3000, 6500, 3000),
  ];
  const { rooms } = detectRooms(walls);
  assert.equal(rooms.length, 4);
  for (const r of rooms) {
    assert.ok(near(r.area, 9e6, 1));
    assert.ok(pointInPolygon(r.label, r.poly));
  }
});

test('line path projection', () => {
  const p = new LinePath({ x: 0, y: 0 }, { x: 1000, y: 0 });
  const pr = p.project({ x: 500, y: -20 });
  assert.equal(pr.side, -1);
  assert.ok(near(pr.dist, 20));
  assert.ok(near(p.paramOf({ x: -100, y: 5 }), -100));
});
