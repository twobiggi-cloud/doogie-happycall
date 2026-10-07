import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, isoDay, isCallDay, pullBackToCallDay, nextCallDayAfter, todayYMD,
  runoutOn, planCalls, hasPastCall, decideNoAnswer, decideSmsSent, decideAnswered,
  defaultVisitNeededFor, isOnTodayList, overdueDays, preRunoutOffsetFor, isShipmentOverdue, replanPendingCalls, dueDateWarning,
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

test('목·토·일은 콜 요일이 아니다', () => {
  assert.equal(isCallDay('2026-09-17'), false); // 목
  assert.equal(isCallDay('2026-09-19'), false); // 토
  assert.equal(isCallDay('2026-09-20'), false); // 일
  assert.equal(isCallDay('2026-09-18'), true);  // 금
});

test('콜 없는 요일은 앞날로 당긴다', () => {
  assert.equal(pullBackToCallDay('2026-09-17'), '2026-09-16'); // 목 → 수
  assert.equal(pullBackToCallDay('2026-09-19'), '2026-09-18'); // 토 → 금
  assert.equal(pullBackToCallDay('2026-09-20'), '2026-09-18'); // 일 → 금
  assert.equal(pullBackToCallDay('2026-09-18'), '2026-09-18');
});

test('다음 콜 요일은 목·토·일을 건너뛴다', () => {
  assert.equal(nextCallDayAfter('2026-09-16'), '2026-09-18'); // 수 → 금
  assert.equal(nextCallDayAfter('2026-09-18'), '2026-09-21'); // 금 → 월
  assert.equal(nextCallDayAfter('2026-09-14'), '2026-09-15');
});

test('todayYMD는 브라우저 로컬 날짜를 쓴다', () => {
  assert.equal(todayYMD(new Date(2026, 8, 15, 23, 59)), '2026-09-15');
});

test('소진일은 처방일 + 처방 일수', () => {
  assert.equal(runoutOn('2026-09-15', 30), '2026-10-15');
});

test('중간 콜을 켜면 30일 처방은 두 건', () => {
  assert.deepEqual(planCalls('2026-09-15', 30, { withMid: true }), {
    runoutOn: '2026-10-15',
    calls: [
      { kind: 'mid', dueOn: '2026-09-30' },
      { kind: 'pre_runout', dueOn: '2026-10-12' },
    ],
  });
});

test('중간 콜은 켜지 않으면 일수와 상관없이 생기지 않는다', () => {
  assert.deepEqual(planCalls('2026-09-15', 30).calls, [{ kind: 'pre_runout', dueOn: '2026-10-12' }]);
  assert.deepEqual(planCalls('2026-09-15', 30, { withMid: false }).calls, [{ kind: 'pre_runout', dueOn: '2026-10-12' }]);
});

test('소진 전 콜이 일요일이면 금요일로 당겨진다', () => {
  // 소진 09-30 → 3일 전 09-27(일) → 토요일도 쉬므로 09-25(금)
  assert.deepEqual(planCalls('2026-09-15', 15), {
    runoutOn: '2026-09-30',
    calls: [{ kind: 'pre_runout', dueOn: '2026-09-25' }],
  });
});

test('중간 콜을 켜면 짧은 처방에도 절반 날짜로 잡힌다', () => {
  // 발송 09-15(화) 10일분 → 절반 09-20(일) → 09-18(금), 소진 09-25 → 3일 전 09-22(화)
  assert.deepEqual(planCalls('2026-09-15', 10, { withMid: true }).calls, [
    { kind: 'mid', dueOn: '2026-09-18' },
    { kind: 'pre_runout', dueOn: '2026-09-22' },
  ]);
});

test('10일 처방에서 목요일에 걸린 소진 전 콜은 수요일로 당겨진다', () => {
  assert.deepEqual(planCalls('2026-09-10', 10), {
    runoutOn: '2026-09-20',
    calls: [{ kind: 'pre_runout', dueOn: '2026-09-16' }],
  });
});

