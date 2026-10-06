import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model, newDoc, normalize } from '../js/core/model.js';
import { sampleHouse } from '../js/core/sample.js';
import { detectRooms } from '../js/geom/rooms.js';
import { beginTransform, applyTranslate, beginParallelMove, applyParallelMove, setWallLength, flipWall, splitWall, beginEndDrag, applyEndDrag, addWallChain, duplicate } from '../js/core/ops.js';

test('sample house normalises into four named rooms', () => {
  const m = new Model(sampleHouse());
  const doc = m.doc;
  const { rooms } = detectRooms(doc.walls);
  assert.equal(rooms.length, 4);
  assert.equal(doc.rooms.length, 4);
  const names = doc.rooms.map((r) => r.name).sort();
  assert.deepEqual(names, ['Bathroom', 'Bedroom 1', 'Bedroom 2', 'Living / Kitchen']);
  assert.equal(doc.openings.length, 12);
});

test('undo/redo and revert', () => {
  const m = new Model(newDoc());
  addWallChain(m, 'L1', [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }], { closed: true });
  m.commit('Room');
  assert.equal(m.doc.walls.length, 4);
  assert.equal(m.doc.rooms.length, 1, 'auto room tag');
  m.doc.walls[0].a.x = -500;
  m.touch();
  m.revert();
  assert.equal(m.doc.walls[0].a.x, 0);
  m.undo();
  assert.equal(m.doc.walls.length, 0);
  assert.equal(m.doc.rooms.length, 0);
  m.redo();
  assert.equal(m.doc.walls.length, 4);
});

test('moving a wall parallel keeps corners joined and neighbours square', () => {
  const m = new Model(newDoc());
  const ws = addWallChain(m, 'L1', [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }], { closed: true });
  m.commit();
  const east = m.doc.walls.find((w) => w.id === ws[1].id);
  const ctx = beginParallelMove(m.doc, east);
  // east wall direction is +y, left normal is -x: offset -500 moves it to x=4500
  applyParallelMove(m.doc, ctx, -500);
  assert.deepEqual(east.a, { x: 4500, y: 0 });
  assert.deepEqual(east.b, { x: 4500, y: 3000 });
  const south = m.doc.walls.find((w) => w.id === ws[0].id);
  const north = m.doc.walls.find((w) => w.id === ws[2].id);
  assert.deepEqual(south.b, { x: 4500, y: 0 });
  assert.deepEqual(north.a, { x: 4500, y: 3000 });
});

test('T walls stay attached when the host moves', () => {
  const m = new Model(newDoc());
  const [host] = addWallChain(m, 'L1', [{ x: 0, y: 0 }, { x: 6000, y: 0 }]);
  const [branch] = addWallChain(m, 'L1', [{ x: 3000, y: 0 }, { x: 3000, y: 3000 }]);
  m.commit();
  const ctx = beginTransform(m.doc, [host.id]);
  applyTranslate(m.doc, ctx, { x: 700, y: -400 });
  assert.deepEqual(branch.a, { x: 3000, y: -400 });
  assert.deepEqual(branch.b, { x: 3000, y: 3000 });
});

test('dragging a shared end point moves joined ends; openings keep their place', () => {
  const m = new Model(newDoc());
  const [w1, w2] = addWallChain(m, 'L1', [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }]);
  m.doc.openings.push({ id: 'o1', wall: w1.id, kind: 'window', style: 'casement', pos: 1000, width: 900, height: 1200, sill: 900, swing: 1, hinge: 'start' });
  m.commit();
  const ctx = beginEndDrag(m.doc, w1, 'a');
  applyEndDrag(m.doc, ctx, { x: -1000, y: 0 });
  assert.equal(m.doc.openings[0].pos, 2000, 'window stays at x=1000');
  const ctx2 = beginEndDrag(m.doc, w1, 'b');
  applyEndDrag(m.doc, ctx2, { x: 5000, y: 0 });
  assert.deepEqual(w2.a, { x: 5000, y: 0 });
});

test('setWallLength, flip and split', () => {
  const m = new Model(newDoc());
  const [w] = addWallChain(m, 'L1', [{ x: 0, y: 0 }, { x: 4000, y: 0 }]);
  m.doc.openings.push({ id: 'o1', wall: w.id, kind: 'door', style: 'single', pos: 1000, width: 820, height: 2040, sill: 0, swing: 1, hinge: 'start' });
  setWallLength(m.doc, w, 5000);
  assert.deepEqual(w.b, { x: 5000, y: 0 });
  flipWall(m.doc, w);
  assert.deepEqual(w.a, { x: 5000, y: 0 });
  assert.equal(m.doc.openings[0].pos, 4000);
  assert.equal(m.doc.openings[0].swing, -1);
  const w2 = splitWall(m, w, 2500);
  assert.ok(w2);
  assert.equal(m.doc.openings[0].wall, w2.id);
  assert.equal(m.doc.openings[0].pos, 1500);
});

test('duplicate copies walls with their openings', () => {
  const m = new Model(sampleHouse());
  const before = m.doc.openings.length;
  const ids = m.doc.walls.map((w) => w.id);
  const out = duplicate(m, ids, { x: 20000, y: 0 });
  assert.equal(out.length, ids.length);
  assert.equal(m.doc.openings.length, before * 2);
  m.commit();
  assert.equal(m.doc.rooms.length, 8);
});

test('normalize clamps openings to the wall', () => {
  const doc = newDoc();
  doc.walls.push({ id: 'w1', level: 'L1', a: { x: 0, y: 0 }, b: { x: 2000, y: 0 }, bulge: 0, thickness: 200, height: 2700 });
  doc.openings.push({ id: 'o1', wall: 'w1', kind: 'window', pos: 1900, width: 1200, height: 1200, sill: 900, swing: 1, hinge: 'start' });
  doc.openings.push({ id: 'o2', wall: 'zz', kind: 'window', pos: 100, width: 600, height: 600, sill: 900 });
  normalize(doc);
  assert.equal(doc.openings.length, 1);
  const o = doc.openings[0];
  assert.ok(o.pos + o.width / 2 <= 2000 - 20 + 1e-9);
  assert.equal(o.width, 1200);
});
