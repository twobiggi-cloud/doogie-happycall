# V2 4단계: 일정 수정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax로 추적한다.

**Goal:** 잘못 넣었거나 사정이 바뀐 처방의 **발송일·투약일수**를 고치고, **콜 하나의 날짜**를 옮길 수 있게 한다. 이미 통화한 콜은 건드리지 않고, 바꾼 이유를 기록에 남긴다.

**Architecture:** 대기 중인 콜만 다시 계산하는 규칙은 `js/schedule.js`의 순수 함수로 두고 Node 테스트로 검증한다. 데이터베이스에는 변경 기록 표(`change_logs`)를 만들고, 수정은 함수 두 개(`update_prescription_schedule`, `update_call_due_on`)로만 한다. 두 함수 모두 **고치기 직전 값**을 함께 받아, 그사이 다른 직원이 먼저 바꿨으면 저장하지 않는다.

**Tech Stack:** 정적 HTML + ES 모듈(빌드 없음), Supabase Postgres + RLS, Node 24 `node:test`, Vercel 배포(`feat/v1` = production)

**Spec:** `docs/superpowers/specs/2026-09-26-happycall-v2-design.md` 3장 (일정 수정)

## Global Constraints

- **이미 통화하거나 문자로 마감한 콜은 다시 계산하지 않는다.** 대기 중(`pending`)인 콜만 지우고 새로 만든다.
- 투약일수를 줄여 중간 콜이 없어지면 대기 중인 중간 콜은 사라진다. 늘어나 중간 콜이 생기면 새로 만든다. 이미 끝난 중간 콜은 그대로 둔다.
- 콜 날짜는 목요일과 일요일로 바꿀 수 없다. 데이터베이스에도 같은 제약이 있다.
- 소진일보다 뒤인 날짜로 옮기면 경고를 보여주되 막지는 않는다. 약을 늦게 먹기 시작하는 경우가 있다.
- **바꾼 이유를 반드시 받는다.** 이유 없이 저장하지 않는다. 누가 언제 바꿨는지 함께 남긴다.
- 발송일을 지워 다시 '발송 대기'로 되돌릴 수 있다. 이때 대기 중인 콜은 모두 사라지고, 소진일도 비워진다.
- 실제 환자 정보는 코드·문서·커밋·캡처에 넣지 않는다. 예시 환자로만 시험한다.
- 데이터베이스 변경은 `supabase/migrations`에 번호 순서로 남기고, 적용 후 `get_advisors`(security)를 돌린다. 시험용 행은 반드시 지운다.
- 새 표는 행 수준 보안을 켜고 `private.is_allowed()` 정책을 붙인다. SQL 시험은 허용 계정 / 허용되지 않은 계정 / 로그인 안 함 세 경우를 확인한다. 허용 계정 컨텍스트:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"doogieclinic@naver.com"}', true);
```

- `feat/v1`에 push하면 곧바로 실제 배포다. **push 전에 사용자에게 묻는다.**

---

### Task 1: 변경 기록 표

**Files:**
- Create: `supabase/migrations/010_change_logs.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Produces: `public.change_logs(id uuid, target_type text, target_id uuid, summary text, reason text, staff_name text, changed_at timestamptz)` — `target_type`은 `prescription` 또는 `call`. 허용 계정만 읽고 쓴다.

- [ ] **Step 1: 실패하는 시험 실행**

```sql
select count(*) from public.change_logs;
```

Expected: ERROR `42P01: relation "public.change_logs" does not exist`

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/010_change_logs.sql`:

```sql
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
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — name `change_logs`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 허용 계정이 쓰고 읽는지**

허용 계정 앞부분 + 아래.

```sql
insert into public.change_logs (target_type, target_id, summary, reason, staff_name)
values ('call', '00000000-0000-0000-0000-000000000000', '시험 요약', '시험 사유', '접수실');
select target_type, summary, reason, staff_name from public.change_logs;
```

Expected: 1행이 그대로 보인다.

