# V2 1단계: 약 발송일 기준과 7일분 처방 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 콜 날짜를 처방일이 아니라 **약 발송일** 기준으로 계산하고, 발송일을 모르는 처방은 "발송 대기"로 남겨 두었다가 발송일을 넣는 순간 콜이 생기게 하며, 7일분 처방을 더한다.

**Architecture:** 날짜 규칙은 `js/schedule.js`(브라우저 기능을 쓰지 않는 순수 함수)에 모여 있고 Node 테스트로 검증한다. 데이터베이스는 `prescriptions`에 `shipped_on`을 더하고 `runout_on`을 비워둘 수 있게 바꾼다. 화면은 등록 창에 발송일 칸을 두고, 발송일이 없는 처방을 모아 보는 "발송 대기" 탭을 새로 만든다. 콜 생성은 화면이 아니라 데이터베이스 함수가 맡아, 두 직원이 같은 처방의 발송일을 동시에 넣어도 콜이 두 번 생기지 않는다.

**Tech Stack:** 정적 HTML + ES 모듈(빌드 없음), supabase-js 2.116.0(CDN 고정), Supabase Postgres + RLS, Node 24 `node:test`, Vercel 배포(`feat/v1` = production)

**Spec:** `docs/superpowers/specs/2026-09-26-happycall-v2-design.md` (2장 기준 변경, 6장 투약 기간 7일 추가, 13장 확인 목록 1·2번 답변 반영)

## Global Constraints

- 소진일 = **발송일 + 투약일수**. 발송일이 없으면 소진일도 콜도 없다.
- 중간 콜 = 발송일 + 투약일수의 절반. 투약일수 **15일 이하면 중간 콜을 만들지 않는다.**
- 소진 전 콜 = **7일 이하 처방은 소진 1일 전**, 8일 이상은 소진 3일 전.
- 계산된 날이 목요일이면 수요일, 일요일이면 토요일로 당긴다. 목·일에는 콜을 잡지 않는다.
- 처방일로부터 **5일이 지나도 발송일이 비어 있으면** 발송 대기 목록에서 빨갛게 표시한다. 나흘까지는 정상이다.
- 처방일은 지우지 않는다. 진료가 언제 있었는지는 통계와 문의 대응에 쓴다.
- 실제 환자 정보는 코드·문서·커밋·캡처 어디에도 넣지 않는다. 예시 환자로만 시험한다.
- 앱에는 publishable 키만 쓴다. `service_role` 키는 넣지 않는다.
- 데이터베이스 변경은 `supabase/migrations`에 번호 순서로 파일을 남기고, 적용 후 `get_advisors`(security)를 돌린다. 시험용 행은 반드시 지운다.
- SQL 시험은 허용 계정 / 허용되지 않은 계정 / 로그인 안 함 세 경우를 모두 확인한다.
- 화면 글자 크기는 지금 크기를 유지한다(접수실 요청).
- `feat/v1`에 push하면 곧바로 실제 배포다. **push 전에 사용자에게 묻는다.**
- Supabase project_id: `yblqrtwbvqrshqmnizij`. 허용 계정은 `allowed_emails` 표에 있는 두 개(공용 계정 `접수실`, 원장 계정)다. SQL 시험에서 허용 계정 컨텍스트는 아래 두 줄을 앞에 붙여 만든다.

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"doogieclinic@naver.com"}', true);
```

---

### Task 1: 데이터베이스에 발송일 자리 만들기

**Files:**
- Create: `supabase/migrations/006_shipped_on.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Produces: `public.prescriptions.shipped_on date` (null 허용 = 발송 대기), `runout_on`이 null 허용으로 바뀜, 제약 `prescriptions_runout_matches_shipment`(발송일이 없으면 소진일도 없고, 있으면 `runout_on = shipped_on + days`)

- [ ] **Step 1: 실패하는 시험 실행**

MCP `execute_sql`:

```sql
select shipped_on from public.prescriptions limit 1;
```

Expected: ERROR `42703: column "shipped_on" does not exist`. 실제 메시지를 보고서에 적는다.

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/006_shipped_on.sql`:

```sql
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
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — project_id `yblqrtwbvqrshqmnizij`, name `shipped_on`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 기존 행이 그대로인지**

```sql
select prescribed_on, shipped_on, days, runout_on,
       (runout_on = shipped_on + days) as 계산맞음
from public.prescriptions order by prescribed_on;
```

Expected: 4행 모두 `shipped_on = prescribed_on`이고 `계산맞음`이 true.

- [ ] **Step 5: 발송 대기 행이 들어가는지**

허용 계정 앞부분 + 아래.

```sql
insert into public.patients (name, phone, condition) values ('발송대기시험', '01099990002', 'cough');
insert into public.prescriptions (patient_id, prescribed_on, days)
select id, date '2026-09-25', 30 from public.patients where phone = '01099990002';
select prescribed_on, shipped_on, runout_on from public.prescriptions
where patient_id = (select id from public.patients where phone = '01099990002');
```

Expected: 1행, `shipped_on`과 `runout_on`이 모두 null.

- [ ] **Step 6: 어긋난 값이 막히는지**

```sql
update public.prescriptions set runout_on = date '2026-10-30'
where patient_id = (select id from public.patients where phone = '01099990002');
```

Expected: ERROR `23514` (check constraint `prescriptions_runout_matches_shipment` 위반). 발송일 없이 소진일만 넣을 수 없다.

- [ ] **Step 7: 정리와 보안 점검**

```sql
delete from public.patients where phone = '01099990002';
select count(*) as 환자 from public.patients;
```

Expected: `환자 = 3`

MCP `get_advisors` type `security` → 새 WARN 없음(기존 `auth_leaked_password_protection` 하나만 남아 있으면 통과).

- [ ] **Step 8: 커밋**

