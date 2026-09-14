import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, isoDay, isCallDay, pullBackToCallDay, nextCallDayAfter, todayYMD,
  runoutOn, planCalls, hasPastCall, decideNoAnswer, decideSmsSent, decideAnswered,
  defaultVisitNeededFor, isOnTodayList, overdueDays,
} from '../js/schedule.js';

test('addDays는 달이 바뀌어도 맞게 센다', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
});

test('daysBetween은 뒤 날짜가 크면 양수', () => {
  assert.equal(daysBetween('2026-09-15', '2026-09-18'), 3);
  assert.equal(daysBetween('2026-09-18', '2026-09-15'), -3);
});

test('isoDay는 월=1, 목=4, 일=7', () => {
  assert.equal(isoDay('2026-09-14'), 1);
  assert.equal(isoDay('2026-09-17'), 4);
  assert.equal(isoDay('2026-09-20'), 7);
});

test('목요일과 일요일은 콜 요일이 아니다', () => {
  assert.equal(isCallDay('2026-09-17'), false);
  assert.equal(isCallDay('2026-09-20'), false);
  assert.equal(isCallDay('2026-09-18'), true);
});

test('콜 없는 요일은 앞날로 당긴다', () => {
  assert.equal(pullBackToCallDay('2026-09-17'), '2026-09-16');
  assert.equal(pullBackToCallDay('2026-09-20'), '2026-09-19');
  assert.equal(pullBackToCallDay('2026-09-18'), '2026-09-18');
});

test('다음 콜 요일은 목·일을 건너뛴다', () => {
  assert.equal(nextCallDayAfter('2026-09-16'), '2026-09-18');
  assert.equal(nextCallDayAfter('2026-09-19'), '2026-09-21');
  assert.equal(nextCallDayAfter('2026-09-14'), '2026-09-15');
});

test('todayYMD는 브라우저 로컬 날짜를 쓴다', () => {
  assert.equal(todayYMD(new Date(2026, 8, 15, 23, 59)), '2026-09-15');
});

test('소진일은 처방일 + 처방 일수', () => {
  assert.equal(runoutOn('2026-09-15', 30), '2026-10-15');
});

test('30일 처방은 중간 콜과 소진 전 콜 두 건', () => {
  assert.deepEqual(planCalls('2026-09-15', 30), {
    runoutOn: '2026-10-15',
    calls: [
      { kind: 'mid', dueOn: '2026-09-30' },
      { kind: 'pre_runout', dueOn: '2026-10-12' },
    ],
  });
});

test('15일 처방은 중간 콜 없이 한 건, 일요일이면 토요일로', () => {
  assert.deepEqual(planCalls('2026-09-15', 15), {
    runoutOn: '2026-09-30',
    calls: [{ kind: 'pre_runout', dueOn: '2026-09-26' }],
  });
});

test('16일 처방부터 중간 콜이 생긴다', () => {
  assert.deepEqual(planCalls('2026-09-15', 16).calls, [
    { kind: 'mid', dueOn: '2026-09-23' },
    { kind: 'pre_runout', dueOn: '2026-09-28' },
  ]);
});

test('10일 처방에서 목요일에 걸린 소진 전 콜은 수요일로 당겨진다', () => {
  assert.deepEqual(planCalls('2026-09-10', 10), {
    runoutOn: '2026-09-20',
    calls: [{ kind: 'pre_runout', dueOn: '2026-09-16' }],
  });
});

test('콜이 처방일보다 앞서면 처방일로, 처방일이 쉬는 요일이면 다음 콜 요일로', () => {
  assert.equal(planCalls('2026-09-15', 2).calls[0].dueOn, '2026-09-15');
  assert.equal(planCalls('2026-09-20', 3).calls[0].dueOn, '2026-09-21');
});

test('hasPastCall은 오늘보다 앞선 콜이 있으면 참', () => {
  assert.equal(hasPastCall([{ dueOn: '2026-09-14' }], '2026-09-15'), true);
  assert.equal(hasPastCall([{ dueOn: '2026-09-15' }], '2026-09-15'), false);
});

test('소진 전 콜 첫 부재는 다음 콜 요일로 미룬다', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 0 }, { today: '2026-10-12', runoutOn: '2026-10-15' }),
    { status: 'pending', dueOn: '2026-10-13', noAnswerCount: 1 },
  );
});

test('소진 전 콜 부재 3회째면 문자 대기', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 2 }, { today: '2026-10-12', runoutOn: '2026-10-30' }),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 3 },
  );
});

