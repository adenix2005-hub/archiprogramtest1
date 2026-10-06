// Unit formatting and parsing. All internal lengths are millimetres.

export const UNITS = {
  mm: { label: 'Millimetres (mm)', short: 'mm', metric: true },
  cm: { label: 'Centimetres (cm)', short: 'cm', metric: true },
  m: { label: 'Metres (m)', short: 'm', metric: true },
  ftin: { label: "Feet & inches (ft' in\")", short: 'ft-in', metric: false },
  in: { label: 'Inches (in)', short: 'in', metric: false },
};

const MM_PER = { mm: 1, cm: 10, m: 1000, km: 1e6, in: 25.4, ft: 304.8, yd: 914.4 };

export function isMetric(units) {
  return !UNITS[units] || UNITS[units].metric;
}

function trimZeros(s) {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Format inches as `9 1/2` with a fractional denominator. */
function inchesText(inches, denom) {
  let whole = Math.floor(inches + 1e-9);
  let num = Math.round((inches - whole) * denom);
  if (num >= denom) {
    whole += 1;
    num = 0;
  }
  if (num === 0) return `${whole}`;
  const g = gcd(num, denom);
  const frac = `${num / g}/${denom / g}`;
  return whole ? `${whole} ${frac}` : frac;
}

/**
 * Format a length for display.
 * opts.precision: 'label' (compact, for drawings) or 'input' (more exact).
 * opts.suffix: append the unit symbol for metric units.
 */
export function formatLength(mm, units = 'mm', opts = {}) {
  if (!Number.isFinite(mm)) return '';
  const input = opts.precision === 'input';
  const sign = mm < 0 ? '-' : '';
  const a = Math.abs(mm);
  switch (units) {
    case 'cm': {
      const s = trimZeros((a / 10).toFixed(input ? 2 : 1));
      return sign + s + (opts.suffix ? ' cm' : '');
    }
    case 'm': {
      const s = input ? trimZeros((a / 1000).toFixed(4)) : (a / 1000).toFixed(2);
      return sign + s + (opts.suffix ? ' m' : '');
    }
    case 'ftin': {
      const denom = input ? 16 : 8;
      let totalIn = Math.round((a / 25.4) * denom) / denom;
      let ft = Math.floor(totalIn / 12 + 1e-9);
      let inch = totalIn - ft * 12;
      if (inch < 0) inch = 0;
      if (ft === 0) return `${sign}${inchesText(inch, denom)}"`;
      return `${sign}${ft}'-${inchesText(inch, denom)}"`;
    }
    case 'in': {
      const denom = input ? 16 : 8;
      return `${sign}${inchesText(Math.round((a / 25.4) * denom) / denom, denom)}"`;
    }
    case 'mm':
    default: {
      const s = input ? trimZeros(a.toFixed(1)) : String(Math.round(a));
      return sign + s + (opts.suffix ? ' mm' : '');
    }
  }
}

/** Format an area given in mm². */
export function formatArea(mm2, units = 'mm') {
  if (!Number.isFinite(mm2)) return '';
  if (isMetric(units)) return `${(mm2 / 1e6).toFixed(2)} m²`;
  const ft2 = mm2 / (304.8 * 304.8);
  return `${ft2 >= 100 ? Math.round(ft2) : ft2.toFixed(1)} ft²`;
}

export function formatAngle(degValue, digits = 1) {
  if (!Number.isFinite(degValue)) return '';
  return `${trimZeros(degValue.toFixed(digits))}°`;
}

/** Default unit (as a MM_PER key) for bare numbers. */
function bareUnit(units) {
  switch (units) {
    case 'cm': return 'cm';
    case 'm': return 'm';
    case 'ftin': return 'ft';
    case 'in': return 'in';
    default: return 'mm';
  }
}

const UNIT_ALIASES = {
  mm: 'mm', cm: 'cm', m: 'm', km: 'km',
  in: 'in', inch: 'in', inches: 'in', '"': 'in', '″': 'in',
  ft: 'ft', feet: 'ft', foot: 'ft', "'": 'ft', '′': 'ft',
  yd: 'yd',
};

function tokenize(str) {
  const tokens = [];
  let i = 0;
  const s = str;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if ('+-*/()x×'.includes(c)) {
      tokens.push({ op: c === 'x' || c === '×' ? '*' : c });
      i++;
      continue;
    }
    const m = /^(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      let j = i;
      while (j < s.length && s[j] === ' ') j++;
      const um = /^(mm|cm|km|m|inches|inch|in|feet|foot|ft|yd|["'″′])/i.exec(s.slice(j));
      let unit = null;
      if (um) {
        unit = UNIT_ALIASES[um[1].toLowerCase()] || null;
        i = j + um[0].length;
      }
      tokens.push({ num: parseFloat(m[0]), unit });
      continue;
    }
    return null;
  }
  return tokens;
}

/**
 * Evaluate an arithmetic expression where numbers may carry units.
 * Values are {v, len}: len=true means v is in mm, otherwise a plain number.
 */
function evaluate(tokens, defUnit) {
  let pos = 0;
  const peek = () => tokens[pos];
  const toLen = (val) => (val.len ? val.v : val.v * MM_PER[defUnit]);

  function primary() {
    const t = tokens[pos++];
    if (!t) throw new Error('eof');
    if (t.op === '(') {
      const val = expr();
      if (!tokens[pos] || tokens[pos].op !== ')') throw new Error('paren');
      pos++;
      return val;
    }
    if (t.op === '-') {
      const val = primary();
      return { v: -val.v, len: val.len };
    }
    if (t.op === '+') return primary();
    if (t.num !== undefined) {
      if (t.unit) return { v: t.num * MM_PER[t.unit], len: true };
      return { v: t.num, len: false };
    }
    throw new Error('token');
  }

  function term() {
    let left = primary();
    while (peek() && (peek().op === '*' || peek().op === '/')) {
      const op = tokens[pos++].op;
      const right = primary();
      if (op === '*') {
        if (left.len && right.len) throw new Error('area');
        left = { v: left.v * right.v, len: left.len || right.len };
      } else {
        if (right.v === 0) throw new Error('div0');
        if (left.len && right.len) left = { v: left.v / right.v, len: false };
        else if (!left.len && right.len) throw new Error('inverse');
        else left = { v: left.v / right.v, len: left.len };
      }
    }
    return left;
  }

  function expr() {
    let left = term();
    while (peek() && (peek().op === '+' || peek().op === '-')) {
      const op = tokens[pos++].op;
      const right = term();
      if (left.len || right.len) {
        const a = toLen(left), b = toLen(right);
        left = { v: op === '+' ? a + b : a - b, len: true };
      } else {
        left = { v: op === '+' ? left.v + right.v : left.v - right.v, len: false };
      }
    }
    return left;
  }

  const val = expr();
  if (pos !== tokens.length) throw new Error('trailing');
  return toLen(val);
}

/**
 * Parse a user-entered length. Bare numbers use the current display unit
 * (feet for ft-in, like Revit). Supports 3.6m, 3600mm, 11'6", 11' 6 1/2",
 * 12 6 (feet inches), 6 1/2", and arithmetic such as 3000+600 or 1200*3.
 * Returns millimetres, or NaN when the text is not a valid length.
 */
export function parseLength(str, units = 'mm') {
  if (str == null) return NaN;
  let s = String(str).trim().replace(/,/g, '.').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  if (!s) return NaN;

  // Feet and inches: 11'6", 11' - 6 1/2", 11ft 6in
  let m = /^(-)?\s*(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet|foot)\s*-?\s*(?:(\d+(?:\.\d+)?)(?![\d/])\s*)?(?:(\d+)\s*\/\s*(\d+)\s*)?(?:"|″|in|inch|inches)?\s*$/i.exec(s);
  if (m) {
    const ft = parseFloat(m[2]);
    const inch = (m[3] ? parseFloat(m[3]) : 0) + (m[4] ? parseFloat(m[4]) / parseFloat(m[5]) : 0);
    const val = (ft * 12 + inch) * 25.4;
    return m[1] ? -val : val;
  }
  // Inches with a fraction: 6 1/2", 1/2"
  m = /^(-)?\s*(?:(\d+(?:\.\d+)?)\s+)?(\d+)\s*\/\s*(\d+)\s*(?:"|″|in|inch|inches)?\s*$/i.exec(s);
  if (m && (units === 'ftin' || units === 'in' || /("|in)/i.test(s))) {
    const inch = (m[2] ? parseFloat(m[2]) : 0) + parseFloat(m[3]) / parseFloat(m[4]);
    const val = inch * 25.4;
    return m[1] ? -val : val;
  }
  // Revit style "12 6" = 12'6" when working in feet and inches.
  if (units === 'ftin') {
    m = /^(-)?\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/.exec(s);
    if (m) {
      const val = (parseFloat(m[2]) * 12 + parseFloat(m[3])) * 25.4;
      return m[1] ? -val : val;
    }
  }
  const tokens = tokenize(s);
  if (!tokens || !tokens.length) return NaN;
  try {
    const v = evaluate(tokens, bareUnit(units));
    return Number.isFinite(v) ? cleanFloat(v) : NaN;
  } catch {
    return NaN;
  }
}

/** Strip floating point noise (e.g. 1.2*3 m = 3599.9999999999995 mm). */
function cleanFloat(v) {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Parse an angle in degrees. Also accepts a rise/run slope like 6/12 or 6:12
 * (as used for roof pitches), returning the equivalent angle in degrees.
 */
export function parseAngle(str) {
  if (str == null) return NaN;
  const s = String(str).trim().replace(/,/g, '.').replace(/°|deg|d$/gi, '').trim();
  if (!s) return NaN;
  const m = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const run = parseFloat(m[2]);
    if (run <= 0) return NaN;
    return (Math.atan(parseFloat(m[1]) / run) * 180) / Math.PI;
  }
  const tokens = tokenize(s);
  if (!tokens || !tokens.length || tokens.some((t) => t.unit)) return NaN;
  try {
    // evaluate with "mm" default returns the plain number unchanged
    const v = evaluate(tokens, 'mm');
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

/** Roof pitch as rise in 12 (imperial convention). */
export function pitchToRiseRun(degValue) {
  const rise = Math.tan((degValue * Math.PI) / 180) * 12;
  return `${trimZeros(rise.toFixed(1))}:12`;
}

/** Default length step used for nudging/snapping in the given unit system. */
export function unitStep(units) {
  return isMetric(units) ? 10 : 25.4 / 2;
}
