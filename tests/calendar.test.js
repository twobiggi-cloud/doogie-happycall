import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthKeyOf, shiftMonth, monthLabel, monthGrid,
  calendarDateOf, bucketByDate, undatedViews, countsOf, summarize,
  prescriptionRows, bucketPrescriptionsByDate, prescriptionCountsOf,
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

// ---- 그날 처방한 환자 보기 (V2.2) ----

const 환자들 = [
  {
    id: 'p1', name: '김환자', relation: 'self', deletedAt: null,
    prescriptions: [
      { id: 'r1', prescribedOn: '2026-10-05', shippedOn: '2026-10-05', days: 30, runoutOn: '2026-11-04', status: 'active', deletedAt: null, createdAt: '2026-10-06T01:00:00Z', calls: [] },
      { id: 'r2', prescribedOn: '2026-09-01', shippedOn: '2026-09-01', days: 10, runoutOn: '2026-09-11', status: 'closed', deletedAt: null, calls: [] },
    ],
  },
  {
    id: 'p2', name: '이환자', relation: 'child', deletedAt: null,
    prescriptions: [
      { id: 'r3', prescribedOn: '2026-10-05', shippedOn: null, days: 20, runoutOn: null, status: 'active', deletedAt: null, createdAt: '2026-10-06T00:30:00Z', calls: [] },
    ],
  },
  {
    id: 'p3', name: '지운환자', relation: 'self', deletedAt: '2026-10-01T00:00:00Z',
    prescriptions: [
      { id: 'r4', prescribedOn: '2026-10-05', shippedOn: '2026-10-05', days: 15, runoutOn: '2026-10-20', status: 'active', deletedAt: null, calls: [] },
    ],
  },
  {
    id: 'p4', name: '휴지통처방', relation: 'self', deletedAt: null,
    prescriptions: [
      { id: 'r5', prescribedOn: '2026-10-05', shippedOn: null, days: 10, runoutOn: null, status: 'active', deletedAt: '2026-10-05T00:00:00Z', calls: [] },
    ],
  },
];

test('처방 줄은 환자와 처방을 함께 묶는다', () => {
  const rows = prescriptionRows(환자들);
  assert.deepEqual(rows.map((r) => r.prescription.id).sort(), ['r1', 'r2', 'r3']);
  assert.equal(rows.find((r) => r.prescription.id === 'r3').patient.name, '이환자');
});

test('지운 환자와 휴지통 처방은 처방 줄에서 빠진다', () => {
  const ids = prescriptionRows(환자들).map((r) => r.prescription.id);
  assert.equal(ids.includes('r4'), false);
  assert.equal(ids.includes('r5'), false);
});

test('처방은 처방일로 묶는다', () => {
  const map = bucketPrescriptionsByDate(prescriptionRows(환자들));
  assert.deepEqual([...map.keys()].sort(), ['2026-09-01', '2026-10-05']);
  assert.equal(map.get('2026-10-05').length, 2);
  assert.equal(map.get('2026-09-01').length, 1);
});

test('처방 줄은 앱에 등록한 순서대로 놓는다', () => {
  // 이환자를 먼저(00:30) 등록하고 김환자를 나중(01:00)에 등록했다
  const map = bucketPrescriptionsByDate(prescriptionRows(환자들));
  assert.deepEqual(map.get('2026-10-05').map((r) => r.patient.name), ['이환자', '김환자']);
});

test('등록 시각이 없는 처방은 맨 뒤에 둔다', () => {
  const rows = [
    { patient: { name: '가' }, prescription: { prescribedOn: '2026-10-05', createdAt: null } },
    { patient: { name: '나' }, prescription: { prescribedOn: '2026-10-05', createdAt: '2026-10-05T03:00:00Z' } },
  ];
  assert.deepEqual(bucketPrescriptionsByDate(rows).get('2026-10-05').map((r) => r.patient.name), ['나', '가']);
});

test('그날 처방 집계는 발송과 발송 대기를 나눈다', () => {
  const map = bucketPrescriptionsByDate(prescriptionRows(환자들));
  assert.deepEqual(prescriptionCountsOf(map.get('2026-10-05')), { total: 2, shipped: 1, waiting: 1 });
  assert.deepEqual(prescriptionCountsOf([]), { total: 0, shipped: 0, waiting: 0 });
});
