// 두기 해피콜 일정 규칙. 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다.
// 브라우저 API를 쓰지 않아서 Node 테스트로 그대로 검증한다.

export const MID_CALL_SKIP_MAX_DAYS = 15; // 처방 일수가 이 값 이하면 중간 콜 없음
export const PRE_RUNOUT_OFFSET_DAYS = 3;  // 소진 3일 전
export const MAX_NO_ANSWER = 3;           // 부재 3회째에 마감
export const NO_CALL_ISO_DAYS = [4, 7];   // 목요일, 일요일

const DAY_MS = 86400000;

function toUTC(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(ymd, days) {
  return fromUTC(toUTC(ymd) + days * DAY_MS);
}

export function daysBetween(fromYmd, toYmd) {
  return Math.round((toUTC(toYmd) - toUTC(fromYmd)) / DAY_MS);
}

export function isoDay(ymd) {
  const day = new Date(toUTC(ymd)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isCallDay(ymd) {
  return !NO_CALL_ISO_DAYS.includes(isoDay(ymd));
}

export function pullBackToCallDay(ymd) {
  let d = ymd;
  while (!isCallDay(d)) d = addDays(d, -1);
  return d;
}

export function nextCallDayAfter(ymd) {
  let d = addDays(ymd, 1);
  while (!isCallDay(d)) d = addDays(d, 1);
  return d;
}

export function todayYMD(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function runoutOn(prescribedOn, days) {
  return addDays(prescribedOn, days);
}

// 짧은 처방에서 콜이 처방일보다 앞서지 않게 한다.
function notBeforePrescription(dueOn, prescribedOn) {
  if (dueOn >= prescribedOn) return dueOn;
  return isCallDay(prescribedOn) ? prescribedOn : nextCallDayAfter(prescribedOn);
}

export function planCalls(prescribedOn, days) {
  const runout = runoutOn(prescribedOn, days);
  const calls = [];
  if (days > MID_CALL_SKIP_MAX_DAYS) {
    const mid = pullBackToCallDay(addDays(prescribedOn, Math.floor(days / 2)));
    calls.push({ kind: 'mid', dueOn: notBeforePrescription(mid, prescribedOn) });
  }
  const pre = pullBackToCallDay(addDays(runout, -PRE_RUNOUT_OFFSET_DAYS));
  calls.push({ kind: 'pre_runout', dueOn: notBeforePrescription(pre, prescribedOn) });
  return { runoutOn: runout, calls };
}

export function hasPastCall(calls, today) {
  return calls.some((c) => c.dueOn < today);
}

export function decideNoAnswer(call, ctx) {
  const noAnswerCount = call.noAnswerCount + 1;
  const next = nextCallDayAfter(ctx.today);
  if (call.kind === 'mid') {
    // 소진 전 콜이 곧 이어받으므로 문자 없이 마감한다. 3회째와 겹쳐도 이쪽이 우선이다.
    if (next >= ctx.preRunoutDueOn) return { status: 'closed_no_answer', dueOn: null, noAnswerCount };
    if (noAnswerCount >= MAX_NO_ANSWER) return { status: 'sms_pending', dueOn: null, noAnswerCount };
    return { status: 'pending', dueOn: next, noAnswerCount };
  }
  if (noAnswerCount >= MAX_NO_ANSWER || next >= ctx.runoutOn) {
    return { status: 'sms_pending', dueOn: null, noAnswerCount };
  }
  return { status: 'pending', dueOn: next, noAnswerCount };
}

export function decideSmsSent(call) {
  return { status: 'closed_no_answer', closePrescription: call.kind === 'pre_runout' ? 'completed' : null };
}

export function decideAnswered(call, input) {
  let closePrescription = null;
  if (input.closeEarly) closePrescription = 'early';
  else if (call.kind === 'pre_runout') closePrescription = 'completed';
  return {
    status: 'done',
    result: input.result,
    note: input.note,
    visitNeeded: Boolean(input.visitNeeded),
    escalation: input.result === 'worse' ? 'pending' : 'none',
    closePrescription,
  };
}

export function defaultVisitNeededFor(result) {
  return result === 'worse';
}

export function isOnTodayList(call, today) {
  if (call.status === 'sms_pending') return true;
  return call.status === 'pending' && call.dueOn <= today;
}

export function overdueDays(dueOn, today) {
  return Math.max(0, daysBetween(dueOn, today));
}