test('콜이 발송일보다 앞서면 발송일로, 발송일이 쉬는 요일이면 다음 콜 요일로', () => {
  // 2026-09-15(화) 발송 2일분 → 소진 09-17 → 1일 전 09-16(수)
  assert.equal(planCalls('2026-09-15', 2).calls[0].dueOn, '2026-09-16');
  // 2026-09-20(일) 발송 1일분 → 소진 09-21 → 1일 전 09-20(일)은 쉬는 날이고 발송일보다 앞설 수 없어 09-21(월)
  assert.equal(planCalls('2026-09-20', 1).calls[0].dueOn, '2026-09-21');
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

test('7일 이하 처방은 소진 1일 전, 8일 이상은 소진 3일 전', () => {
  assert.equal(preRunoutOffsetFor(7), 1);
  assert.equal(preRunoutOffsetFor(10), 3);
  assert.equal(preRunoutOffsetFor(30), 3);
});

test('7일분은 소진 1일 전에 걸고, 쉬는 요일이면 당긴다', () => {
  // 2026-10-05(월) 발송 → 소진 10-12(월) → 1일 전 10-11(일) → 금요일 10-09로 당김
  const plan = planCalls('2026-10-05', 7);
  assert.equal(plan.runoutOn, '2026-10-12');
  assert.deepEqual(plan.calls, [{ kind: 'pre_runout', dueOn: '2026-10-09' }]);
});

test('10일분은 소진 3일 전 그대로, 중간 콜은 없다', () => {
  const plan = planCalls('2026-10-05', 10);
  assert.equal(plan.runoutOn, '2026-10-15');
  assert.deepEqual(plan.calls, [{ kind: 'pre_runout', dueOn: '2026-10-12' }]);
});

test('30일분은 발송일 기준으로 중간 콜과 소진 전 콜을 잡는다', () => {
  // 발송 10-05(월) → 소진 11-04(수), 중간 10-20(화), 소진 전 11-01(일) → 10-30(금)
  const plan = planCalls('2026-10-05', 30, { withMid: true });
  assert.equal(plan.runoutOn, '2026-11-04');
  assert.deepEqual(plan.calls, [
    { kind: 'mid', dueOn: '2026-10-20' },
    { kind: 'pre_runout', dueOn: '2026-10-30' },
  ]);
});

test('발송일이 처방일보다 늦어도 콜은 발송일 기준으로 잡힌다', () => {
  const plan = planCalls('2026-10-08', 7); // 목요일 발송 → 소진 10-15(목) → 1일 전 10-14(수)
  assert.equal(plan.runoutOn, '2026-10-15');
  assert.deepEqual(plan.calls, [{ kind: 'pre_runout', dueOn: '2026-10-14' }]);
});

test('처방 후 닷새가 지나도록 발송일이 없으면 확인 대상', () => {
  assert.equal(isShipmentOverdue('2026-09-22', '2026-09-27'), true);
  assert.equal(isShipmentOverdue('2026-09-23', '2026-09-27'), false);
  assert.equal(isShipmentOverdue('2026-09-27', '2026-09-27'), false);
});

test('끝난 콜은 다시 잡지 않고 대기 콜만 다시 계산한다', () => {
  const existing = [
    { kind: 'mid', status: 'done', dueOn: '2026-10-06' },
    { kind: 'pre_runout', status: 'pending', dueOn: '2026-10-19' },
  ];
  const out = replanPendingCalls(existing, '2026-10-05', 30);
  assert.equal(out.runoutOn, '2026-11-04');
  assert.deepEqual(out.calls, [{ kind: 'pre_runout', dueOn: '2026-10-30' }]);
});

test('끝난 콜이 없으면 처음부터 다시 잡는다', () => {
  const out = replanPendingCalls([{ kind: 'pre_runout', status: 'pending', dueOn: '2026-10-19' }], '2026-10-05', 7);
  assert.equal(out.runoutOn, '2026-10-12');
  assert.deepEqual(out.calls, [{ kind: 'pre_runout', dueOn: '2026-10-09' }]);
});

test('중간 콜이 있던 처방은 일정을 다시 잡아도 중간 콜을 지킨다', () => {
  const existing = [
    { kind: 'mid', status: 'pending', dueOn: '2026-10-20' },
    { kind: 'pre_runout', status: 'pending', dueOn: '2026-10-30' },
  ];
  const out = replanPendingCalls(existing, '2026-10-05', 10);
  assert.deepEqual(out.calls, [
    { kind: 'mid', dueOn: '2026-10-09' },
    { kind: 'pre_runout', dueOn: '2026-10-12' },
  ]);
});

test('중간 콜을 끄면 대기 중인 중간 콜은 계획에서 빠진다', () => {
  const existing = [
    { kind: 'mid', status: 'pending', dueOn: '2026-10-20' },
    { kind: 'pre_runout', status: 'pending', dueOn: '2026-10-30' },
  ];
  const out = replanPendingCalls(existing, '2026-10-05', 30, { withMid: false });
  assert.deepEqual(out.calls.map((c) => c.kind), ['pre_runout']);
});

test('날짜 경고는 쉬는 요일과 소진일 이후', () => {
  assert.equal(dueDateWarning('2026-10-11', '2026-10-20'), '목·토·일에는 콜을 잡지 않아요.');
  assert.equal(dueDateWarning('2026-10-10', '2026-10-20'), '목·토·일에는 콜을 잡지 않아요.');
  assert.equal(dueDateWarning('2026-10-21', '2026-10-20'), '소진일 이후예요. 환자 사정이 있을 때만 이렇게 잡으세요.');
  assert.equal(dueDateWarning('2026-10-20', '2026-10-20'), null);
  assert.equal(dueDateWarning('2026-10-20', null), null);
});

test('재시도 콜은 소진일이 지나도 바로 마감하지 않는다', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'retry', noAnswerCount: 0, dueOn: '2026-10-12' }, { today: '2026-10-12', runoutOn: '2026-09-30' }),
    { status: 'pending', dueOn: '2026-10-13', noAnswerCount: 1 },
  );
});

