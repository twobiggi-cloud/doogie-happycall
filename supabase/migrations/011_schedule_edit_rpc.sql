-- 처방의 발송일과 투약일수를 고친다. 대기 중인 콜만 다시 만들고 끝난 콜은 그대로 둔다.
create function public.update_prescription_schedule(
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

  delete from calls where prescription_id = v_id and status = 'pending';

  insert into calls (prescription_id, kind, due_on)
  select v_id, c ->> 'kind', (c ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) as c;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('prescription', v_id,
    format('발송일 %s → %s, 투약일수 %s일 → %s일',
      coalesce(v_old_shipped::text, '없음'), coalesce(p_shipped_on::text, '없음'), v_old_days, p_days),
    btrim(p_reason), v_staff);
end;
$$;

-- 콜 하나의 날짜를 옮긴다.
create function public.update_call_due_on(
  p_call_id uuid,
  p_expected_due_on date,
  p_due_on date,
  p_reason text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '바꾼 이유를 적어주세요' using errcode = 'P0001';
  end if;

  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  update calls set due_on = p_due_on
  where id = p_call_id and status = 'pending' and due_on = p_expected_due_on
  returning id into v_id;

  if v_id is null then
    raise exception '콜 상태가 바뀌었습니다' using errcode = 'P0001';
  end if;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('call', v_id, format('콜 날짜 %s → %s', p_expected_due_on, p_due_on), btrim(p_reason), v_staff);
end;
$$;

revoke all on function public.update_prescription_schedule(uuid, date, date, int, date, jsonb, text) from public, anon;
grant execute on function public.update_prescription_schedule(uuid, date, date, int, date, jsonb, text) to authenticated;
revoke all on function public.update_call_due_on(uuid, date, date, text) from public, anon;
grant execute on function public.update_call_due_on(uuid, date, date, text) to authenticated;
