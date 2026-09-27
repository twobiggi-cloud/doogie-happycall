-- 등록할 때 발송일을 함께 받는다. 발송일을 모르면 null로 두고 콜도 만들지 않는다.
drop function if exists public.register_prescription(text, text, text, text, date, int, date, jsonb);

create function public.register_prescription(
  p_phone text,
  p_name text,
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
  select id into v_patient_id from patients where phone = p_phone;

  if v_patient_id is null then
    insert into patients (name, phone, condition, condition_label)
    values (p_name, p_phone, p_condition, nullif(p_condition_label, ''))
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

-- 발송 대기 처방에 발송일을 넣고 그 자리에서 콜을 만든다.
-- 아직 비어 있을 때만 채우므로, 두 직원이 동시에 눌러도 콜이 두 번 생기지 않는다.
create function public.set_shipped_on(
  p_prescription_id uuid,
  p_shipped_on date,
  p_runout_on date,
  p_calls jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  update prescriptions
  set shipped_on = p_shipped_on, runout_on = p_runout_on
  where id = p_prescription_id and shipped_on is null and status = 'active'
  returning id into v_id;

  if v_id is null then
    raise exception '발송일이 이미 입력됐습니다' using errcode = 'P0001';
  end if;

  insert into calls (prescription_id, kind, due_on)
  select v_id, c ->> 'kind', (c ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) as c;
end;
$$;

revoke all on function public.register_prescription(text, text, text, text, date, date, int, date, jsonb) from public, anon;
grant execute on function public.register_prescription(text, text, text, text, date, date, int, date, jsonb) to authenticated;
revoke all on function public.set_shipped_on(uuid, date, date, jsonb) from public, anon;
grant execute on function public.set_shipped_on(uuid, date, date, jsonb) to authenticated;
