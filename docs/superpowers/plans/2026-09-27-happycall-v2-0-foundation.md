# 두기 해피콜 V2.0 기반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 직원 여러 명이 각자 로그인해 같은 화면을 쓰면서, 담당자가 자동으로 기록되고, 두 사람이 같은 콜을 동시에 저장해도 기록이 덮이지 않으며, 환자가 1000명을 넘어도 콜이 목록에서 빠지지 않게 만든다.

**Architecture:** 기존 구조를 그대로 둔다. 직원 이름은 `allowed_emails`에 열을 하나 더해 보관하고, 자기 행만 읽는 행 수준 보안 정책으로 화면이 자기 이름을 읽는다. 담당자는 화면이 보내지 않고 `save_call_outcome` 안에서 로그인 계정으로 채운다. 같은 함수에 "저장 직전 상태"를 함께 보내 상태가 그대로일 때만 저장한다. 환자 조회는 500명씩 여러 번 나눠 받아 합친다.

**Tech Stack:** HTML/CSS/바닐라 JS(ES 모듈), `@supabase/supabase-js@2.116.0`, Node 24 `node:test`, Supabase(Postgres, RLS, RPC), Vercel.

**Spec:** `docs/superpowers/specs/2026-09-26-happycall-v2-design.md` 10장 추천 1·2·3, 11장 V2.0 기반

## Global Constraints

- 프로젝트 규칙 파일 `CLAUDE.md`를 먼저 읽고 그대로 따른다.
- 실제 환자 정보는 코드·문서·커밋에 넣지 않는다. 예시 환자로만 시험한다.
- 앱에는 publishable 키만 넣는다. `service_role` 키는 쓰지 않는다.
- 새 표나 새 열을 만들면 행 수준 보안을 켜고 허용 이메일 정책을 붙인다.
- 데이터베이스 변경은 `supabase/migrations`에 번호 순서대로 파일을 남기고 MCP `apply_migration`으로 적용한다. 적용 뒤 `get_advisors`(security)를 돌려 새 경고가 없는지 본다.
- SQL 시험은 허용 이메일, 허용되지 않은 이메일, 로그인 안 함 세 경우를 모두 확인하고, 시험용 행은 반드시 지운다.
- Supabase 프로젝트 id는 `yblqrtwbvqrshqmnizij`. 허용 이메일은 `allowed_emails` 표에 있는 계정이며 문서에 이메일을 적지 않는다.
- 빌드 단계가 없다. `npm install`을 돌리지 않는다. 테스트는 `npm test`(현재 45개 통과), 로컬 서버는 `npm run serve`(127.0.0.1:5173).
- `js/schedule.js`, `js/texts.js`, `js/model.js`는 브라우저 기능을 쓰지 않는다. 고칠 때 실패하는 테스트를 먼저 쓴다.
- 화면에 값을 넣을 때는 반드시 `esc()`를 거친다.
- 브랜치는 `feat/v1`이고 여기에 올리면 곧바로 실제 배포다. **push는 사용자에게 묻고 한다.** 태스크마다 커밋만 한다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`를 넣는다.

## 파일 구조

| 파일 | 이 계획에서 하는 일 |
|---|---|
| `supabase/migrations/004_staff_name.sql` | 새로 만듦. 직원 표시 이름 열과 자기 행 읽기 정책 |
| `supabase/migrations/005_save_call_outcome_guard.sql` | 새로 만듦. 담당자 자동 기록과 상태 조건부 저장 |
| `js/texts.js` | `staffLabel()` 추가 |
| `tests/texts.test.js` | `staffLabel()` 테스트 추가 |
| `js/store.js` | `loadMyStaff()` 추가, `saveCallOutcome()` 인자 변경, `isConflictError()` 추가, 예약·전달 표시에 조건 추가, `loadAll()` 페이지 방식 |
| `js/ui.js` | 헤더에 직원 이름 표시, 담당 직원 입력 제거, 저장 충돌 안내, 환자 수 상한 안내 |
| `index.html` | 헤더에 직원 이름 자리 추가 |
| `css/app.css` | 직원 이름 스타일 한 줄 |
| `CLAUDE.md` | V2.0에서 바뀐 규칙 반영 |
| `README.md` | 직원 계정 추가 절차 |

## 테스트 전략

| 대상 | 방법 |
|---|---|
| `texts.js`의 `staffLabel` | `npm test` |
| 마이그레이션 004·005 | Supabase MCP `execute_sql`로 역할과 JWT 이메일을 바꿔 실행 |
| 화면 동작 | 로컬 서버와 사용자 Chrome에서 확인. 충돌 상황은 SQL로 상태를 바꿔 만든다 |
| 환자 1000명 초과 | SQL로 예시 환자 1200명을 만들고 화면 숫자를 확인한 뒤 지운다 |

---

### Task 1: 직원 표시 이름과 자기 행 읽기

**Files:**
- Create: `supabase/migrations/004_staff_name.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Consumes: 기존 표 `public.allowed_emails(email text primary key)`
- Produces:
  - `allowed_emails.display_name text` — 화면에 보일 직원 이름
  - RLS 정책 `"내 계정만 읽기"` — 로그인한 계정이 자기 행만 SELECT
  - 화면에서 쓰는 조회: `select email, display_name from allowed_emails limit 1`

