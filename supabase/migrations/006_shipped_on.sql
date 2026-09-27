-- 복용은 약을 받은 날부터 시작한다. 그래서 콜 날짜의 기준을 발송일로 옮긴다.
alter table public.prescriptions add column if not exists shipped_on date;

-- 지금까지의 처방은 처방일에 바로 나갔다고 본다. 기존 콜 날짜가 그대로 유지된다.
update public.prescriptions set shipped_on = prescribed_on where shipped_on is null;

-- 발송 전에는 소진일을 알 수 없으므로 비워 둘 수 있어야 한다.
alter table public.prescriptions alter column runout_on drop not null;

-- runout_on을 쓰는 옛 제약(이름이 자동으로 붙어 있다)을 찾아서 지운다.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.prescriptions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%runout_on%'
  loop
    execute format('alter table public.prescriptions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.prescriptions
  add constraint prescriptions_runout_matches_shipment
  check ((shipped_on is null and runout_on is null)
      or (shipped_on is not null and runout_on = shipped_on + days));
