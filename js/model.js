// Supabase에서 받은 행을 화면이 쓰는 모양으로 바꾸고, 탭별 목록을 고른다.
import { isOnTodayList, addDays } from './schedule.js';

const newestFirst = (key) => (a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0);

function toAttempt(a) {
  return { id: a.id, attemptedAt: a.attempted_at, outcome: a.outcome, note: a.note ?? '', staffName: a.staff_name ?? '' };
}

function toCall(c, prescriptionId) {
  return {
    id: c.id,
    prescriptionId,
    kind: c.kind,
    dueOn: c.due_on,
    status: c.status,
    noAnswerCount: c.no_answer_count,
    result: c.result,
    note: c.note ?? '',
    visitNeeded: c.visit_needed,
    visitBooked: c.visit_booked,
    escalation: c.escalation,
    escalatedAt: c.escalated_at,
    doneAt: c.done_at,
    attempts: (c.call_attempts ?? []).map(toAttempt).sort(newestFirst('attemptedAt')),
  };
}

function toPrescription(r, patientId) {
  return {
    id: r.id,
    patientId,
    prescribedOn: r.prescribed_on,
    days: r.days,
    runoutOn: r.runout_on,
    status: r.status,
    closedReason: r.closed_reason,
    calls: (r.calls ?? []).map((c) => toCall(c, r.id)),
  };
}

export function toPatient(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    condition: row.condition,
    conditionLabel: row.condition_label ?? '',
    prescriptions: (row.prescriptions ?? []).map((r) => toPrescription(r, row.id)).sort(newestFirst('prescribedOn')),
  };
}

export function callViews(patients) {
  const views = [];
  for (const patient of patients) {
    for (const prescription of patient.prescriptions) {
      for (const call of prescription.calls) views.push({ patient, prescription, call });
    }
  }
  return views;
}

function byDueDate(a, b) {
  if (a.call.dueOn !== b.call.dueOn) return a.call.dueOn < b.call.dueOn ? -1 : 1;
  return a.patient.name.localeCompare(b.patient.name, 'ko');
}

export function todayCalls(patients, today) {
  return callViews(patients)
    .filter((v) => v.prescription.status === 'active' && isOnTodayList(v.call, today))
    .sort(byDueDate);
}

export function upcomingCalls(patients, today) {
  const until = addDays(today, 7);
  return callViews(patients)
    .filter((v) => v.prescription.status === 'active' && v.call.status === 'pending'
      && v.call.dueOn > today && v.call.dueOn <= until)
    .sort(byDueDate);
}

export function escalationCalls(patients) {
  return callViews(patients).filter((v) => v.call.escalation === 'pending').sort(byDueDate);
}

export function visitCalls(patients) {
  return callViews(patients).filter((v) => v.call.visitNeeded && !v.call.visitBooked).sort(byDueDate);
}

export function preRunoutCall(prescription) {
  return prescription.calls.find((c) => c.kind === 'pre_runout') ?? null;
}

export function activePrescriptionCount(patients) {
  return patients.reduce((n, p) => n + p.prescriptions.filter((r) => r.status === 'active').length, 0);
}
