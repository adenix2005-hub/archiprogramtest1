// Command registry: one place for toolbar buttons, keyboard shortcuts, the
// command line (AutoCAD / Revit style aliases) and menus.

import { autoRoof } from './plan/tools/roof.js';

/**
 * keys: shortcut strings like 'W', 'Shift+C', 'Ctrl+Z', 'F8', 'Delete'.
 * aliases: words accepted by the command line.
 */
export const COMMANDS = [
  // Draw
  { id: 'select', label: 'Select', icon: 'select', group: 'draw', keys: ['V'], aliases: ['select', 'sel'], tool: 'select' },
  { id: 'sketch', label: 'Sketch walls', icon: 'sketch', group: 'draw', keys: ['S'], aliases: ['sketch', 'sk', 'freehand', 'pen'], tool: 'sketch' },
  { id: 'wall', label: 'Wall', icon: 'wall', group: 'draw', keys: ['W'], aliases: ['wall', 'wa', 'line', 'l', 'pl', 'polyline'], tool: 'wall' },
  { id: 'arc', label: 'Curved wall', icon: 'arc', group: 'draw', keys: ['A'], aliases: ['arc', 'curve', 'curved', 'cw'], tool: 'arc' },
  { id: 'rect', label: 'Room (rectangle)', icon: 'rect', group: 'draw', keys: ['R'], aliases: ['room', 'rec', 'rectangle', 'rm', 'box'], tool: 'rect' },
  { id: 'door', label: 'Door', icon: 'door', group: 'draw', keys: ['D'], aliases: ['door', 'dr'], tool: 'door' },
  { id: 'window', label: 'Window', icon: 'window', group: 'draw', keys: ['N'], aliases: ['window', 'wn', 'win'], tool: 'window' },
  { id: 'opening', label: 'Opening (no door)', icon: 'opening', group: 'draw', keys: [], aliases: ['opening', 'op', 'hole', 'gap'], tool: 'opening' },
  { id: 'roof', label: 'Roof', icon: 'roof', group: 'draw', keys: ['F'], aliases: ['roof', 'rf'], tool: 'roof' },
  { id: 'autoroof', label: 'Auto roof', icon: 'roof', group: 'draw', keys: ['Shift+F'], aliases: ['autoroof', 'ar'], run: (app) => autoRoof(app) },
  { id: 'dim', label: 'Dimension', icon: 'dim', group: 'annotate', keys: ['T'], aliases: ['dim', 'dimension', 'dli', 'dal', 'da'], tool: 'dim' },
  { id: 'measure', label: 'Measure', icon: 'measure', group: 'annotate', keys: ['Shift+T'], aliases: ['measure', 'dist', 'tape', 'me'], tool: 'measure' },
  { id: 'text', label: 'Text', icon: 'text', group: 'annotate', keys: [], aliases: ['text', 'tx', 'dt', 'mtext', 'note'], tool: 'text' },
  { id: 'section', label: 'Section', icon: 'section', group: 'annotate', keys: ['X'], aliases: ['section', 'se', 'cut'], tool: 'section' },
  { id: 'camera', label: 'Camera', icon: 'camera', group: 'annotate', keys: ['C'], aliases: ['camera', 'cam', 'viewpoint'], tool: 'camera' },
  // Modify
  { id: 'erase', label: 'Erase', icon: 'erase', group: 'modify', keys: ['E'], aliases: ['erase', 'e', 'del'], tool: 'erase' },
  { id: 'move', label: 'Move', icon: 'move', group: 'modify', keys: ['M'], aliases: ['move', 'm', 'mv'], tool: 'move' },
  { id: 'copy', label: 'Copy', icon: 'copy', group: 'modify', keys: ['Shift+C'], aliases: ['copy', 'co', 'cp', 'cc'], tool: 'copy' },
  { id: 'rotate', label: 'Rotate', icon: 'rotate', group: 'modify', keys: ['Q'], aliases: ['rotate', 'ro'], tool: 'rotate' },
  { id: 'mirror', label: 'Mirror', icon: 'mirror', group: 'modify', keys: ['Shift+M'], aliases: ['mirror', 'mi', 'mm'], tool: 'mirror' },
  { id: 'offset', label: 'Offset', icon: 'offset', group: 'modify', keys: ['O'], aliases: ['offset', 'o', 'of'], tool: 'offset' },
  { id: 'split', label: 'Split wall', icon: 'split', group: 'modify', keys: ['Shift+S'], aliases: ['split', 'sl', 'break', 'br'], tool: 'split' },
  { id: 'pan', label: 'Pan', icon: 'pan', group: 'view', keys: ['H'], aliases: ['pan', 'p', 'hand'], tool: 'pan' },
  // View
  { id: 'zoomExtents', label: 'Zoom to fit', icon: 'zoom-fit', group: 'view', keys: ['Z', 'Shift+Z'], aliases: ['zoom', 'z', 'ze', 'extents', 'fit'], run: (app) => app.zoomExtents() },
  { id: 'zoomIn', label: 'Zoom in', icon: 'zoom-in', group: 'view', keys: ['=', '+'], aliases: ['zoomin', 'zi'], run: (app) => app.zoomBy(1.4) },
  { id: 'zoomOut', label: 'Zoom out', icon: 'zoom-out', group: 'view', keys: ['-', '_'], aliases: ['zoomout', 'zo'], run: (app) => app.zoomBy(1 / 1.4) },
  { id: 'layoutPlan', label: '2D plan', icon: 'plan', group: 'view', keys: ['1'], aliases: ['plan', '2d'], run: (app) => app.setLayout('plan') },
  { id: 'layout3d', label: '3D view', icon: 'cube', group: 'view', keys: ['2'], aliases: ['3d', 'model', 'orbit'], run: (app) => app.openView({ type: 'model' }) },
  { id: 'layoutSplit', label: 'Split view', icon: 'split-view', group: 'view', keys: ['3'], aliases: ['splitview', 'both', 'tile'], run: (app) => app.setLayout('split') },
  { id: 'walk', label: 'Walk through', icon: 'walk', group: 'view', keys: ['4'], aliases: ['walk', 'fly', 'firstperson'], run: (app) => app.openView({ type: 'walk' }) },
  { id: 'cycleLayout', label: 'Switch 2D / 3D', icon: 'cube', group: 'view', keys: ['Tab'], aliases: [], run: (app) => app.cycleLayout() },
  { id: 'saveView', label: 'Save 3D viewpoint', icon: 'camera', group: 'view', keys: ['Shift+V'], aliases: ['saveview', 'sv', 'viewpoint+'], run: (app) => app.saveCurrent3DView() },
  { id: 'elevN', label: 'North elevation', icon: 'elevation', group: 'view', keys: [], aliases: ['elevn', 'north'], run: (app) => app.openView({ type: 'elevation', dir: 'N' }) },
  { id: 'elevS', label: 'South elevation', icon: 'elevation', group: 'view', keys: [], aliases: ['elevs', 'south'], run: (app) => app.openView({ type: 'elevation', dir: 'S' }) },
  { id: 'elevE', label: 'East elevation', icon: 'elevation', group: 'view', keys: [], aliases: ['eleve', 'east'], run: (app) => app.openView({ type: 'elevation', dir: 'E' }) },
  { id: 'elevW', label: 'West elevation', icon: 'elevation', group: 'view', keys: [], aliases: ['elevw', 'west'], run: (app) => app.openView({ type: 'elevation', dir: 'W' }) },
  // Toggles (AutoCAD function keys)
  { id: 'toggleSnap', label: 'Object snap', icon: 'magnet', group: 'toggle', keys: ['F3'], aliases: ['osnap', 'snap', 'os'], run: (app) => app.togglePref('snap.object') },
  { id: 'toggleGrid', label: 'Show grid', icon: 'grid', group: 'toggle', keys: ['G', 'F7'], aliases: ['grid', 'gr'], run: (app) => app.togglePref('layers.grid') },
  { id: 'toggleOrtho', label: 'Ortho', icon: 'ortho', group: 'toggle', keys: ['F8'], aliases: ['ortho', 'or'], run: (app) => app.togglePref('snap.ortho') },
  { id: 'toggleGridSnap', label: 'Snap to grid', icon: 'grid-snap', group: 'toggle', keys: ['F9'], aliases: ['snapgrid', 'sg'], run: (app) => app.togglePref('snap.grid') },
  { id: 'togglePolar', label: 'Polar tracking', icon: 'polar', group: 'toggle', keys: ['F10'], aliases: ['polar', 'pt'], run: (app) => app.togglePref('snap.polar') },
  { id: 'toggleAlign', label: 'Alignment guides', icon: 'align', group: 'toggle', keys: ['F11'], aliases: ['otrack', 'align'], run: (app) => app.togglePref('snap.align') },
  // Edit
  { id: 'undo', label: 'Undo', icon: 'undo', group: 'edit', keys: ['Ctrl+Z'], aliases: ['undo', 'u'], run: (app) => app.undo() },
  { id: 'redo', label: 'Redo', icon: 'redo', group: 'edit', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], aliases: ['redo', 're'], run: (app) => app.redo() },
  { id: 'delete', label: 'Delete selection', icon: 'trash', group: 'edit', keys: ['Delete', 'Backspace'], aliases: ['delete', 'erase!'], run: (app) => app.deleteSelection() },
  { id: 'selectAll', label: 'Select all', icon: 'select', group: 'edit', keys: ['Ctrl+A'], aliases: ['all', 'selectall'], run: (app) => app.selectAll() },
  { id: 'clipCopy', label: 'Copy to clipboard', icon: 'copy', group: 'edit', keys: ['Ctrl+C'], aliases: [], run: (app) => app.clipboardCopy() },
  { id: 'clipCut', label: 'Cut', icon: 'copy', group: 'edit', keys: ['Ctrl+X'], aliases: ['cut'], run: (app) => app.clipboardCopy(true) },
  { id: 'clipPaste', label: 'Paste', icon: 'copy', group: 'edit', keys: ['Ctrl+V'], aliases: ['paste'], run: (app) => app.clipboardPaste() },
  { id: 'duplicate', label: 'Duplicate', icon: 'copy', group: 'edit', keys: ['Ctrl+D'], aliases: ['duplicate', 'dup'], run: (app) => app.duplicateSelection() },
  { id: 'flip', label: 'Flip', icon: 'flip', group: 'edit', keys: ['Shift+X'], aliases: ['flip', 'reverse'], run: (app) => app.flipSelection() },
  // Levels
  { id: 'levelUp', label: 'Level up', icon: 'level-up', group: 'level', keys: ['PageUp'], aliases: ['levelup', 'up'], run: (app) => app.stepLevel(1) },
  { id: 'levelDown', label: 'Level down', icon: 'level-down', group: 'level', keys: ['PageDown'], aliases: ['leveldown', 'down'], run: (app) => app.stepLevel(-1) },
  { id: 'addLevel', label: 'Add level above', icon: 'plus', group: 'level', keys: [], aliases: ['addlevel', 'level', 'storey', 'floor'], run: (app) => app.addLevel() },
  // File
  { id: 'projects', label: 'Projects', icon: 'folder', group: 'file', keys: ['Ctrl+O'], aliases: ['open', 'projects', 'new'], run: (app) => app.ui.dialogs.projects() },
  { id: 'save', label: 'Save', icon: 'save', group: 'file', keys: ['Ctrl+S'], aliases: ['save', 'qsave'], run: (app) => app.saveNow(true) },
  { id: 'export', label: 'Export', icon: 'export', group: 'file', keys: ['Ctrl+E', 'Ctrl+Shift+S'], aliases: ['export', 'dxf', 'png', 'glb', 'saveas'], run: (app) => app.ui.dialogs.exportDialog() },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'file', keys: ['Ctrl+,'], aliases: ['settings', 'options', 'op!', 'units', 'prefs'], run: (app) => app.ui.dialogs.settings() },
  { id: 'help', label: 'Shortcuts & help', icon: 'help', group: 'file', keys: ['F1', '?'], aliases: ['help', 'keys', 'shortcuts', '?'], run: (app) => app.ui.dialogs.help() },
  { id: 'theme', label: 'Switch theme', icon: 'theme', group: 'file', keys: [], aliases: ['theme', 'dark', 'light', 'blueprint'], run: (app) => app.cycleTheme() },
];