SQL 시험에서 허용 계정으로 실행할 때 쓰는 앞부분이다. `<허용이메일>`은 `allowed_emails`에 들어 있는 실제 주소로 바꿔 쓴다. 문서에는 적지 않는다.

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"<허용이메일>"}', true);
```

- [ ] **Step 1: 실패하는 시험 실행**

MCP `execute_sql` (project_id `yblqrtwbvqrshqmnizij`), 허용 계정 앞부분을 붙이고:

```sql
select email, display_name from public.allowed_emails;
```

Expected: ERROR `column "display_name" does not exist`

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/004_staff_name.sql`:

```sql
-- 직원 표시 이름. 통화 기록의 담당자와 화면 인사말에 쓴다.
alter table public.allowed_emails add column if not exists display_name text;

-- 기존 계정은 이메일 앞부분을 임시 이름으로 채운다.
update public.allowed_emails
set display_name = split_part(email, '@', 1)
where display_name is null or display_name = '';

-- 로그인한 계정이 자기 행만 읽는다. 다른 직원의 이메일은 보이지 않는다.
drop policy if exists "내 계정만 읽기" on public.allowed_emails;
create policy "내 계정만 읽기"
  on public.allowed_emails
  for select
  to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — project_id `yblqrtwbvqrshqmnizij`, name `staff_name`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 허용 계정이 자기 행을 읽는지**

허용 계정 앞부분 + `select email, display_name from public.allowed_emails;`
Expected: 1행. `display_name`이 비어 있지 않다.

- [ ] **Step 5: 다른 이메일은 못 읽는지**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"stranger@example.com"}', true);
select count(*) as visible from public.allowed_emails;
```

Expected: `visible = 0`

- [ ] **Step 6: 로그인 안 하면 못 읽는지**

```sql
set local role anon;
select count(*) from public.allowed_emails;
```

Expected: ERROR `permission denied for table allowed_emails`

- [ ] **Step 7: 보안 점검**

MCP `get_advisors` type `security`.
Expected: 새 WARN이 없다. `allowed_emails`의 "RLS Enabled No Policy" INFO는 이번 정책으로 사라진다. `auth_leaked_password_protection` WARN은 이전부터 있던 계정 설정이라 그대로 있어도 된다.

- [ ] **Step 8: 커밋**

```bash
git add supabase/migrations/004_staff_name.sql
git commit -F - <<'MSG'
feat: 직원 표시 이름과 자기 계정 읽기 정책

allowed_emails에 display_name을 더하고, 로그인한 계정이 자기 행만 읽도록 정책을 붙였다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: 담당자 자동 기록과 동시 저장 보호

**Files:**
- Create: `supabase/migrations/005_save_call_outcome_guard.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Consumes: Task 1의 `allowed_emails.display_name`과 자기 행 읽기 정책
- Produces: `public.save_call_outcome(p_call_id uuid, p_expected_status text, p_outcome text, p_note text, p_status text, p_due_on date, p_no_answer_count int, p_result text, p_visit_needed boolean, p_escalation text, p_close_prescription text) returns void`
  - `p_staff_name` 인자가 없어졌다. 담당자는 로그인 계정에서 채운다.
  - `p_expected_status`와 콜의 현재 상태가 다르면 `콜 상태가 바뀌었습니다` 예외를 낸다.
  - 시도 기록은 콜 저장에 성공한 뒤에만 들어간다.

- [ ] **Step 1: 실패하는 시험 실행**

허용 계정 앞부분 + 아래. 아직 옛 함수(인자 11개, 두 번째가 `p_outcome`)만 있으므로 실패한다.

```sql
select public.save_call_outcome(
  '00000000-0000-0000-0000-000000000000'::uuid,
  'pending', 'answered', '메모', 'done', null, 0, 'improved', false, 'none', null);
```

