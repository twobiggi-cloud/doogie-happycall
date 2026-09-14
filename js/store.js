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

export async function sendLoginLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
  });
  check(error);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  check(error);
}

// ---- 읽기 ----

export async function loadAll() {
  const { data, error } = await supabase
    .from('patients')
    .select(`
      id, name, phone, condition, condition_label, created_at,
      prescriptions (
        id, prescribed_on, days, runout_on, status, closed_reason, created_at,
        calls (
          id, kind, due_on, status, no_answer_count, result, note, visit_needed, visit_booked,
          escalation, escalated_at, done_at,
          call_attempts ( id, attempted_at, outcome, note, staff_name )
        )
      )`)
    .order('created_at', { ascending: false });
  check(error);
  return data.map(toPatient);
}

export async function loadScripts() {
  const { data, error } = await supabase.from('scripts').select('key, text');
  check(error);
  return Object.fromEntries(data.map((r) => [r.key, r.text]));
}
