-- 두기 해피콜 V1 초기 스키마
-- 기획: customer-view-os-workshop/05_3회차준비과제/닥터두기/2_기획안_V1_V2.md

-- 1. 허용 이메일 ------------------------------------------------------------
create table if not exists public.allowed_emails (
  email text primary key check (email = lower(email))
);

-- 로그인한 사람이 허용 목록에 있는지. 목록 테이블은 클라이언트가 직접 못 읽게 두고
-- 이 함수만 security definer로 읽는다.
create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

-- 2. 환자 ------------------------------------------------------------------
create table if not exists public.patients (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null check (char_length(name) between 1 and 50),
  phone           text        not null unique check (phone ~ '^[0-9]{10,11}$'),
  condition       text        not null check (condition in ('urticaria', 'cough', 'other')),
  condition_label text,
  created_at      timestamptz not null default now()
);

-- 3. 처방 ------------------------------------------------------------------
create table if not exists public.prescriptions (
  id            uuid        primary key default gen_random_uuid(),
  patient_id    uuid        not null references public.patients (id) on delete cascade,
  prescribed_on date        not null,
  days          int         not null check (days between 1 and 90),
  runout_on     date        not null,
  status        text        not null default 'active' check (status in ('active', 'closed')),
  closed_reason text        check (closed_reason in ('completed', 'early')),
  created_at    timestamptz not null default now(),
  check (runout_on = prescribed_on + days),
  check ((status = 'closed') = (closed_reason is not null))
);
create index if not exists prescriptions_patient_idx on public.prescriptions (patient_id);

-- 4. 콜 --------------------------------------------------------------------
create table if not exists public.calls (
  id              uuid        primary key default gen_random_uuid(),
  prescription_id uuid        not null references public.prescriptions (id) on delete cascade,
  kind            text        not null check (kind in ('mid', 'pre_runout')),
  due_on          date        not null,
  status          text        not null default 'pending'
                  check (status in ('pending', 'done', 'sms_pending', 'closed_no_answer')),
  no_answer_count int         not null default 0 check (no_answer_count between 0 and 3),
  result          text        check (result in ('improved', 'same', 'worse', 'unknown')),
  note            text,
  visit_needed    boolean     not null default false,
  visit_booked    boolean     not null default false,
  escalation      text        not null default 'none' check (escalation in ('none', 'pending', 'sent')),
  escalated_at    timestamptz,
  done_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (prescription_id, kind),
  check (extract(isodow from due_on) not in (4, 7))  -- 목요일(4)·일요일(7) 콜 없음
);
create index if not exists calls_due_idx on public.calls (status, due_on);
create index if not exists calls_escalation_idx on public.calls (escalation) where escalation = 'pending';

-- 5. 콜 시도 이력 ------------------------------------------------------------
create table if not exists public.call_attempts (
  id           uuid        primary key default gen_random_uuid(),
  call_id      uuid        not null references public.calls (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  outcome      text        not null check (outcome in ('answered', 'no_answer')),
  note         text,
  staff_name   text
);
create index if not exists call_attempts_call_idx on public.call_attempts (call_id, attempted_at);

-- 6. 스크립트 --------------------------------------------------------------
create table if not exists public.scripts (
  key        text        primary key,
  text       text        not null,
  updated_at timestamptz not null default now()
);

-- 7. 행 수준 보안 ------------------------------------------------------------
alter table public.allowed_emails enable row level security;  -- 정책 없음: 클라이언트 접근 불가
alter table public.patients       enable row level security;
alter table public.prescriptions  enable row level security;
alter table public.calls          enable row level security;
alter table public.call_attempts  enable row level security;
alter table public.scripts        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['patients', 'prescriptions', 'calls', 'call_attempts', 'scripts'] loop
    execute format('drop policy if exists "허용 이메일만" on public.%I', t);
    execute format(
      'create policy "허용 이메일만" on public.%I for all to authenticated
         using (public.is_allowed()) with check (public.is_allowed())', t);
  end loop;
end $$;

-- 로그인하지 않은 공개 키로는 아무 테이블도 건드리지 못하게 한 번 더 막는다.
revoke all on all tables in schema public from anon;
