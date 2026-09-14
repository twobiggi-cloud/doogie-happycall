-- 등록과 통화 결과 저장을 한 번에 처리한다.
-- security invoker라서 호출한 사람의 RLS가 그대로 적용된다.

create or replace function public.register_prescription(
  p_phone text,
  p_name text,
  p_condition text,
  p_condition_label text,
  p_prescribed_on date,
  p_days int,
  p_runout_on date,
  p_calls jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_prescription_id uuid;
begin
  select id into v_patient_id from patients where phone = p_phone;

  if v_patient_id is null then
    insert into patients (name, phone, condition, condition_label)
    values (p_name, p_phone, p_condition, nullif(p_condition_label, ''))
    returning id into v_patient_id;
  end if;

  insert into prescriptions (patient_id, prescribed_on, days, runout_on)
  values (v_patient_id, p_prescribed_on, p_days, p_runout_on)
  returning id into v_prescription_id;

  insert into calls (prescription_id, kind, due_on)
  select v_prescription_id, c ->> 'kind', (c ->> 'dueOn')::date
  from jsonb_array_elements(p_calls) as c;

  return v_prescription_id;
end;
$$;

create or replace function public.save_call_outcome(
  p_call_id uuid,
  p_outcome text,
  p_note text,
  p_staff_name text,
  p_status text,
  p_due_on date,
  p_no_answer_count int,
  p_result text,
  p_visit_needed boolean,
  p_escalation text,
  p_close_prescription text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prescription_id uuid;
begin
  if p_outcome is not null then
    insert into call_attempts (call_id, outcome, note, staff_name)
    values (p_call_id, p_outcome, nullif(p_note, ''), nullif(p_staff_name, ''));
  end if;

  update calls set
    status = p_status,
    due_on = coalesce(p_due_on, due_on),
    no_answer_count = p_no_answer_count,
    result = coalesce(p_result, result),
    note = case when p_outcome = 'answered' then nullif(p_note, '') else note end,
    visit_needed = p_visit_needed,
    escalation = p_escalation,
    done_at = case when p_status in ('done', 'closed_no_answer') then now() else done_at end
  where id = p_call_id
  returning prescription_id into v_prescription_id;

  if v_prescription_id is null then
    raise exception 'call % not found', p_call_id;
  end if;

  if p_close_prescription is not null then
    update prescriptions
    set status = 'closed', closed_reason = p_close_prescription
    where id = v_prescription_id and status = 'active';
  end if;
end;
$$;

revoke all on function public.register_prescription(text, text, text, text, date, int, date, jsonb) from public, anon;
grant execute on function public.register_prescription(text, text, text, text, date, int, date, jsonb) to authenticated;

revoke all on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text) from public, anon;
grant execute on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text) to authenticated;