```bash
git add supabase/migrations/006_shipped_on.sql
git commit -F - <<'MSG'
feat: 처방에 약 발송일 열 추가

복용은 약을 받은 날부터 시작하므로 소진일 기준을 발송일로 옮긴다.
발송 전에는 소진일을 비워 두고, 발송일이 들어오면 소진일이 계산되게 한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: 등록과 발송일 입력 함수

**Files:**
- Create: `supabase/migrations/007_shipping_rpc.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Consumes: Task 1의 `shipped_on`
- Produces:
  - `public.register_prescription(p_phone text, p_name text, p_condition text, p_condition_label text, p_prescribed_on date, p_shipped_on date, p_days int, p_runout_on date, p_calls jsonb) returns uuid` — 인자가 하나 늘었다(`p_shipped_on`). `p_calls`가 빈 배열이면 콜을 만들지 않는다.
  - `public.set_shipped_on(p_prescription_id uuid, p_shipped_on date, p_runout_on date, p_calls jsonb) returns void` — 발송일이 아직 비어 있을 때만 채우고 콜을 만든다. 이미 채워져 있으면 `발송일이 이미 입력됐습니다` 예외.

- [ ] **Step 1: 실패하는 시험 실행**

허용 계정 앞부분 + 아래.

```sql
select public.set_shipped_on('00000000-0000-0000-0000-000000000000'::uuid, date '2026-09-28', date '2026-10-28', '[]'::jsonb);
```

Expected: ERROR `42883: function public.set_shipped_on(...) does not exist`

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/007_shipping_rpc.sql`:

```sql
-- 등록할 때 발송일을 함께 받는다. 발송일을 모르면 null로 두고 콜도 만들지 않는다.
drop function if exists public.register_prescription(text, text, text, text, date, int, date, jsonb);

create function public.register_prescription(
  p_phone text,
  p_name text,
  p_condition text,
  p_condition_label text,
  p_prescribed_on date,
  p_shipped_on date,
  p_days int,
  p_runout_on date,
  p_calls jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_prescription_id uuid;
begin
  select id into v_patient_id from patients where phone = p_phone;

  if v_patient_id is null then
    insert into patients (name, phone, condition, condition_label)
    values (p_name, p_phone, p_condition, nullif(p_condition_label, ''))
    returning id into v_patient_id;
  end if;

  insert into prescriptions (patient_id, prescribed_on, shipped_on, days, runout_on)
  values (v_patient_id, p_prescribed_on, p_shipped_on, p_days, p_runout_on)
  returning id into v_prescription_id;

  insert into calls (prescription_id, kind, due_on)
  select v_prescription_id, c ->> 'kind', (c ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) as c;

  return v_prescription_id;
end;
$$;

-- 발송 대기 처방에 발송일을 넣고 그 자리에서 콜을 만든다.
-- 아직 비어 있을 때만 채우므로, 두 직원이 동시에 눌러도 콜이 두 번 생기지 않는다.
create function public.set_shipped_on(
  p_prescription_id uuid,
  p_shipped_on date,
  p_runout_on date,
  p_calls jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  update prescriptions
  set shipped_on = p_shipped_on, runout_on = p_runout_on
  where id = p_prescription_id and shipped_on is null and status = 'active'
  returning id into v_id;

  if v_id is null then
    raise exception '발송일이 이미 입력됐습니다' using errcode = 'P0001';
  end if;

  insert into calls (prescription_id, kind, due_on)
  select v_id, c ->> 'kind', (c ->> 'dueOn')::date
  from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) as c;
end;
$$;

revoke all on function public.register_prescription(text, text, text, text, date, date, int, date, jsonb) from public, anon;
grant execute on function public.register_prescription(text, text, text, text, date, date, int, date, jsonb) to authenticated;
revoke all on function public.set_shipped_on(uuid, date, date, jsonb) from public, anon;
grant execute on function public.set_shipped_on(uuid, date, date, jsonb) to authenticated;
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — name `shipping_rpc`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 발송일 없이 등록하면 콜이 없는지**

허용 계정 앞부분 + 아래.

```sql
select public.register_prescription('01099990003', '발송대기시험', 'cough', '',
  date '2026-09-25', null, 30, null, '[]'::jsonb) as prescription_id;
select r.id, r.shipped_on, r.runout_on, (select count(*) from calls c where c.prescription_id = r.id) as 콜건수
from prescriptions r join patients p on p.id = r.patient_id
where p.phone = '01099990003';
```

Expected: 1행, `shipped_on`과 `runout_on`이 null, `콜건수 = 0`. 나온 `id`를 다음 단계에서 쓴다.

- [ ] **Step 5: 발송일을 넣으면 콜이 생기는지**

허용 계정 앞부분 + 아래. `<처방id>`는 Step 4에서 받은 값이다.

```sql
select public.set_shipped_on('<처방id>'::uuid, date '2026-09-28', date '2026-10-28',
  '[{"kind":"mid","dueOn":"2026-10-13"},{"kind":"pre_runout","dueOn":"2026-10-24"}]'::jsonb);
select r.shipped_on, r.runout_on, c.kind, c.due_on, c.status
from prescriptions r join calls c on c.prescription_id = r.id
where r.id = '<처방id>'::uuid order by c.due_on;
```

Expected: 2행. `shipped_on = 2026-09-28`, `runout_on = 2026-10-28`, `mid`는 10-13, `pre_runout`은 10-24, 둘 다 `pending`.

- [ ] **Step 6: 두 번 넣으면 막히는지**

허용 계정 앞부분 + 같은 호출을 한 번 더.

```sql
select public.set_shipped_on('<처방id>'::uuid, date '2026-09-29', date '2026-10-29',
  '[{"kind":"pre_runout","dueOn":"2026-10-26"}]'::jsonb);
```

Expected: ERROR `P0001: 발송일이 이미 입력됐습니다`

이어서 콜이 늘지 않았는지 확인한다.

```sql
select count(*) as 콜건수 from calls where prescription_id = '<처방id>'::uuid;
```

Expected: `콜건수 = 2`

- [ ] **Step 7: 허용되지 않은 계정은 못 넣는지**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"stranger@example.com"}', true);
select public.set_shipped_on('<처방id>'::uuid, date '2026-09-30', date '2026-10-30', '[]'::jsonb);
```

Expected: ERROR `P0001: 발송일이 이미 입력됐습니다` (행 수준 보안 때문에 그 처방이 보이지 않아 갱신 대상이 없다)

- [ ] **Step 8: 정리와 보안 점검**

역할을 바꾸지 않고:

```sql
delete from public.patients where phone = '01099990003';
select (select count(*) from public.patients) as 환자, (select count(*) from public.calls) as 콜;
```

Expected: `환자 = 3`, `콜 = 5`

MCP `get_advisors` type `security` → 새 WARN 없음.

- [ ] **Step 9: 커밋**

```bash
git add supabase/migrations/007_shipping_rpc.sql
git commit -F - <<'MSG'
feat: 발송일을 받는 등록 함수와 발송일 입력 함수

