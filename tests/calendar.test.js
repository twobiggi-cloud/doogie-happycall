import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthKeyOf, shiftMonth, monthLabel, monthGrid } from '../js/calendar.js';

test('날짜에서 달을 뽑는다', () => {
  assert.equal(monthKeyOf('2026-10-13'), '2026-10');
  assert.equal(monthKeyOf('2026-01-01'), '2026-01');
});

test('달을 앞뒤로 옮긴다', () => {
  assert.equal(shiftMonth('2026-10', -1), '2026-09');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('달 이름은 한국어로', () => {
  assert.equal(monthLabel('2026-10'), '2026년 10월');
});

test('달력 격자는 일요일 시작 6주', () => {
  const grid = monthGrid('2026-10');
  assert.equal(grid.length, 6);
  assert.equal(grid[0].length, 7);
  // 2026-10-01은 목요일이라 첫 주는 9월 27일(일)부터 시작한다
  assert.equal(grid[0][0], '2026-09-27');
  assert.equal(grid[0][4], '2026-10-01');
  assert.equal(grid[5][6], '2026-11-07');
});
