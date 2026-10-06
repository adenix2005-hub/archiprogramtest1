// Materials for the 3D model. Solid materials render back faces in a flat
// "poché" colour, so clipped sections look filled like a drawn section cut.

import * as THREE from './lib.js';

function srgbVec(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  const n = m ? parseInt(m[1], 16) : 0x2b2f33;
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export class Materials {
  constructor() {
    this.planes = [];
    this.cache = new Map();
    this.all = new Set();
    this.cutUniform = { value: srgbVec('#2b2f33') };
    this.edge = new THREE.LineBasicMaterial({ color: 0x1b2326, transparent: true, opacity: 0.38, depthWrite: false });
    this.track(this.edge);
    this.glass = new THREE.MeshStandardMaterial({ color: 0x9cc7e0, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    this.track(this.glass);
    this.highlight = this.solid('#ffcf5a', { emissive: 0x6a4a00, key: 'highlight' });
  }

  track(m) {
    m.clippingPlanes = this.planes;
    m.clipShadows = true;
    this.all.add(m);
    return m;
  }

  /** Opaque material with section poché on back faces. */
  solid(color, { roughness = 0.88, metalness = 0, emissive = 0x000000, key = null, flat = false } = {}) {
    const k = key || `${color}|${roughness}|${metalness}|${flat}`;
    let m = this.cache.get(k);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness, emissive, side: THREE.DoubleSide, flatShading: flat });
    const cut = this.cutUniform;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.cutColor = cut;
      shader.fragmentShader = `uniform vec3 cutColor;\n${shader.fragmentShader}`.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n\tif ( ! gl_FrontFacing ) gl_FragColor = vec4( cutColor, 1.0 );',
      );
    };
    m.customProgramCacheKey = () => 'lintel-poche';
    this.track(m);
    this.cache.set(k, m);
    return m;
  }

  setCutColor(hex) {
    this.cutUniform.value.copy(srgbVec(hex));
  }

  setEdgeColor(hex, opacity) {
    this.edge.color.set(hex);
    if (opacity != null) this.edge.opacity = opacity;
  }

  /** Replace the active clipping planes (array of THREE.Plane). */
  setClipping(planes) {
    const changed = planes.length !== this.planes.length;
    this.planes.length = 0;
    for (const p of planes) this.planes.push(p);
    if (changed) for (const m of this.all) m.needsUpdate = true;
  }

  dispose() {
    for (const m of this.all) m.dispose();
  }
}
