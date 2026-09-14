-- 허용 이메일 확인 함수를 API로 노출되지 않는 private 스키마로 옮긴다.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_allowed()
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

revoke all on function private.is_allowed() from public, anon;
grant execute on function private.is_allowed() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['patients', 'prescriptions', 'calls', 'call_attempts', 'scripts'] loop
    execute format('drop policy if exists "허용 이메일만" on public.%I', t);
    execute format(
      'create policy "허용 이메일만" on public.%I for all to authenticated
         using ((select private.is_allowed())) with check ((select private.is_allowed()))', t);
  end loop;
end $$;

drop function if exists public.is_allowed();
