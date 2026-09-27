-- 연락이 안 된 처방에 다시 걸 콜을 만든다. 처방이 마감됐어도 만들 수 있다.
create function public.create_retry_call(
  p_prescription_id uuid,
  p_due_on date,
  p_reason text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_call_id uuid;
  v_staff text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '바꾼 이유를 적어주세요' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from calls
    where prescription_id = p_prescription_id and kind = 'retry' and status = 'pending'
  ) then
    raise exception '재시도 콜이 이미 있습니다' using errcode = 'P0001';
  end if;

  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  insert into calls (prescription_id, kind, due_on)
  values (p_prescription_id, 'retry', p_due_on)
  returning id into v_call_id;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('call', v_call_id, format('재시도 콜 만듦 %s', p_due_on), btrim(p_reason), v_staff);

  return v_call_id;
end;
$$;

revoke all on function public.create_retry_call(uuid, date, text) from public, anon;
grant execute on function public.create_retry_call(uuid, date, text) to authenticated;
