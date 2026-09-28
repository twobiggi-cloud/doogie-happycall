import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, backupFileName } from '../js/backup.js';

const patients = [{
  id: 'p1', name: '가환자', phone: '01011110001', relation: 'self', condition: 'cough', conditionLabel: '', deletedAt: null,
  prescriptions: [{
    id: 'r1', prescribedOn: '2026-09-01', shippedOn: '2026-09-01', days: 7, runoutOn: '2026-09-08',
    status: 'active', closedReason: null, deletedAt: null,
    calls: [{
      id: 'c1', kind: 'pre_runout', dueOn: '2026-09-07', status: 'done', noAnswerCount: 0,
      result: 'improved', note: '좋아짐', visitNeeded: false, visitBooked: false,
      escalation: 'none', escalatedAt: null, doneAt: '2026-09-07T01:00:00Z',
      attempts: [{ id: 'a1', attemptedAt: '2026-09-07T01:00:00Z', outcome: 'answered', note: '', staffName: '접수실' }],
    }],
  }],
}];

test('백업에는 개수와 원본이 함께 들어간다', () => {
  const out = buildBackup({ patients, scripts: { cough: '안녕하세요' }, changes: [{ id: 'g1' }], generatedAt: '2026-09-28T02:00:00Z' });
  assert.equal(out.app, '두기 해피콜');
  assert.equal(out.version, 1);
  assert.equal(out.generatedAt, '2026-09-28T02:00:00Z');
  assert.deepEqual(out.counts, { patients: 1, prescriptions: 1, calls: 1, attempts: 1, changes: 1 });
  assert.equal(out.patients[0].prescriptions[0].calls[0].attempts[0].staffName, '접수실');
  assert.equal(out.scripts.cough, '안녕하세요');
});

test('지워진 것도 백업에 담고 표시한다', () => {
  const trashed = [{ ...patients[0], deletedAt: '2026-09-20T01:00:00Z' }];
  const out = buildBackup({ patients: trashed, scripts: {}, changes: [], generatedAt: '2026-09-28T02:00:00Z' });
  assert.equal(out.counts.patients, 1);
  assert.equal(out.patients[0].deletedAt, '2026-09-20T01:00:00Z');
});

test('파일 이름은 날짜까지', () => {
  assert.equal(backupFileName('2026-09-28T02:00:00Z'), '두기해피콜-백업-2026-09-28.json');
});
