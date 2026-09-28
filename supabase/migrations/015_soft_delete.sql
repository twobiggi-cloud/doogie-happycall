-- 지운 것을 되돌릴 수 있어야 한다. 행을 없애지 않고 지운 시각만 적는다.
alter table public.patients add column if not exists deleted_at timestamptz;
alter table public.prescriptions add column if not exists deleted_at timestamptz;

create index if not exists patients_deleted_idx on public.patients (deleted_at);
create index if not exists prescriptions_deleted_idx on public.prescriptions (deleted_at);

-- 환자를 지운 기록도 남긴다.
alter table public.change_logs drop constraint if exists change_logs_target_type_check;
alter table public.change_logs add constraint change_logs_target_type_check
  check (target_type in ('prescription', 'call', 'patient'));