등록할 때 발송일을 함께 받고, 모르면 콜 없이 발송 대기로 남긴다.
발송일은 아직 비어 있을 때만 채워, 두 사람이 동시에 넣어도 콜이 겹치지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: 날짜 규칙을 발송일 기준으로 바꾸기

**Files:**
- Modify: `js/schedule.js`, `tests/schedule.test.js`

**Interfaces:**
- Produces:
  - `planCalls(shippedOn, days)` — 첫 인자의 뜻이 처방일에서 **발송일**로 바뀐다. 반환 모양은 그대로 `{ runoutOn, calls: [{kind, dueOn}] }`
  - `runoutOn(shippedOn, days)` — 같은 이유로 첫 인자의 뜻이 바뀐다
  - `preRunoutOffsetFor(days): number` — 7일 이하면 1, 아니면 3
  - `isShipmentOverdue(prescribedOn, today): boolean` — 처방 후 5일이 지나도록 발송일이 없으면 true
  - 상수 `SHORT_RX_MAX_DAYS = 7`, `SHORT_PRE_RUNOUT_OFFSET_DAYS = 1`, `SHIPMENT_WAIT_LIMIT_DAYS = 5`

**참고(요일):** 2026-09-27은 일요일, 2026-10-05는 월요일, 2026-10-11은 일요일, 2026-11-01은 일요일이다. 아래 테스트의 기대값은 이 요일에서 나온다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/schedule.test.js` 맨 위 import 목록에 `preRunoutOffsetFor`와 `isShipmentOverdue`를 더하고, 파일 끝에 아래를 붙인다.

```js
test('7일 이하 처방은 소진 1일 전, 8일 이상은 소진 3일 전', () => {
  assert.equal(preRunoutOffsetFor(7), 1);
  assert.equal(preRunoutOffsetFor(10), 3);
  assert.equal(preRunoutOffsetFor(30), 3);
});

test('7일분은 발송 엿새째에 걸고, 목·일이면 당긴다', () => {
  // 2026-10-05(월) 발송 → 소진 10-12(월) → 1일 전 10-11(일) → 토요일로 당김
  const plan = planCalls('2026-10-05', 7);
  assert.equal(plan.runoutOn, '2026-10-12');
  assert.deepEqual(plan.calls, [{ kind: 'pre_runout', dueOn: '2026-10-10' }]);
});

test('10일분은 소진 3일 전 그대로, 중간 콜은 없다', () => {
  const plan = planCalls('2026-10-05', 10);
  assert.equal(plan.runoutOn, '2026-10-15');
  assert.deepEqual(plan.calls, [{ kind: 'pre_runout', dueOn: '2026-10-12' }]);
});

test('30일분은 발송일 기준으로 중간 콜과 소진 전 콜을 잡는다', () => {
  // 발송 10-05(월) → 소진 11-04(수), 중간 10-20(화), 소진 전 11-01(일) → 10-31(토)
  const plan = planCalls('2026-10-05', 30);
  assert.equal(plan.runoutOn, '2026-11-04');
  assert.deepEqual(plan.calls, [
    { kind: 'mid', dueOn: '2026-10-20' },
    { kind: 'pre_runout', dueOn: '2026-10-31' },
  ]);
});

test('발송일이 처방일보다 늦어도 콜은 발송일 기준으로 잡힌다', () => {
  const plan = planCalls('2026-10-08', 7); // 목요일 발송 → 소진 10-15(목) → 1일 전 10-14(수)
  assert.equal(plan.runoutOn, '2026-10-15');
  assert.deepEqual(plan.calls, [{ kind: 'pre_runout', dueOn: '2026-10-14' }]);
});

