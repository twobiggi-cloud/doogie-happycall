-- 담당자를 로그인 계정에서 채우고, 저장 직전 상태가 그대로일 때만 저장한다.
-- 옛 함수와 인자 타입이 같아 이름만 바꿀 수 없으므로 지우고 새로 만든다.
drop function if exists public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text);

create function public.save_call_outcome(
  p_call_id uuid,
  p_expected_status text,
  p_outcome text,
  p_note text,
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
  v_staff text;
begin
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  update calls set
    status = p_status,
    due_on = coalesce(p_due_on, due_on),
    no_answer_count = p_no_answer_count,
    result = coalesce(p_result, result),
    note = case when p_outcome = 'answered' then nullif(p_note, '') else note end,
    visit_needed = p_visit_needed,
    escalation = p_escalation,
    done_at = case when p_status in ('done', 'closed_no_answer') then now() else done_at end
  where id = p_call_id and status = p_expected_status
  returning prescription_id into v_prescription_id;

  if v_prescription_id is null then
    raise exception '콜 상태가 바뀌었습니다' using errcode = 'P0001';
  end if;

  if p_outcome is not null then
    insert into call_attempts (call_id, outcome, note, staff_name)
    values (p_call_id, p_outcome, nullif(p_note, ''), v_staff);
  end if;

  if p_close_prescription is not null then
    update prescriptions
    set status = 'closed', closed_reason = p_close_prescription
    where id = v_prescription_id and status = 'active';
  end if;
end;
$$;

revoke all on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text) from public, anon;
grant execute on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text) to authenticated;