export const COMMAND_BY_ID = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));

/** Normalise a KeyboardEvent to a shortcut string like 'Ctrl+Shift+Z'. */
export function keyString(e) {
  let k = e.key;
  if (k === ' ') k = 'Space';
  if (k.length === 1) k = k.toUpperCase();
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  // Shift is implied for symbols such as ? and +
  if (e.shiftKey && (k.length > 1 || /[A-Z]/.test(k))) parts.push('Shift');
  parts.push(k);
  return parts.join('+');
}

const KEYMAP = new Map();
for (const c of COMMANDS) for (const k of c.keys) KEYMAP.set(k, c);

export function commandForKey(e) {
  return KEYMAP.get(keyString(e)) || null;
}

/** Find commands matching typed text (exact alias first, then prefix / label matches). */
export function searchCommands(text) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const exact = COMMANDS.filter((c) => c.aliases.includes(t) || c.id.toLowerCase() === t);
  const prefix = COMMANDS.filter((c) => !exact.includes(c) && (c.aliases.some((a) => a.startsWith(t)) || c.label.toLowerCase().startsWith(t)));
  const contains = COMMANDS.filter((c) => !exact.includes(c) && !prefix.includes(c) && c.label.toLowerCase().includes(t));
  return [...exact, ...prefix, ...contains].slice(0, 8);
}

export function shortcutLabel(c) {
  return c.keys[0] || '';
}
