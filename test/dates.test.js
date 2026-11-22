const test = require('node:test');
const assert = require('node:assert/strict');
const { localDateStr, dayDiff, addDays, range } = require('../lib/dates');

test('localDateStr uses local calendar parts, zero-padded', () => {
  assert.equal(localDateStr(new Date(2026, 0, 5, 23, 59, 59)), '2026-01-05');
  assert.equal(localDateStr(new Date(2026, 11, 31, 0, 0, 0)), '2026-12-31');
});

test('dayDiff counts calendar days (to minus from)', () => {
  assert.equal(dayDiff('2026-05-01', '2026-05-01'), 0);
  assert.equal(dayDiff('2026-05-01', '2026-05-05'), 4);
  assert.equal(dayDiff('2026-05-05', '2026-05-01'), -4);
});

test('dayDiff is exact across US DST changes (March and November)', () => {
  // US spring forward: 2026-03-08, fall back: 2026-11-01
  assert.equal(dayDiff('2026-03-07', '2026-03-09'), 2);
  assert.equal(dayDiff('2026-03-01', '2026-03-15'), 14);
  assert.equal(dayDiff('2026-10-31', '2026-11-02'), 2);
  assert.equal(dayDiff('2026-10-25', '2026-11-08'), 14);
  // EU: 2026-03-29 and 2026-10-25
  assert.equal(dayDiff('2026-03-28', '2026-03-30'), 2);
  assert.equal(dayDiff('2026-10-24', '2026-10-26'), 2);
});

test('addDays crosses month, year, and leap-day boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-05-10', 0), '2026-05-10');
});

test('addDays across DST weeks gives one date per day', () => {
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(addDays('2026-03-01', 365), '2027-03-01');
});

test('range is inclusive and ordered', () => {
  assert.deepEqual(range('2026-12-30', '2027-01-02'), [
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
  ]);
  assert.deepEqual(range('2026-05-01', '2026-05-01'), ['2026-05-01']);
});

test('range over the November DST week has no gaps or repeats', () => {
  assert.deepEqual(range('2026-10-30', '2026-11-03'), [
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
  ]);
});

test('range is empty when end is before start', () => {
  assert.deepEqual(range('2026-05-02', '2026-05-01'), []);
});

test('invalid date strings throw', () => {
  assert.throws(() => dayDiff('2026-5-1', '2026-05-02'));
  assert.throws(() => addDays('nope', 1));
  assert.throws(() => addDays('2026-02-30', 1));
});
