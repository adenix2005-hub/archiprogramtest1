// Builds the three.js model (walls with openings, doors, windows, floors,
// roofs) from the document.

import * as THREE from './lib.js';
import { GeoBuilder, V, D, M, slabGeometry, polyNormal } from './geo.js';
import { wallOutline } from '../geom/joins.js';
import { clamp } from '../core/vec.js';

const COLORS = {
  wall: '#f1efea',
  floor: '#d8c9ae',
  roof: '#55595e',
  soffit: '#ebe8e1',
  fascia: '#f3f2ee',
  frame: '#3d4348',
  lining: '#f4f3ef',
  leaf: '#b98d5f',
  metal: '#8f969c',
  sill: '#d9d6cf',
  garage: '#e6e6e2',
};

function arcRefine(path, list) {
  if (!path.isArc) return list;
  const out = [];
  for (let i = 0; i < list.length - 1; i++) {
    const ss = path.samples(list[i], list[i + 1], Math.PI / 36);
    for (let k = 0; k < ss.length - 1; k++) out.push(ss[k]);
  }
  out.push(list[list.length - 1]);
  return out;
}

function wallGeometry(g, level, openings) {
  const w = g.wall;
  const path = g.path;
  const L = path.length;
  const half = g.half;
  const base = level.elevation + (w.baseOffset || 0);
  const h0 = w.height;
  const h1 = w.heightEnd ?? w.height;
  const H = (s) => h0 + (h1 - h0) * clamp(s / L, 0, 1);
  const ops = openings
    .map(({ o, s0, s1 }) => {
      const z0 = o.kind === 'window' ? Math.max(0, o.sill || 0) : 0;
      const top = Math.min(H(s0), H(s1));
      const z1 = Math.min(z0 + o.height, top);
      return { s0, s1, z0, z1, full: z1 >= top - 0.5 };
    })
    .filter((x) => x.z1 > x.z0 + 1);
  const gb = new GeoBuilder();
  const nAt = (s, side) => {
    const n = path.normalAt(s);
    return D({ x: n.x * side, y: n.y * side });
  };

  // Side faces split around openings.
  for (const side of [1, -1]) {
    const d = side * half;
    const sA = side > 0 ? g.start.sLeft : g.start.sRight;
    const sB = side > 0 ? g.end.sLeft : g.end.sRight;
    if (!(sB > sA)) continue;
    const bps = new Set([sA, sB]);
    for (const o of ops) {
      if (o.s0 > sA && o.s0 < sB) bps.add(o.s0);
      if (o.s1 > sA && o.s1 < sB) bps.add(o.s1);
    }
    const list = arcRefine(path, [...bps].sort((a, b) => a - b));
    // Cells on a grid of opening edges and sill/head heights, so neighbouring
    // faces share whole edges (no T-junctions, clean outline edges).
    const zLevels = [...new Set(ops.flatMap((o) => [o.z0, o.z1]).filter((z) => z > 0.5))].sort((a, b) => a - b);
    for (let i = 0; i < list.length - 1; i++) {
      const u0 = list[i], u1 = list[i + 1];
      if (u1 - u0 < 0.01) continue;
      const um = (u0 + u1) / 2;
      const p0 = path.offsetAt(u0, d), p1 = path.offsetAt(u1, d);
      const n0 = nAt(u0, side), n1 = nAt(u1, side);
      const band = (za0, za1, zb0, zb1) => {
        if (za1 - za0 < 0.5 && zb1 - zb0 < 0.5) return;
        if (path.isArc) gb.quadN(V(p0, base + za0), V(p1, base + zb0), V(p1, base + zb1), V(p0, base + za1), n0, n1, n1, n0);
        else gb.quad(V(p0, base + za0), V(p1, base + zb0), V(p1, base + zb1), V(p0, base + za1), n0);
      };
      const top0 = H(u0), top1 = H(u1);
      const levels = [0, ...zLevels.filter((z) => z < Math.min(top0, top1) - 0.5)];
      for (let k = 0; k < levels.length; k++) {
        const za = levels[k];
        const last = k === levels.length - 1;
        const zb0 = last ? top0 : levels[k + 1];
        const zb1 = last ? top1 : levels[k + 1];
        const zm = (za + Math.min(zb0, zb1)) / 2;
        if (ops.some((o) => um > o.s0 && um < o.s1 && zm > o.z0 && zm < o.z1)) continue;
        band(za, zb0, za, zb1);
      }
    }
  }

  // Top and bottom from the joined outline (cut where openings reach the top).
  const fullCuts = ops.filter((o) => o.full).map((o) => ({ s0: o.s0, s1: o.s1 }));
  for (const poly of wallOutline(g, fullCuts)) {
    const hs = poly.map((p) => base + H(path.paramOf(p)));
    gb.planPolygon(poly, hs, 1);
  }
  for (const poly of wallOutline(g, ops.filter((o) => o.z0 <= 0.5).map((o) => ({ s0: o.s0, s1: o.s1 })))) {
    gb.planPolygon(poly, base, -1);
  }

  // Opening reveals: jambs, head and sill.
  for (const o of ops) {
    for (const [s, dir] of [[o.s0, 1], [o.s1, -1]]) {
      const t = path.tangentAt(s);
      const a = path.offsetAt(s, half), b = path.offsetAt(s, -half);
      gb.quad(V(a, base + o.z0), V(b, base + o.z0), V(b, base + o.z1), V(a, base + o.z1), D({ x: t.x * dir, y: t.y * dir }));
    }
    const ss = path.samples(o.s0, o.s1, Math.PI / 36);
    for (let i = 0; i < ss.length - 1; i++) {
      const a0 = path.offsetAt(ss[i], half), a1 = path.offsetAt(ss[i + 1], half);
      const b0 = path.offsetAt(ss[i], -half), b1 = path.offsetAt(ss[i + 1], -half);
      if (!o.full) gb.quad(V(a0, base + o.z1), V(a1, base + o.z1), V(b1, base + o.z1), V(b0, base + o.z1), [0, -1, 0]);
      if (o.z0 > 0.5) gb.quad(V(a0, base + o.z0), V(a1, base + o.z0), V(b1, base + o.z0), V(b0, base + o.z0), [0, 1, 0]);
    }
  }

  // Free ends.
  for (const [cap, s, dir] of [[g.start, 0, -1], [g.end, L, 1]]) {
    if (cap.kind !== 'free') continue;
    const t = path.tangentAt(s);
    const hh = H(s);
    gb.quad(V(cap.left, base), V(cap.right, base), V(cap.right, base + hh), V(cap.left, base + hh), D({ x: t.x * dir, y: t.y * dir }));
  }
  return gb.empty ? null : gb.build();
}

