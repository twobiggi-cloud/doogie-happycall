# V2 5단계: 연락 안 되는 환자 관리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax로 추적한다.

**Goal:** 부재로 마감돼 목록에서 사라진 환자를 **"연락 안 됨" 탭**에 모아 보고, 거기서 **재시도 콜**을 만들 수 있게 한다. 두 번 이상 못 닿은 환자에게는 **"다음 내원 시 확인"** 표시를 붙인다.

**Architecture:** 목록은 이미 불러온 콜에서 계산한다(추가 조회 없음). 마지막으로 통화가 된 날보다 뒤에 있는 미연결 콜만 모으므로, 나중에 통화가 되면 목록에서 저절로 빠진다. 재시도 콜은 `kind = 'retry'`인 새 콜이고, 한 처방에 여러 번 만들 수 있다. 만들 때 이유를 받아 `change_logs`에 남긴다.

**Tech Stack:** 정적 HTML + ES 모듈(빌드 없음), Supabase Postgres + RLS, Node 24 `node:test`, Vercel 배포(`feat/v1` = production)

**Spec:** `docs/superpowers/specs/2026-09-26-happycall-v2-design.md` 8장 (연락이 안 되는 환자 관리)

## Global Constraints

- "연락 안 됨"은 **문자 대기(`sms_pending`)** 또는 **부재 마감(`closed_no_answer`)** 상태의 콜이다. 그 환자에게 그 뒤로 통화가 된 콜이 있으면 목록에서 뺀다.
- 목록은 **최근 60일** 안의 미연결만 본다. 그보다 오래된 것은 지나간 일로 본다.
- 미연결이 **2건 이상**이면 `다음 내원 시 확인` 표시를 붙인다.
- 재시도 콜은 **마감된 처방에도 만들 수 있다.** 부재로 문자 마감하면 처방이 닫히기 때문이다.
- 재시도 콜은 한 처방에 여러 번 만들 수 있다. 다만 **대기 중인 재시도 콜이 있으면 새로 만들지 않는다.**
- 재시도 콜의 부재 처리는 3회까지 미루고 그다음에 문자로 마감한다. 소진일이 지났다고 바로 마감하지 않는다(이미 지난 뒤에 거는 콜이다).
- 재시도 콜에서 통화가 되면 다른 콜과 같이 처리하고, 처방이 아직 진행 중이면 마감한다.
- 콜 날짜는 목요일과 일요일로 잡을 수 없다.
- 실제 환자 정보는 코드·문서·커밋·캡처에 넣지 않는다. 예시 환자로만 시험한다.
- 데이터베이스 변경은 `supabase/migrations`에 번호 순서로 남기고, 적용 후 `get_advisors`(security)를 돌린다. 시험용 행은 반드시 지운다.
- SQL 시험은 허용 계정 / 허용되지 않은 계정 / 로그인 안 함 세 경우를 확인한다. 허용 계정 컨텍스트:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"doogieclinic@naver.com"}', true);
```

- `feat/v1`에 push하면 곧바로 실제 배포다. **push 전에 사용자에게 묻는다.**

---

### Task 1: 재시도 콜 종류 허용

**Files:**
- Create: `supabase/migrations/013_retry_call.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Produces: `calls.kind`에 `'retry'` 허용, `(prescription_id, kind)` 유일 제약을 **중간 콜과 소진 전 콜에만** 적용하는 부분 색인으로 교체

- [ ] **Step 1: 실패하는 시험 실행**

허용 계정 앞부분 + 아래. `<처방id>`는 아래 SQL로 고른다.

```sql
insert into public.calls (prescription_id, kind, due_on)
select r.id, 'retry', date '2026-09-30' from prescriptions r
join patients p on p.id = r.patient_id where p.name = '예시나' limit 1;
```

