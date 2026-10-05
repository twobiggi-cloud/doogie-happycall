-- V2.2 직원회의: 환자마다 메모를 남긴다(예: "오전에는 전화 받기 어려움").
-- 처방이 바뀌어도 메모는 환자에게 계속 붙어 있다.
alter table public.patients
  add column if not exists memo             text        not null default '',
  add column if not exists memo_updated_at  timestamptz,
  add column if not exists memo_staff_name  text;

-- 두 직원이 같은 환자의 메모를 동시에 고치면 뒤에 저장한 쪽이 앞사람 글을 지운다.
-- 그래서 '고치기 전에 보고 있던 메모'를 함께 보내고, 그 사이에 바뀌었으면 저장을 막는다.
create or replace function public.save_patient_memo(
  p_patient_id uuid,
  p_expected_memo text,
  p_memo text
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

  update patients
  set memo = coalesce(p_memo, ''),
      memo_updated_at = now(),
      memo_staff_name = v_staff
  where id = p_patient_id
    and deleted_at is null
    and coalesce(memo, '') = coalesce(p_expected_memo, '')
  returning id into v_id;

  if v_id is null then
    raise exception '메모가 이미 바뀌었습니다' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.save_patient_memo(uuid, text, text) from public, anon;
grant execute on function public.save_patient_memo(uuid, text, text) to authenticated;
