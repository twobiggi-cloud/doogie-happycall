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
  id, name, phone, condition, condition_label, created_at,
  prescriptions (
    id, prescribed_on, days, runout_on, status, closed_reason, created_at,
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

export async function findPatientByPhone(phone) {
  const { data, error } = await supabase
    .from('patients')
    .select('id, name, condition, condition_label')
    .eq('phone', phone)
    .maybeSingle();
  check(error);
  return data ? { id: data.id, name: data.name, condition: data.condition, conditionLabel: data.condition_label ?? '' } : null;
}

export async function registerPrescription({ phone, name, condition, conditionLabel, prescribedOn, days, runoutOn, calls }) {
  const { data, error } = await supabase.rpc('register_prescription', {
    p_phone: phone,
    p_name: name,
    p_condition: condition,
    p_condition_label: conditionLabel ?? '',
    p_prescribed_on: prescribedOn,
    p_days: days,
    p_runout_on: runoutOn,
    p_calls: calls,
  });
  check(error);
  return data;
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
export function isConflictError(err) {
  return Boolean(err && typeof err.message === 'string' && err.message.includes('콜 상태가 바뀌었습니다'));
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
