-- V2.1 직원회의: 해피콜은 월·화·수·금에만 건다. 토요일 콜은 금요일 명단으로 들어간다.
-- 1) 아직 하지 않은 토요일 콜만 금요일로 당긴다. 이미 끝난 콜은 기록이므로 그대로 둔다.
update public.calls
set due_on = due_on - 1
where status = 'pending'
  and extract(isodow from due_on) = 6;

-- 2) 요일 제약을 목·토·일로 바꾼다. 이름 없이 만들어진 옛 제약을 찾아서 지운다.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.calls'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%isodow%'
  loop
    execute format('alter table public.calls drop constraint %I', c.conname);
  end loop;
end $$;

-- 끝난 토요일 콜 기록을 되돌리지 않으려고 not valid로 붙인다.
-- 앞으로 넣거나 고치는 콜에는 그대로 적용된다.
alter table public.calls
  add constraint calls_no_call_days
  check (extract(isodow from due_on) not in (4, 6, 7)) not valid;