function addBox(group, mat, w, h, d, x, y, zLeft) {
  if (w <= 0 || h <= 0 || d <= 0) return null;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * M, h * M, d * M), mat);
  m.position.set(x * M, y * M, -zLeft * M);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function openingGroup(o, g, level, mats) {
  const path = g.path;
  const T = g.wall.thickness;
  const W = o.width;
  const Hh = o.height;
  const sill = o.kind === 'window' ? o.sill || 0 : 0;
  const base = level.elevation + (g.wall.baseOffset || 0);
  const s = clamp(o.pos, 0, path.length);
  const P = path.pointAt(s);
  const t = path.tangentAt(s);
  const grp = new THREE.Group();
  grp.position.set(P.x * M, (base + sill) * M, -P.y * M);
  grp.rotation.y = Math.atan2(t.y, t.x);
  const sigma = (o.swing ?? 1) >= 0 ? 1 : -1;
  const frame = mats.solid(COLORS.frame, { roughness: 0.5 });
  const lining = mats.solid(COLORS.lining, { roughness: 0.7 });
  const leaf = mats.solid(COLORS.leaf, { roughness: 0.65 });
  const metal = mats.solid(COLORS.metal, { roughness: 0.35, metalness: 0.6 });
  if (o.kind === 'window') {
    const f = 55;
    const fd = Math.max(40, Math.min(T - 20, 80));
    addBox(grp, frame, f, Hh, fd, -W / 2 + f / 2, Hh / 2, 0);
    addBox(grp, frame, f, Hh, fd, W / 2 - f / 2, Hh / 2, 0);
    addBox(grp, frame, W, f, fd, 0, Hh - f / 2, 0);
    addBox(grp, frame, W, f, fd, 0, f / 2, 0);
    const gl = new THREE.Mesh(new THREE.BoxGeometry((W - 2 * f) * M, (Hh - 2 * f) * M, 8 * M), mats.glass);
    gl.position.set(0, (Hh / 2) * M, 0);
    gl.renderOrder = 2;
    grp.add(gl);
    const style = o.style || 'casement';
    if (style === 'sliding' || (style === 'casement' && W > 1000)) addBox(grp, frame, f * 0.9, Hh - 2 * f, fd * 0.8, 0, Hh / 2, 0);
    if (style === 'double-hung') addBox(grp, frame, W - 2 * f, f * 0.9, fd * 0.8, 0, Hh / 2, 0);
    if (style === 'awning') addBox(grp, frame, W - 2 * f, f * 0.8, fd * 0.8, 0, Hh * 0.62, 0);
    addBox(grp, mats.solid(COLORS.sill), W + 80, 25, T + 50, 0, -12.5, 0);
    return grp;
  }
  if (o.kind !== 'door') return grp;
  const lt = 30;
  addBox(grp, lining, lt, Hh, T + 4, -W / 2 + lt / 2, Hh / 2, 0);
  addBox(grp, lining, lt, Hh, T + 4, W / 2 - lt / 2, Hh / 2, 0);
  addBox(grp, lining, W, lt, T + 4, 0, Hh - lt / 2, 0);
  const style = o.style || 'single';
  const lw = W - 2 * lt - 6;
  const lh = Hh - lt - 12;
  const zf = sigma * Math.max(0, T / 2 - 32);
  const handle = (x, z) => {
    addBox(grp, metal, 120, 20, 22, x, 1000, z + 32);
    addBox(grp, metal, 120, 20, 22, x, 1000, z - 32);
  };
  switch (style) {
    case 'double': {
      addBox(grp, leaf, lw / 2 - 2, lh, 40, -lw / 4 - 1, lh / 2 + 6, zf);
      addBox(grp, leaf, lw / 2 - 2, lh, 40, lw / 4 + 1, lh / 2 + 6, zf);
      handle(-60, zf);
      handle(60, zf);
      break;
    }
    case 'sliding': {
      const pw = lw * 0.53;
      for (const [x, z] of [[-lw / 2 + pw / 2, T * 0.16], [lw / 2 - pw / 2, -T * 0.16]]) {
        addBox(grp, frame, pw, 50, 40, x, lh - 25 + 6, z);
        addBox(grp, frame, pw, 60, 40, x, 30 + 6, z);
        addBox(grp, frame, 50, lh, 40, x - pw / 2 + 25, lh / 2 + 6, z);
        addBox(grp, frame, 50, lh, 40, x + pw / 2 - 25, lh / 2 + 6, z);
        const gl = new THREE.Mesh(new THREE.BoxGeometry((pw - 100) * M, (lh - 110) * M, 8 * M), mats.glass);
        gl.position.set(x * M, ((lh - 110) / 2 + 66) * M, -z * M);
        gl.renderOrder = 2;
        grp.add(gl);
      }
      break;
    }
    case 'garage': {
      const panel = mats.solid(COLORS.garage, { roughness: 0.6 });
      addBox(grp, panel, lw, lh, 45, 0, lh / 2 + 6, zf);
      for (let k = 1; k < 4; k++) addBox(grp, mats.solid('#c9c9c4'), lw, 18, 50, 0, (lh * k) / 4, zf);
      break;
    }
    default: {
      addBox(grp, leaf, lw, lh, 40, 0, lh / 2 + 6, zf);
      const latchX = o.hinge === 'end' ? -(lw / 2 - 70) : lw / 2 - 70;
      handle(latchX, zf);
    }
  }
  return grp;
}

