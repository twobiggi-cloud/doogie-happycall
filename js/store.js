import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { toPatient } from './model.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

function check(error) {
  if (error) throw error;
}

// ---- 로그인 ----

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  check(error);
  return data.session;
}

export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  check(error);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  check(error);
}

// ---- 읽기 ----

const PATIENT_PAGE_SIZE = 500;
const PATIENT_MAX = 5000;

const PATIENT_SELECT = `
  id, name, phone, relation, condition, condition_label, created_at, deleted_at,
  memo, memo_updated_at, memo_staff_name,
  prescriptions (
    id, prescribed_on, shipped_on, days, runout_on, status, closed_reason, created_at, deleted_at,
    calls (
      id, kind, due_on, status, no_answer_count, result, note, visit_needed, visit_booked,
      escalation, escalated_at, done_at,
      call_attempts ( id, attempted_at, outcome, note, staff_name )
    )
  )`;

// 한 번에 요청하면 서버 기본 상한 때문에 1000명까지만 온다. 나눠 받아 합친다.
export async function loadAll() {
  const rows = [];
  for (let from = 0; from < PATIENT_MAX; from += PATIENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('patients')
      .select(PATIENT_SELECT)
      .order('created_at', { ascending: false })
      .range(from, from + PATIENT_PAGE_SIZE - 1);
    check(error);
    rows.push(...data);
    if (data.length < PATIENT_PAGE_SIZE) {
      return { patients: rows.map(toPatient), truncated: false };
    }
  }
  return { patients: rows.map(toPatient), truncated: true };
}

export async function loadScripts() {
  const { data, error } = await supabase.from('scripts').select('key, text');
  check(error);
  return Object.fromEntries(data.map((r) => [r.key, r.text]));
}

export async function loadChanges() {
  const { data, error } = await supabase
    .from('change_logs')
    .select('id, target_type, target_id, summary, reason, staff_name, changed_at')
    .order('changed_at', { ascending: false })
    .limit(200);
  check(error);
  return (data ?? []).map((d) => ({
    id: d.id, targetType: d.target_type, targetId: d.target_id,
    summary: d.summary, reason: d.reason, staffName: d.staff_name ?? '', changedAt: d.changed_at,
  }));
}

export async function loadMyStaff() {
  const { data, error } = await supabase
    .from('allowed_emails')
    .select('email, display_name')
    .limit(1)
    .maybeSingle();
  check(error);
  return data ? { email: data.email, name: data.display_name ?? '' } : null;
}

// ---- 쓰기 ----

// 한 번호를 가족이 함께 쓴다. 그 번호에 등록된 사람을 모두 준다.
export async function findPatientsByPhone(phone) {
  const { data, error } = await supabase
    .from('patients')
    .select('id, name, relation, condition, condition_label')
    .eq('phone', phone)
    .order('created_at');
  check(error);
  return (data ?? []).map((d) => ({
    id: d.id, name: d.name, relation: d.relation ?? 'self', condition: d.condition, conditionLabel: d.condition_label ?? '',
  }));
}

export async function registerPrescription({ phone, name, relation, condition, conditionLabel, prescribedOn, shippedOn, days, runoutOn, calls }) {
  const { data, error } = await supabase.rpc('register_prescription', {
    p_phone: phone,
    p_name: name,
    p_relation: relation ?? 'self',
    p_condition: condition,
    p_condition_label: conditionLabel ?? '',
    p_prescribed_on: prescribedOn,
    p_shipped_on: shippedOn ?? null,
    p_days: days,
    p_runout_on: runoutOn ?? null,
    p_calls: calls ?? [],
  });
  check(error);
  return data;
}

// 발송 대기 처방에 발송일을 넣고 그 자리에서 콜을 만든다.
export async function setShippedOn(prescriptionId, { shippedOn, runoutOn, calls }) {
  const { error } = await supabase.rpc('set_shipped_on', {
    p_prescription_id: prescriptionId,
    p_shipped_on: shippedOn,
    p_runout_on: runoutOn,
    p_calls: calls ?? [],
  });
  check(error);
}