- [ ] **Step 5: 허용되지 않은 계정과 비로그인은 막히는지**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"stranger@example.com"}', true);
select count(*) as 남의계정 from public.change_logs;
```

Expected: `남의계정 = 0`

```sql
set local role anon;
select count(*) from public.change_logs;
```

Expected: ERROR `42501: permission denied for table change_logs`

- [ ] **Step 6: 정리와 보안 점검**

```sql
delete from public.change_logs;
select count(*) as 기록 from public.change_logs;
```

Expected: `기록 = 0`

MCP `get_advisors` type `security` → 새 WARN 없음.

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations/010_change_logs.sql
git commit -F - <<'MSG'
feat: 일정 변경 기록 표

무엇을 왜 바꿨는지, 누가 언제 바꿨는지 남긴다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: 일정을 고치는 함수 두 개

**Files:**
- Create: `supabase/migrations/011_schedule_edit_rpc.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Consumes: Task 1의 `change_logs`
- Produces:
  - `public.update_prescription_schedule(p_prescription_id uuid, p_expected_shipped_on date, p_shipped_on date, p_days int, p_runout_on date, p_calls jsonb, p_reason text) returns void` — 대기 중인 콜을 지우고 받은 콜로 다시 만든다. 고치기 직전 발송일이 다르면 `처방이 이미 바뀌었습니다` 예외.
  - `public.update_call_due_on(p_call_id uuid, p_expected_due_on date, p_due_on date, p_reason text) returns void` — 대기 중인 콜만, 직전 날짜가 같을 때만 옮긴다. 아니면 `콜 상태가 바뀌었습니다` 예외.

- [ ] **Step 1: 실패하는 시험 실행**

```sql
select public.update_call_due_on('00000000-0000-0000-0000-000000000000'::uuid, current_date, current_date + 1, '시험');
```

