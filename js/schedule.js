// 두기 해피콜 일정 규칙. 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다.
// 브라우저 API를 쓰지 않아서 Node 테스트로 그대로 검증한다.

export const MID_CALL_SKIP_MAX_DAYS = 15; // 투약 일수가 이 값 이하면 중간 콜 없음
export const PRE_RUNOUT_OFFSET_DAYS = 3;  // 소진 3일 전
export const SHORT_RX_MAX_DAYS = 7;       // 이 일수 이하는 짧은 처방으로 본다
export const SHORT_PRE_RUNOUT_OFFSET_DAYS = 1; // 짧은 처방은 소진 1일 전
export const SHIPMENT_WAIT_LIMIT_DAYS = 5; // 처방 후 이 날수가 지나면 발송일 확인 대상
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

// 복용은 약을 받은 날부터 시작한다. 모든 계산의 기준은 발송일이다.
export function runoutOn(shippedOn, days) {
  return addDays(shippedOn, days);
}

export function preRunoutOffsetFor(days) {
  return days <= SHORT_RX_MAX_DAYS ? SHORT_PRE_RUNOUT_OFFSET_DAYS : PRE_RUNOUT_OFFSET_DAYS;
}

// 짧은 처방에서 콜이 발송일보다 앞서지 않게 한다.
function notBeforeShipment(dueOn, shippedOn) {
  if (dueOn >= shippedOn) return dueOn;
  return isCallDay(shippedOn) ? shippedOn : nextCallDayAfter(shippedOn);
}

export function planCalls(shippedOn, days) {
  const runout = runoutOn(shippedOn, days);
  const calls = [];
  if (days > MID_CALL_SKIP_MAX_DAYS) {
    const mid = pullBackToCallDay(addDays(shippedOn, Math.floor(days / 2)));
    calls.push({ kind: 'mid', dueOn: notBeforeShipment(mid, shippedOn) });
  }
  const pre = pullBackToCallDay(addDays(runout, -preRunoutOffsetFor(days)));
  calls.push({ kind: 'pre_runout', dueOn: notBeforeShipment(pre, shippedOn) });
  return { runoutOn: runout, calls };
}

// 약이 아직 나가지 않은 채 오래 남은 처방을 찾는다. 보통 이틀, 길어도 나흘이면 나간다.
export function isShipmentOverdue(prescribedOn, today) {
  return daysBetween(prescribedOn, today) >= SHIPMENT_WAIT_LIMIT_DAYS;
}

export function hasPastCall(calls, today) {
  return calls.some((c) => c.dueOn < today);
}

export function decideNoAnswer(call, ctx) {
  const noAnswerCount = call.noAnswerCount + 1;
  const nextCallDay = nextCallDayAfter(ctx.today);
  // 예정일 전에 부재 처리해도 콜을 앞당기지 않는다(미룬다).
  const next = call.dueOn && call.dueOn > nextCallDay ? call.dueOn : nextCallDay;
  if (call.kind === 'mid') {
    // 소진 전 콜이 곧 이어받으므로 문자 없이 마감한다. 3회째와 겹쳐도 이쪽이 우선이다.
    if (next >= ctx.preRunoutDueOn) return { status: 'closed_no_answer', dueOn: null, noAnswerCount };
    if (noAnswerCount >= MAX_NO_ANSWER) return { status: 'sms_pending', dueOn: null, noAnswerCount };
    return { status: 'pending', dueOn: next, noAnswerCount };
  }
  // 재시도 콜은 소진일이 지난 뒤에 거는 콜이라 소진일 기준으로 앞당겨 마감하지 않는다.
  const pastRunout = call.kind === 'pre_runout' && next >= ctx.runoutOn;
  if (noAnswerCount >= MAX_NO_ANSWER || pastRunout) {
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
  else if (call.kind === 'pre_runout' || call.kind === 'retry') closePrescription = 'completed';
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

// 일정을 고칠 때 쓴다. 이미 통화하거나 마감한 종류의 콜은 다시 만들지 않는다.
export function replanPendingCalls(existingCalls, shippedOn, days) {
  const finished = new Set((existingCalls ?? []).filter((c) => c.status !== 'pending').map((c) => c.kind));
  const plan = planCalls(shippedOn, days);
  return { runoutOn: plan.runoutOn, calls: plan.calls.filter((c) => !finished.has(c.kind)) };
}

export function dueDateWarning(dueOn, runoutOn) {
  if (!isCallDay(dueOn)) return '목요일과 일요일에는 콜을 잡지 않아요.';
  if (runoutOn && dueOn > runoutOn) return '소진일보다 늦은 날짜예요.';
  return null;
}
