import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthKeyOf, shiftMonth, monthLabel, monthGrid,
  calendarDateOf, bucketByDate, undatedViews, countsOf, summarize,
} from '../js/calendar.js';

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

const view = (call) => ({ patient: { id: 'p' }, prescription: { id: 'r' }, call });

test('콜이 달력에서 속하는 날짜', () => {
  assert.equal(calendarDateOf({ dueOn: '2026-10-13', status: 'pending', doneAt: null }), '2026-10-13');
  assert.equal(calendarDateOf({ dueOn: null, status: 'closed_no_answer', doneAt: '2026-10-14T02:00:00Z' }), '2026-10-14');
  assert.equal(calendarDateOf({ dueOn: null, status: 'sms_pending', doneAt: null }), null);
});

test('날짜별로 모으고 날짜 없는 콜은 따로 둔다', () => {
  const views = [
    view({ dueOn: '2026-10-13', status: 'done', doneAt: '2026-10-13T01:00:00Z' }),
    view({ dueOn: '2026-10-13', status: 'pending', doneAt: null }),
    view({ dueOn: null, status: 'sms_pending', doneAt: null }),
  ];
  const map = bucketByDate(views);
  assert.equal(map.get('2026-10-13').length, 2);
  assert.equal(undatedViews(views).length, 1);
});

test('상태별로 센다', () => {
  const views = [
    view({ dueOn: '2026-10-13', status: 'done', doneAt: '2026-10-13T01:00:00Z' }),
    view({ dueOn: '2026-10-13', status: 'closed_no_answer', doneAt: '2026-10-13T02:00:00Z' }),
    view({ dueOn: '2026-10-14', status: 'pending', doneAt: null }),
    view({ dueOn: null, status: 'sms_pending', doneAt: null }),
  ];
  assert.deepEqual(countsOf(views), { total: 4, done: 1, closed: 1, pending: 1, sms: 1 });
});

test('달 요약은 지연과 연결률까지', () => {
  const views = [
    view({ dueOn: '2026-10-10', status: 'done', doneAt: '2026-10-10T01:00:00Z' }),
    view({ dueOn: '2026-10-11', status: 'closed_no_answer', doneAt: '2026-10-11T01:00:00Z' }),
    view({ dueOn: '2026-10-12', status: 'pending', doneAt: null }),
    view({ dueOn: '2026-10-20', status: 'pending', doneAt: null }),
  ];
  const s = summarize(views, '2026-10-15');
  assert.equal(s.total, 4);
  assert.equal(s.done, 1);
  assert.equal(s.pending, 2);
  assert.equal(s.late, 1);   // 10-12 예정인데 오늘이 10-15
  assert.equal(s.rate, 50);  // 완료 1 / (완료 1 + 미연결 마감 1)
});

test('연결된 콜도 마감된 콜도 없으면 연결률은 없다', () => {
  const s = summarize([view({ dueOn: '2026-10-20', status: 'pending', doneAt: null })], '2026-10-15');
  assert.equal(s.rate, null);
});