test('처방 후 닷새가 지나도록 발송일이 없으면 확인 대상', () => {
  assert.equal(isShipmentOverdue('2026-09-22', '2026-09-27'), true);
  assert.equal(isShipmentOverdue('2026-09-23', '2026-09-27'), false);
  assert.equal(isShipmentOverdue('2026-09-27', '2026-09-27'), false);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL. `preRunoutOffsetFor is not a function` 또는 import 오류.

- [ ] **Step 3: `js/schedule.js` 고치기**

상수 줄을 아래로 바꾼다.

```js
export const MID_CALL_SKIP_MAX_DAYS = 15; // 투약 일수가 이 값 이하면 중간 콜 없음
export const PRE_RUNOUT_OFFSET_DAYS = 3;  // 소진 3일 전
export const SHORT_RX_MAX_DAYS = 7;       // 이 일수 이하는 짧은 처방으로 본다
export const SHORT_PRE_RUNOUT_OFFSET_DAYS = 1; // 짧은 처방은 소진 1일 전
export const SHIPMENT_WAIT_LIMIT_DAYS = 5; // 처방 후 이 날수가 지나면 발송일 확인 대상
export const MAX_NO_ANSWER = 3;           // 부재 3회째에 마감
export const NO_CALL_ISO_DAYS = [4, 7];   // 목요일, 일요일
```

`runoutOn`, `notBeforePrescription`, `planCalls` 세 함수를 아래로 바꾼다.

```js
// 복용은 약을 받은 날부터 시작한다. 모든 계산의 기준은 발송일이다.
export function runoutOn(shippedOn, days) {
  return addDays(shippedOn, days);
}

export function preRunoutOffsetFor(days) {
  return days <= SHORT_RX_MAX_DAYS ? SHORT_PRE_RUNOUT_OFFSET_DAYS : PRE_RUNOUT_OFFSET_DAYS;
}

// 짧은 처방에서 콜이 발송일보다 앞서지 않게 한다.
function notBeforeShipment(dueOn, shippedOn) {
  if (dueOn >= shippedOn) return dueOn;
  return isCallDay(shippedOn) ? shippedOn : nextCallDayAfter(shippedOn);
}

export function planCalls(shippedOn, days) {
  const runout = runoutOn(shippedOn, days);
  const calls = [];
  if (days > MID_CALL_SKIP_MAX_DAYS) {
    const mid = pullBackToCallDay(addDays(shippedOn, Math.floor(days / 2)));
    calls.push({ kind: 'mid', dueOn: notBeforeShipment(mid, shippedOn) });
  }
  const pre = pullBackToCallDay(addDays(runout, -preRunoutOffsetFor(days)));
  calls.push({ kind: 'pre_runout', dueOn: notBeforeShipment(pre, shippedOn) });
  return { runoutOn: runout, calls };
}

// 약이 나가지 않은 채로 오래 남은 처방을 찾는다. 보통 이틀, 길어도 나흘이면 나간다.
export function isShipmentOverdue(prescribedOn, today) {
  return daysBetween(prescribedOn, today) >= SHIPMENT_WAIT_LIMIT_DAYS;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, 실패 0. 기존 테스트 중 `planCalls`를 처방일로 부르던 것들은 인자 이름만 바뀌었을 뿐 값이 같으므로 그대로 통과한다.

- [ ] **Step 5: 커밋**

```bash
git add js/schedule.js tests/schedule.test.js
git commit -F - <<'MSG'
feat: 콜 날짜를 약 발송일 기준으로 계산

소진일과 중간 콜을 발송일에서 센다. 7일 이하 처방은 소진 1일 전에 걸고,
처방 후 닷새가 지나도록 발송일이 없으면 확인 대상으로 표시할 수 있게 한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: 7일 버튼과 발송 대기 목록 고르기

**Files:**
- Modify: `js/texts.js`, `tests/texts.test.js`, `js/model.js`, `tests/model.test.js`

**Interfaces:**
- Consumes: Task 3의 `isShipmentOverdue`
- Produces:
  - `DAYS_PRESETS = [30, 15, 10, 7]`
  - `model.toPatient` 결과의 처방에 `shippedOn` 추가(없으면 `null`)
  - `awaitingShipment(patients, today): [{ patient, prescription, overdue }]` — 발송일이 없는 진행 중 처방을 처방일 오름차순으로

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/texts.test.js`의 해당 테스트를 아래로 바꾼다.

```js
test('처방 일수 버튼은 30, 15, 10, 7', () => {
  assert.deepEqual(DAYS_PRESETS, [30, 15, 10, 7]);
});
```

`tests/model.test.js` 맨 위 import 목록에 `awaitingShipment`를 더하고, 파일 끝에 아래를 붙인다.

```js
test('발송 대기 목록은 발송일이 없는 진행 중 처방만, 오래된 것부터', () => {
  const patients = [
    {
      id: 'p1', name: '가환자', phone: '01011110001', condition: 'cough', conditionLabel: '',
      prescriptions: [
        { id: 'r1', prescribedOn: '2026-09-20', shippedOn: null, days: 30, runoutOn: null, status: 'active', calls: [] },
        { id: 'r2', prescribedOn: '2026-09-26', shippedOn: '2026-09-26', days: 30, runoutOn: '2026-10-26', status: 'active', calls: [] },
      ],
    },
    {
      id: 'p2', name: '나환자', phone: '01011110002', condition: 'cough', conditionLabel: '',
      prescriptions: [
        { id: 'r3', prescribedOn: '2026-09-25', shippedOn: null, days: 7, runoutOn: null, status: 'active', calls: [] },
        { id: 'r4', prescribedOn: '2026-09-01', shippedOn: null, days: 7, runoutOn: null, status: 'closed', calls: [] },
      ],
    },
  ];
  const rows = awaitingShipment(patients, '2026-09-27');
  assert.deepEqual(rows.map((v) => v.prescription.id), ['r1', 'r3']);
  assert.equal(rows[0].overdue, true);  // 9월 20일 처방, 7일 지남
  assert.equal(rows[1].overdue, false); // 9월 25일 처방, 2일 지남
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL 2건. `DAYS_PRESETS` 비교 실패와 `awaitingShipment is not a function`.

- [ ] **Step 3: `js/texts.js` 고치기**

```js
export const DAYS_PRESETS = [30, 15, 10, 7];
```

- [ ] **Step 4: `js/model.js` 고치기**

맨 위 import 줄을 아래로 바꾼다.

```js
import { isOnTodayList, addDays, isShipmentOverdue } from './schedule.js';
```

`toPrescription`의 반환에 `shippedOn`을 더한다.

```js
function toPrescription(r, patientId) {
  return {
    id: r.id,
    patientId,
    prescribedOn: r.prescribed_on,
    shippedOn: r.shipped_on ?? null,
    days: r.days,
    runoutOn: r.runout_on,
    status: r.status,
    closedReason: r.closed_reason,
    calls: (r.calls ?? []).map((c) => toCall(c, r.id)),
  };
}
```

`activePrescriptionCount` 아래에 덧붙인다.

```js
// 약이 아직 나가지 않아 콜이 잡히지 않은 처방. 여기를 비워두면 그 환자는 해피콜에서 사라진다.
export function awaitingShipment(patients, today) {
  const rows = [];
  for (const patient of patients) {
    for (const prescription of patient.prescriptions) {
      if (prescription.status !== 'active' || prescription.shippedOn) continue;
      rows.push({ patient, prescription, overdue: isShipmentOverdue(prescription.prescribedOn, today) });
    }
  }
  return rows.sort((a, b) => (a.prescription.prescribedOn < b.prescription.prescribedOn ? -1 : 1));
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, 실패 0.

- [ ] **Step 6: 커밋**

```bash
git add js/texts.js tests/texts.test.js js/model.js tests/model.test.js
git commit -F - <<'MSG'
feat: 처방 일수 7일 버튼과 발송 대기 목록

발송일이 없는 진행 중 처방을 따로 모으고, 처방 후 닷새가 지난 건은 표시한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: 저장 통로에 발송일 붙이기

**Files:**
- Modify: `js/store.js`

**Interfaces:**
- Consumes: Task 2의 두 함수
- Produces:
  - `store.registerPrescription({ phone, name, condition, conditionLabel, prescribedOn, shippedOn, days, runoutOn, calls })` — `shippedOn`이 없으면 `null`, `runoutOn`도 `null`, `calls`는 빈 배열
  - `store.setShippedOn(prescriptionId, { shippedOn, runoutOn, calls })`
  - `store.isConflictError(err)` — 발송일 중복 입력 오류도 충돌로 본다

- [ ] **Step 1: `registerPrescription` 고치기**

```js
export async function registerPrescription({ phone, name, condition, conditionLabel, prescribedOn, shippedOn, days, runoutOn, calls }) {
  const { data, error } = await supabase.rpc('register_prescription', {
    p_phone: phone,
    p_name: name,
    p_condition: condition,
    p_condition_label: conditionLabel ?? '',
    p_prescribed_on: prescribedOn,
    p_shipped_on: shippedOn ?? null,
    p_days: days,
    p_runout_on: runoutOn ?? null,
    p_calls: calls ?? [],
  });
  check(error);
  return data;
}

export async function setShippedOn(prescriptionId, { shippedOn, runoutOn, calls }) {
  const { error } = await supabase.rpc('set_shipped_on', {
    p_prescription_id: prescriptionId,
    p_shipped_on: shippedOn,
    p_runout_on: runoutOn,
    p_calls: calls ?? [],
  });
  check(error);
}
```

- [ ] **Step 2: `isConflictError` 고치기**

```js
// 다른 직원이 먼저 처리했을 때 나는 오류인지 구분한다.
const CONFLICT_MESSAGES = ['콜 상태가 바뀌었습니다', '발송일이 이미 입력됐습니다'];

export function isConflictError(err) {
  return Boolean(err && typeof err.message === 'string'
    && CONFLICT_MESSAGES.some((m) => err.message.includes(m)));
}
```

- [ ] **Step 3: 확인**

- Run: `node --check js/store.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0
- Run: `grep -n "p_shipped_on\|set_shipped_on" js/store.js` → Expected: 세 줄 이상 나온다

- [ ] **Step 4: 커밋**

```bash
git add js/store.js
git commit -F - <<'MSG'
feat: 발송일을 저장하고 나중에 채우는 통로 추가

등록할 때 발송일을 함께 보내고, 발송 대기 처방에 나중에 발송일을 넣을 수 있게 한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: 처방 등록 창에 발송일 넣기

**Files:**
- Modify: `js/ui.js`

**Interfaces:**
- Consumes: Task 3의 `planCalls(shippedOn, days)`, Task 5의 `store.registerPrescription`
- Produces: 등록 창에서 발송일을 받고, 모르면 "아직 모름"으로 저장한다

- [ ] **Step 1: 등록 창에 칸 더하기**

`openRegisterModal` 안의 처방일·처방 일수 줄을 아래로 바꾼다.

```html
    <div class="field-row">
      <div class="field"><label>처방일</label><input type="date" id="rg-date" value="${today}"></div>
      <div class="field">
        <label>처방 일수 *</label>
        ${pillGroup('rg-days-presets', DAYS_PRESETS.map((d) => [d, `${d}일`]), 30)}
        <input type="number" id="rg-days" min="1" max="90" value="30">
      </div>
    </div>
    <div class="field">
      <label>약 발송일</label>
      <input type="date" id="rg-ship" value="${today}">
      <label class="checkbox-row"><input type="checkbox" id="rg-ship-unknown"> 아직 모름 (발송 대기로 두기)</label>
      <span class="field-hint">콜 날짜는 발송일부터 셉니다.</span>
    </div>
```

- [ ] **Step 2: 미리보기와 읽기 함수 고치기**

`readPlan`과 `updatePreview`를 아래로 바꾼다.

```js
  const readPlan = () => {
    const days = Number($('rg-days').value);
    const date = $('rg-date').value;
    if (!date || !isValidDays(days)) return null;
    if ($('rg-ship-unknown').checked) return { date, days, shippedOn: null, plan: null };
    const shippedOn = $('rg-ship').value;
    if (!shippedOn) return null;
    return { date, days, shippedOn, plan: planCalls(shippedOn, days) };
  };

  const updatePreview = () => {
    const read = readPlan();
    if (!read) {
      $('rg-preview').innerHTML = '<div class="preview-box warn">처방일과 발송일을 넣고, 처방 일수는 1~90일로 넣어주세요.</div>';
      return;
    }
    if (!read.plan) {
      $('rg-preview').innerHTML = '<div class="preview-box warn">발송 대기로 저장돼요. 발송일을 넣는 날 콜이 잡혀요.</div>';
      return;
    }
    const lines = read.plan.calls.map((c) => `${KIND_LABELS[c.kind]} ${formatKoreanDate(c.dueOn)}`).join(', ');
    let html = `<div class="preview-box">소진일 ${formatKoreanDate(read.plan.runoutOn)} · ${lines}</div>`;
    if (hasPastCall(read.plan.calls, today)) {
      html += '<div class="preview-box warn">이미 지난 콜 날짜가 있어요. 저장하면 바로 지연으로 떠요.</div>';
    }
    $('rg-preview').innerHTML = html;
  };
```

- [ ] **Step 3: 새 칸에 반응하게 하기**

`$('rg-date').addEventListener('input', updatePreview);` 줄 아래에 덧붙인다.

```js
  $('rg-ship').addEventListener('input', updatePreview);
  $('rg-ship-unknown').addEventListener('change', () => {
    $('rg-ship').disabled = $('rg-ship-unknown').checked;
    updatePreview();
  });
```

- [ ] **Step 4: 저장 호출 고치기**

`rg-submit` 처리의 저장 호출을 아래로 바꾼다.

```js
    if (!read) { toast('처방일·발송일과 처방 일수(1~90일)를 확인해주세요.'); return; }
    const ok = await run(() => store.registerPrescription({
      phone,
      name: form.existing ? form.existing.name : name,
      condition: form.condition,
      conditionLabel: form.condition === 'other' ? $('rg-other').value.trim() : '',
      prescribedOn: read.date,
      shippedOn: read.shippedOn,
      days: read.days,
      runoutOn: read.plan ? read.plan.runoutOn : null,
      calls: read.plan ? read.plan.calls : [],
    }), read.plan
      ? (form.existing ? '기존 환자에 처방을 추가했어요.' : '등록했어요.')
      : '발송 대기로 저장했어요. 발송일을 넣으면 콜이 잡혀요.');
```

- [ ] **Step 5: 확인**

- Run: `node --check js/ui.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0

- [ ] **Step 6: 커밋**

```bash
git add js/ui.js
git commit -F - <<'MSG'
feat: 처방 등록 창에서 약 발송일 받기

발송일을 넣으면 그 날짜부터 콜을 계산하고, 모르면 발송 대기로 저장한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 7: 발송 대기 탭과 발송일 입력 창

**Files:**
- Modify: `index.html`, `js/ui.js`, `css/app.css`

**Interfaces:**
- Consumes: Task 4의 `awaitingShipment`, Task 5의 `store.setShippedOn`
- Produces: 탭 `발송 대기`(숫자 배지 포함), 처방 카드의 "발송일 입력" 버튼과 입력 창, 환자 상세의 발송일 표시

- [ ] **Step 1: `index.html`에 탭과 칸 더하기**

탭 줄에서 `오늘 콜` 버튼 아래에 덧붙인다.

```html
    <button class="tab-btn" data-tab="shipment">발송 대기 <span class="count" id="tab-count-shipment">0</span></button>
```

패널 줄에서 `panel-today` 아래에 덧붙인다.

```html
  <div class="panel" id="panel-shipment" hidden></div>
```

- [ ] **Step 2: `css/app.css`에 표시 색 더하기**

파일 끝에 덧붙인다.

```css
.badge-waiting{background:var(--warn-soft); color:var(--warn);}
.badge-late-ship{background:var(--danger-soft); color:var(--danger);}
```

- [ ] **Step 3: `js/ui.js`에서 탭 등록하기**

import 목록과 `TABS`를 고친다.

```js
import {
  todayCalls, upcomingCalls, escalationCalls, visitCalls, activePrescriptionCount, preRunoutCall, awaitingShipment,
} from './model.js';
```

```js
const TABS = ['escalation', 'today', 'shipment', 'visit', 'all', 'scripts'];
```

`render()`를 아래로 바꾼다.

```js
export function render() {
  const today = todayYMD();
  const escalations = escalationCalls(state.patients);
  const todays = todayCalls(state.patients, today);
  const visits = visitCalls(state.patients);
  const shipments = awaitingShipment(state.patients, today);

  $('stat-escalation').textContent = escalations.length;
  $('stat-today').textContent = todays.length;
  $('stat-visit').textContent = visits.length;
  $('stat-active').textContent = activePrescriptionCount(state.patients);
  $('tab-count-escalation').textContent = escalations.length;
  $('tab-count-today').textContent = todays.length;
  $('tab-count-shipment').textContent = shipments.length;
  $('tab-count-visit').textContent = visits.length;
  $('tab-count-all').textContent = state.patients.length;

  TABS.forEach((t) => { $(`panel-${t}`).hidden = t !== state.tab; });
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));

  if (state.tab === 'escalation') renderEscalation(escalations);
  if (state.tab === 'today') renderToday(todays, today);
  if (state.tab === 'shipment') renderShipment(shipments, today);
  if (state.tab === 'visit') renderVisit(visits);
  if (state.tab === 'all') renderAll();
  if (state.tab === 'scripts') renderScripts();
}
```

- [ ] **Step 4: 발송 대기 목록 그리기**

`renderVisit` 함수 앞에 덧붙인다.

```js
function renderShipment(rows, today) {
  if (rows.length === 0) {
    $('panel-shipment').innerHTML = '<div class="empty">발송일을 기다리는 처방이 없어요.</div>';
    return;
  }
  $('panel-shipment').innerHTML = rows.map(({ patient, prescription, overdue }) => {
    const waited = overdueDays(prescription.prescribedOn, today);
    const late = overdue
      ? `<span class="badge badge-late-ship">${waited}일째 발송일 없음</span>`
      : `<span class="badge badge-waiting">발송 대기 ${waited}일째</span>`;
    return `
      <div class="case-card">
        <div class="case-top">
          <div class="case-id">
            <div class="case-name">${esc(patient.name)}</div>
            <div class="case-meta-row">${conditionBadge(patient)}${late}</div>
            <div class="case-phone mono">${esc(formatPhone(patient.phone))}</div>
          </div>
          <div class="case-due">
            <div>처방일</div>
            <div class="d">${formatKoreanDate(prescription.prescribedOn)}</div>
            <div>${prescription.days}일분</div>
          </div>
        </div>
        <div class="case-actions">
          <button class="btn btn-primary btn-sm" data-action="ship" data-id="${prescription.id}">📦 발송일 입력</button>
          <button class="btn btn-ghost btn-sm" data-action="detail" data-patient="${patient.id}">상세 · 이력</button>
        </div>
      </div>`;
  }).join('');
}
```

- [ ] **Step 5: 발송일 입력 창 만들기**

`openSmsModal` 함수 앞에 덧붙인다.

```js
function openShipModal(row) {
  const { patient, prescription } = row;
  const today = todayYMD();
  openModal(`
    <div class="modal-head">
      <div><h2>발송일 입력 · ${esc(patient.name)}</h2>
        <div class="sub">${formatKoreanDate(prescription.prescribedOn)} 처방 · ${prescription.days}일분</div></div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    <div class="field">
      <label>약을 보낸 날</label>
      <input type="date" id="sp-date" value="${today}">
      <span class="field-hint">이 날짜부터 콜 날짜를 셉니다.</span>
    </div>
    <div id="sp-preview"></div>
    <div class="modal-footer">
      <button class="btn" data-action="close">취소</button>
      <button class="btn btn-primary" id="sp-submit">저장</button>
    </div>`);

  const readShip = () => {
    const shippedOn = $('sp-date').value;
    if (!shippedOn) return null;
    return { shippedOn, plan: planCalls(shippedOn, prescription.days) };
  };

  const updatePreview = () => {
    const read = readShip();
    if (!read) {
      $('sp-preview').innerHTML = '<div class="preview-box warn">발송일을 넣어주세요.</div>';
      return;
    }
    const lines = read.plan.calls.map((c) => `${KIND_LABELS[c.kind]} ${formatKoreanDate(c.dueOn)}`).join(', ');
    let html = `<div class="preview-box">소진일 ${formatKoreanDate(read.plan.runoutOn)} · ${lines}</div>`;
    if (hasPastCall(read.plan.calls, today)) {
      html += '<div class="preview-box warn">이미 지난 콜 날짜가 있어요. 저장하면 바로 지연으로 떠요.</div>';
    }
    $('sp-preview').innerHTML = html;
  };

  $('sp-date').addEventListener('input', updatePreview);
  updatePreview();

  $('sp-submit').addEventListener('click', async () => {
    const read = readShip();
    if (!read) { toast('발송일을 넣어주세요.'); return; }
    const ok = await run(() => store.setShippedOn(prescription.id, {
      shippedOn: read.shippedOn,
      runoutOn: read.plan.runoutOn,
      calls: read.plan.calls,
    }), '발송일을 넣었어요. 콜이 잡혔어요.');
    if (ok) closeModal();
  });
}
```

- [ ] **Step 6: 버튼 연결하기**

`onAppClick`의 동작 분기(`data-action`을 보고 창을 여는 부분)에서 `sms` 분기 옆에 덧붙인다.

```js
  if (action === 'ship') {
    const today = todayYMD();
    const row = awaitingShipment(state.patients, today).find((v) => v.prescription.id === btn.dataset.id);
    if (row) openShipModal(row);
    return;
  }
```

- [ ] **Step 7: 환자 상세에 발송일 보이기**

상세 창의 처방 줄(`${formatKoreanDate(rx.prescribedOn)} 처방 · ${rx.days}일`이 들어 있는 줄)을 아래로 바꾼다.

```js
          <strong>${formatKoreanDate(rx.prescribedOn)} 처방 · ${rx.days}일</strong>
          <span>${rx.shippedOn
            ? `발송 ${formatKoreanDate(rx.shippedOn)} · 소진 ${formatKoreanDate(rx.runoutOn)}`
            : '발송 대기'} · ${rxStatus}</span>
```

- [ ] **Step 8: 확인**

- Run: `node --check js/ui.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0
- Run: `grep -n "panel-shipment\|tab-count-shipment" index.html js/ui.js` → Expected: 각각 두 곳 이상

- [ ] **Step 9: 커밋**

```bash
git add index.html js/ui.js css/app.css
git commit -F - <<'MSG'
feat: 발송 대기 탭과 발송일 입력 창

약이 아직 나가지 않은 처방을 모아 보여주고, 그 자리에서 발송일을 넣으면
콜이 잡힌다. 처방 후 닷새가 지난 건은 빨갛게 표시한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 8: 화면 확인과 문서 정리

**Files:**
- Modify: `CLAUDE.md`, `README.md`
- Test: 로컬 서버(`npm run serve`)와 브라우저, MCP `execute_sql`

**Interfaces:**
- Consumes: Task 1~7 전부

- [ ] **Step 1: 발송일을 아는 처방 등록해 보기**

로컬 서버를 켜고 로그인한 화면에서 "+ 처방 등록"을 연다. 전화번호 `01099991001`, 이름 `시험가`, 증상 기침, 처방 일수 **7일**, 발송일 오늘로 등록한다.

Expected: 미리보기에 소진일과 `소진 전 콜` 한 건만 뜬다(중간 콜 없음). 소진 전 콜 날짜는 발송일 + 6일이고, 그날이 목·일이면 하루씩 당겨진다. 저장 후 오늘 콜 또는 다가오는 콜에 보인다.

- [ ] **Step 2: 발송일을 모르는 처방 등록해 보기**

같은 창에서 전화번호 `01099991002`, 이름 `시험나`, 30일분, **"아직 모름"** 체크 후 등록한다.

Expected: "발송 대기로 저장했어요." 안내가 뜨고, **발송 대기** 탭 숫자가 1 늘어난다. 그 탭에 `시험나` 카드가 보이고 `발송 대기 0일째`로 표시된다.

- [ ] **Step 3: 발송일을 나중에 넣어 보기**

발송 대기 탭에서 `시험나`의 "📦 발송일 입력"을 누르고 오늘 날짜로 저장한다.

Expected: 미리보기에 중간 콜과 소진 전 콜 두 건이 뜨고, 저장하면 발송 대기 목록에서 사라진다. 환자 상세를 열면 `발송 …· 소진 …`이 보인다.

MCP로 확인한다.

```sql
select p.name, r.prescribed_on, r.shipped_on, r.days, r.runout_on,
       (select count(*) from calls c where c.prescription_id = r.id) as 콜건수
from prescriptions r join patients p on p.id = r.patient_id
where p.phone in ('01099991001', '01099991002') order by p.name;
```

Expected: `시험가`는 콜 1건, `시험나`는 콜 2건. 둘 다 `runout_on = shipped_on + days`.

- [ ] **Step 4: 오래된 발송 대기가 빨갛게 뜨는지**

```sql
update public.prescriptions set prescribed_on = current_date - 6
where patient_id = (select id from public.patients where phone = '01099991002');
update public.prescriptions set shipped_on = null, runout_on = null
where patient_id = (select id from public.patients where phone = '01099991002');
delete from public.calls
where prescription_id in (select id from prescriptions where patient_id = (select id from patients where phone = '01099991002'));
```

화면을 새로고침한다.
Expected: 발송 대기 탭에 `시험나`가 다시 뜨고 `6일째 발송일 없음`이 **빨간 배지**로 보인다.

- [ ] **Step 5: 두 번 저장이 막히는지**

발송 대기 탭에서 `시험나`의 발송일 입력 창을 연 채로, MCP로 먼저 발송일을 넣는다.

```sql
update public.prescriptions set shipped_on = current_date, runout_on = current_date + 30
where patient_id = (select id from public.patients where phone = '01099991002');
```

그다음 화면에서 "저장"을 누른다.
Expected: "다른 직원이 먼저 처리했어요. 최신 내용으로 다시 불러옵니다." 안내가 뜨고 목록이 새로 고쳐진다.

- [ ] **Step 6: 시험 데이터 지우기**

```sql
delete from public.patients where phone in ('01099991001', '01099991002');
select (select count(*) from public.patients) as 환자, (select count(*) from public.calls) as 콜;
```

Expected: `환자 = 3`, `콜 = 5`

- [ ] **Step 7: `CLAUDE.md` 고치기**

"## 해피콜 운영 규칙" 절의 앞 세 줄을 아래로 바꾼다.

```markdown
- 소진일 = **약 발송일 + 투약일수**. 발송일이 없으면 소진일도 콜도 없고, 처방은 '발송 대기'로 남는다.
- 처방 후 5일이 지나도록 발송일이 없으면 발송 대기 탭에서 빨갛게 표시한다. 보통 이틀, 길면 나흘이면 약이 나간다.
- 중간 콜 = 발송일 + 투약일수의 절반. 투약일수 15일 이하면 만들지 않는다.
- 소진 전 콜 = 7일 이하 처방은 소진 1일 전, 8일 이상은 소진 3일 전.
```

"## V2에서 할 일" 절의 2번 줄에서 이번에 끝낸 부분을 표시한다.

```markdown
2. **기준 변경**: ~~약 발송일 기준, 발송 대기 상태, 7일분 추가~~ (2026-09-27 완료), 가족 환자 등록(같은 번호에 관계 표시)
```

- [ ] **Step 8: `README.md` 고치기**

"## 데이터베이스" 절의 목록 끝에 덧붙인다.

```markdown
- 처방에는 처방일과 약 발송일이 따로 있습니다. 콜 날짜는 발송일 기준이고, 발송일이 비어 있으면 '발송 대기'입니다
```

- [ ] **Step 9: 커밋**

```bash
git add CLAUDE.md README.md
git commit -F - <<'MSG'
docs: 발송일 기준 규칙을 문서에 반영

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 10: 올릴지 묻기**

`feat/v1`에 올리면 곧바로 실제 배포다. 올리기 전에 `npm test` 통과, 비밀 값이 들어가지 않았는지(`git grep -nEi "(password|비밀번호)\s*[:=]"`), 예시 데이터만 남았는지 확인하고 **사용자에게 물어본 뒤에만** push한다. 올린 뒤 배포 주소에서 등록 창에 발송일 칸이 보이는지 확인한다.

---

## 이 계획에서 하지 않는 것

- 처방의 발송일·투약일수를 **나중에 고치는 기능**(기획안 3장). 2단계에서 한 달 달력과 함께 다룬다.
- 이미 만들어진 콜의 날짜를 달력에서 바꾸는 기능(기획안 3·4장).
- 가족 환자 등록(기획안 5장), 통계(7장), 연락 안 됨 목록(8장), 재발 확인 콜(9장).
- 옛 처방의 `shipped_on`을 실제 발송일로 고치는 일. 기존 행은 처방일을 발송일로 본다.
