-- 같은 번호에 여러 환자가 있을 수 있으므로 번호와 이름으로 찾는다.
drop function if exists public.register_prescription(text, text, text, text, date, date, int, date, jsonb);

create function public.register_prescription(
  p_phone text,
  p_name text,
  p_relation text,
  p_condition text,
  p_condition_label text,
  p_prescribed_on date,
  p_shipped_on date,
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
  select id into v_patient_id from patients where phone = p_phone and name = p_name;

  if v_patient_id is null then
    insert into patients (name, phone, relation, condition, condition_label)
    values (p_name, p_phone, coalesce(nullif(p_relation, ''), 'self'), p_condition, nullif(p_condition_label, ''))
    returning id into v_patient_id;
  end if;

  insert into prescriptions (patient_id, prescribed_on, shipped_on, days, runout_on)
  values (v_patient_id, p_prescribed_on, p_shipped_on, p_days, p_runout_on)
  returning id into v_prescription_id;

  insert into calls (prescription_id, kind, due_on)
  select v_prescription_id, c ->> 'kind', (c ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) as c;

  return v_prescription_id;
end;
$$;

revoke all on function public.register_prescription(text, text, text, text, text, date, date, int, date, jsonb) from public, anon;
grant execute on function public.register_prescription(text, text, text, text, text, date, date, int, date, jsonb) to authenticated;
