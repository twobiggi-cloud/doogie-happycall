-- 대기 콜을 지우고 새로 만들면 id가 바뀌어 부재 시도 기록(call_attempts)이 함께 사라진다.
-- 그래서 종류별로 날짜만 고치고, 계획에서 빠진 종류만 지운다.
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

  -- 계획에서 빠진 종류의 대기 콜만 지운다(예: 투약일수를 줄여 중간 콜이 없어질 때).
  delete from calls c
  where c.prescription_id = v_id
    and c.status = 'pending'
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) x
      where x ->> 'kind' = c.kind
    );

  -- 남아 있는 대기 콜은 날짜만 고친다. 부재 횟수와 시도 기록이 그대로 남는다.
  update calls c
  set due_on = (x ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) x
  where c.prescription_id = v_id and c.status = 'pending' and c.kind = x ->> 'kind';

  -- 아직 없는 종류만 새로 만든다.
  insert into calls (prescription_id, kind, due_on)
  select v_id, x ->> 'kind', (x ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) x
  where not exists (
    select 1 from calls c where c.prescription_id = v_id and c.kind = x ->> 'kind'
  );

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('prescription', v_id,
    format('발송일 %s → %s, 투약일수 %s일 → %s일',
      coalesce(v_old_shipped::text, '없음'), coalesce(p_shipped_on::text, '없음'), v_old_days, p_days),
    btrim(p_reason), v_staff);
end;
$$;