Expected: ERROR `23514` (`calls_kind_check` 위반). 지금은 `mid`와 `pre_runout`만 된다.

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/013_retry_call.sql`:

```sql
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
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — name `retry_call`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 재시도 콜이 여러 건 들어가는지**

허용 계정 앞부분 + 아래.

```sql
insert into public.calls (prescription_id, kind, due_on)
select r.id, 'retry', date '2026-09-30' from prescriptions r
join patients p on p.id = r.patient_id where p.name = '예시나' limit 1;

insert into public.calls (prescription_id, kind, due_on)
select r.id, 'retry', date '2026-10-02' from prescriptions r
join patients p on p.id = r.patient_id where p.name = '예시나' limit 1;

select c.kind, c.due_on from calls c
join prescriptions r on r.id = c.prescription_id
join patients p on p.id = r.patient_id
where p.name = '예시나' order by c.kind, c.due_on;
```

Expected: `retry` 두 건이 들어간다.

- [ ] **Step 5: 중간 콜·소진 전 콜은 여전히 한 건만인지**

```sql
insert into public.calls (prescription_id, kind, due_on)
select r.id, 'pre_runout', date '2026-10-05' from prescriptions r
join patients p on p.id = r.patient_id where p.name = '예시나' limit 1;
```

Expected: ERROR `23505` (`calls_one_per_kind_idx` 위반)

- [ ] **Step 6: 정리와 보안 점검**

```sql
delete from public.calls where kind = 'retry';
select count(*) as 콜 from public.calls;
```

Expected: `콜 = 5`

MCP `get_advisors` type `security` → 새 WARN 없음.

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations/013_retry_call.sql
git commit -F - <<'MSG'
feat: 재시도 콜 종류 허용

연락이 안 된 환자에게 다시 걸 콜을 한 처방에 여러 번 만들 수 있게 한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: 재시도 콜을 만드는 함수

**Files:**
- Create: `supabase/migrations/014_retry_call_rpc.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Consumes: Task 1의 `retry` 종류
- Produces: `public.create_retry_call(p_prescription_id uuid, p_due_on date, p_reason text) returns uuid` — 대기 중인 재시도 콜이 이미 있으면 `재시도 콜이 이미 있습니다` 예외. 이유가 비면 `바꾼 이유를 적어주세요` 예외. 만들면 `change_logs`에 남긴다.

- [ ] **Step 1: 실패하는 시험 실행**

```sql
select public.create_retry_call('00000000-0000-0000-0000-000000000000'::uuid, current_date, '시험');
```

Expected: ERROR `42883` (함수가 없다)

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/014_retry_call_rpc.sql`:

```sql
-- 연락이 안 된 처방에 다시 걸 콜을 만든다. 처방이 마감됐어도 만들 수 있다.
create function public.create_retry_call(
  p_prescription_id uuid,
  p_due_on date,
  p_reason text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_call_id uuid;
  v_staff text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '바꾼 이유를 적어주세요' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from calls
    where prescription_id = p_prescription_id and kind = 'retry' and status = 'pending'
  ) then
    raise exception '재시도 콜이 이미 있습니다' using errcode = 'P0001';
  end if;

  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  insert into calls (prescription_id, kind, due_on)
  values (p_prescription_id, 'retry', p_due_on)
  returning id into v_call_id;

  insert into change_logs (target_type, target_id, summary, reason, staff_name)
  values ('call', v_call_id, format('재시도 콜 만듦 %s', p_due_on), btrim(p_reason), v_staff);

  return v_call_id;
end;
$$;

revoke all on function public.create_retry_call(uuid, date, text) from public, anon;
grant execute on function public.create_retry_call(uuid, date, text) to authenticated;
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — name `retry_call_rpc`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 마감된 처방에도 만들어지는지**

허용 계정 앞부분 + 아래. `예시나`의 처방은 이미 `closed` 상태다.

```sql
select public.create_retry_call(
  (select r.id from prescriptions r join patients p on p.id = r.patient_id where p.name = '예시나' limit 1),
  date '2026-09-30', '원장님 지시로 다시 연락') as call_id;