Expected: ERROR. 인자 이름이 달라 `function public.save_call_outcome(...) does not exist` 또는 콜을 찾지 못한다는 옛 함수의 오류가 난다. 어느 쪽이든 실제 메시지를 보고서에 적는다.

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/005_save_call_outcome_guard.sql`:

```sql
-- 담당자를 로그인 계정에서 채우고, 저장 직전 상태가 그대로일 때만 저장한다.
-- 옛 함수와 인자 타입이 같아 이름만 바꿀 수 없으므로 지우고 새로 만든다.
drop function if exists public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text);

create function public.save_call_outcome(
  p_call_id uuid,
  p_expected_status text,
  p_outcome text,
  p_note text,
  p_status text,
  p_due_on date,
  p_no_answer_count int,
  p_result text,
  p_visit_needed boolean,
  p_escalation text,
  p_close_prescription text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prescription_id uuid;
  v_staff text;
begin
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
  into v_staff
  from allowed_emails
  where email = lower(coalesce(auth.jwt() ->> 'email', ''));

  update calls set
    status = p_status,
    due_on = coalesce(p_due_on, due_on),
    no_answer_count = p_no_answer_count,
    result = coalesce(p_result, result),
    note = case when p_outcome = 'answered' then nullif(p_note, '') else note end,
    visit_needed = p_visit_needed,
    escalation = p_escalation,
    done_at = case when p_status in ('done', 'closed_no_answer') then now() else done_at end
  where id = p_call_id and status = p_expected_status
  returning prescription_id into v_prescription_id;

  if v_prescription_id is null then
    raise exception '콜 상태가 바뀌었습니다' using errcode = 'P0001';
  end if;

  if p_outcome is not null then
    insert into call_attempts (call_id, outcome, note, staff_name)
    values (p_call_id, p_outcome, nullif(p_note, ''), v_staff);
  end if;

  if p_close_prescription is not null then
    update prescriptions
    set status = 'closed', closed_reason = p_close_prescription
    where id = v_prescription_id and status = 'active';
  end if;
end;
$$;

revoke all on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text) from public, anon;
grant execute on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text) to authenticated;
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — name `save_call_outcome_guard`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 시험용 데이터 만들기**

허용 계정 앞부분 + 아래. 오늘이 목·일이면 `due_on`이 규칙에 걸리므로 고정 날짜를 쓴다.

```sql
select public.register_prescription('01099990001', '동시저장 시험', 'cough', '', date '2026-09-21', 30, date '2026-10-21',
  '[{"kind":"mid","dueOn":"2026-10-06"},{"kind":"pre_runout","dueOn":"2026-10-19"}]'::jsonb);
select c.id, c.kind, c.status from calls c
join prescriptions r on r.id = c.prescription_id
join patients p on p.id = r.patient_id
where p.phone = '01099990001' order by c.kind;
```

Expected: 2행, 둘 다 `pending`. `mid` 콜의 id를 다음 단계에서 쓴다.

- [ ] **Step 5: 상태가 맞으면 저장되고 담당자가 자동으로 들어가는지**

허용 계정 앞부분 + 아래. `<mid콜id>`는 Step 4에서 받은 값이다.

```sql
select public.save_call_outcome('<mid콜id>'::uuid, 'pending', 'answered', '경과 좋음', 'done', null, 0, 'improved', false, 'none', null);
select c.status, c.result, c.note,
       (select a.staff_name from call_attempts a where a.call_id = c.id order by a.attempted_at desc limit 1) as staff,
       (select count(*) from call_attempts a where a.call_id = c.id) as attempts
from calls c where c.id = '<mid콜id>'::uuid;
```

Expected: `status = done`, `result = improved`, `note = 경과 좋음`, `staff`가 비어 있지 않다(허용 계정의 `display_name`), `attempts = 1`.

- [ ] **Step 6: 상태가 다르면 막히는지**

허용 계정 앞부분 + 같은 콜에 다시 `pending`을 기대 상태로 보낸다.

```sql
select public.save_call_outcome('<mid콜id>'::uuid, 'pending', 'answered', '두 번째 저장', 'done', null, 0, 'same', false, 'none', null);
```

Expected: ERROR `콜 상태가 바뀌었습니다`

이어서 시도 기록이 늘지 않았는지 확인한다.

```sql
select count(*) as attempts from call_attempts where call_id = '<mid콜id>'::uuid;
```

Expected: `attempts = 1`

- [ ] **Step 7: 없는 콜도 같은 방식으로 막히는지**

허용 계정 앞부분 + 아래.

```sql
select public.save_call_outcome('00000000-0000-0000-0000-000000000000'::uuid, 'pending', 'no_answer', '', 'pending', date '2026-10-07', 1, null, false, 'none', null);
```

