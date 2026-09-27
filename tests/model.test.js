import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPatient, callViews, todayCalls, upcomingCalls, escalationCalls, visitCalls,
  preRunoutCall, activePrescriptionCount, awaitingShipment,
} from '../js/model.js';

const row = {
  id: 'p1', name: '홍길동', phone: '01012345678', condition: 'urticaria', condition_label: null,
  created_at: '2026-09-15T00:00:00Z',
  prescriptions: [{
    id: 'r1', prescribed_on: '2026-09-15', days: 30, runout_on: '2026-10-15', status: 'active',
    closed_reason: null, created_at: '2026-09-15T00:00:00Z',
    calls: [
      {
        id: 'c2', kind: 'pre_runout', due_on: '2026-10-12', status: 'pending', no_answer_count: 0,
        result: null, note: null, visit_needed: false, visit_booked: false, escalation: 'none',
        escalated_at: null, done_at: null, call_attempts: [],
      },
      {
        id: 'c1', kind: 'mid', due_on: '2026-09-30', status: 'done', no_answer_count: 1,
        result: 'worse', note: '가려움', visit_needed: true, visit_booked: false, escalation: 'pending',
        escalated_at: null, done_at: '2026-09-30T01:00:00Z',
        call_attempts: [
          { id: 'a1', attempted_at: '2026-09-29T01:00:00Z', outcome: 'no_answer', note: null, staff_name: '김직원' },
          { id: 'a2', attempted_at: '2026-09-30T01:00:00Z', outcome: 'answered', note: '가려움', staff_name: '김직원' },
        ],
      },
    ],
  }],
};

const ids = (views) => views.map((v) => v.call.id);

test('toPatient는 camelCase로 바꾸고 빈 값을 채운다', () => {
  const p = toPatient(row);
  assert.equal(p.conditionLabel, '');
  const rx = p.prescriptions[0];
  assert.equal(rx.runoutOn, '2026-10-15');
  assert.equal(rx.patientId, 'p1');
  const mid = rx.calls.find((c) => c.id === 'c1');
  assert.equal(mid.noAnswerCount, 1);
  assert.equal(mid.visitNeeded, true);
  assert.equal(mid.prescriptionId, 'r1');
  assert.deepEqual(mid.attempts.map((a) => a.id), ['a2', 'a1']);
  assert.equal(mid.attempts[1].note, '');
  assert.equal(mid.attempts[1].staffName, '김직원');
});

test('callViews는 모든 콜을 환자·처방과 묶는다', () => {
  assert.deepEqual(ids(callViews([toPatient(row)])).sort(), ['c1', 'c2']);
});

test('todayCalls는 진행 중 처방의 오늘까지 대기 콜만', () => {
  assert.deepEqual(ids(todayCalls([toPatient(row)], '2026-10-12')), ['c2']);
  assert.deepEqual(ids(todayCalls([toPatient(row)], '2026-10-11')), []);
});

test('처방이 마감되면 todayCalls에서 빠진다', () => {
  const closed = structuredClone(row);
  closed.prescriptions[0].status = 'closed';
  closed.prescriptions[0].closed_reason = 'early';
  assert.deepEqual(ids(todayCalls([toPatient(closed)], '2026-10-12')), []);
});

test('upcomingCalls는 오늘 다음날부터 7일 뒤까지', () => {
  assert.deepEqual(ids(upcomingCalls([toPatient(row)], '2026-10-06')), ['c2']);
  assert.deepEqual(ids(upcomingCalls([toPatient(row)], '2026-10-01')), []);
  assert.deepEqual(ids(upcomingCalls([toPatient(row)], '2026-10-12')), []);
});

test('원장 전달과 내원 예약 목록', () => {
  assert.deepEqual(ids(escalationCalls([toPatient(row)])), ['c1']);
  assert.deepEqual(ids(visitCalls([toPatient(row)])), ['c1']);
});

test('preRunoutCall과 진행 중 처방 수', () => {
  const p = toPatient(row);
  assert.equal(preRunoutCall(p.prescriptions[0]).id, 'c2');
  assert.equal(activePrescriptionCount([p]), 1);
});

test('발송 대기 목록은 발송일이 없는 진행 중 처방만, 오래된 것부터', () => {
  const patients = [
    {
      id: 'p1', name: '가환자', phone: '01011110001', condition: 'cough', conditionLabel: '',
      prescriptions: [
        { id: 'r1', prescribedOn: '2026-09-20', shippedOn: null, days: 30, runoutOn: null, status: 'active', calls: [] },
        { id: 'r2', prescribedOn: '2026-09-26', shippedOn: '2026-09-26', days: 30, runoutOn: '2026-10-26', status: 'active', calls: [] },
      ],
    },
    {
      id: 'p2', name: '나환자', phone: '01011110002', condition: 'cough', conditionLabel: '',
      prescriptions: [
        { id: 'r3', prescribedOn: '2026-09-25', shippedOn: null, days: 7, runoutOn: null, status: 'active', calls: [] },
        { id: 'r4', prescribedOn: '2026-09-01', shippedOn: null, days: 7, runoutOn: null, status: 'closed', calls: [] },
      ],
    },
  ];
  const rows = awaitingShipment(patients, '2026-09-27');
  assert.deepEqual(rows.map((v) => v.prescription.id), ['r1', 'r3']);
  assert.equal(rows[0].overdue, true);  // 9월 20일 처방, 7일 지남
  assert.equal(rows[1].overdue, false); // 9월 25일 처방, 2일 지남
});