select c.kind, c.due_on, c.status from calls c
join prescriptions r on r.id = c.prescription_id
join patients p on p.id = r.patient_id where p.name = '예시나' order by c.kind;
select summary, reason, staff_name from change_logs order by changed_at desc limit 1;
```

Expected: `retry` 콜 1건이 `pending`으로 생기고, 기록에 `재시도 콜 만듦 2026-09-30`과 사유·담당자가 남는다.

- [ ] **Step 5: 두 번 만들면 막히는지**

```sql
select public.create_retry_call(
  (select r.id from prescriptions r join patients p on p.id = r.patient_id where p.name = '예시나' limit 1),
  date '2026-10-02', '두 번째');
```

Expected: ERROR `P0001: 재시도 콜이 이미 있습니다`

- [ ] **Step 6: 이유 없이 만들면 막히는지**

```sql
select public.create_retry_call(
  (select r.id from prescriptions r join patients p on p.id = r.patient_id where p.name = '예시다' limit 1),
  date '2026-10-02', '  ');
```

Expected: ERROR `P0001: 바꾼 이유를 적어주세요`

- [ ] **Step 7: 허용되지 않은 계정은 못 만드는지**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"stranger@example.com"}', true);
select public.create_retry_call(
  '00000000-0000-0000-0000-000000000000'::uuid, date '2026-10-02', '침입');
```

Expected: ERROR (행 수준 보안 때문에 콜을 넣지 못한다). 실제 메시지를 보고서에 적는다.

- [ ] **Step 8: 정리와 보안 점검**

```sql
delete from public.calls where kind = 'retry';
delete from public.change_logs;
select (select count(*) from public.calls) as 콜, (select count(*) from public.change_logs) as 기록;
```

Expected: `콜 = 5`, `기록 = 0`

MCP `get_advisors` type `security` → 새 WARN 없음.

- [ ] **Step 9: 커밋**

```bash
git add supabase/migrations/014_retry_call_rpc.sql
git commit -F - <<'MSG'
feat: 재시도 콜을 만드는 함수

마감된 처방에도 만들 수 있고, 대기 중인 재시도 콜이 있으면 막는다.
만든 이유는 변경 기록에 남는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: 재시도 콜의 처리 규칙

**Files:**
- Modify: `js/schedule.js`, `tests/schedule.test.js`, `js/texts.js`, `tests/texts.test.js`

**Interfaces:**
- Produces:
  - `KIND_LABELS.retry = '재시도 콜'`
  - `decideNoAnswer`가 재시도 콜에서는 소진일 기준 조기 마감을 하지 않는다(3회까지 미룬다)
  - `decideAnswered`가 재시도 콜에서도 진행 중인 처방을 마감한다

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/texts.test.js` 끝에 붙인다.

```js
test('콜 종류 이름에 재시도 콜이 있다', () => {
  assert.equal(KIND_LABELS.retry, '재시도 콜');
});
```

`tests/texts.test.js` import 목록에 `KIND_LABELS`를 더한다.

`tests/schedule.test.js` 끝에 붙인다.