Expected: ERROR `42883` (함수가 없다)

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/011_schedule_edit_rpc.sql`:

```sql
-- 처방의 발송일과 투약일수를 고친다. 대기 중인 콜만 다시 만들고 끝난 콜은 그대로 둔다.
create function public.update_prescription_schedule(
  p_prescription_id uuid,
  p_expected_shipped_on date,
  p_shipped_on date,
  p_days int,
  p_runout_on date,
  p_calls jsonb,
  p_reason text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_staff text;
  v_old_shipped date;
  v_old_days int;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '바꾼 이유를 적어주세요' using errcode = 'P0001';
  end if;

  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  select shipped_on, days into v_old_shipped, v_old_days
  from prescriptions where id = p_prescription_id;

  update prescriptions
  set shipped_on = p_shipped_on, days = p_days, runout_on = p_runout_on
  where id = p_prescription_id
    and status = 'active'
    and shipped_on is not distinct from p_expected_shipped_on
  returning id into v_id;

  if v_id is null then
    raise exception '처방이 이미 바뀌었습니다' using errcode = 'P0001';
  end if;

  delete from calls where prescription_id = v_id and status = 'pending';

  insert into calls (prescription_id, kind, due_on)
  select v_id, c ->> 'kind', (c ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) as c;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('prescription', v_id,
    format('발송일 %s → %s, 투약일수 %s일 → %s일',
      coalesce(v_old_shipped::text, '없음'), coalesce(p_shipped_on::text, '없음'), v_old_days, p_days),
    btrim(p_reason), v_staff);
end;
$$;

-- 콜 하나의 날짜를 옮긴다.
create function public.update_call_due_on(
  p_call_id uuid,
  p_expected_due_on date,
  p_due_on date,
  p_reason text
) returns void
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
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  update calls set due_on = p_due_on
  where id = p_call_id and status = 'pending' and due_on = p_expected_due_on
  returning id into v_id;

  if v_id is null then
    raise exception '콜 상태가 바뀌었습니다' using errcode = 'P0001';
  end if;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('call', v_id, format('콜 날짜 %s → %s', p_expected_due_on, p_due_on), btrim(p_reason), v_staff);
end;
$$;

revoke all on function public.update_prescription_schedule(uuid, date, date, int, date, jsonb, text) from public, anon;
grant execute on function public.update_prescription_schedule(uuid, date, date, int, date, jsonb, text) to authenticated;
revoke all on function public.update_call_due_on(uuid, date, date, text) from public, anon;
grant execute on function public.update_call_due_on(uuid, date, date, text) to authenticated;
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — name `schedule_edit_rpc`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 시험용 처방 만들기**

허용 계정 앞부분 + 아래.

```sql
select public.register_prescription('01099994001', '일정시험', 'self', 'cough', '',
  date '2026-09-21', date '2026-09-21', 30, date '2026-10-21',
  '[{"kind":"mid","dueOn":"2026-10-06"},{"kind":"pre_runout","dueOn":"2026-10-19"}]'::jsonb) as prescription_id;
select c.id, c.kind, c.due_on, c.status from calls c
join prescriptions r on r.id = c.prescription_id
join patients p on p.id = r.patient_id
where p.phone = '01099994001' order by c.kind;
```

Expected: 2행, 둘 다 `pending`. `prescription_id`와 `mid` 콜 id를 다음 단계에서 쓴다.

- [ ] **Step 5: 끝난 콜은 남고 대기 콜만 다시 잡히는지**

먼저 중간 콜을 통화 완료로 만든다.

```sql
select public.save_call_outcome('<mid콜id>'::uuid, 'pending', 'answered', '경과 좋음', 'done', null, 0, 'improved', false, 'none', null);
```

그다음 발송일을 이틀 뒤로 고친다. 중간 콜은 이미 끝났으므로 보내지 않는다.

```sql
select public.update_prescription_schedule('<처방id>'::uuid, date '2026-09-21', date '2026-09-23', 30, date '2026-10-23',
  '[{"kind":"pre_runout","dueOn":"2026-10-21"}]'::jsonb, '약이 늦게 나갔어요');
select c.kind, c.due_on, c.status from calls c where c.prescription_id = '<처방id>'::uuid order by c.kind;
select summary, reason, staff_name from change_logs where target_id = '<처방id>'::uuid;
```

Expected: `mid`는 `done`으로 그대로(날짜도 그대로), `pre_runout`은 `2026-10-21` `pending`. 기록에 `발송일 2026-09-21 → 2026-09-23, 투약일수 30일 → 30일`과 사유·담당자가 남는다.

- [ ] **Step 6: 직전 값이 다르면 막히는지**

```sql
select public.update_prescription_schedule('<처방id>'::uuid, date '2026-09-21', date '2026-09-25', 30, date '2026-10-25',
  '[]'::jsonb, '두 번째 시도');
```

Expected: ERROR `P0001: 처방이 이미 바뀌었습니다` (지금 발송일은 09-23이다)

- [ ] **Step 7: 이유 없이 저장하면 막히는지**

```sql
select public.update_call_due_on('<pre_runout콜id>'::uuid, date '2026-10-21', date '2026-10-20', '   ');
```

Expected: ERROR `P0001: 바꾼 이유를 적어주세요`

- [ ] **Step 8: 콜 날짜 옮기기와 목·일 막힘**

```sql
select public.update_call_due_on('<pre_runout콜id>'::uuid, date '2026-10-21', date '2026-10-20', '환자 요청');
select due_on from calls where id = '<pre_runout콜id>'::uuid;
select summary, reason from change_logs where target_type = 'call';
```

Expected: `due_on = 2026-10-20`, 기록에 `콜 날짜 2026-10-21 → 2026-10-20`.

```sql
select public.update_call_due_on('<pre_runout콜id>'::uuid, date '2026-10-20', date '2026-10-25', '일요일 시험');
```

Expected: ERROR `23514` (2026-10-25는 일요일이라 데이터베이스가 막는다)

- [ ] **Step 9: 허용되지 않은 계정은 못 바꾸는지**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"stranger@example.com"}', true);
select public.update_call_due_on('<pre_runout콜id>'::uuid, date '2026-10-20', date '2026-10-19', '침입');
```

Expected: ERROR `P0001: 콜 상태가 바뀌었습니다`

- [ ] **Step 10: 정리와 보안 점검**

```sql
delete from public.patients where phone = '01099994001';
delete from public.change_logs;
select (select count(*) from public.patients) as 환자, (select count(*) from public.calls) as 콜, (select count(*) from public.change_logs) as 기록;
```

Expected: `환자 = 3`, `콜 = 5`, `기록 = 0`

MCP `get_advisors` type `security` → 새 WARN 없음.

- [ ] **Step 11: 커밋**

```bash
git add supabase/migrations/011_schedule_edit_rpc.sql
git commit -F - <<'MSG'
feat: 처방 일정과 콜 날짜를 고치는 함수

대기 중인 콜만 다시 만들고 끝난 콜은 건드리지 않는다. 고치기 직전 값이
다르면 저장하지 않고, 바꾼 이유를 반드시 받는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: 다시 계산하는 규칙

**Files:**
- Modify: `js/schedule.js`, `tests/schedule.test.js`

