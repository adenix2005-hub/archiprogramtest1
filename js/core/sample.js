// A small sample house so the app opens in a working state.

import { newDoc } from './model.js';

export function sampleHouse() {
  const doc = newDoc('Sample house');
  doc.settings.units = 'mm';
  let n = 0;
  const id = (p) => `${p}s${(++n).toString(36)}`;
  const L = 'L1';
  const W = (ax, ay, bx, by, t = 250, extra = {}) => {
    const w = { id: id('w'), level: L, a: { x: ax, y: ay }, b: { x: bx, y: by }, bulge: 0, thickness: t, height: 2700, heightEnd: null, baseOffset: 0, ...extra };
    doc.walls.push(w);
    return w;
  };
  const south = W(0, 0, 12000, 0);
  const east = W(12000, 0, 12000, 8000);
  const north = W(12000, 8000, 0, 8000);
  const west = W(0, 8000, 0, 0);
  const spine = W(7000, 0, 7000, 8000, 110);
  const bedSplit = W(7000, 4000, 12000, 4000, 110);
  const bathSouth = W(0, 5000, 3500, 5000, 110);
  W(3500, 5000, 3500, 8000, 110, { bulge: -600 });

  const O = (wall, kind, pos, width, height, extra = {}) => {
    doc.openings.push({
      id: id('o'),
      wall: wall.id,
      kind,
      style: kind === 'door' ? 'single' : kind === 'window' ? 'casement' : 'opening',
      pos,
      width,
      height,
      sill: kind === 'window' ? 900 : 0,
      swing: 1,
      hinge: 'start',
      ...extra,
    });
  };
  O(south, 'door', 2200, 920, 2100, { swing: 1 });
  O(south, 'window', 5000, 1800, 1500, { sill: 750 });
  O(south, 'window', 9500, 1500, 1200);
  O(east, 'window', 2000, 1200, 1200);
  O(east, 'window', 6000, 1200, 1200);
  O(north, 'window', 2500, 1500, 1200);
  O(north, 'door', 6750, 2100, 2100, { style: 'sliding' });
  O(north, 'window', 10250, 800, 600, { sill: 1500, style: 'awning' });
  O(west, 'window', 5500, 1500, 1000, { sill: 1000 });
  O(spine, 'door', 2600, 820, 2040, { swing: -1, hinge: 'end' });
  O(spine, 'door', 5400, 820, 2040, { swing: -1 });
  O(bathSouth, 'door', 2600, 720, 2040, { swing: 1 });
  void bedSplit;

  const R = (x, y, name, color) => doc.rooms.push({ id: id('r'), level: L, x, y, name, color, auto: true });
  R(3500, 2500, 'Living / Kitchen', '#d9c7a7');
  R(1700, 6500, 'Bathroom', '#c9d6dc');
  R(9500, 2000, 'Bedroom 1', '#cfc2b0');
  R(9500, 6000, 'Bedroom 2', '#cfc2b0');

  doc.roofs.push({
    id: id('f'),
    level: L,
    points: [
      { x: -125, y: -125 },
      { x: 12125, y: -125 },
      { x: 12125, y: 8125 },
      { x: -125, y: 8125 },
    ],
    kind: 'hip',
    pitch: 25,
    overhang: 500,
    thickness: 250,
    baseOffset: null,
    edges: null,
    rotate: false,
    lowEdge: null,
    color: null,
  });

  doc.dims.push({ id: id('d'), level: L, a: { x: -125, y: -125 }, b: { x: 12125, y: -125 }, offset: -1100 });
  doc.dims.push({ id: id('d'), level: L, a: { x: 12125, y: -125 }, b: { x: 12125, y: 8125 }, offset: -1100 });

  doc.sections.push({ id: id('s'), name: 'Section A', a: { x: -1500, y: 3000 }, b: { x: 13500, y: 3000 }, flip: false, depth: 0 });
  doc.views.push({
    id: id('v'),
    name: 'Street view',
    pos: { x: -5200, y: -9500, z: 1650 },
    target: { x: 6000, y: 3500, z: 1500 },
    fov: 55,
  });
  return doc;
}