```js
test('재시도 콜은 소진일이 지나도 바로 마감하지 않는다', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'retry', noAnswerCount: 0, dueOn: '2026-10-12' }, { today: '2026-10-12', runoutOn: '2026-09-30' }),
    { status: 'pending', dueOn: '2026-10-13', noAnswerCount: 1 },
  );
});

test('재시도 콜도 부재 3회면 문자로 마감한다', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'retry', noAnswerCount: 2, dueOn: '2026-10-12' }, { today: '2026-10-12', runoutOn: '2026-09-30' }),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 3 },
  );
});

test('재시도 콜에서 통화가 되면 진행 중인 처방을 마감한다', () => {
  const out = decideAnswered({ kind: 'retry' }, { result: 'improved', note: '', visitNeeded: false, closeEarly: false });
  assert.equal(out.closePrescription, 'completed');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL 2건 이상.

- [ ] **Step 3: `js/texts.js` 고치기**

```js
export const KIND_LABELS = { mid: '중간 콜', pre_runout: '소진 전 콜', retry: '재시도 콜' };
```

- [ ] **Step 4: `js/schedule.js` 고치기**

`decideNoAnswer`의 마지막 분기를 아래로 바꾼다.

```js
  // 재시도 콜은 소진일이 지난 뒤에 거는 콜이라 소진일 기준으로 앞당겨 마감하지 않는다.
  const pastRunout = call.kind === 'pre_runout' && next >= ctx.runoutOn;
  if (noAnswerCount >= MAX_NO_ANSWER || pastRunout) {
    return { status: 'sms_pending', dueOn: null, noAnswerCount };
  }
  return { status: 'pending', dueOn: next, noAnswerCount };
```

`decideAnswered`의 마감 판단을 아래로 바꾼다.

```js
  if (input.closeEarly) closePrescription = 'early';
  else if (call.kind === 'pre_runout' || call.kind === 'retry') closePrescription = 'completed';
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, 실패 0

- [ ] **Step 6: 커밋**

```bash
git add js/schedule.js tests/schedule.test.js js/texts.js tests/texts.test.js
git commit -F - <<'MSG'
feat: 재시도 콜의 부재와 통화 처리 규칙

재시도 콜은 소진일이 지난 뒤에 거는 콜이라 3회까지 미루고, 통화가 되면
진행 중인 처방을 마감한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: 연락 안 됨 목록 고르기

**Files:**
- Modify: `js/model.js`, `tests/model.test.js`

**Interfaces:**
- Produces: `unreachedRows(patients, today, windowDays = 60): [{ patient, prescription, call, lastTriedOn, noAnswerCount, smsSent, hasRetryPending, count, needsVisitCheck }]`
  - 마지막으로 통화가 된 날보다 뒤에 있는 미연결 콜만 모은다
  - 같은 환자의 미연결이 2건 이상이면 모든 줄에 `needsVisitCheck: true`
  - 최근 것부터 정렬

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/model.test.js` import에 `unreachedRows`를 더하고 끝에 붙인다.

