// Supabase에서 받은 행을 화면이 쓰는 모양으로 바꾸고, 탭별 목록을 고른다.
import { isOnTodayList, addDays, isShipmentOverdue } from './schedule.js';

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
    shippedOn: r.shipped_on ?? null,
    days: r.days,
    runoutOn: r.runout_on,
    status: r.status,
    closedReason: r.closed_reason,
    deletedAt: r.deleted_at ?? null,
    calls: (r.calls ?? []).map((c) => toCall(c, r.id)),
  };
}

export function toPatient(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    relation: row.relation ?? 'self',
    deletedAt: row.deleted_at ?? null,
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

// 약이 아직 나가지 않아 콜이 잡히지 않은 처방. 여기를 비워두면 그 환자는 해피콜에서 사라진다.
export function awaitingShipment(patients, today) {
  const rows = [];
  for (const patient of patients) {
    for (const prescription of patient.prescriptions) {
      if (prescription.status !== 'active' || prescription.shippedOn) continue;
      rows.push({ patient, prescription, overdue: isShipmentOverdue(prescription.prescribedOn, today) });
    }
  }
  return rows.sort((a, b) => (a.prescription.prescribedOn < b.prescription.prescribedOn ? -1 : 1));
}

// 콜이 실제로 처리된 날. 부재로 마감된 콜은 예정일이 아니라 처리한 날로 본다.
function handledOn(call) {
  if (call.doneAt) return String(call.doneAt).slice(0, 10);
  return call.dueOn ?? '';
}

// 연락이 닿지 않은 채 남은 콜. 나중에 통화가 되면 저절로 목록에서 빠진다.
export function unreachedRows(patients, today, windowDays = 60) {
  const since = addDays(today, -windowDays);
  const rows = [];
  for (const patient of patients) {
    const calls = patient.prescriptions.flatMap((r) => r.calls.map((c) => ({ prescription: r, call: c })));
    const lastAnswered = calls
      .filter((v) => v.call.status === 'done')
      .map((v) => handledOn(v.call))
      .sort()
      .pop() ?? '';
    const mine = calls.filter(({ call }) => {
      if (call.status !== 'sms_pending' && call.status !== 'closed_no_answer') return false;
      const on = handledOn(call);
      return on >= since && on > lastAnswered;
    });
    for (const { prescription, call } of mine) {
      rows.push({
        patient,
        prescription,
        call,
        lastTriedOn: call.attempts[0] ? String(call.attempts[0].attemptedAt).slice(0, 10) : handledOn(call),
        noAnswerCount: call.noAnswerCount,
        smsSent: call.status === 'closed_no_answer',
        hasRetryPending: prescription.calls.some((c) => c.kind === 'retry' && c.status === 'pending'),
        count: mine.length,
        needsVisitCheck: mine.length >= 2,
      });
    }
  }
  return rows.sort((a, b) => (a.lastTriedOn < b.lastTriedOn ? 1 : a.lastTriedOn > b.lastTriedOn ? -1 : 0));
}

// 화면은 지워지지 않은 것만 본다. 지운 것은 휴지통에서만 보인다.
export function livePatients(patients) {
  return patients
    .filter((p) => !p.deletedAt)
    .map((p) => ({ ...p, prescriptions: p.prescriptions.filter((r) => !r.deletedAt) }));
}

export function trashRows(patients) {
  const rows = [];
  for (const patient of patients) {
    if (patient.deletedAt) {
      rows.push({ type: 'patient', patient, prescription: null, deletedAt: patient.deletedAt });
      continue;
    }
    for (const prescription of patient.prescriptions) {
      if (prescription.deletedAt) {
        rows.push({ type: 'prescription', patient, prescription, deletedAt: prescription.deletedAt });
      }
    }
  }
  return rows.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
}