**Interfaces:**
- Produces:
  - `replanPendingCalls(existingCalls, shippedOn, days): { runoutOn, calls }` — 이미 끝난 종류의 콜은 새 목록에서 뺀다
  - `dueDateWarning(dueOn, runoutOn): string|null` — 목·일이면 `'목요일과 일요일에는 콜을 잡지 않아요.'`, 소진일보다 뒤면 `'소진일보다 늦은 날짜예요.'`, 아니면 `null`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/schedule.test.js` import에 `replanPendingCalls, dueDateWarning`을 더하고 파일 끝에 붙인다.

```js
test('끝난 콜은 다시 잡지 않고 대기 콜만 다시 계산한다', () => {
  const existing = [
    { kind: 'mid', status: 'done', dueOn: '2026-10-06' },
    { kind: 'pre_runout', status: 'pending', dueOn: '2026-10-19' },
  ];
  const out = replanPendingCalls(existing, '2026-10-05', 30);
  assert.equal(out.runoutOn, '2026-11-04');
  assert.deepEqual(out.calls, [{ kind: 'pre_runout', dueOn: '2026-10-31' }]);
});

test('끝난 콜이 없으면 처음부터 다시 잡는다', () => {
  const out = replanPendingCalls([{ kind: 'pre_runout', status: 'pending', dueOn: '2026-10-19' }], '2026-10-05', 7);
  assert.equal(out.runoutOn, '2026-10-12');
  assert.deepEqual(out.calls, [{ kind: 'pre_runout', dueOn: '2026-10-10' }]);
});

test('투약일수를 줄이면 대기 중인 중간 콜은 사라진다', () => {
  const existing = [
    { kind: 'mid', status: 'pending', dueOn: '2026-10-20' },
    { kind: 'pre_runout', status: 'pending', dueOn: '2026-10-31' },
  ];
  const out = replanPendingCalls(existing, '2026-10-05', 10);
  assert.deepEqual(out.calls.map((c) => c.kind), ['pre_runout']);
});