```js
const rxWith = (id, calls) => ({
  id, prescribedOn: '2026-08-20', shippedOn: '2026-08-20', days: 30, runoutOn: '2026-09-19',
  status: 'closed', calls,
});

test('연락 안 됨은 마지막 통화 이후의 미연결만 모은다', () => {
  const patients = [
    {
      id: 'p1', name: '가환자', phone: '01011110001', relation: 'self', condition: 'cough', conditionLabel: '',
      prescriptions: [rxWith('r1', [
        { id: 'c1', kind: 'pre_runout', status: 'closed_no_answer', dueOn: null, doneAt: '2026-09-10T01:00:00Z', noAnswerCount: 3, attempts: [] },
        { id: 'c2', kind: 'retry', status: 'done', dueOn: '2026-09-15', doneAt: '2026-09-15T01:00:00Z', noAnswerCount: 0, attempts: [] },
      ])],
    },
    {
      id: 'p2', name: '나환자', phone: '01011110002', relation: 'self', condition: 'cough', conditionLabel: '',
      prescriptions: [rxWith('r2', [
        { id: 'c3', kind: 'pre_runout', status: 'sms_pending', dueOn: '2026-09-18', doneAt: null, noAnswerCount: 3, attempts: [{ attemptedAt: '2026-09-18T01:00:00Z', outcome: 'no_answer', note: '', staffName: '' }] },
      ])],
    },
  ];
  const rows = unreachedRows(patients, '2026-09-27');
  assert.deepEqual(rows.map((r) => r.call.id), ['c3']); // 가환자는 뒤에 통화가 됐으므로 빠진다
  assert.equal(rows[0].smsSent, false);
  assert.equal(rows[0].noAnswerCount, 3);
  assert.equal(rows[0].needsVisitCheck, false);
});

test('미연결이 두 건 이상이면 다음 내원 시 확인 표시', () => {
  const patients = [{
    id: 'p3', name: '다환자', phone: '01011110003', relation: 'self', condition: 'cough', conditionLabel: '',
    prescriptions: [
      rxWith('r3', [{ id: 'c4', kind: 'pre_runout', status: 'closed_no_answer', dueOn: null, doneAt: '2026-09-05T01:00:00Z', noAnswerCount: 3, attempts: [] }]),
      rxWith('r4', [{ id: 'c5', kind: 'pre_runout', status: 'closed_no_answer', dueOn: null, doneAt: '2026-09-20T01:00:00Z', noAnswerCount: 3, attempts: [] }]),
    ],
  }];
  const rows = unreachedRows(patients, '2026-09-27');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].call.id, 'c5'); // 최근 것이 먼저
  assert.ok(rows.every((r) => r.needsVisitCheck));
  assert.ok(rows.every((r) => r.smsSent));
});

test('60일보다 오래된 미연결은 빠진다', () => {
  const patients = [{
    id: 'p4', name: '라환자', phone: '01011110004', relation: 'self', condition: 'cough', conditionLabel: '',
    prescriptions: [rxWith('r5', [
      { id: 'c6', kind: 'pre_runout', status: 'closed_no_answer', dueOn: null, doneAt: '2026-06-01T01:00:00Z', noAnswerCount: 3, attempts: [] },
    ])],
  }];
  assert.deepEqual(unreachedRows(patients, '2026-09-27'), []);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL. `unreachedRows is not a function`

- [ ] **Step 3: `js/model.js`에 더하기**

파일 끝에 붙인다.

```js
// 콜이 실제로 처리된 날. 부재로 마감된 콜은 예정일이 아니라 처리한 날로 본다.
function handledOn(call) {
  if (call.doneAt) return String(call.doneAt).slice(0, 10);
  return call.dueOn ?? '';
}