Expected: ERROR `콜 상태가 바뀌었습니다`

- [ ] **Step 8: 허용되지 않은 이메일은 저장 못 하는지**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"stranger@example.com"}', true);
select public.save_call_outcome('<pre_runout콜id>'::uuid, 'pending', 'answered', '침입', 'done', null, 0, 'improved', false, 'none', null);
```

Expected: ERROR `콜 상태가 바뀌었습니다` (행 수준 보안 때문에 콜이 보이지 않아 갱신 대상이 없다)

- [ ] **Step 9: 정리와 보안 점검**

역할을 바꾸지 않고:

```sql
delete from public.patients where phone = '01099990001';
select (select count(*) from public.patients) as patients, (select count(*) from public.calls) as calls;
```

Expected: 시험 전 숫자로 돌아온다(예시 환자 3명, 콜 5건).

MCP `get_advisors` type `security` → 새 WARN이 없다.

- [ ] **Step 10: 커밋**

```bash
git add supabase/migrations/005_save_call_outcome_guard.sql
git commit -F - <<'MSG'
feat: 통화 결과 저장에 담당자 자동 기록과 상태 확인 추가

담당자는 로그인 계정의 표시 이름으로 채우고, 저장 직전 상태가 그대로일 때만
저장한다. 시도 기록은 콜 저장에 성공한 뒤에만 남는다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: 화면에 직원 이름 붙이고 충돌을 안내

**Files:**
- Modify: `js/texts.js`, `tests/texts.test.js`, `js/store.js`, `js/ui.js`, `index.html`, `css/app.css`

