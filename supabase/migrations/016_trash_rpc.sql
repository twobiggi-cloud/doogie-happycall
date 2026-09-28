-- 휴지통으로 보내기와 되돌리기. 누가 왜 했는지 기록에 남긴다.
create function public.trash_patient(p_patient_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_staff text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '바꾼 이유를 적어주세요' using errcode = 'P0001';
  end if;

  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  update patients set deleted_at = now()
  where id = p_patient_id and deleted_at is null
  returning id, name into v_id, v_name;

  if v_id is null then
    raise exception '이미 처리됐습니다' using errcode = 'P0001';
  end if;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('patient', v_id, format('환자 %s 휴지통으로', v_name), btrim(p_reason), v_staff);
end;
$$;

create function public.restore_patient(p_patient_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_staff text;
begin
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  update patients set deleted_at = null
  where id = p_patient_id and deleted_at is not null
  returning id, name into v_id, v_name;

  if v_id is null then
    raise exception '이미 처리됐습니다' using errcode = 'P0001';
  end if;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('patient', v_id, format('환자 %s 되돌림', v_name), '휴지통에서 되돌림', v_staff);
end;
$$;

create function public.trash_prescription(p_prescription_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '바꾼 이유를 적어주세요' using errcode = 'P0001';
  end if;

  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  update prescriptions set deleted_at = now()
  where id = p_prescription_id and deleted_at is null
  returning id into v_id;

  if v_id is null then
    raise exception '이미 처리됐습니다' using errcode = 'P0001';
  end if;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('prescription', v_id, '처방 휴지통으로', btrim(p_reason), v_staff);
end;
$$;

create function public.restore_prescription(p_prescription_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff text;
begin
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  update prescriptions set deleted_at = null
  where id = p_prescription_id and deleted_at is not null
  returning id into v_id;

  if v_id is null then
    raise exception '이미 처리됐습니다' using errcode = 'P0001';
  end if;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('prescription', v_id, '처방 되돌림', '휴지통에서 되돌림', v_staff);
end;
$$;

revoke all on function public.trash_patient(uuid, text) from public, anon;
grant execute on function public.trash_patient(uuid, text) to authenticated;
revoke all on function public.restore_patient(uuid) from public, anon;
grant execute on function public.restore_patient(uuid) to authenticated;
revoke all on function public.trash_prescription(uuid, text) from public, anon;
grant execute on function public.trash_prescription(uuid, text) to authenticated;
revoke all on function public.restore_prescription(uuid) from public, anon;
grant execute on function public.restore_prescription(uuid) to authenticated;
