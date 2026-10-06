// Line icons (24×24, stroke = currentColor), injected once as an SVG sprite.

const P = {
  select: '<path d="M6 3.5l12 7-5.2 1.3 3.1 5.6-2.2 1.2-3.1-5.6L7 16.5z"/>',
  sketch: '<path d="M3 19.5c2.2 0 2.8-2.6 5-2.6s2.6 2.6 5 2.6"/><path d="M14.3 4.2l3.5 3.5-7.5 7.5-4.3.8.8-4.3z"/>',
  wall: '<rect x="3" y="9" width="18" height="6" rx=".5"/><path d="M7.5 9l-2 6M12 9l-2 6M16.5 9l-2 6M21 9.5l-1.5 5" stroke-width="1.2"/>',
  arc: '<path d="M3 19a9 9 0 0 1 18 0"/><path d="M7.5 19a4.5 4.5 0 0 1 9 0"/>',
  rect: '<rect x="3.5" y="4.5" width="17" height="15" rx=".5"/><rect x="7" y="8" width="10" height="8" rx=".3"/>',
  door: '<path d="M3 20h4M17 20h4"/><path d="M7 20V5.5"/><path d="M7 5.5A14.5 14.5 0 0 1 21 20" stroke-dasharray="2 2.4"/>',
  window: '<path d="M3 8.5h18M3 15.5h18M3 8.5v7M21 8.5v7"/><path d="M4 12h16"/>',
  opening: '<path d="M3 9h6v6H3M21 9h-6v6h6"/><path d="M9.5 12h5" stroke-dasharray="1.5 2"/>',
  roof: '<path d="M2.5 12.5L12 5l9.5 7.5"/><path d="M5 10.6V20h14v-9.4"/><path d="M10 20v-5h4v5"/>',
  dim: '<path d="M4 14h16M4 10v8M20 10v8"/><path d="M2.8 15.8l2.4-3.6M18.8 15.8l2.4-3.6"/><path d="M9 7.5h6"/>',
  measure: '<path d="M3.5 16.5L16.5 3.5l4 4-13 13z"/><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
  text: '<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>',
  section: '<path d="M6.5 15h11" stroke-dasharray="4 2 1 2"/><circle cx="4" cy="15" r="2.3"/><circle cx="20" cy="15" r="2.3"/><path d="M2.3 10.5L4 6.5l1.7 4M18.3 10.5L20 6.5l1.7 4"/>',
  camera: '<rect x="2.5" y="7" width="12.5" height="10" rx="1.5"/><path d="M15 10.6l6.5-3.1v9l-6.5-3.1z"/>',
  erase: '<path d="M8.5 20H20"/><path d="M4.4 14.6l9.2-9.2a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12.4 18.6a2 2 0 0 1-1.4.6H8.6a2 2 0 0 1-1.4-.6l-2.8-2.8a1 1 0 0 1 0-1.2z"/><path d="M9 10l5 5"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.2 3.8v4.8h-4.8"/>',
  'rotate-ccw': '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M3.8 3.8v4.8h4.8"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7.5L3.5 17H9zM15 7.5l5.5 9.5H15z"/>',
  offset: '<path d="M4 6.5h16"/><path d="M4 17.5h16" stroke-dasharray="3 2"/><path d="M12 9v6M10 13l2 2 2-2"/>',
  split: '<path d="M3 9h7v6H3M21 9h-7v6h7"/><path d="M12 4.5v15"/>',
  pan: '<path d="M8 12.5V5.6a1.5 1.5 0 0 1 3 0v5.4"/><path d="M11 10.5V4.6a1.5 1.5 0 0 1 3 0v5.9"/><path d="M14 10.5V6.1a1.5 1.5 0 0 1 3 0v7.4c0 4.1-2.6 7-6.6 7-2.9 0-4.7-1.6-5.9-4.2L3.2 12a1.4 1.4 0 0 1 2.5-1.2L8 13.8"/>',
  'zoom-fit': '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.5" y="8.5" width="7" height="7" rx=".8"/>',
  'zoom-in': '<circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8l4.7 4.7M8 11h6M11 8v6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8l4.7 4.7M8 11h6"/>',
  undo: '<path d="M9 14.5l-5-5 5-5"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14.5l5-5-5-5"/><path d="M20 9.5H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  plan: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M3.5 12.5H10M10 3.5V16M14.5 12.5h6"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  'split-view': '<rect x="3" y="4.5" width="18" height="15" rx="1.5"/><path d="M12 4.5v15"/><path d="M5.5 9h4M14.5 15l2-4.5 2 4.5"/>',
  walk: '<circle cx="13.5" cy="4.5" r="1.8"/><path d="M9.5 21l2.3-6.2 2.7 2.4V21"/><path d="M7.5 11.5l3-4 3.5 1.2 2.3 3.3"/><path d="M11.8 14.8l-1.3-7.3"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .9-1 1.6v.6"/><path d="M12 17.2h.01" stroke-width="2.4"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10" stroke-width="2"/>',
  flip: '<path d="M7 7.5h12l-3.5-3.5M17 16.5H5l3.5 3.5"/>',
  'close-shape': '<path d="M5 18V6h14v12"/><path d="M5 18h14" stroke-dasharray="2 2.5"/><circle cx="5" cy="18" r="1.6"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  'eye-off': '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><path d="M4 20L20 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  'level-up': '<path d="M4 20h16M4 15.5h16"/><path d="M12 12V3.5M8.5 7L12 3.5 15.5 7"/>',
  'level-down': '<path d="M4 4h16M4 8.5h16"/><path d="M12 12v8.5M8.5 17l3.5 3.5 3.5-3.5"/>',
  export: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 13v7h14v-7"/>',
  import: '<path d="M12 3.5V15M7.5 10.5L12 15l4.5-4.5"/><path d="M5 13v7h14v-7"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  save: '<path d="M5 4h11.5L20 7.5V20H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  grid: '<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  'grid-snap': '<path d="M4 4h16v16H4zM4 12h16M12 4v16" opacity=".55"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  magnet: '<path d="M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0z"/><path d="M5 8h4M15 8h4"/>',
  ortho: '<path d="M5 4v15h15"/><path d="M5 14h5v5"/>',
  polar: '<path d="M4 19h16"/><path d="M4 19L16.5 6.5"/><path d="M11 19a7 7 0 0 0-2.1-5"/>',
  align: '<path d="M3 12h18" stroke-dasharray="2 2"/><circle cx="7" cy="12" r="2.2"/><circle cx="17" cy="12" r="2.2"/><path d="M7 4v4M17 16v4"/>',
  pen: '<path d="M14.5 3.5l6 6L9 21H3v-6z"/><path d="M12 6l6 6"/>',
  elevation: '<path d="M3 20h18"/><path d="M5 20V10.5l7-5.5 7 5.5V20"/><rect x="10" y="14" width="4" height="6"/><path d="M7.5 12h2M14.5 12h2"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  cut: '<path d="M3 12h18" stroke-dasharray="3 2"/><path d="M6 12V5h12v7"/><path d="M6 15.5V19h12v-3.5" opacity=".45"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  props: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  views: '<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6h.01" stroke-width="2.2"/>',
  edges: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8" opacity=".5"/>',
  level: '<path d="M3 19h18M3 13.5h18M3 8h18"/><path d="M7 4.5h10" opacity=".5"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/>',
  top: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 10h16M10 10v10"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
};

export function iconSprite() {
  const symbols = Object.entries(P)
    .map(([k, d]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${d}</symbol>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`;
}

export function icon(name, cls = 'ic') {
  const n = P[name] ? name : 'info';
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;
}

export const ICON_NAMES = Object.keys(P);