**Interfaces:**
- Consumes: Task 1의 조회, Task 2의 함수 인자
- Produces:
  - `texts.staffLabel(staff)` — `{ email, name }`에서 화면에 쓸 이름을 만든다
  - `store.loadMyStaff(): Promise<{email, name}|null>`
  - `store.saveCallOutcome(callId, { expectedStatus, outcome, note, status, dueOn, noAnswerCount, result, visitNeeded, escalation, closePrescription })`
  - `store.isConflictError(err): boolean`
  - `ui.state.staff` — 로그인한 직원 정보. `state.staffName`은 없어진다

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/texts.test.js` 끝에 덧붙인다. 파일 맨 위 import 목록에 `staffLabel`을 더한다.

```js
test('staffLabel은 이름이 있으면 이름, 없으면 이메일 앞부분', () => {
  assert.equal(staffLabel({ email: 'kim@clinic.example', name: '김직원' }), '김직원');
  assert.equal(staffLabel({ email: 'kim@clinic.example', name: '' }), 'kim');
  assert.equal(staffLabel({ email: 'kim@clinic.example', name: '   ' }), 'kim');
  assert.equal(staffLabel(null), '');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL. `staffLabel is not a function` 또는 import 오류.

- [ ] **Step 3: `js/texts.js`에 함수 추가**

파일 끝에 덧붙인다.

```js
export function staffLabel(staff) {
  if (!staff) return '';
  const name = String(staff.name ?? '').trim();
  if (name) return name;
  const email = String(staff.email ?? '');
  return email.includes('@') ? email.split('@')[0] : email;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, `# fail 0` (49개)

- [ ] **Step 5: `js/store.js` 고치기**

`loadScripts` 아래(`// ---- 쓰기 ----` 줄 앞)에 덧붙인다.

```js
export async function loadMyStaff() {
  const { data, error } = await supabase
    .from('allowed_emails')
    .select('email, display_name')
    .limit(1)
    .maybeSingle();
  check(error);
  return data ? { email: data.email, name: data.display_name ?? '' } : null;
}
```

`saveCallOutcome`을 통째로 아래로 바꾼다.

```js
export async function saveCallOutcome(callId, o) {
  const { error } = await supabase.rpc('save_call_outcome', {
    p_call_id: callId,
    p_expected_status: o.expectedStatus,
    p_outcome: o.outcome ?? null,
    p_note: o.note ?? '',
    p_status: o.status,
    p_due_on: o.dueOn ?? null,
    p_no_answer_count: o.noAnswerCount,
    p_result: o.result ?? null,
    p_visit_needed: o.visitNeeded,
    p_escalation: o.escalation,
    p_close_prescription: o.closePrescription ?? null,
  });
  check(error);
}

// 다른 직원이 먼저 처리했을 때 나는 오류인지 구분한다.
export function isConflictError(err) {
  return Boolean(err && typeof err.message === 'string' && err.message.includes('콜 상태가 바뀌었습니다'));
}
```

`markEscalationSent`와 `markVisitBooked`를 아래로 바꾼다. 조건을 붙여 이미 처리된 건은 덮지 않는다.

```js
export async function markEscalationSent(callId) {
  const { data, error } = await supabase
    .from('calls')
    .update({ escalation: 'sent', escalated_at: new Date().toISOString() })
    .eq('id', callId)
    .eq('escalation', 'pending')
    .select('id');
  check(error);
  if (!data || data.length === 0) throw new Error('콜 상태가 바뀌었습니다');
}

export async function markVisitBooked(callId) {
  const { data, error } = await supabase
    .from('calls')
    .update({ visit_booked: true })
    .eq('id', callId)
    .eq('visit_booked', false)
    .select('id');
  check(error);
  if (!data || data.length === 0) throw new Error('콜 상태가 바뀌었습니다');
}
```

- [ ] **Step 6: `index.html`과 `css/app.css` 고치기**

`index.html`의 헤더에서 아래 줄을

```html
    <div class="header-actions">
```

아래로 바꾼다.

```html
    <div class="header-actions">
      <span class="header-staff" id="staff-name"></span>
```

`css/app.css` 끝에 덧붙인다.

```css
.header-staff{font-size:12.5px; color:var(--text-muted); font-weight:600;}
```

- [ ] **Step 7: `js/ui.js` 고치기**

(1) `texts.js` import 목록 끝에 `staffLabel`을 더한다.

(2) `state` 줄을 아래로 바꾼다.

```js
export const state = { patients: [], scripts: {}, tab: 'today', search: '', staff: null, detailPatientId: null };
```

(3) `refresh`를 아래로 바꾼다.

```js
export async function refresh() {
  try {
    const [patients, scripts, staff] = await Promise.all([store.loadAll(), store.loadScripts(), store.loadMyStaff()]);
    state.patients = patients;
    state.scripts = scripts;
    state.staff = staff;
    $('staff-name').textContent = staffLabel(staff) ? `${staffLabel(staff)} 님` : '';
    render();
    if (state.detailPatientId) openDetailModal(findPatient(state.detailPatientId));
  } catch (err) {
    console.error(err);
    toast('불러오지 못했어요. 새로고침해주세요.');
  }
}
```

(4) `run`의 `catch` 블록을 아래로 바꾼다.

```js
    } catch (err) {
      console.error(err);
      if (store.isConflictError(err)) {
        toast('다른 직원이 먼저 처리했어요. 최신 내용으로 다시 불러옵니다.');
        await refresh();
      } else {
        toast('저장하지 못했어요. 다시 시도해주세요.');
      }
      return false;
    }
```

(5) 통화 기록 창에서 담당 직원 입력을 없앤다. 아래 줄을 지운다.

```html
    <div class="field"><label>담당 직원</label><input type="text" id="cl-staff" value="${esc(state.staffName)}"></div>
```

(6) `cl-submit` 처리에서 첫 줄 `state.staffName = $('cl-staff').value.trim();`을 지우고, 저장 호출을 아래로 바꾼다.

```js
    const ok = await run(() => store.saveCallOutcome(call.id, {
      expectedStatus: call.status, outcome: 'answered', note: d.note, status: d.status, dueOn: null,
      noAnswerCount: call.noAnswerCount, result: d.result, visitNeeded: d.visitNeeded,
      escalation: d.escalation, closePrescription: d.closePrescription,
    }), d.escalation === 'pending' ? "저장했어요. '원장 전달 필요'에 올라갔어요." : '저장했어요.');
```

(7) `handleNoAnswer`의 저장 호출을 아래로 바꾼다.

```js
  const ok = await run(() => store.saveCallOutcome(call.id, {
    expectedStatus: call.status, outcome: 'no_answer', note: '', status: d.status, dueOn: d.dueOn,
    noAnswerCount: d.noAnswerCount, result: null, visitNeeded: call.visitNeeded,
    escalation: call.escalation, closePrescription: null,
  }), message);
```

(8) `openSmsModal`의 저장 호출을 아래로 바꾼다.

```js
    const ok = await run(() => store.saveCallOutcome(call.id, {
      expectedStatus: call.status, outcome: null, note: '', status: d.status, dueOn: null,
      noAnswerCount: call.noAnswerCount, result: null, visitNeeded: call.visitNeeded,
      escalation: call.escalation, closePrescription: d.closePrescription,
    }), '문자 보냄으로 마감했어요.');
```

(9) `stopApp`에서 로그아웃 때 이름도 지운다.

```js
export function stopApp() {
  state.patients = [];
  state.scripts = {};
  state.staff = null;
  $('staff-name').textContent = '';
  closeModal();
}
```

- [ ] **Step 8: 확인**

- Run: `npm test` → Expected: PASS, 49개, 실패 0
- Run: `node --check js/ui.js && node --check js/store.js && node --check js/texts.js` → Expected: 출력 없음
- Run: `grep -n "staffName\|cl-staff" js/ui.js` → Expected: 결과 없음
- Run: `grep -n "p_staff_name" js/store.js` → Expected: 결과 없음

- [ ] **Step 9: 커밋**

```bash
git add js/texts.js tests/texts.test.js js/store.js js/ui.js index.html css/app.css
git commit -F - <<'MSG'
feat: 로그인한 직원 이름 표시와 저장 충돌 안내

담당 직원을 손으로 적지 않고 로그인 계정으로 자동 기록한다. 다른 직원이 먼저
처리한 콜을 저장하려 하면 안내하고 최신 내용을 다시 불러온다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: 환자가 1000명을 넘어도 빠지지 않게

**Files:**
- Modify: `js/store.js`, `js/ui.js`
- Test: Supabase MCP `execute_sql` + 화면 확인

**Interfaces:**
- Consumes: 기존 `toPatient`
- Produces: `store.loadAll(): Promise<{ patients: Patient[], truncated: boolean }>` — 500명씩 나눠 받아 합친다. 상한(5000명)을 넘으면 `truncated: true`

**왜 필요한가:** 지금은 한 번에 요청해서 서버 기본 상한인 1000행까지만 온다. 1001번째부터는 오래된 환자의 콜이 화면에서 조용히 사라진다.

- [ ] **Step 1: 현재 동작 확인 (실패 시험)**

MCP `execute_sql` (역할 전환 없이). 예시 환자 1200명을 만든다.

```sql
insert into public.patients (name, phone, condition)
select '부하시험' || g, '0109' || lpad(g::text, 7, '0'), 'cough'
from generate_series(1, 1200) g;
select count(*) as total from public.patients;
```

Expected: `total`이 1203(기존 예시 3명 + 1200).

로컬 서버를 켜고(`npm run serve`) 사용자 Chrome에서 로그인된 화면을 새로고침한 뒤 "전체 환자" 탭의 숫자를 본다.
Expected: 1000. 즉 203명이 빠진다. 이 숫자를 보고서에 적는다.

- [ ] **Step 2: `js/store.js`의 `loadAll` 교체**

```js
const PATIENT_PAGE_SIZE = 500;
const PATIENT_MAX = 5000;

const PATIENT_SELECT = `
  id, name, phone, condition, condition_label, created_at,
  prescriptions (
    id, prescribed_on, days, runout_on, status, closed_reason, created_at,
    calls (
      id, kind, due_on, status, no_answer_count, result, note, visit_needed, visit_booked,
      escalation, escalated_at, done_at,
      call_attempts ( id, attempted_at, outcome, note, staff_name )
    )
  )`;

export async function loadAll() {
  const rows = [];
  for (let from = 0; from < PATIENT_MAX; from += PATIENT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('patients')
      .select(PATIENT_SELECT)
      .order('created_at', { ascending: false })
      .range(from, from + PATIENT_PAGE_SIZE - 1);
    check(error);
    rows.push(...data);
    if (data.length < PATIENT_PAGE_SIZE) {
      return { patients: rows.map(toPatient), truncated: false };
    }
  }
  return { patients: rows.map(toPatient), truncated: true };
}
```

- [ ] **Step 3: `js/ui.js`의 `refresh` 교체**

```js
export async function refresh() {
  try {
    const [all, scripts, staff] = await Promise.all([store.loadAll(), store.loadScripts(), store.loadMyStaff()]);
    state.patients = all.patients;
    state.scripts = scripts;
    state.staff = staff;
    $('staff-name').textContent = staffLabel(staff) ? `${staffLabel(staff)} 님` : '';
    render();
    if (all.truncated) toast('환자가 너무 많아 일부만 불러왔어요. 관리자에게 알려주세요.');
    if (state.detailPatientId) openDetailModal(findPatient(state.detailPatientId));
  } catch (err) {
    console.error(err);
    toast('불러오지 못했어요. 새로고침해주세요.');
  }
}
```

- [ ] **Step 4: 다시 확인**

- Run: `npm test` → Expected: PASS, 49개
- Run: `node --check js/store.js && node --check js/ui.js` → Expected: 출력 없음
- 사용자 Chrome에서 화면을 새로고침한다. Expected: "전체 환자" 탭 숫자가 1203. 콘솔 오류 없음. 목록이 뜨기까지 몇 초 걸려도 된다.

- [ ] **Step 5: 시험 데이터 정리**

```sql
delete from public.patients where name like '부하시험%';
select count(*) as total from public.patients;
```

Expected: `total = 3`

화면을 새로고침해 "전체 환자"가 3으로 돌아오는지 본다.

- [ ] **Step 6: 커밋**

```bash
git add js/store.js js/ui.js
git commit -F - <<'MSG'
fix: 환자를 500명씩 나눠 받아 1000명 상한을 넘기지 않게

한 번에 요청하면 서버 기본 상한 때문에 1000명까지만 와서 오래된 환자의 콜이
목록에서 빠졌다. 나눠 받아 합치고, 상한을 넘으면 화면에 알린다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: 화면 확인과 문서 정리

**Files:**
- Modify: `CLAUDE.md`
- Test: 사용자 Chrome에서 확인 + MCP `execute_sql`

**Interfaces:**
- Consumes: Task 1~4 결과
- Produces: V2.0이 끝났다는 확인 기록

- [ ] **Step 1: 직원 이름이 보이는지**

로컬 서버를 켜고 사용자 Chrome에서 로그인된 화면을 연다.
Expected: 헤더의 "+ 처방 등록" 왼쪽에 `<이름> 님`이 보인다.

- [ ] **Step 2: 담당자가 자동으로 들어가는지**

예시 환자 하나의 대기 중인 콜에서 "통화 기록"을 열고 저장한다.
Expected: 창에 담당 직원 입력칸이 없다. 저장 뒤 환자 상세의 시도 기록에 직원 이름이 보인다.

MCP로 확인한다.

```sql
select a.staff_name, a.outcome, a.attempted_at
from call_attempts a order by a.attempted_at desc limit 3;
```

Expected: 방금 저장한 줄의 `staff_name`이 화면에 보이는 이름과 같다.

- [ ] **Step 3: 동시 저장 보호가 화면에서 동작하는지**

같은 콜을 화면에 띄워 둔 채, MCP로 그 콜의 상태를 먼저 바꾼다.

```sql
update public.calls set status = 'done', done_at = now()
where id = (select c.id from calls c join prescriptions r on r.id = c.prescription_id
            join patients p on p.id = r.patient_id
            where p.phone = '01011110001' and c.status = 'pending' limit 1);
```

그 다음 화면에서 그 콜의 "부재중"을 누른다.
Expected: "다른 직원이 먼저 처리했어요. 최신 내용으로 다시 불러옵니다." 안내가 뜨고 목록이 새로 고쳐진다. 시도 기록이 늘지 않는다.

확인 후 원래대로 돌린다.

```sql
update public.calls set status = 'pending', done_at = null
where id = (select c.id from calls c join prescriptions r on r.id = c.prescription_id
            join patients p on p.id = r.patient_id
            where p.phone = '01011110001' and c.status = 'done' order by c.due_on limit 1);
```

- [ ] **Step 4: 예약 완료와 원장 전달도 두 번 눌리지 않는지**

"내원 예약 필요" 탭에서 "예약 완료로 표시"를 누른 뒤, 목록이 갱신되기 전에 한 번 더 누른다.
Expected: 두 번째 누름은 안내만 뜨고 아무것도 바뀌지 않는다.

- [ ] **Step 5: `CLAUDE.md` 고치기**

"## 데이터와 보안" 절의 로그인 항목을 아래로 바꾼다.

```markdown
- 로그인은 허용 이메일 목록에 있는 계정만 통과한다. 목록은 `allowed_emails` 표에서 관리하고, 표시 이름은 같은 표의 `display_name`에 둔다. 문서나 코드에 이메일을 적지 않는다.
- 통화 기록의 담당자는 화면이 보내지 않는다. `save_call_outcome`이 로그인 계정에서 채운다.
- 콜을 저장할 때는 저장 직전 상태를 함께 보내고, 상태가 바뀌었으면 저장하지 않고 사용자에게 알린다.
```

"## V2에서 할 일" 절의 1번 줄을 아래로 바꾼다.

```markdown
1. ~~**기반**: 직원별 로그인과 담당자 자동 기록, 동시 저장 보호, 환자 1000명 제한 해소~~ (2026-09-27 완료)
```

- [ ] **Step 6: 커밋**

```bash
git add CLAUDE.md
git commit -F - <<'MSG'
docs: V2.0 기반 완료 내용을 규칙 파일에 반영

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 7: 올릴지 묻기**

`feat/v1`에 올리면 곧바로 실제 배포다. 사용자에게 올려도 되는지 묻고, 허락을 받은 뒤에만 push한다. 올린 뒤에는 배포 주소에서 로그인하고 직원 이름이 보이는지 확인한다.

---

### Task 6: 직원 계정을 실제로 늘리기

**Files:**
- Modify: `README.md`
- Test: Supabase MCP `execute_sql` + 새 계정으로 로그인

**Interfaces:**
- Consumes: Task 1의 `display_name`과 자기 행 읽기 정책, Task 3의 헤더 이름 표시
- Produces: 직원 한 명을 추가하는 절차와 그 절차를 적은 `README.md` 절

**왜 필요한가:** V2.0의 목표는 직원 여러 명이 각자 로그인하는 것이다. 표와 화면만으로는 계정이 늘지 않는다. 계정 추가는 대시보드 작업이라 사용자가 직접 해야 하므로, 절차를 문서로 남긴다.

- [ ] **Step 1: 사용자에게 계정 추가 요청**

아래를 사용자에게 안내한다. 이메일 주소는 사용자가 정한다. 문서나 커밋에 그 주소를 적지 않는다.

1. `https://supabase.com/dashboard/project/yblqrtwbvqrshqmnizij/auth/users` 를 연다.
2. 오른쪽 위 **Add user** → **Create new user** 를 누른다.
3. 직원 이메일을 넣고, 비밀번호는 아무 값이나 넣는다. 이 앱은 비밀번호를 쓰지 않는다.
4. **Auto Confirm User** 를 켜고 **Create user** 를 누른다.
5. 만든 이메일을 이 대화에 알려준다.

- [ ] **Step 2: 허용 목록에 직원 추가**

MCP `execute_sql` (역할 전환 없이). `<직원이메일>`과 `<직원이름>`은 사용자가 준 값이다.

```sql
insert into public.allowed_emails (email, display_name)
values (lower('<직원이메일>'), '<직원이름>')
on conflict (email) do update set display_name = excluded.display_name;
select email, display_name from public.allowed_emails order by email;
```

Expected: 두 행 이상. 새 직원 행의 `display_name`이 사용자가 준 이름과 같다.

- [ ] **Step 3: 새 계정이 자기 행만 보는지**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"<직원이메일>"}', true);
select email, display_name from public.allowed_emails;
```

Expected: 1행. 새 직원 자신의 행만 보인다.

- [ ] **Step 4: 새 계정이 콜을 저장할 수 있는지**

같은 앞부분 + 예시 환자의 대기 중인 콜 하나로 시험한다.

```sql
select public.save_call_outcome(
  (select c.id from calls c join prescriptions r on r.id = c.prescription_id
   join patients p on p.id = r.patient_id
   where p.phone = '01011110003' and c.status = 'pending' limit 1),
  'pending', 'no_answer', '', 'pending', date '2026-10-07', 1, null, false, 'none', null);
select a.staff_name, a.outcome from call_attempts a order by a.attempted_at desc limit 1;
```

Expected: 저장되고 `staff_name`이 새 직원 이름이다.

확인 뒤 되돌린다.

```sql
update public.calls set status = 'pending', no_answer_count = 0, due_on = date '2026-09-23'
where id = (select c.id from calls c join prescriptions r on r.id = c.prescription_id
            join patients p on p.id = r.patient_id where p.phone = '01011110003' limit 1);
delete from public.call_attempts a
where a.id = (select id from call_attempts order by attempted_at desc limit 1);
```

- [ ] **Step 5: 새 계정으로 로그인 확인 (사용자)**

사용자에게 요청한다. 직원 이메일로 로그인 링크를 받아 같은 PC의 Chrome에서 누른다. 메일 한도가 있으므로 **한 번만** 요청한다.
Expected: 로그인되고 헤더에 새 직원 이름이 보인다. 통계와 목록은 기존과 같다.

- [ ] **Step 6: `README.md`에 절차 적기**

`## 데이터베이스` 절 아래에 덧붙인다.

```markdown
## 직원 계정 추가

1. Supabase 대시보드 → Authentication → Users → Add user → Create new user.
   직원 이메일을 넣고 **Auto Confirm User**를 켠 뒤 만듭니다. 비밀번호는 쓰지 않습니다.
2. `allowed_emails` 표에 그 이메일과 표시 이름을 넣습니다. 표시 이름은 통화 기록의 담당자와 화면 인사말에 쓰입니다.
3. 직원이 앱에서 자기 이메일로 로그인 링크를 받아 같은 PC에서 링크를 누릅니다.

직원이 그만두면 `allowed_emails`에서 그 줄을 지웁니다. 계정이 남아 있어도 환자 정보를 읽지 못합니다.
```

- [ ] **Step 7: 커밋**

```bash
git add README.md
git commit -F - <<'MSG'
docs: 직원 계정 추가 절차 안내

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```