test('소진 전 콜 다음 재시도가 소진일과 같으면 3회 전이라도 문자 대기', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 1 }, { today: '2026-09-23', runoutOn: '2026-09-25' }),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 2 },
  );
});

test('중간 콜 부재는 다음 콜 요일로 미룬다', () => {
  assert.deepEqual(
    decideNoAnswer(
      { kind: 'mid', noAnswerCount: 0 },
      { today: '2026-09-30', runoutOn: '2026-10-15', preRunoutDueOn: '2026-10-12' },
    ),
    { status: 'pending', dueOn: '2026-10-02', noAnswerCount: 1 },
  );
});

test('중간 콜 부재 3회째면 문자 대기', () => {
  assert.deepEqual(
    decideNoAnswer(
      { kind: 'mid', noAnswerCount: 2 },
      { today: '2026-10-05', runoutOn: '2026-10-15', preRunoutDueOn: '2026-10-12' },
    ),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 3 },
  );
});

test('중간 콜 다음 재시도가 소진 전 콜 날짜에 닿으면 3회째여도 문자 없이 마감', () => {
  assert.deepEqual(
    decideNoAnswer(
      { kind: 'mid', noAnswerCount: 2 },
      { today: '2026-10-10', runoutOn: '2026-10-15', preRunoutDueOn: '2026-10-12' },
    ),
    { status: 'closed_no_answer', dueOn: null, noAnswerCount: 3 },
  );
});

test('문자 보냄: 소진 전 콜이면 처방도 마감', () => {
  assert.deepEqual(decideSmsSent({ kind: 'pre_runout' }), { status: 'closed_no_answer', closePrescription: 'completed' });
  assert.deepEqual(decideSmsSent({ kind: 'mid' }), { status: 'closed_no_answer', closePrescription: null });
});

test('악화는 원장 전달 대기', () => {
  assert.deepEqual(
    decideAnswered({ kind: 'mid' }, { result: 'worse', note: '가려움 심해짐', visitNeeded: true, closeEarly: false }),
    { status: 'done', result: 'worse', note: '가려움 심해짐', visitNeeded: true, escalation: 'pending', closePrescription: null },
  );
});

test('소진 전 콜을 저장하면 처방 마감, 조기 마감 체크가 우선', () => {
  const base = { result: 'improved', note: '', visitNeeded: false };
  assert.equal(decideAnswered({ kind: 'pre_runout' }, { ...base, closeEarly: false }).closePrescription, 'completed');
  assert.equal(decideAnswered({ kind: 'pre_runout' }, { ...base, closeEarly: true }).closePrescription, 'early');
  assert.equal(decideAnswered({ kind: 'mid' }, { ...base, closeEarly: false }).closePrescription, null);
});

test('악화를 고르면 내원 필요 기본값이 켜진다', () => {
  assert.equal(defaultVisitNeededFor('worse'), true);
  assert.equal(defaultVisitNeededFor('improved'), false);
});

test('오늘 목록: 예정일이 오늘까지인 대기 콜과 모든 문자 대기', () => {
  assert.equal(isOnTodayList({ status: 'pending', dueOn: '2026-09-15' }, '2026-09-15'), true);
  assert.equal(isOnTodayList({ status: 'pending', dueOn: '2026-09-14' }, '2026-09-15'), true);
  assert.equal(isOnTodayList({ status: 'pending', dueOn: '2026-09-16' }, '2026-09-15'), false);
  assert.equal(isOnTodayList({ status: 'sms_pending', dueOn: '2026-09-30' }, '2026-09-15'), true);
  assert.equal(isOnTodayList({ status: 'done', dueOn: '2026-09-14' }, '2026-09-15'), false);
});

test('overdueDays는 지난 날수, 미래면 0', () => {
  assert.equal(overdueDays('2026-09-13', '2026-09-15'), 2);
  assert.equal(overdueDays('2026-09-16', '2026-09-15'), 0);
});

test('예정일 전 부재는 예정일을 앞당기지 않는다', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 0, dueOn: '2026-10-12' }, { today: '2026-09-15', runoutOn: '2026-10-15' }),
    { status: 'pending', dueOn: '2026-10-12', noAnswerCount: 1 },
  );
  assert.deepEqual(
    decideNoAnswer({ kind: 'mid', noAnswerCount: 0, dueOn: '2026-09-30' },
      { today: '2026-09-15', runoutOn: '2026-10-15', preRunoutDueOn: '2026-10-12' }),
    { status: 'pending', dueOn: '2026-09-30', noAnswerCount: 1 },
  );
});
