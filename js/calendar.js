// 달력 격자와 날짜별 집계. 브라우저 기능을 쓰지 않아서 Node 테스트로 그대로 검증한다.
import { addDays, isoDay } from './schedule.js';

export function monthKeyOf(ymd) {
  return ymd.slice(0, 7);
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}년 ${m}월`;
}

// 일요일 시작 6주 격자. 앞뒤 달 날짜도 실제 날짜로 채워 빈칸을 두지 않는다.
export function monthGrid(ym) {
  const first = `${ym}-01`;
  const start = addDays(first, -(isoDay(first) % 7)); // 일요일=7 → 0칸 앞
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) week.push(addDays(start, w * 7 + d));
    weeks.push(week);
  }
  return weeks;
}

// 콜이 달력에서 놓이는 날. 예정일이 먼저고, 부재로 마감돼 예정일이 지워진 콜은 처리한 날에 둔다.
export function calendarDateOf(call) {
  if (call.dueOn) return call.dueOn;
  if (call.doneAt) return String(call.doneAt).slice(0, 10);
  return null;
}

export function bucketByDate(views) {
  const map = new Map();
  for (const v of views) {
    const date = calendarDateOf(v.call);
    if (!date) continue;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(v);
  }
  return map;
}

// 문자 대기는 날짜가 없다. 달력 위에 따로 보여 놓치지 않게 한다.
export function undatedViews(views) {
  return views.filter((v) => calendarDateOf(v.call) === null);
}

export function countsOf(views) {
  const counts = { total: views.length, done: 0, closed: 0, pending: 0, sms: 0 };
  for (const { call } of views) {
    if (call.status === 'done') counts.done += 1;
    else if (call.status === 'closed_no_answer') counts.closed += 1;
    else if (call.status === 'sms_pending') counts.sms += 1;
    else counts.pending += 1;
  }
  return counts;
}

export function summarize(views, today) {
  const counts = countsOf(views);
  const late = views.filter((v) => v.call.status === 'pending' && v.call.dueOn && v.call.dueOn < today).length;
  const reached = counts.done + counts.closed;
  const rate = reached === 0 ? null : Math.round((counts.done / reached) * 100);
  return { ...counts, late, rate };
}

// ---- 그날 처방한 환자 보기 ----
// 달력에서 날짜를 누르면 그날 처방한 환자도 같이 본다. 처방 누락을 눈으로 잡으려는 것이다.
// 기준 날짜는 '처방일'이다. 앱에 입력한 날이 아니라 원장님이 처방한 날로 묶는다.

export function prescriptionRows(patients) {
  const rows = [];
  for (const patient of patients) {
    if (patient.deletedAt) continue;
    for (const prescription of patient.prescriptions) {
      if (prescription.deletedAt) continue;
      rows.push({ patient, prescription });
    }
  }
  return rows;
}

export function bucketPrescriptionsByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    const date = row.prescription.prescribedOn;
    if (!date) continue;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(row);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.patient.name.localeCompare(b.patient.name, 'ko'));
  }
  return map;
}

export function prescriptionCountsOf(rows) {
  const list = rows ?? [];
  const shipped = list.filter((r) => r.prescription.shippedOn).length;
  return { total: list.length, shipped, waiting: list.length - shipped };
}
