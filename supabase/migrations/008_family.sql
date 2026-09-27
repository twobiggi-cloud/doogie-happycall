-- 한 번호를 가족이 함께 쓴다. 환자는 번호가 아니라 번호와 이름으로 구분한다.
alter table public.patients add column if not exists relation text;

update public.patients set relation = 'self' where relation is null;

alter table public.patients alter column relation set default 'self';
alter table public.patients alter column relation set not null;

alter table public.patients drop constraint if exists patients_relation_check;
alter table public.patients add constraint patients_relation_check
  check (relation in ('self', 'mother', 'father', 'grandmother', 'grandfather', 'child', 'other'));

-- 번호 단독 유일 제약(이름이 자동으로 붙어 있다)을 찾아서 지운다.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.patients'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) like '%(phone)%'
  loop
    execute format('alter table public.patients drop constraint %I', c.conname);
  end loop;
end $$;

create unique index if not exists patients_phone_name_key on public.patients (phone, name);