// 처방의 발송일과 투약 일수를 고친다. 대기 중인 콜만 다시 잡힌다.
export async function updatePrescriptionSchedule(prescriptionId, { expectedShippedOn, shippedOn, days, runoutOn, calls, reason }) {
  const { error } = await supabase.rpc('update_prescription_schedule', {
    p_prescription_id: prescriptionId,
    p_expected_shipped_on: expectedShippedOn ?? null,
    p_shipped_on: shippedOn ?? null,
    p_days: days,
    p_runout_on: runoutOn ?? null,
    p_calls: calls ?? [],
    p_reason: reason,
  });
  check(error);
}

export async function updateCallDueOn(callId, { expectedDueOn, dueOn, reason }) {
  const { error } = await supabase.rpc('update_call_due_on', {
    p_call_id: callId,
    p_expected_due_on: expectedDueOn,
    p_due_on: dueOn,
    p_reason: reason,
  });
  check(error);
}

// 연락이 안 된 처방에 다시 걸 콜을 만든다.
export async function createRetryCall(prescriptionId, { dueOn, reason }) {
  const { error } = await supabase.rpc('create_retry_call', {
    p_prescription_id: prescriptionId,
    p_due_on: dueOn,
    p_reason: reason,
  });
  check(error);
}

// 지우기는 행을 없애지 않는다. 지운 시각만 적고 화면에서 숨긴다.
export async function trashPatient(patientId, reason) {
  const { error } = await supabase.rpc('trash_patient', { p_patient_id: patientId, p_reason: reason });
  check(error);
}

export async function restorePatient(patientId) {
  const { error } = await supabase.rpc('restore_patient', { p_patient_id: patientId });
  check(error);
}

export async function trashPrescription(prescriptionId, reason) {
  const { error } = await supabase.rpc('trash_prescription', { p_prescription_id: prescriptionId, p_reason: reason });
  check(error);
}

export async function restorePrescription(prescriptionId) {
  const { error } = await supabase.rpc('restore_prescription', { p_prescription_id: prescriptionId });
  check(error);
}

export async function saveCallOutcome(callId, o) {
  const { error } = await supabase.rpc('save_call_outcome', {
    p_call_id: callId,
    p_expected_status: o.expectedStatus,
    p_outcome: o.outcome ?? null,
    p_note: o.note ?? '',
    p_status: o.status,
    p_due_on: o.dueOn ?? null,
    p_no_answer_count: o.noAnswerCount,
    p_result: o.result ?? null,
    p_visit_needed: o.visitNeeded,
    p_escalation: o.escalation,
    p_close_prescription: o.closePrescription ?? null,
  });
  check(error);
}

// 다른 직원이 먼저 처리했을 때 나는 오류인지 구분한다.
const CONFLICT_MESSAGES = [
  '콜 상태가 바뀌었습니다', '발송일이 이미 입력됐습니다', '처방이 이미 바뀌었습니다', '재시도 콜이 이미 있습니다',
  '이미 처리됐습니다', '메모가 이미 바뀌었습니다',
];

// 고치기 전에 보고 있던 메모(expectedMemo)를 함께 보낸다. 그 사이 남이 고쳤으면 저장이 막힌다.
export async function savePatientMemo(patientId, { expectedMemo, memo }) {
  const { error } = await supabase.rpc('save_patient_memo', {
    p_patient_id: patientId,
    p_expected_memo: expectedMemo ?? '',
    p_memo: memo ?? '',
  });
  if (error) throw error;
}

export function isConflictError(err) {
  return Boolean(err && typeof err.message === 'string'
    && CONFLICT_MESSAGES.some((m) => err.message.includes(m)));
}

export async function markEscalationSent(callId) {
  const { data, error } = await supabase
    .from('calls')
    .update({ escalation: 'sent', escalated_at: new Date().toISOString() })
    .eq('id', callId)
    .eq('escalation', 'pending')
    .select('id');
  check(error);
  if (!data || data.length === 0) throw new Error('콜 상태가 바뀌었습니다');
}

export async function markVisitBooked(callId) {
  const { data, error } = await supabase
    .from('calls')
    .update({ visit_booked: true })
    .eq('id', callId)
    .eq('visit_booked', false)
    .select('id');
  check(error);
  if (!data || data.length === 0) throw new Error('콜 상태가 바뀌었습니다');
}

export async function saveScript(key, text) {
  const { error } = await supabase.from('scripts').upsert({ key, text, updated_at: new Date().toISOString() });
  check(error);
}
