import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPatient, callViews, todayCalls, upcomingCalls, escalationCalls, visitCalls,
  preRunoutCall, activePrescriptionCount, awaitingShipment, unreachedRows, livePatients, trashRows,
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

test('관계가 없으면 본인으로 본다', () => {
  const p = toPatient({ id: 'p1', name: '가환자', phone: '01011110001', condition: 'cough', condition_label: null, prescriptions: [] });
  assert.equal(p.relation, 'self');
  const q = toPatient({ id: 'p2', name: '나환자', phone: '01011110001', condition: 'cough', condition_label: null, relation: 'child', prescriptions: [] });
  assert.equal(q.relation, 'child');
});

const rxWith = (id, calls) => ({
  id, prescribedOn: '2026-08-20', shippedOn: '2026-08-20', days: 30, runoutOn: '2026-09-19',
  status: 'closed', calls,
});

test('연락 안 됨은 마지막 통화 이후의 미연결만 모은다', () => {
  const patients = [
    {
      id: 'p1', name: '가환자', phone: '01011110001', relation: 'self', condition: 'cough', conditionLabel: '',
      prescriptions: [rxWith('r1', [
        { id: 'c1', kind: 'pre_runout', status: 'closed_no_answer', dueOn: null, doneAt: '2026-09-10T01:00:00Z', noAnswerCount: 3, attempts: [] },
        { id: 'c2', kind: 'retry', status: 'done', dueOn: '2026-09-15', doneAt: '2026-09-15T01:00:00Z', noAnswerCount: 0, attempts: [] },
      ])],
    },
    {
      id: 'p2', name: '나환자', phone: '01011110002', relation: 'self', condition: 'cough', conditionLabel: '',
      prescriptions: [rxWith('r2', [
        { id: 'c3', kind: 'pre_runout', status: 'sms_pending', dueOn: '2026-09-18', doneAt: null, noAnswerCount: 3, attempts: [{ attemptedAt: '2026-09-18T01:00:00Z', outcome: 'no_answer', note: '', staffName: '' }] },
      ])],
    },
  ];
  const rows = unreachedRows(patients, '2026-09-27');
  assert.deepEqual(rows.map((r) => r.call.id), ['c3']);
  assert.equal(rows[0].smsSent, false);
  assert.equal(rows[0].noAnswerCount, 3);
  assert.equal(rows[0].needsVisitCheck, false);
});

test('미연결이 두 건 이상이면 다음 내원 시 확인 표시', () => {
  const patients = [{
    id: 'p3', name: '다환자', phone: '01011110003', relation: 'self', condition: 'cough', conditionLabel: '',
    prescriptions: [
      rxWith('r3', [{ id: 'c4', kind: 'pre_runout', status: 'closed_no_answer', dueOn: null, doneAt: '2026-09-05T01:00:00Z', noAnswerCount: 3, attempts: [] }]),
      rxWith('r4', [{ id: 'c5', kind: 'pre_runout', status: 'closed_no_answer', dueOn: null, doneAt: '2026-09-20T01:00:00Z', noAnswerCount: 3, attempts: [] }]),
    ],
  }];
  const rows = unreachedRows(patients, '2026-09-27');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].call.id, 'c5');
  assert.ok(rows.every((r) => r.needsVisitCheck));
  assert.ok(rows.every((r) => r.smsSent));
});

test('60일보다 오래된 미연결은 빠진다', () => {
  const patients = [{
    id: 'p4', name: '라환자', phone: '01011110004', relation: 'self', condition: 'cough', conditionLabel: '',
    prescriptions: [rxWith('r5', [
      { id: 'c6', kind: 'pre_runout', status: 'closed_no_answer', dueOn: null, doneAt: '2026-06-01T01:00:00Z', noAnswerCount: 3, attempts: [] },
    ])],
  }];
  assert.deepEqual(unreachedRows(patients, '2026-09-27'), []);
});

const trashFixture = () => ([{
  id: 'p1', name: '산환자', phone: '01011110001', relation: 'self', condition: 'cough', conditionLabel: '', deletedAt: null,
  prescriptions: [
    { id: 'r1', prescribedOn: '2026-09-01', shippedOn: '2026-09-01', days: 7, runoutOn: '2026-09-08', status: 'active', deletedAt: null, calls: [] },
    { id: 'r2', prescribedOn: '2026-09-02', shippedOn: '2026-09-02', days: 7, runoutOn: '2026-09-09', status: 'active', deletedAt: '2026-09-20T01:00:00Z', calls: [] },
  ],
}, {
  id: 'p2', name: '지운환자', phone: '01011110002', relation: 'self', condition: 'cough', conditionLabel: '', deletedAt: '2026-09-25T01:00:00Z',
  prescriptions: [{ id: 'r3', prescribedOn: '2026-09-03', shippedOn: '2026-09-03', days: 7, runoutOn: '2026-09-10', status: 'active', deletedAt: null, calls: [] }],
}]);

test('화면에는 지워지지 않은 환자와 처방만 보인다', () => {
  const live = livePatients(trashFixture());
  assert.deepEqual(live.map((p) => p.id), ['p1']);
  assert.deepEqual(live[0].prescriptions.map((r) => r.id), ['r1']);
});

test('휴지통에는 지운 환자와 지운 처방이 최근 순으로', () => {
  const rows = trashRows(trashFixture());
  assert.deepEqual(rows.map((r) => r.type), ['patient', 'prescription']);
  assert.equal(rows[0].patient.id, 'p2');
  assert.equal(rows[1].prescription.id, 'r2');
});
