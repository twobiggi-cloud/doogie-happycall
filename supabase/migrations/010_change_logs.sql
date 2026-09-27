-- 일정을 왜 바꿨는지 남긴다. 나중에 "이 콜 왜 밀렸지?"를 답할 수 있어야 한다.
create table if not exists public.change_logs (
  id          uuid        primary key default gen_random_uuid(),
  target_type text        not null check (target_type in ('prescription', 'call')),
  target_id   uuid        not null,
  summary     text        not null,
  reason      text        not null check (char_length(reason) between 1 and 200),
  staff_name  text,
  changed_at  timestamptz not null default now()
);

create index if not exists change_logs_target_idx on public.change_logs (target_id, changed_at desc);

alter table public.change_logs enable row level security;

drop policy if exists "허용 이메일만" on public.change_logs;
create policy "허용 이메일만" on public.change_logs
  for all to authenticated
  using (private.is_allowed()) with check (private.is_allowed());

-- 다른 표와 같게 로그인하지 않은 접근은 권한부터 막는다.
revoke all on public.change_logs from anon;
