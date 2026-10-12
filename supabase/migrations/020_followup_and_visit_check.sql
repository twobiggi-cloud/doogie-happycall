-- V2.4 실장 피드백
-- 1) 경과 확인 콜(followup): 한두 달 뒤 경과를 묻는 전화. 처방을 새로 넣지 않고 만든다.
-- 2) 내원 확인: 예약했다고 표시한 뒤 실제로 왔는지 확인할 날짜를 둔다.
-- 3) 통화 기록 창에서 재해피콜 날짜를 바로 잡는다.

alter table public.calls drop constraint if exists calls_kind_check;
alter table public.calls add constraint calls_kind_check
  check (kind in ('mid', 'pre_runout', 'retry', 'followup'));

alter table public.calls
  add column if not exists visit_check_on     date,
  add column if not exists visit_confirmed_at timestamptz,
  add column if not exists visit_result       text;

alter table public.calls drop constraint if exists calls_visit_result_check;
alter table public.calls add constraint calls_visit_result_check
  check (visit_result is null or visit_result in ('visited', 'no_show'));

create index if not exists calls_visit_check_idx
  on public.calls (visit_check_on)
  where visit_check_on is not null and visit_confirmed_at is null;

-- 통화를 저장하면서 재해피콜과 내원 확인 날짜를 한 번에 처리한다.
-- 둘로 나누면 통화는 저장됐는데 재해피콜만 실패하는 일이 생긴다.
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
  p_close_prescription text,
  p_retry_due_on date default null,
  p_visit_check_on date default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prescription_id uuid;
  v_staff text;
  v_retry_id uuid;
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
    visit_check_on = case when p_visit_check_on is not null then p_visit_check_on else visit_check_on end,
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

  -- 약을 다 먹지 못해 다시 걸어야 하는 경우. 이미 대기 중인 재시도 콜이 있으면 날짜만 옮긴다.
  if p_retry_due_on is not null then
    update calls
    set due_on = p_retry_due_on
    where prescription_id = v_prescription_id and kind = 'retry' and status = 'pending'
    returning id into v_retry_id;

    if v_retry_id is null then
      insert into calls (prescription_id, kind, due_on)
      values (v_prescription_id, 'retry', p_retry_due_on)
      returning id into v_retry_id;
    end if;

    insert into change_logs (target_type, target_id, summary, reason, staff_name)
    values ('call', v_retry_id, format('재해피콜 %s', p_retry_due_on), '통화 기록에서 잡음', v_staff);
  end if;
end;
$$;

revoke all on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text, date, date) from public, anon;
grant execute on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text, date, date) to authenticated;

-- 경과 확인 콜. 가장 최근 처방에 붙이고, 처방이 하나도 없으면 막는다.
create or replace function public.create_followup_call(
  p_patient_id uuid,
  p_due_on date,
  p_reason text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prescription_id uuid;
  v_call_id uuid;
  v_staff text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '거는 이유를 적어주세요' using errcode = 'P0001';
  end if;

  select r.id into v_prescription_id
  from prescriptions r
  join patients p on p.id = r.patient_id
  where r.patient_id = p_patient_id and r.deleted_at is null and p.deleted_at is null
  order by r.prescribed_on desc, r.created_at desc
  limit 1;

  if v_prescription_id is null then
    raise exception '처방이 없어 경과 확인 콜을 만들 수 없습니다' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from calls
    where prescription_id = v_prescription_id and kind = 'followup'
      and status = 'pending' and due_on = p_due_on
  ) then
    raise exception '같은 날짜의 경과 확인 콜이 이미 있습니다' using errcode = 'P0001';
  end if;

  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  insert into calls (prescription_id, kind, due_on)
  values (v_prescription_id, 'followup', p_due_on)
  returning id into v_call_id;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('call', v_call_id, format('경과 확인 콜 만듦 %s', p_due_on), btrim(p_reason), v_staff);

  return v_call_id;
end;
$$;

revoke all on function public.create_followup_call(uuid, date, text) from public, anon;
grant execute on function public.create_followup_call(uuid, date, text) to authenticated;

-- 내원 예약으로 표시하면서 '언제 확인할지'를 함께 정한다.
create or replace function public.mark_visit_booked(
  p_call_id uuid,
  p_check_on date
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff text;
begin
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  update calls
  set visit_booked = true,
      visit_check_on = p_check_on,
      visit_confirmed_at = null,
      visit_result = null
  where id = p_call_id and visit_booked = false
  returning id into v_id;

  if v_id is null then
    raise exception '이미 처리됐습니다' using errcode = 'P0001';
  end if;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('call', v_id, format('내원 예약함 · %s 확인', p_check_on), '내원 예약 표시', v_staff);
end;
$$;

revoke all on function public.mark_visit_booked(uuid, date) from public, anon;
grant execute on function public.mark_visit_booked(uuid, date) to authenticated;

-- 내원했는지 확인한다. 아직 안 왔으면 다음 확인 날짜로 미룬다.
create or replace function public.confirm_visit(
  p_call_id uuid,
  p_result text,
  p_next_check_on date
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff text;
begin
  if p_result not in ('visited', 'no_show') then
    raise exception '내원 결과가 올바르지 않습니다' using errcode = 'P0001';
  end if;

  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  if p_result = 'visited' then
    update calls
    set visit_result = 'visited', visit_confirmed_at = now()
    where id = p_call_id and visit_confirmed_at is null
    returning id into v_id;
  else
    -- 아직 안 왔다: 확인 날짜만 미루고 목록에 남긴다.
    update calls
    set visit_check_on = p_next_check_on
    where id = p_call_id and visit_confirmed_at is null
    returning id into v_id;
  end if;

  if v_id is null then
    raise exception '이미 처리됐습니다' using errcode = 'P0001';
  end if;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('call', v_id,
    case when p_result = 'visited' then '내원 확인함'
         else format('아직 안 옴 · %s 다시 확인', p_next_check_on) end,
    '내원 확인', v_staff);
end;
$$;

revoke all on function public.confirm_visit(uuid, text, date) from public, anon;
grant execute on function public.confirm_visit(uuid, text, date) to authenticated;
