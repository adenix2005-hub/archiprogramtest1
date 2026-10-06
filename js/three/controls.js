// Camera controls tuned for touch, S Pen and mouse:
// Orbit (perspective), Plan pan/zoom (orthographic) and Walk (first person).

import * as THREE from './lib.js';

const tmpV = new THREE.Vector3();

export class OrbitController {
  constructor(view) {
    this.view = view;
    this.target = new THREE.Vector3(6, 0, -4);
    this.radius = 25;
    this.theta = -0.7; // azimuth
    this.phi = 1.0; // polar angle from +Y
    this.minPhi = 0.02;
    this.maxPhi = Math.PI / 2 + 0.35;
    this.anim = null;
  }

  apply(camera) {
    const sp = Math.sin(this.phi);
    camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    camera.lookAt(this.target);
  }

  setFromCamera(position, target) {
    this.target.copy(target);
    const d = tmpV.copy(position).sub(target);
    this.radius = Math.max(0.1, d.length());
    this.phi = Math.acos(Math.min(1, Math.max(-1, d.y / this.radius)));
    this.theta = Math.atan2(d.x, d.z);
  }

  rotate(dx, dy, h) {
    this.theta -= (dx / h) * Math.PI * 1.4;
    this.phi = Math.min(this.maxPhi, Math.max(this.minPhi, this.phi - (dy / h) * Math.PI * 1.1));
  }

  pan(dx, dy, camera, h) {
    const perPx = (2 * this.radius * Math.tan(((camera.fov || 50) * Math.PI) / 360)) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * perPx).addScaledVector(up, dy * perPx);
  }

  /** Zoom by factor f (<1 = closer) about a world point that stays put on screen. */
  zoomAbout(f, point, camera) {
    f = Math.min(4, Math.max(0.25, f));
    const newR = Math.min(800, Math.max(0.4, this.radius * f));
    const k = newR / this.radius;
    if (point) {
      const camPos = camera.position.clone();
      const t2 = point.clone().add(this.target.clone().sub(point).multiplyScalar(k));
      const c2 = point.clone().add(camPos.sub(point).multiplyScalar(k));
      this.setFromCamera(c2, t2);
    } else {
      this.radius = newR;
    }
  }

  animateTo(target, radius, theta, phi, ms = 450) {
    const from = { t: this.target.clone(), r: this.radius, th: this.theta, ph: this.phi };
    let dTheta = theta - from.th;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    this.anim = { from, to: { t: target.clone(), r: radius, th: from.th + dTheta, ph: phi }, t0: performance.now(), ms };
  }

  step(now) {
    if (!this.anim) return false;
    const { from, to, t0, ms } = this.anim;
    let k = Math.min(1, (now - t0) / ms);
    k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    this.target.lerpVectors(from.t, to.t, k);
    this.radius = from.r + (to.r - from.r) * k;
    this.theta = from.th + (to.th - from.th) * k;
    this.phi = from.ph + (to.ph - from.ph) * k;
    if (k >= 1) this.anim = null;
    return true;
  }
}

export class WalkController {
  constructor(view) {
    this.view = view;
    this.pos = new THREE.Vector3(0, 1.6, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.speed = 1.6; // m/s
  }

  apply(camera) {
    camera.position.copy(this.pos);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    camera.lookAt(this.pos.clone().add(dir));
  }

  setFromCamera(position, target) {
    this.pos.copy(position);
    const d = target.clone().sub(position).normalize();
    this.yaw = Math.atan2(d.x, d.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  }

  look(dx, dy, h) {
    this.yaw -= (dx / h) * 2.2;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - (dy / h) * 2.2));
  }

  get moving() {
    return this.keys.size > 0 || Math.hypot(this.stick.x, this.stick.y) > 0.05;
  }

  step(dt) {
    let fwd = 0, side = 0, up = 0;
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) fwd += 1;
    if (k.has('s') || k.has('arrowdown')) fwd -= 1;
    if (k.has('a') || k.has('arrowleft')) side -= 1;
    if (k.has('d') || k.has('arrowright')) side += 1;
    if (k.has('e') || k.has('pageup')) up += 1;
    if (k.has('q') || k.has('pagedown')) up -= 1;
    fwd += -this.stick.y;
    side += this.stick.x;
    if (!fwd && !side && !up) return false;
    const run = k.has('shift') ? 2.5 : 1;
    const v = this.speed * run * dt;
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.pos.addScaledVector(f, fwd * v).addScaledVector(r, side * v);
    this.pos.y = Math.max(0.3, this.pos.y + up * v);
    return true;
  }
}
