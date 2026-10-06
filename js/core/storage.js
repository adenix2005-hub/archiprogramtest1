// Local project storage (localStorage). Every access is guarded: storage can be
// unavailable (private mode, blocked site data, embedded previews) and the app
// must keep working in memory.

const KEY_INDEX = 'lintel.projects';
const KEY_CURRENT = 'lintel.current';
const KEY_PREFS = 'lintel.prefs';
const projectKey = (id) => `lintel.project.${id}`;

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function storageAvailable() {
  try {
    const k = 'lintel.__probe';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function newProjectId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function listProjects() {
  try {
    const list = JSON.parse(read(KEY_INDEX) || '[]');
    return Array.isArray(list) ? list.sort((a, b) => (b.modified || 0) - (a.modified || 0)) : [];
  } catch {
    return [];
  }
}

function saveIndex(list) {
  write(KEY_INDEX, JSON.stringify(list));
}

export function loadProject(id) {
  try {
    const s = read(projectKey(id));
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** Save a document; returns false when storage is full or unavailable. */
export function saveProject(id, doc) {
  const ok = write(projectKey(id), JSON.stringify(doc));
  if (!ok) return false;
  const list = listProjects().filter((p) => p.id !== id);
  list.push({
    id,
    name: doc.name || 'Untitled plan',
    modified: doc.modified || Date.now(),
    walls: doc.walls?.length || 0,
  });
  saveIndex(list);
  return true;
}

export function deleteProject(id) {
  removeKey(projectKey(id));
  saveIndex(listProjects().filter((p) => p.id !== id));
  if (getCurrentId() === id) removeKey(KEY_CURRENT);
}

export function getCurrentId() {
  return read(KEY_CURRENT);
}

export function setCurrentId(id) {
  write(KEY_CURRENT, id);
}

export function loadPrefs() {
  try {
    return JSON.parse(read(KEY_PREFS) || '{}') || {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs) {
  write(KEY_PREFS, JSON.stringify(prefs));
}
