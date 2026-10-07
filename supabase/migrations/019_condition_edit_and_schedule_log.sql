-- V2.3 접수실 피드백
-- 1) 등록한 뒤에도 증상(두드러기·기침·기타)을 고칠 수 있게 한다.
--    두 직원이 동시에 고칠 때를 대비해 '고치기 전에 보고 있던 증상'을 함께 보낸다.
create or replace function public.update_patient_condition(
  p_patient_id uuid,
  p_expected_condition text,
  p_expected_label text,
  p_condition text,
  p_condition_label text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  update patients
  set condition = p_condition,
      condition_label = nullif(btrim(coalesce(p_condition_label, '')), '')
  where id = p_patient_id
    and deleted_at is null
    and condition = p_expected_condition
    and coalesce(condition_label, '') = coalesce(p_expected_label, '')
  returning id into v_id;

  if v_id is null then
    raise exception '증상이 이미 바뀌었습니다' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.update_patient_condition(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_patient_condition(uuid, text, text, text, text) to authenticated;

-- 2) 일정 고치기에서 콜 날짜도 직접 고치게 되었다.
--    발송일·투약일수가 그대로여도 무엇이 바뀌었는지 보이도록 변경 기록에 콜 날짜를 덧붙인다.
--    나머지 동작은 012와 같다(대기 콜은 날짜만 고치고 부재 기록은 지키며, 계획에서 빠진 종류만 지운다).
create or replace function public.update_prescription_schedule(
  p_prescription_id uuid,
  p_expected_shipped_on date,
  p_shipped_on date,
  p_days int,
  p_runout_on date,
  p_calls jsonb,
  p_reason text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff text;
  v_old_shipped date;
  v_old_days int;
  v_calls text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '바꾼 이유를 적어주세요' using errcode = 'P0001';
  end if;

  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  select shipped_on, days into v_old_shipped, v_old_days
  from prescriptions where id = p_prescription_id;

  update prescriptions
  set shipped_on = p_shipped_on, days = p_days, runout_on = p_runout_on
  where id = p_prescription_id
    and status = 'active'
    and shipped_on is not distinct from p_expected_shipped_on
  returning id into v_id;

  if v_id is null then
    raise exception '처방이 이미 바뀌었습니다' using errcode = 'P0001';
  end if;

  delete from calls c
  where c.prescription_id = v_id
    and c.status = 'pending'
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) x
      where x ->> 'kind' = c.kind
    );

  update calls c
  set due_on = (x ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) x
  where c.prescription_id = v_id and c.status = 'pending' and c.kind = x ->> 'kind';

  insert into calls (prescription_id, kind, due_on)
  select v_id, x ->> 'kind', (x ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) x
  where not exists (
    select 1 from calls c where c.prescription_id = v_id and c.kind = x ->> 'kind'
  );

  select string_agg(
           case x ->> 'kind'
             when 'mid' then '중간 콜'
             when 'pre_runout' then '소진 전 콜'
             else '재시도 콜'
           end || ' ' || to_char((x ->> 'dueOn')::date, 'MM-DD'),
           ', ')
  into v_calls
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) x;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('prescription', v_id,
    format('발송일 %s → %s, 투약일수 %s일 → %s일',
      coalesce(v_old_shipped::text, '없음'), coalesce(p_shipped_on::text, '없음'), v_old_days, p_days)
      || coalesce(' · ' || v_calls, ''),
    btrim(p_reason), v_staff);
end;
$$;