// 연락이 닿지 않은 채 남은 콜. 나중에 통화가 되면 저절로 목록에서 빠진다.
export function unreachedRows(patients, today, windowDays = 60) {
  const since = addDays(today, -windowDays);
  const rows = [];
  for (const patient of patients) {
    const calls = patient.prescriptions.flatMap((r) => r.calls.map((c) => ({ prescription: r, call: c })));
    const lastAnswered = calls
      .filter((v) => v.call.status === 'done')
      .map((v) => handledOn(v.call))
      .sort()
      .pop() ?? '';
    const mine = calls.filter(({ call }) => {
      if (call.status !== 'sms_pending' && call.status !== 'closed_no_answer') return false;
      const on = handledOn(call);
      return on >= since && on > lastAnswered;
    });
    for (const { prescription, call } of mine) {
      rows.push({
        patient,
        prescription,
        call,
        lastTriedOn: call.attempts[0] ? String(call.attempts[0].attemptedAt).slice(0, 10) : handledOn(call),
        noAnswerCount: call.noAnswerCount,
        smsSent: call.status === 'closed_no_answer',
        hasRetryPending: prescription.calls.some((c) => c.kind === 'retry' && c.status === 'pending'),
        count: mine.length,
        needsVisitCheck: mine.length >= 2,
      });
    }
  }
  return rows.sort((a, b) => (a.lastTriedOn < b.lastTriedOn ? 1 : a.lastTriedOn > b.lastTriedOn ? -1 : 0));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, 실패 0

- [ ] **Step 5: 커밋**

```bash
git add js/model.js tests/model.test.js
git commit -F - <<'MSG'
feat: 연락 안 된 환자 목록 고르기

마지막 통화 이후의 미연결만 모으고, 두 건 이상이면 다음 내원 시 확인으로
표시한다. 60일보다 오래된 것은 보지 않는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: 연락 안 됨 탭과 재시도 콜 만들기

**Files:**
- Modify: `js/store.js`, `index.html`, `js/ui.js`, `css/app.css`

**Interfaces:**
- Consumes: Task 2의 함수, Task 4의 `unreachedRows`
- Produces: `store.createRetryCall(prescriptionId, { dueOn, reason })`, 탭 `연락 안 됨`(숫자 배지), 줄마다 재시도 콜 만들기·문자 문구 열기·상세 버튼

- [ ] **Step 1: `js/store.js`에 함수 더하기**

`updateCallDueOn` 아래에 붙인다.

```js
export async function createRetryCall(prescriptionId, { dueOn, reason }) {
  const { error } = await supabase.rpc('create_retry_call', {
    p_prescription_id: prescriptionId,
    p_due_on: dueOn,
    p_reason: reason,
  });
  check(error);
}
```

충돌 문구에 재시도 중복을 더한다.

```js
const CONFLICT_MESSAGES = ['콜 상태가 바뀌었습니다', '발송일이 이미 입력됐습니다', '처방이 이미 바뀌었습니다', '재시도 콜이 이미 있습니다'];
```

- [ ] **Step 2: `index.html`에 탭과 칸 더하기**

`달력` 탭 버튼 아래에 덧붙인다.

```html
    <button class="tab-btn" data-tab="unreached">연락 안 됨 <span class="count" id="tab-count-unreached">0</span></button>
```

`panel-calendar` 아래에 덧붙인다.

```html
  <div class="panel" id="panel-unreached" hidden></div>
```

- [ ] **Step 3: `css/app.css`에 표시 더하기**

```css
.badge-visit-check{background:var(--info-soft); color:var(--info);}
.badge-retry{background:var(--accent-soft); color:var(--accent-strong);}
```

- [ ] **Step 4: `js/ui.js`에 탭 붙이기**

import에 `unreachedRows`를 더한다(`model.js`에서).

```js
const TABS = ['escalation', 'today', 'shipment', 'calendar', 'unreached', 'visit', 'all', 'scripts'];
```

`render()`에 덧붙인다.

```js
  const unreached = unreachedRows(state.patients, today);
```

```js
  $('tab-count-unreached').textContent = unreached.length;
```

```js
  if (state.tab === 'unreached') renderUnreached(unreached);
```

- [ ] **Step 5: 목록 그리기**

`renderVisit` 앞에 붙인다.

```js
function renderUnreached(rows) {
  if (rows.length === 0) {
    $('panel-unreached').innerHTML = '<div class="empty">연락이 안 된 환자가 없어요.</div>';
    return;
  }
  $('panel-unreached').innerHTML = rows.map(({ patient, prescription, call, lastTriedOn, noAnswerCount, smsSent, hasRetryPending, needsVisitCheck }) => {
    const pills = [conditionBadge(patient), kindBadge(call)];
    pills.push(`<span class="badge badge-other">부재 ${noAnswerCount}회</span>`);
    pills.push(smsSent ? '<span class="badge badge-ended">문자 보냄</span>' : '<span class="badge badge-sms">문자 대기</span>');
    if (needsVisitCheck) pills.push('<span class="badge badge-visit-check">다음 내원 시 확인</span>');
    if (hasRetryPending) pills.push('<span class="badge badge-retry">재시도 콜 있음</span>');
    const actions = [
      hasRetryPending ? '' : `<button class="btn btn-primary btn-sm" data-action="retry" data-id="${prescription.id}">📞 재시도 콜 만들기</button>`,
      call.status === 'sms_pending' ? `<button class="btn btn-sm" data-action="sms" data-id="${call.id}">✉️ 문자 문구 열기</button>` : '',
      `<button class="btn btn-ghost btn-sm" data-action="detail" data-id="${patient.id}">상세 · 이력</button>`,
    ].join('');
    return `
      <div class="case-card">
        <div class="case-top">
          <div class="case-id">
            <div class="case-name">${esc(patientLabel(patient))}</div>
            <div class="case-meta-row">${pills.join('')}</div>
            <div class="case-phone mono">${esc(formatPhone(patient.phone))}</div>
          </div>
          <div class="case-due">
            <div>마지막 시도</div>
            <div class="d">${formatKoreanDate(lastTriedOn)}</div>
            <div>소진 ${prescription.runoutOn ? formatKoreanDate(prescription.runoutOn) : '-'}</div>
          </div>
        </div>
        <div class="case-actions">${actions}</div>
      </div>`;
  }).join('');
}
```

- [ ] **Step 6: 재시도 콜 만들기 창**

`openEditCallModal` 아래에 붙인다.

```js
function openRetryModal(patient, prescription) {
  const today = todayYMD();
  const first = isCallDay(today) ? today : nextCallDayAfter(today);
  openModal(`
    <div class="modal-head">
      <div><h2>재시도 콜 · ${esc(patientLabel(patient))}</h2>
        <div class="sub">${formatKoreanDate(prescription.prescribedOn)} 처방 · ${prescription.days}일분</div></div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    <div class="field">
      <label>언제 걸까요?</label>
      <input type="date" id="rt-date" value="${first}">
    </div>
    <div class="field">
      <label>만드는 이유 *</label>
      <input type="text" id="rt-reason" maxlength="200" placeholder="예: 원장님 지시로 다시 연락">
    </div>
    <div id="rt-preview"></div>
    <div class="modal-footer">
      <button class="btn" data-action="close">취소</button>
      <button class="btn btn-primary" id="rt-submit">만들기</button>
    </div>`);

  const updatePreview = () => {
    const date = $('rt-date').value;
    if (!date) { $('rt-preview').innerHTML = '<div class="preview-box warn">날짜를 넣어주세요.</div>'; return; }
    $('rt-preview').innerHTML = isCallDay(date)
      ? `<div class="preview-box">${formatKoreanDate(date)}에 재시도 콜이 뜹니다.</div>`
      : '<div class="preview-box warn">목요일과 일요일에는 콜을 잡지 않아요.</div>';
  };

  $('rt-date').addEventListener('input', updatePreview);
  updatePreview();

  $('rt-submit').addEventListener('click', async () => {
    const date = $('rt-date').value;
    const reason = $('rt-reason').value.trim();
    if (!date || !isCallDay(date)) { toast('목요일과 일요일이 아닌 날짜를 골라주세요.'); return; }
    if (!reason) { toast('만드는 이유를 적어주세요.'); return; }
    const ok = await run(() => store.createRetryCall(prescription.id, { dueOn: date, reason }), '재시도 콜을 만들었어요.');
    if (ok) closeModal();
  });
}
```

- [ ] **Step 7: 버튼 연결하기**

import에 `nextCallDayAfter`를 더한다(`schedule.js`에서). `onAppClick`에 덧붙인다.

```js
  if (action === 'retry') {
    for (const patient of state.patients) {
      const rx = patient.prescriptions.find((r) => r.id === id);
      if (rx) { openRetryModal(patient, rx); break; }
    }
  }
```

- [ ] **Step 8: 확인**

- Run: `node --check js/ui.js && node --check js/store.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0
- Run: `grep -n "panel-unreached\|tab-count-unreached" index.html js/ui.js` → Expected: 각각 두 곳 이상

- [ ] **Step 9: 커밋**

```bash
git add js/store.js index.html js/ui.js css/app.css
git commit -F - <<'MSG'
feat: 연락 안 됨 탭과 재시도 콜 만들기

부재로 마감돼 목록에서 사라진 환자를 모아 보고, 거기서 날짜를 골라 재시도
콜을 만든다. 두 번 이상 못 닿은 환자는 다음 내원 시 확인으로 표시한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: 화면 확인과 문서

**Files:**
- Modify: `CLAUDE.md`
- Test: 로컬 서버와 브라우저, MCP `execute_sql`

- [ ] **Step 1: 미연결 환자 만들기**

예시 환자 하나의 콜을 부재 마감 상태로 만든다(바꾸기 전 값을 적어 둔다).

```sql
update public.calls set status = 'closed_no_answer', no_answer_count = 3, done_at = now()
where id = (select c.id from calls c join prescriptions r on r.id = c.prescription_id
            join patients p on p.id = r.patient_id where p.name = '예시다' and c.status = 'pending' limit 1);
```

- [ ] **Step 2: 목록 확인**

화면을 새로고침하고 `연락 안 됨` 탭을 연다.
Expected: 탭 숫자가 1이고, `예시다` 줄에 `부재 3회`, `문자 보냄`, 마지막 시도일이 보인다. `📞 재시도 콜 만들기` 버튼이 있다.

- [ ] **Step 3: 재시도 콜 만들기**

버튼을 눌러 날짜를 고르고 이유 `예시 시험`으로 만든다.
Expected: "재시도 콜을 만들었어요."가 뜨고, 줄에 `재시도 콜 있음` 배지가 붙으며 만들기 버튼이 사라진다. 그 날짜가 오늘이면 `오늘 콜` 탭에 재시도 콜로 보인다.

목·일을 고르면 저장되지 않고 안내가 뜬다.

- [ ] **Step 4: 데이터로 확인**

```sql
select c.kind, c.due_on, c.status from calls c
join prescriptions r on r.id = c.prescription_id
join patients p on p.id = r.patient_id where p.name = '예시다' order by c.kind;
select summary, reason, staff_name from change_logs order by changed_at desc limit 1;
```

Expected: `retry` 콜이 `pending`으로 있고, 기록에 `재시도 콜 만듦 …`이 남는다.

- [ ] **Step 5: 되돌리고 정리**

```sql
delete from public.calls where kind = 'retry';
update public.calls set status = 'pending', no_answer_count = 0, done_at = null
where id = '<Step 1에서 바꾼 콜 id>';
delete from public.change_logs;
select (select count(*) from public.patients) as 환자, (select count(*) from public.calls) as 콜,
       (select count(*) from public.change_logs) as 기록;
```

Expected: `환자 = 3`, `콜 = 5`, `기록 = 0`

- [ ] **Step 6: `CLAUDE.md` 고치기**

"## 해피콜 운영 규칙"에 덧붙인다.

```markdown
- 부재로 마감된 콜은 '연락 안 됨' 탭에 모인다. 그 뒤에 통화가 되면 저절로 빠진다. 최근 60일만 본다.
- 재시도 콜(`kind = 'retry'`)은 마감된 처방에도 만들 수 있고, 대기 중인 재시도 콜이 있으면 새로 만들지 않는다. 소진일이 지나도 3회까지 미루고 그다음 문자로 마감한다.
```

"## V2에서 할 일"의 4번 줄을 고친다.

```markdown
4. **통계와 미연결**: 월 통계, ~~연락 안 됨 목록, 재시도 콜~~ (2026-09-27 완료)
```

- [ ] **Step 7: 커밋**

```bash
git add CLAUDE.md
git commit -F - <<'MSG'
docs: 연락 안 됨 목록과 재시도 콜 규칙을 규칙 파일에 반영

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 8: 올릴지 묻기**

`npm test` 통과와 예시 데이터만 남았는지 확인하고 **사용자에게 물어본 뒤에만** push한다.

---

## 이 계획에서 하지 않는 것

- 월별로 골라 보는 조회(지금은 최근 60일 고정).
- 문자 외의 다른 연락 방법(카카오 등).
- '다음 내원 시 확인'을 환자 표에 저장해 데스크 화면에 띄우는 것. 지금은 목록에서만 보인다.
- 월 통계 화면.
