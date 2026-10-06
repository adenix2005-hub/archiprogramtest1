// Canvas colours come from CSS custom properties so the plan follows the app theme.

const FALLBACK = {
  planBg: '#fbfcfa',
  planGrid: 'rgba(74,168,216,0.12)',
  planGridMajor: 'rgba(74,168,216,0.26)',
  planWall: '#3a3f44',
  planWallLine: '#121518',
  planInk: '#1d2427',
  planMuted: '#66737a',
  planAccent: '#1f5fae',
  planAccentFill: 'rgba(31,95,174,0.18)',
  planGuide: '#3f9fd1',
  planRoof: '#8a5a2b',
  planSnap: '#d1531f',
  planRoom: '#d9d2c3',
  planRoomAlpha: '0.32',
  planGlass: '#3f9fd1',
  planUnderlay: 'rgba(29,36,39,0.22)',
  planDim: '#33424a',
  planSection: '#b5461e',
  planPaper: '#ffffff',
};

const toVar = (k) => '--' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

export function readTheme(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const t = {};
  for (const k of Object.keys(FALLBACK)) {
    const v = cs.getPropertyValue(toVar(k)).trim();
    t[k] = v || FALLBACK[k];
  }
  t.fontUI = cs.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif';
  t.fontDim = cs.getPropertyValue('--font-dim').trim() || 'system-ui, sans-serif';
  t.fontMono = cs.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';
  return t;
}

export function lightTheme() {
  return { ...FALLBACK, fontUI: 'sans-serif', fontDim: 'sans-serif', fontMono: 'monospace' };
}