test('날짜 경고는 쉬는 요일과 소진일 이후', () => {
  assert.equal(dueDateWarning('2026-10-11', '2026-10-20'), '목요일과 일요일에는 콜을 잡지 않아요.');
  assert.equal(dueDateWarning('2026-10-21', '2026-10-20'), '소진일보다 늦은 날짜예요.');
  assert.equal(dueDateWarning('2026-10-20', '2026-10-20'), null);
  assert.equal(dueDateWarning('2026-10-20', null), null);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL. `replanPendingCalls is not a function`

- [ ] **Step 3: `js/schedule.js`에 더하기**

`isShipmentOverdue` 아래에 붙인다.

```js
// 일정을 고칠 때 쓴다. 이미 통화하거나 마감한 종류의 콜은 다시 만들지 않는다.
export function replanPendingCalls(existingCalls, shippedOn, days) {
  const finished = new Set((existingCalls ?? []).filter((c) => c.status !== 'pending').map((c) => c.kind));
  const plan = planCalls(shippedOn, days);
  return { runoutOn: plan.runoutOn, calls: plan.calls.filter((c) => !finished.has(c.kind)) };
}

export function dueDateWarning(dueOn, runoutOn) {
  if (!isCallDay(dueOn)) return '목요일과 일요일에는 콜을 잡지 않아요.';
  if (runoutOn && dueOn > runoutOn) return '소진일보다 늦은 날짜예요.';
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, 실패 0

- [ ] **Step 5: 커밋**

```bash
git add js/schedule.js tests/schedule.test.js
git commit -F - <<'MSG'
feat: 일정을 고칠 때 대기 콜만 다시 계산하는 규칙

끝난 종류의 콜은 그대로 두고, 바꾼 날짜가 쉬는 요일이거나 소진일보다
늦으면 알려줄 문구를 만든다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: 저장 통로와 변경 기록 불러오기

**Files:**
- Modify: `js/store.js`

**Interfaces:**
- Consumes: Task 2의 함수
- Produces:
  - `store.updatePrescriptionSchedule(prescriptionId, { expectedShippedOn, shippedOn, days, runoutOn, calls, reason })`
  - `store.updateCallDueOn(callId, { expectedDueOn, dueOn, reason })`
  - `store.loadChanges(): Promise<[{ id, targetType, targetId, summary, reason, staffName, changedAt }]>` — 최근 200건
  - `isConflictError`가 `처방이 이미 바뀌었습니다`와 `바꾼 이유를 적어주세요`도 구분하도록 목록에 더한다(이유 없음은 충돌이 아니므로 따로 둔다)

- [ ] **Step 1: 함수 더하기**

`setShippedOn` 아래에 붙인다.

```js
export async function updatePrescriptionSchedule(prescriptionId, { expectedShippedOn, shippedOn, days, runoutOn, calls, reason }) {
  const { error } = await supabase.rpc('update_prescription_schedule', {
    p_prescription_id: prescriptionId,
    p_expected_shipped_on: expectedShippedOn ?? null,
    p_shipped_on: shippedOn ?? null,
    p_days: days,
    p_runout_on: runoutOn ?? null,
    p_calls: calls ?? [],
    p_reason: reason,
  });
  check(error);
}

export async function updateCallDueOn(callId, { expectedDueOn, dueOn, reason }) {
  const { error } = await supabase.rpc('update_call_due_on', {
    p_call_id: callId,
    p_expected_due_on: expectedDueOn,
    p_due_on: dueOn,
    p_reason: reason,
  });
  check(error);
}
```

`loadScripts` 아래에 붙인다.

```js
export async function loadChanges() {
  const { data, error } = await supabase
    .from('change_logs')
    .select('id, target_type, target_id, summary, reason, staff_name, changed_at')
    .order('changed_at', { ascending: false })
    .limit(200);
  check(error);
  return (data ?? []).map((d) => ({
    id: d.id, targetType: d.target_type, targetId: d.target_id,
    summary: d.summary, reason: d.reason, staffName: d.staff_name ?? '', changedAt: d.changed_at,
  }));
}
```

- [ ] **Step 2: 충돌 문구 목록 넓히기**

```js
const CONFLICT_MESSAGES = ['콜 상태가 바뀌었습니다', '발송일이 이미 입력됐습니다', '처방이 이미 바뀌었습니다'];
```

- [ ] **Step 3: 확인**

- Run: `node --check js/store.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0
- Run: `grep -n "update_prescription_schedule\|update_call_due_on\|change_logs" js/store.js` → Expected: 세 줄 이상

- [ ] **Step 4: 커밋**

```bash
git add js/store.js
git commit -F - <<'MSG'
feat: 일정 수정과 변경 기록을 위한 저장 통로

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: 처방 일정 고치기 창

**Files:**
- Modify: `js/ui.js`, `css/app.css`

**Interfaces:**
- Consumes: Task 3의 `replanPendingCalls`, Task 4의 `store.updatePrescriptionSchedule`·`store.loadChanges`
- Produces: 환자 상세의 처방마다 **일정 고치기** 버튼과 창, 처방 아래 변경 이력 표시, `state.changes`

- [ ] **Step 1: 변경 기록을 함께 불러오기**

`state`에 `changes: []`를 더한다.

```js
export const state = {
  patients: [], scripts: {}, tab: 'today', search: '', staff: null, detailPatientId: null,
  month: null, pickedDate: null, changes: [],
};
```

`refresh()`의 불러오기를 아래로 바꾼다.

```js
    const [all, scripts, staff, changes] = await Promise.all([
      store.loadAll(), store.loadScripts(), store.loadMyStaff(), store.loadChanges(),
    ]);
    state.patients = all.patients;
    state.scripts = scripts;
    state.staff = staff;
    state.changes = changes;
```

`stopApp()`에 `state.changes = [];`를 더한다.

- [ ] **Step 2: 상세 창에 버튼과 이력 넣기**

`import`에 `replanPendingCalls, dueDateWarning`을 더한다(`schedule.js`에서).

상세 창의 처방 블록을 아래로 바꾼다.

```js
    const logs = state.changes
      .filter((c) => c.targetId === rx.id || rx.calls.some((call) => call.id === c.targetId))
      .slice(0, 5)
      .map((c) => `<div class="chg">· ${localDate(c.changedAt)} ${esc(c.summary)} — ${esc(c.reason)}${c.staffName ? ` (${esc(c.staffName)})` : ''}</div>`)
      .join('');
    return `
      <div class="rx-block">
        <div class="rx-head">
          <strong>${formatKoreanDate(rx.prescribedOn)} 처방 · ${rx.days}일</strong>
          <span>${rx.shippedOn
            ? `발송 ${formatKoreanDate(rx.shippedOn)} · 소진 ${formatKoreanDate(rx.runoutOn)}`
            : '발송 대기'} · ${rxStatus}</span>
        </div>
        ${calls}
        ${logs ? `<div class="chg-list">${logs}</div>` : ''}
        ${rx.status === 'active' ? `<div class="row-end"><button class="btn btn-sm" data-action="edit-rx" data-id="${rx.id}">🗓 일정 고치기</button></div>` : ''}
      </div>`;
```

- [ ] **Step 3: `css/app.css`에 이력 모양 더하기**

```css
.chg-list{margin-top:8px; border-top:1px dashed var(--border); padding-top:8px;}
.chg{font-size:11.5px; color:var(--text-muted); line-height:1.6;}
```

- [ ] **Step 4: 창 만들기**

`openShipModal` 아래에 붙인다.

```js
function openEditRxModal(patient, rx) {
  const today = todayYMD();
  openModal(`
    <div class="modal-head">
      <div><h2>일정 고치기 · ${esc(patientLabel(patient))}</h2>
        <div class="sub">${formatKoreanDate(rx.prescribedOn)} 처방 · 지금 ${rx.days}일분</div></div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    <div class="field">
      <label>약 발송일</label>
      <input type="date" id="er-ship" value="${rx.shippedOn ?? today}">
      <label class="checkbox-row"><input type="checkbox" id="er-wait"${rx.shippedOn ? '' : ' checked'}> 발송 대기로 되돌리기</label>
    </div>
    <div class="field">
      <label>투약 일수</label>
      ${pillGroup('er-days-presets', DAYS_PRESETS.map((d) => [d, `${d}일`]), rx.days)}
      <input type="number" id="er-days" min="1" max="90" value="${rx.days}">
    </div>
    <div class="field">
      <label>바꾸는 이유 *</label>
      <input type="text" id="er-reason" maxlength="200" placeholder="예: 약이 이틀 늦게 나갔어요">
    </div>
    <div id="er-preview"></div>
    <div class="modal-footer">
      <button class="btn" data-action="close">취소</button>
      <button class="btn btn-primary" id="er-submit">저장</button>
    </div>`);

  const read = () => {
    const days = Number($('er-days').value);
    if (!isValidDays(days)) return null;
    if ($('er-wait').checked) return { days, shippedOn: null, plan: null };
    const shippedOn = $('er-ship').value;
    if (!shippedOn) return null;
    return { days, shippedOn, plan: replanPendingCalls(rx.calls, shippedOn, days) };
  };

  const updatePreview = () => {
    const r = read();
    if (!r) {
      $('er-preview').innerHTML = '<div class="preview-box warn">발송일과 투약 일수(1~90일)를 확인해주세요.</div>';
      return;
    }
    if (!r.plan) {
      $('er-preview').innerHTML = '<div class="preview-box warn">발송 대기로 되돌려요. 대기 중인 콜은 사라지고, 발송일을 다시 넣으면 새로 잡혀요.</div>';
      return;
    }
    const kept = rx.calls.filter((c) => c.status !== 'pending');
    const lines = r.plan.calls.map((c) => `${KIND_LABELS[c.kind]} ${formatKoreanDate(c.dueOn)}`).join(', ');
    let html = `<div class="preview-box">소진일 ${formatKoreanDate(r.plan.runoutOn)}${lines ? ` · ${lines}` : ' · 새로 잡을 콜 없음'}</div>`;
    if (kept.length > 0) {
      html += `<div class="preview-box">이미 끝난 콜 ${kept.length}건은 그대로 둬요: ${kept.map((c) => KIND_LABELS[c.kind]).join(', ')}</div>`;
    }
    if (hasPastCall(r.plan.calls, today)) {
      html += '<div class="preview-box warn">이미 지난 콜 날짜가 있어요. 저장하면 바로 지연으로 떠요.</div>';
    }
    $('er-preview').innerHTML = html;
  };

  $('er-ship').addEventListener('input', updatePreview);
  $('er-days').addEventListener('input', () => { selectPill('er-days-presets', $('er-days').value); updatePreview(); });
  $('er-days-presets').addEventListener('click', (e) => {
    const b = e.target.closest('.pill-opt');
    if (!b) return;
    $('er-days').value = b.dataset.val;
    selectPill('er-days-presets', b.dataset.val);
    updatePreview();
  });
  $('er-wait').addEventListener('change', () => { $('er-ship').disabled = $('er-wait').checked; updatePreview(); });
  $('er-ship').disabled = $('er-wait').checked;
  updatePreview();

  $('er-submit').addEventListener('click', async () => {
    const r = read();
    const reason = $('er-reason').value.trim();
    if (!r) { toast('발송일과 투약 일수를 확인해주세요.'); return; }
    if (!reason) { toast('바꾸는 이유를 적어주세요.'); return; }
    const ok = await run(() => store.updatePrescriptionSchedule(rx.id, {
      expectedShippedOn: rx.shippedOn,
      shippedOn: r.shippedOn,
      days: r.days,
      runoutOn: r.plan ? r.plan.runoutOn : null,
      calls: r.plan ? r.plan.calls : [],
      reason,
    }), '일정을 고쳤어요.');
    if (ok) closeModal();
  });
}
```

- [ ] **Step 5: 버튼 연결하기**

`onAppClick`에 덧붙인다.

```js
  if (action === 'edit-rx') {
    for (const patient of state.patients) {
      const rx = patient.prescriptions.find((r) => r.id === id);
      if (rx) { openEditRxModal(patient, rx); break; }
    }
  }
```

- [ ] **Step 6: 확인**

- Run: `node --check js/ui.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0

- [ ] **Step 7: 커밋**

```bash
git add js/ui.js css/app.css
git commit -F - <<'MSG'
feat: 처방 일정 고치기 창과 변경 이력 표시

발송일과 투약 일수를 고치면 대기 중인 콜만 다시 잡히고, 끝난 콜은 그대로
둔다는 것을 미리 보여준다. 바꾼 이유는 처방 아래에 남는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: 콜 날짜 변경 창

**Files:**
- Modify: `js/ui.js`

**Interfaces:**
- Consumes: Task 3의 `dueDateWarning`, Task 4의 `store.updateCallDueOn`
- Produces: 대기 중인 콜 카드의 **날짜 변경** 버튼과 창

- [ ] **Step 1: 콜 카드에 버튼 더하기**

`callCard`의 `actions`에서 대기 중인 콜 쪽에 버튼을 더한다.

```js
      : `<button class="btn btn-primary btn-sm" data-action="call" data-id="${call.id}">📞 통화 기록</button>
         <button class="btn btn-sm" data-action="no-answer" data-id="${call.id}">부재중</button>
         <button class="btn btn-sm" data-action="edit-call" data-id="${call.id}">🗓 날짜 변경</button>`);
```

- [ ] **Step 2: 창 만들기**

`openEditRxModal` 아래에 붙인다.

```js
function openEditCallModal({ patient, prescription, call }) {
  openModal(`
    <div class="modal-head">
      <div><h2>콜 날짜 변경 · ${esc(patientLabel(patient))}</h2>
        <div class="sub">${KIND_LABELS[call.kind]} · 지금 ${formatKoreanDate(call.dueOn)} · 소진 ${formatKoreanDate(prescription.runoutOn)}</div></div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    <div class="field">
      <label>새 날짜</label>
      <input type="date" id="ec-date" value="${call.dueOn}">
    </div>
    <div class="field">
      <label>바꾸는 이유 *</label>
      <input type="text" id="ec-reason" maxlength="200" placeholder="예: 환자가 다음 주에 통화 원하심">
    </div>
    <div id="ec-preview"></div>
    <div class="modal-footer">
      <button class="btn" data-action="close">취소</button>
      <button class="btn btn-primary" id="ec-submit">저장</button>
    </div>`);

  const updatePreview = () => {
    const date = $('ec-date').value;
    if (!date) { $('ec-preview').innerHTML = '<div class="preview-box warn">날짜를 넣어주세요.</div>'; return; }
    const warn = dueDateWarning(date, prescription.runoutOn);
    $('ec-preview').innerHTML = warn
      ? `<div class="preview-box warn">${warn}</div>`
      : `<div class="preview-box">${formatKoreanDate(date)}로 옮겨요.</div>`;
  };

  $('ec-date').addEventListener('input', updatePreview);
  updatePreview();

  $('ec-submit').addEventListener('click', async () => {
    const date = $('ec-date').value;
    const reason = $('ec-reason').value.trim();
    if (!date) { toast('날짜를 넣어주세요.'); return; }
    if (!isCallDay(date)) { toast('목요일과 일요일에는 콜을 잡지 않아요.'); return; }
    if (!reason) { toast('바꾸는 이유를 적어주세요.'); return; }
    const ok = await run(() => store.updateCallDueOn(call.id, {
      expectedDueOn: call.dueOn, dueOn: date, reason,
    }), '날짜를 옮겼어요.');
    if (ok) closeModal();
  });
}
```

- [ ] **Step 3: 버튼 연결하기**

`onAppClick`에 덧붙인다.

```js
  if (action === 'edit-call') openEditCallModal(findView(id));
```

- [ ] **Step 4: 확인**

- Run: `node --check js/ui.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0
- Run: `grep -n "edit-call\|edit-rx" js/ui.js` → Expected: 네 줄 이상

- [ ] **Step 5: 커밋**

```bash
git add js/ui.js
git commit -F - <<'MSG'
feat: 콜 날짜 변경 창

대기 중인 콜의 날짜를 옮긴다. 목·일은 막고, 소진일보다 늦으면 알려준다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 7: 화면 확인과 문서

**Files:**
- Modify: `CLAUDE.md`
- Test: 로컬 서버와 브라우저, MCP `execute_sql`

- [ ] **Step 1: 콜 날짜 옮겨 보기**

로컬 서버를 켜고 오늘 콜의 대기 콜에서 **🗓 날짜 변경**을 눌러 이틀 뒤로 옮긴다(이유: `예시 시험`).
Expected: 미리보기에 새 날짜가 뜨고, 저장하면 "날짜를 옮겼어요."가 뜬 뒤 목록에서 사라진다(오늘 콜이 아니게 된다).

목요일이나 일요일을 고르면 저장 전에 경고가 뜨고 저장되지 않는다.

- [ ] **Step 2: 처방 일정 고쳐 보기**

환자 상세를 열고 **🗓 일정 고치기**에서 투약 일수를 30일로 바꾼다(이유: `예시 시험`).
Expected: 미리보기에 새 소진일과 콜 날짜, 그리고 "이미 끝난 콜 N건은 그대로 둬요"가 뜬다. 저장하면 처방 아래에 `발송일 … → …, 투약일수 …일 → …일 — 예시 시험 (접수실)` 기록이 보인다.

- [ ] **Step 3: 데이터로 확인**

```sql
select c.kind, c.due_on, c.status from calls c
join prescriptions r on r.id = c.prescription_id
join patients p on p.id = r.patient_id
where p.name like '예시%' order by p.name, c.kind;
select target_type, summary, reason, staff_name from change_logs order by changed_at desc limit 5;
```

Expected: 끝난 콜의 날짜와 상태는 그대로, 대기 콜만 새 날짜. 기록에 방금 두 건이 남는다.

- [ ] **Step 4: 되돌리고 정리**

시험으로 바꾼 값을 원래대로 돌린다(바꾸기 전 값을 미리 적어 둔다).

```sql
delete from public.change_logs;
select (select count(*) from public.patients) as 환자, (select count(*) from public.calls) as 콜, (select count(*) from public.change_logs) as 기록;
```

Expected: `환자 = 3`, `콜 = 5`, `기록 = 0`

- [ ] **Step 5: `CLAUDE.md` 고치기**

"## 해피콜 운영 규칙"에 덧붙인다.

```markdown
- 일정을 고치면 **대기 중인 콜만** 다시 계산한다. 이미 통화하거나 문자로 마감한 콜은 날짜도 상태도 건드리지 않는다.
- 일정 변경에는 이유를 반드시 받고 `change_logs`에 남긴다. 누가 언제 바꿨는지 함께 남는다.
```

"## V2에서 할 일"의 3번 줄을 고친다.

```markdown
3. **일정과 달력**: ~~처방 수정과 콜 날짜 변경, 변경 사유, 월 달력과 날짜별 명단~~ (2026-09-27 완료), 휴진일
```

- [ ] **Step 6: 커밋**

```bash
git add CLAUDE.md
git commit -F - <<'MSG'
docs: 일정 수정 규칙을 규칙 파일에 반영

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 7: 올릴지 묻기**

`npm test` 통과와 예시 데이터만 남았는지 확인하고 **사용자에게 물어본 뒤에만** push한다.

---

## 이 계획에서 하지 않는 것

- 달력에서 콜을 끌어 옮기는 기능. 날짜 변경 창으로 충분하다.
- 약을 바꿨을 때 기존 처방을 자동으로 마감하고 새 처방을 만드는 흐름. 지금도 손으로 할 수 있다(기존 처방 마감 후 새로 등록).
- 변경 기록 전체를 보는 화면. 처방 아래에 최근 다섯 건만 보인다.
- 휴진일·공휴일 달력.