/**
 * Build the whole model.
 * Returns {group, meshesById: Map<id, Mesh[]>, pickables: Mesh[], bounds: Box3}
 */
export function buildModel(app, mats, opts = {}) {
  const doc = app.model.doc;
  const derived = app.derived;
  const root = new THREE.Group();
  root.name = 'model';
  const meshesById = new Map();
  const pickables = [];
  const reg = (id, mesh) => {
    mesh.userData.id = id;
    if (!meshesById.has(id)) meshesById.set(id, []);
    meshesById.get(id).push(mesh);
    pickables.push(mesh);
  };
  const edges = (mesh, angle = 28) => {
    if (!opts.edges) return;
    const eg = new THREE.EdgesGeometry(mesh.geometry, angle);
    const ls = new THREE.LineSegments(eg, mats.edge);
    ls.raycast = () => {};
    ls.renderOrder = 1;
    mesh.add(ls);
  };
  const wallMat = (w) => mats.solid(w.color || COLORS.wall);
  const slab = doc.settings.slabThickness || 150;
  let maxWallT = 0;

  for (const level of doc.levels) {
    const lv = derived.level(level.id);
    for (const [id, g] of lv.geoms) {
      maxWallT = Math.max(maxWallT, g.wall.thickness);
      const geo = wallGeometry(g, level, lv.openingsByWall.get(id) || []);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, wallMat(g.wall));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      edges(mesh);
      reg(id, mesh);
      root.add(mesh);
    }
    for (const [wid, list] of lv.openingsByWall) {
      const g = lv.geoms.get(wid);
      for (const { o } of list) {
        const grp = openingGroup(o, g, level, mats);
        grp.traverse((m) => {
          if (m.isMesh) reg(o.id, m);
        });
        root.add(grp);
      }
    }
    // Floors.
    for (const r of lv.rooms) {
      const color = r.tag?.color || COLORS.floor;
      const top = level.elevation - 2;
      const geo = slabGeometry(r.poly, top - slab, top);
      const mesh = new THREE.Mesh(geo, mats.solid(color, { roughness: 0.92 }));
      mesh.receiveShadow = true;
      mesh.castShadow = level.elevation > 0;
      edges(mesh, 40);
      if (r.tag) reg(r.tag.id, mesh);
      root.add(mesh);
    }
  }

  // Roofs.
  for (const roof of doc.roofs) {
    const rg = derived.roof(roof);
    if (!rg) continue;
    const topMat = mats.solid(roof.color || COLORS.roof, { roughness: 0.8 });
    const gb = new GeoBuilder();
    const add3 = (pts, hint) => {
      const p3 = pts.map((p) => V(p, p.z));
      if (p3.length <= 4) gb.fan(p3, hint);
      else {
        // general polygon (flat caps): triangulate in plan
        gb.planPolygon(pts, pts.map((p) => p.z), hint[1] >= 0 ? 1 : -1);
      }
    };
    for (const p of rg.tops) add3(p, [0, 1, 0]);
    const top = gb.build();
    const mTop = new THREE.Mesh(top, topMat);
    mTop.castShadow = true;
    mTop.receiveShadow = true;
    edges(mTop, 20);
    reg(roof.id, mTop);
    root.add(mTop);

    const gs = new GeoBuilder();
    for (const p of rg.surfaces) {
      const p3 = p.map((q) => V(q, q.z));
      if (p3.length <= 4) gs.fan(p3, [0, -1, 0]);
      else gs.planPolygon(p, p.map((q) => q.z), -1);
    }
    for (const f of rg.fascia) gs.quad(...f.pts.map((q) => V(q, q.z)), D(f.out));
    const mUnder = new THREE.Mesh(gs.build(), mats.solid(COLORS.soffit));
    mUnder.castShadow = true;
    mUnder.receiveShadow = true;
    edges(mUnder, 20);
    reg(roof.id, mUnder);
    root.add(mUnder);

    if (rg.gables.length) {
      const gg = new GeoBuilder();
      const th = maxWallT || 200;
      for (const gab of rg.gables) {
        const outer = gab.pts.map((q) => V(q, q.z));
        const n = gab.n;
        const inner = gab.pts.map((q) => V({ x: q.x + n.x * th, y: q.y + n.y * th }, q.z));
        const nrm = polyNormal(outer);
        if (Math.hypot(nrm[0], nrm[1], nrm[2]) < 0.5) continue;
        gg.fan(outer, D({ x: -n.x, y: -n.y }));
        gg.fan(inner, D(n));
        for (let i = 0; i < 4; i++) {
          const a = gab.pts[i], b = gab.pts[(i + 1) % 4];
          if (Math.abs(a.z - b.z) < 1) continue; // horizontal edges sit on the wall or under the next step
          const ia = inner[i], ib = inner[(i + 1) % 4];
          const oa = outer[i], ob = outer[(i + 1) % 4];
          gg.quad(oa, ob, ib, ia, [0, 1, 0]);
        }
      }
      if (!gg.empty) {
        const mg = new THREE.Mesh(gg.build(), mats.solid(COLORS.wall));
        mg.castShadow = true;
        mg.receiveShadow = true;
        edges(mg);
        reg(roof.id, mg);
        root.add(mg);
      }
    }
  }

  const bounds = new THREE.Box3().setFromObject(root);
  return { group: root, meshesById, pickables, bounds };
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}

export { COLORS };