test('재시도 콜도 부재 3회면 문자로 마감한다', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'retry', noAnswerCount: 2, dueOn: '2026-10-12' }, { today: '2026-10-12', runoutOn: '2026-09-30' }),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 3 },
  );
});

test('재시도 콜에서 통화가 되면 진행 중인 처방을 마감한다', () => {
  const out = decideAnswered({ kind: 'retry' }, { result: 'improved', note: '', visitNeeded: false, closeEarly: false });
  assert.equal(out.closePrescription, 'completed');
});

// ---- V2.3: 소진일 이후 콜 ----

test('소진일 이후로 일부러 잡은 소진 전 콜은 부재 한 번에 마감하지 않는다', () => {
  // 소진 10-15인데 환자 사정으로 10-19(월)에 걸기로 함 → 부재면 다음 콜 요일 10-20(화)
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 0, dueOn: '2026-10-19' }, { today: '2026-10-19', runoutOn: '2026-10-15' }),
    { status: 'pending', dueOn: '2026-10-20', noAnswerCount: 1 },
  );
});

test('소진일 이후 소진 전 콜도 부재 3회면 문자 대기', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 2, dueOn: '2026-10-19' }, { today: '2026-10-21', runoutOn: '2026-10-15' }),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 3 },
  );
});

test('소진일 전에 잡힌 소진 전 콜은 재시도가 소진일에 닿으면 그대로 문자 대기', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 0, dueOn: '2026-10-14' }, { today: '2026-10-14', runoutOn: '2026-10-15' }),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 1 },
  );
});

test('일정을 다시 잡아도 대기 중인 재시도 콜은 날짜 그대로 남긴다', () => {
  const existing = [
    { kind: 'pre_runout', status: 'done', dueOn: '2026-10-12' },
    { kind: 'retry', status: 'pending', dueOn: '2026-10-21' },
  ];
  const out = replanPendingCalls(existing, '2026-10-05', 10);
  assert.deepEqual(out.calls, [{ kind: 'retry', dueOn: '2026-10-21' }]);
});
