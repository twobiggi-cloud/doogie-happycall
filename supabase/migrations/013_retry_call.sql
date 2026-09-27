-- 연락이 안 된 환자에게 다시 거는 콜. 한 처방에 여러 번 만들 수 있다.
alter table public.calls drop constraint if exists calls_kind_check;
alter table public.calls add constraint calls_kind_check
  check (kind in ('mid', 'pre_runout', 'retry'));

-- (처방, 종류) 유일 제약은 중간 콜과 소진 전 콜에만 적용한다.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.calls'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%prescription_id, kind%'
  loop
    execute format('alter table public.calls drop constraint %I', c.conname);
  end loop;
end $$;

create unique index if not exists calls_one_per_kind_idx
  on public.calls (prescription_id, kind)
  where kind in ('mid', 'pre_runout');
