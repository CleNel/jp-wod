// Dates are local calendar strings (YYYY-MM-DD). All day math goes through
// Date.UTC so daylight saving changes can never shift a day.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

function parse(str) {
  const m = DATE_RE.exec(str);
  if (!m) throw new Error(`Invalid date string: ${str}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`Invalid date string: ${str}`);
  }
  return ms;
}

function format(ms) {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Local calendar date of a Date object (defaults to now).
function localDateStr(date = new Date()) {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Whole days from `from` to `to` (negative if `to` is earlier).
function dayDiff(from, to) {
  return Math.round((parse(to) - parse(from)) / MS_PER_DAY);
}

function addDays(str, n) {
  return format(parse(str) + n * MS_PER_DAY);
}

// Inclusive list of dates from start to end; empty if end < start.
function range(start, end) {
  const n = dayDiff(start, end);
  const out = [];
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

module.exports = { localDateStr, dayDiff, addDays, range };
