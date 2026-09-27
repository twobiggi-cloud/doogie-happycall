-- 직원 표시 이름. 통화 기록의 담당자와 화면 인사말에 쓴다.
alter table public.allowed_emails add column if not exists display_name text;

-- 기존 계정은 이메일 앞부분을 임시 이름으로 채운다.
update public.allowed_emails
set display_name = split_part(email, '@', 1)
where display_name is null or display_name = '';

-- 로그인한 계정이 자기 행만 읽는다. 다른 직원의 이메일은 보이지 않는다.
drop policy if exists "내 계정만 읽기" on public.allowed_emails;
create policy "내 계정만 읽기"
  on public.allowed_emails
  for select
  to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));
