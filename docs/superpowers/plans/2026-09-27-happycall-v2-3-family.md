# V2 3단계: 가족 환자 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전화번호 하나에 여러 환자를 등록할 수 있게 하고, 환자마다 **본인·모·부·조모·조부·자녀·기타** 관계를 붙여 콜 카드·통화 창·문자·원장 전달 문구에서 누구 이야기인지 바로 알 수 있게 한다.

**Architecture:** 환자를 구분하는 값이 전화번호 하나에서 **전화번호 + 이름**으로 바뀐다. `patients`에 `relation` 열을 더하고 번호 단독 유일 제약을 번호+이름 유일 색인으로 바꾼다. 등록 함수는 번호+이름으로 환자를 찾고, 없으면 관계와 함께 새로 만든다. 화면은 등록 창에서 그 번호에 등록된 가족을 카드로 보여주고 고르게 한다.

**Tech Stack:** 정적 HTML + ES 모듈(빌드 없음), Supabase Postgres + RLS, Node 24 `node:test`, Vercel 배포(`feat/v1` = production)

**Spec:** `docs/superpowers/specs/2026-09-26-happycall-v2-design.md` 5장 (가족 환자)

## Global Constraints

- 환자를 구분하는 값은 **전화번호 + 이름**이다. 같은 번호에 같은 이름을 두 번 넣을 수 없다.
- 관계 값은 `self`, `mother`, `father`, `grandmother`, `grandfather`, `child`, `other` 일곱 개뿐이다. 화면에는 본인·모·부·조모·조부·자녀·기타로 보인다.
- 기존 환자는 모두 `self`(본인)로 채운다.
- 본인이면 화면에 관계를 적지 않는다. 본인이 아닐 때만 `이름 (자녀)`처럼 붙인다.
- 통화 스크립트와 안내 문자에서 본인이 아니면 `이름님 보호자님`으로 부른다. 전화를 받는 사람이 환자가 아닐 수 있기 때문이다.
- 실제 환자 정보는 코드·문서·커밋·캡처에 넣지 않는다. 예시 환자로만 시험한다.
- 데이터베이스 변경은 `supabase/migrations`에 번호 순서로 남기고, 적용 후 `get_advisors`(security)를 돌린다. 시험용 행은 반드시 지운다.
- SQL 시험은 허용 계정 / 허용되지 않은 계정 / 로그인 안 함 세 경우를 확인한다. 허용 계정 컨텍스트는 아래 두 줄로 만든다.

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"doogieclinic@naver.com"}', true);
```

- `feat/v1`에 push하면 곧바로 실제 배포다. **push 전에 사용자에게 묻는다.**

---

### Task 1: 환자에 관계 열과 번호+이름 유일

**Files:**
- Create: `supabase/migrations/008_family.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Produces: `public.patients.relation text not null default 'self'`(일곱 값 중 하나), 유일 색인 `patients_phone_name_key (phone, name)`, 번호 단독 유일 제약 삭제

- [ ] **Step 1: 실패하는 시험 실행**

허용 계정 앞부분 + 아래.

```sql
insert into public.patients (name, phone, condition) values ('가족시험아이', '01011110001', 'cough');
```

Expected: ERROR `23505` (전화번호 유일 제약 위반). 지금은 한 번호에 한 명만 된다.

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/008_family.sql`:

```sql
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
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — name `family`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 기존 환자 확인**

```sql
select name, phone, relation from public.patients order by name;
```

Expected: 3행, 모두 `relation = 'self'`.

- [ ] **Step 5: 같은 번호에 다른 이름이 들어가는지**

허용 계정 앞부분 + 아래.

```sql
insert into public.patients (name, phone, condition, relation)
values ('가족시험아이', '01011110001', 'cough', 'child');
select name, relation from public.patients where phone = '01011110001' order by name;
```

Expected: 2행(`예시가` self, `가족시험아이` child).

- [ ] **Step 6: 같은 번호에 같은 이름은 막히는지**

```sql
insert into public.patients (name, phone, condition, relation)
values ('가족시험아이', '01011110001', 'cough', 'child');
```

Expected: ERROR `23505` (`patients_phone_name_key` 위반)

- [ ] **Step 7: 없는 관계 값이 막히는지**

```sql
insert into public.patients (name, phone, condition, relation)
values ('관계시험', '01099992001', 'cough', '삼촌');
```

Expected: ERROR `23514` (`patients_relation_check` 위반)

- [ ] **Step 8: 정리와 보안 점검**

```sql
delete from public.patients where name in ('가족시험아이', '관계시험');
select count(*) as 환자 from public.patients;
```

Expected: `환자 = 3`

MCP `get_advisors` type `security` → 새 WARN 없음.

- [ ] **Step 9: 커밋**

```bash
git add supabase/migrations/008_family.sql
git commit -F - <<'MSG'
feat: 환자에 가족 관계 열과 번호+이름 유일 색인

한 번호를 가족이 함께 쓴다. 환자를 번호가 아니라 번호와 이름으로 구분한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: 등록 함수가 가족을 구분하게

**Files:**
- Create: `supabase/migrations/009_family_rpc.sql`
- Test: Supabase MCP `execute_sql`

**Interfaces:**
- Consumes: Task 1의 `relation`
- Produces: `public.register_prescription(p_phone text, p_name text, p_relation text, p_condition text, p_condition_label text, p_prescribed_on date, p_shipped_on date, p_days int, p_runout_on date, p_calls jsonb) returns uuid` — 환자를 **번호+이름**으로 찾고, 없으면 관계와 함께 만든다

- [ ] **Step 1: 실패하는 시험 실행**

허용 계정 앞부분 + 아래.

```sql
select public.register_prescription('01099992002', '관계시험', 'child', 'cough', '',
  current_date, current_date, 7, current_date + 7, '[]'::jsonb);
```

Expected: ERROR `42883` (인자가 열 개인 함수가 없다)

- [ ] **Step 2: 마이그레이션 파일 쓰기**

`supabase/migrations/009_family_rpc.sql`:

```sql
-- 같은 번호에 여러 환자가 있을 수 있으므로 번호와 이름으로 찾는다.
drop function if exists public.register_prescription(text, text, text, text, date, date, int, date, jsonb);

create function public.register_prescription(
  p_phone text,
  p_name text,
  p_relation text,
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
  select id into v_patient_id from patients where phone = p_phone and name = p_name;

  if v_patient_id is null then
    insert into patients (name, phone, relation, condition, condition_label)
    values (p_name, p_phone, coalesce(nullif(p_relation, ''), 'self'), p_condition, nullif(p_condition_label, ''))
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

revoke all on function public.register_prescription(text, text, text, text, text, date, date, int, date, jsonb) from public, anon;
grant execute on function public.register_prescription(text, text, text, text, text, date, date, int, date, jsonb) to authenticated;
```

- [ ] **Step 3: 적용**

MCP `apply_migration` — name `family_rpc`, query는 위 파일 전체.
Expected: `{"success":true}`

- [ ] **Step 4: 가족 두 명이 각각 등록되는지**

허용 계정 앞부분 + 아래.

```sql
select public.register_prescription('01099992003', '가족시험엄마', 'self', 'urticaria', '',
  current_date, current_date, 7, current_date + 7, '[{"kind":"pre_runout","dueOn":"2026-10-02"}]'::jsonb);
select public.register_prescription('01099992003', '가족시험아이', 'child', 'cough', '',
  current_date, current_date, 7, current_date + 7, '[{"kind":"pre_runout","dueOn":"2026-10-02"}]'::jsonb);
select name, relation, (select count(*) from prescriptions r where r.patient_id = p.id) as 처방
from patients p where phone = '01099992003' order by name;
```

Expected: 2행. `가족시험아이`(child) 처방 1건, `가족시험엄마`(self) 처방 1건.

- [ ] **Step 5: 같은 사람에 처방만 더해지는지**

```sql
select public.register_prescription('01099992003', '가족시험아이', 'child', 'cough', '',
  current_date, current_date, 10, current_date + 10, '[]'::jsonb);
select count(*) as 환자수 from patients where phone = '01099992003';
select name, (select count(*) from prescriptions r where r.patient_id = p.id) as 처방
from patients p where phone = '01099992003' order by name;
```

Expected: `환자수 = 2`, `가족시험아이`의 처방이 2건.

- [ ] **Step 6: 정리와 보안 점검**

```sql
delete from public.patients where phone = '01099992003';
select (select count(*) from public.patients) as 환자, (select count(*) from public.calls) as 콜;
```

Expected: `환자 = 3`, `콜 = 5`

MCP `get_advisors` type `security` → 새 WARN 없음.

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations/009_family_rpc.sql
git commit -F - <<'MSG'
feat: 등록 함수가 번호와 이름으로 환자를 찾게

같은 번호에 가족이 여러 명 있을 수 있다. 없는 사람이면 관계와 함께 새로 만든다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: 관계 이름과 부르는 말

**Files:**
- Modify: `js/texts.js`, `tests/texts.test.js`, `js/model.js`, `tests/model.test.js`

**Interfaces:**
- Produces:
  - `RELATION_LABELS` — `{ self: '본인', mother: '모', father: '부', grandmother: '조모', grandfather: '조부', child: '자녀', other: '기타' }`
  - `RELATION_PRESETS: [key, label][]` — 등록 창 버튼 순서
  - `patientLabel(patient): string` — 본인이면 이름, 아니면 `이름 (자녀)`
  - `addressName(patient): string` — 본인이면 이름, 아니면 `이름님 보호자`
  - `buildEscalationText({ name, ... })`의 `name`에는 `patientLabel` 결과를 넣는다(함수는 그대로)
  - `model.toPatient` 결과에 `relation` 추가(없으면 `'self'`)

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/texts.test.js` import에 `RELATION_LABELS, patientLabel, addressName`을 더하고 파일 끝에 붙인다.

```js
test('관계 이름은 일곱 개', () => {
  assert.deepEqual(Object.keys(RELATION_LABELS), ['self', 'mother', 'father', 'grandmother', 'grandfather', 'child', 'other']);
  assert.equal(RELATION_LABELS.child, '자녀');
});

test('본인이면 이름만, 아니면 관계를 붙인다', () => {
  assert.equal(patientLabel({ name: '홍길동', relation: 'self' }), '홍길동');
  assert.equal(patientLabel({ name: '홍길동' }), '홍길동');
  assert.equal(patientLabel({ name: '홍아이', relation: 'child' }), '홍아이 (자녀)');
  assert.equal(patientLabel({ name: '홍모', relation: 'mother' }), '홍모 (모)');
});

test('본인이 아니면 보호자를 부른다', () => {
  assert.equal(addressName({ name: '홍길동', relation: 'self' }), '홍길동');
  assert.equal(addressName({ name: '홍아이', relation: 'child' }), '홍아이님 보호자');
});
```

`tests/model.test.js` 끝에 붙인다.

```js
test('관계가 없으면 본인으로 본다', () => {
  const p = toPatient({ id: 'p1', name: '가환자', phone: '01011110001', condition: 'cough', condition_label: null, prescriptions: [] });
  assert.equal(p.relation, 'self');
  const q = toPatient({ id: 'p2', name: '나환자', phone: '01011110001', condition: 'cough', condition_label: null, relation: 'child', prescriptions: [] });
  assert.equal(q.relation, 'child');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL 2건 이상. `RELATION_LABELS is not defined`, `relation`이 `undefined`.

- [ ] **Step 3: `js/texts.js`에 더하기**

`DAYS_PRESETS` 줄 아래에 붙인다.

```js
export const RELATION_LABELS = {
  self: '본인', mother: '모', father: '부', grandmother: '조모', grandfather: '조부', child: '자녀', other: '기타',
};

export const RELATION_PRESETS = Object.entries(RELATION_LABELS);
```

파일 끝에 붙인다.

```js
// 화면에 쓰는 이름. 전화할 때 누구 이야기인지 바로 알 수 있게 관계를 붙인다.
export function patientLabel(patient) {
  const name = String(patient?.name ?? '');
  const relation = patient?.relation ?? 'self';
  if (!relation || relation === 'self') return name;
  return `${name} (${RELATION_LABELS[relation] ?? RELATION_LABELS.other})`;
}

// 통화와 문자에서 부르는 말. 본인이 아니면 전화를 받는 사람은 보호자다.
export function addressName(patient) {
  const name = String(patient?.name ?? '');
  const relation = patient?.relation ?? 'self';
  if (!relation || relation === 'self') return name;
  return `${name}님 보호자`;
}
```

- [ ] **Step 4: `js/model.js`에 더하기**

`toPatient`의 반환에 관계를 더한다.

```js
export function toPatient(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    relation: row.relation ?? 'self',
    condition: row.condition,
    conditionLabel: row.condition_label ?? '',
    prescriptions: (row.prescriptions ?? []).map((r) => toPrescription(r, row.id)).sort(newestFirst('prescribedOn')),
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, 실패 0

- [ ] **Step 6: 커밋**

```bash
git add js/texts.js tests/texts.test.js js/model.js tests/model.test.js
git commit -F - <<'MSG'
feat: 가족 관계 이름과 부르는 말

본인이 아니면 화면에 관계를 붙이고, 통화와 문자에서는 보호자를 부른다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: 등록 창에서 가족 고르기와 화면 표시

**Files:**
- Modify: `js/store.js`, `js/ui.js`, `css/app.css`

**Interfaces:**
- Consumes: Task 2의 함수, Task 3의 `patientLabel`·`addressName`·`RELATION_PRESETS`
- Produces:
  - `store.findPatientsByPhone(phone): Promise<[{ id, name, relation, condition, conditionLabel }]>` — `findPatientByPhone`을 대신한다
  - `store.registerPrescription({ ..., relation })`
  - 등록 창: 번호를 넣으면 그 번호의 가족이 카드로 보이고, 한 명을 고르거나 "가족 새로 등록"을 고른다
  - 콜 카드·표·상세·통화 창·문자 창·전달 창에 `patientLabel` 표시

- [ ] **Step 1: `js/store.js` 고치기**

`findPatientByPhone`을 통째로 바꾼다.

```js
export async function findPatientsByPhone(phone) {
  const { data, error } = await supabase
    .from('patients')
    .select('id, name, relation, condition, condition_label')
    .eq('phone', phone)
    .order('created_at');
  check(error);
  return (data ?? []).map((d) => ({
    id: d.id, name: d.name, relation: d.relation ?? 'self', condition: d.condition, conditionLabel: d.condition_label ?? '',
  }));
}
```

`registerPrescription`의 인자와 호출에 관계를 더한다.

```js
export async function registerPrescription({ phone, name, relation, condition, conditionLabel, prescribedOn, shippedOn, days, runoutOn, calls }) {
  const { data, error } = await supabase.rpc('register_prescription', {
    p_phone: phone,
    p_name: name,
    p_relation: relation ?? 'self',
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
```

또한 `PATIENT_SELECT`의 첫 줄에 `relation`을 더한다.

```js
  id, name, phone, relation, condition, condition_label, created_at,
```

- [ ] **Step 2: `css/app.css`에 가족 카드 모양 더하기**

파일 끝에 덧붙인다.

```css
.fam-list{display:flex; flex-direction:column; gap:6px; margin-bottom:6px;}
.fam-opt{display:flex; justify-content:space-between; align-items:center; gap:8px; border:1px solid var(--border-strong); background:var(--surface); border-radius:10px; padding:9px 12px; font-size:13px; text-align:left; width:100%;}
.fam-opt.selected{background:var(--accent-soft); border-color:var(--accent);}
.fam-opt .who{font-weight:700;}
.fam-opt .what{font-size:12px; color:var(--text-muted);}
```

- [ ] **Step 3: `js/ui.js` 등록 창 고치기**

import에 `patientLabel, addressName, RELATION_PRESETS`를 더한다.

등록 창의 전화번호 칸 아래(`<div class="field-row">` 앞)에 가족 목록 자리를 만든다.

```html
    <div class="field" id="rg-family-field" hidden>
      <label>이 번호로 등록된 가족</label>
      <div class="fam-list" id="rg-family"></div>
    </div>
```

이름 칸 아래(같은 `field-row` 안, 증상 칸 앞)에 관계 칸을 만든다. `field-row`를 아래로 바꾼다.

```html
    <div class="field-row">
      <div class="field"><label>환자명 *</label><input type="text" id="rg-name" maxlength="50"></div>
      <div class="field"><label>증상</label>${pillGroup('rg-condition', Object.entries(CONDITION_LABELS), form.condition)}</div>
    </div>
    <div class="field" id="rg-relation-field">
      <label>이 번호의 주인과의 관계</label>
      ${pillGroup('rg-relation', RELATION_PRESETS, 'self')}
      <span class="field-hint">전화를 받는 분이 환자가 아닐 때 '자녀', '모'처럼 골라주세요.</span>
    </div>
```

`form`에 고른 사람을 둔다.

```js
  const form = { condition: 'urticaria', existing: null, relation: 'self', family: [], lookup: 0 };
```

가족 목록을 그리고 고르는 함수를 `setCondition` 아래에 둔다.

```js
  const renderFamily = () => {
    const field = $('rg-family-field');
    if (form.family.length === 0) { field.hidden = true; $('rg-family').innerHTML = ''; return; }
    field.hidden = false;
    const options = form.family.map((p) => `
      <button type="button" class="fam-opt${form.existing && form.existing.id === p.id ? ' selected' : ''}" data-pick="${p.id}">
        <span class="who">${esc(patientLabel(p))}</span>
        <span class="what">${esc(conditionText(p.condition, p.conditionLabel))} · 이 사람에 처방 추가</span>
      </button>`).join('');
    $('rg-family').innerHTML = `${options}
      <button type="button" class="fam-opt${form.existing ? '' : ' selected'}" data-pick="new">
        <span class="who">＋ 가족 새로 등록</span>
        <span class="what">같은 번호에 다른 사람을 더해요</span>
      </button>`;
  };

  const pickPatient = (id) => {
    form.existing = id === 'new' ? null : form.family.find((p) => p.id === id) ?? null;
    if (form.existing) {
      $('rg-name').value = form.existing.name;
      $('rg-name').disabled = true;
      $('rg-other').value = form.existing.conditionLabel;
      setCondition(form.existing.condition, true);
      form.relation = form.existing.relation;
      $('rg-relation-field').hidden = true;
    } else {
      $('rg-name').value = '';
      $('rg-name').disabled = false;
      setCondition(form.condition, false);
      form.relation = 'self';
      selectPill('rg-relation', 'self');
      $('rg-relation-field').hidden = form.family.length === 0 && false;
      $('rg-relation-field').hidden = false;
    }
    renderFamily();
  };
```

전화번호 입력 처리를 아래로 바꾼다.

```js
  $('rg-phone').addEventListener('input', async () => {
    const phone = normalizePhone($('rg-phone').value);
    const token = ++form.lookup;
    form.existing = null;
    form.family = [];
    $('rg-existing').textContent = '';
    $('rg-name').disabled = false;
    setCondition(form.condition, false);
    renderFamily();
    if (!isValidPhone(phone)) return;
    try {
      const found = await store.findPatientsByPhone(phone);
      if (token !== form.lookup) return;
      form.family = found;
      if (found.length > 0) {
        $('rg-existing').textContent = `이 번호로 ${found.length}명이 등록돼 있어요. 아래에서 고르거나 새로 등록하세요.`;
        pickPatient(found[0].id);
      } else {
        renderFamily();
      }
    } catch (err) {
      console.error(err);
    }
  });
```

가족 목록과 관계 버튼 클릭을 연결한다(`rg-condition` 처리 옆).

```js
  $('rg-family').addEventListener('click', (e) => {
    const b = e.target.closest('.fam-opt');
    if (b) pickPatient(b.dataset.pick);
  });

  $('rg-relation').addEventListener('click', (e) => {
    const b = e.target.closest('.pill-opt');
    if (!b) return;
    form.relation = b.dataset.val;
    selectPill('rg-relation', b.dataset.val);
  });
```

저장 호출에 관계를 더한다.

```js
      name: form.existing ? form.existing.name : name,
      relation: form.existing ? form.existing.relation : form.relation,
```

- [ ] **Step 4: 이름이 보이는 곳에 관계 붙이기**

아래 자리의 `patient.name`을 `patientLabel(patient)`로 바꾼다(모두 `esc()` 안).

- 콜 카드의 `<div class="case-name">`
- 다가오는 콜 줄의 `<span>`
- 원장 전달 카드와 내원 예약 카드의 `<div class="case-name">`
- 발송 대기 카드의 `<div class="case-name">`
- 전체 환자 표의 이름 칸
- 상세 창 제목, 통화 창 제목, 문자 창 제목, 원장 전달 창 제목, 발송일 입력 창 제목

통화 스크립트와 문자, 전달 문구는 부르는 말을 쓴다.

```js
    condition: patient.condition, kind: call.kind, name: addressName(patient),
```

```js
  const text = fillTemplate(scriptsWithDefaults().sms_no_answer, { name: addressName(patient) });
```

```js
    name: patientLabel(patient), condition: patient.condition, conditionLabel: patient.conditionLabel, note: call.note,
```

- [ ] **Step 5: 확인**

- Run: `node --check js/ui.js && node --check js/store.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0
- Run: `grep -n "findPatientByPhone" js/` → Expected: 결과 없음

- [ ] **Step 6: 커밋**

```bash
git add js/store.js js/ui.js css/app.css
git commit -F - <<'MSG'
feat: 등록 창에서 가족을 고르고 화면에 관계 표시

같은 번호에 등록된 가족을 보여주고, 그 사람에 처방을 더하거나 새 가족을
등록한다. 콜 카드와 문구에는 누구 이야기인지 관계까지 보인다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: 화면 확인과 문서

**Files:**
- Modify: `CLAUDE.md`
- Test: 로컬 서버와 브라우저, MCP `execute_sql`

- [ ] **Step 1: 가족 두 명 등록해 보기**

로컬 서버를 켜고 "+ 처방 등록"에서 번호 `01099993001`, 이름 `시험엄마`, 관계 **본인**, 두드러기, 7일분, 발송일 오늘로 등록한다.
다시 "+ 처방 등록"에서 같은 번호를 넣는다.

Expected: "이 번호로 1명이 등록돼 있어요" 안내와 함께 `시험엄마` 카드가 보인다. **＋ 가족 새로 등록**을 고르면 이름 칸이 비고 관계 버튼이 나온다. 이름 `시험아이`, 관계 **자녀**, 기침, 7일분으로 등록하면 저장된다.

- [ ] **Step 2: 화면에 관계가 보이는지**

Expected: 오늘 콜/다가오는 콜과 전체 환자 표에서 `시험아이 (자녀)`로 보인다. `시험엄마`는 이름만 보인다.

- [ ] **Step 3: 부르는 말 확인**

`시험아이`의 콜에서 "📞 통화 기록"을 연다.
Expected: 창 제목이 `통화 기록 · 시험아이 (자녀)`이고, 스크립트 첫 줄이 `안녕하세요, 시험아이님 보호자님.`으로 시작한다.

- [ ] **Step 4: 같은 사람에 처방 더하기**

같은 번호로 다시 등록 창을 열어 `시험아이` 카드를 고르고 10일분으로 등록한다.

```sql
select p.name, p.relation, count(r.id) as 처방
from patients p left join prescriptions r on r.patient_id = p.id
where p.phone = '01099993001' group by p.name, p.relation order by p.name;
```

Expected: 환자는 2명 그대로, `시험아이`의 처방이 2건.

- [ ] **Step 5: 정리**

```sql
delete from public.patients where phone = '01099993001';
select (select count(*) from public.patients) as 환자, (select count(*) from public.calls) as 콜;
```

Expected: `환자 = 3`, `콜 = 5`

- [ ] **Step 6: `CLAUDE.md` 고치기**

"## 해피콜 운영 규칙"에 덧붙인다.

```markdown
- 환자는 전화번호가 아니라 **전화번호 + 이름**으로 구분한다. 한 번호에 가족 여러 명이 등록된다.
- 본인이 아닌 환자는 화면에 `이름 (자녀)`처럼 관계를 붙이고, 통화·문자에서는 `이름님 보호자님`으로 부른다.
```

"## V2에서 할 일"의 2번 줄에서 가족 환자를 완료로 표시한다.

```markdown
2. **기준 변경**: ~~약 발송일 기준, 발송 대기 상태, 7일분 추가~~ (2026-09-27 완료), ~~가족 환자 등록(같은 번호에 관계 표시)~~ (2026-09-27 완료)
```

- [ ] **Step 7: 커밋**

```bash
git add CLAUDE.md
git commit -F - <<'MSG'
docs: 가족 환자 규칙을 규칙 파일에 반영

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 8: 올릴지 묻기**

`npm test` 통과와 예시 데이터만 남았는지 확인하고 **사용자에게 물어본 뒤에만** push한다.

---

## 이 계획에서 하지 않는 것

- 이미 등록된 환자의 관계를 나중에 고치는 화면. 필요하면 다음 단계에서 상세 창에 넣는다.
- 가족을 하나의 묶음으로 보는 화면(가족 단위 목록).
- 전화번호가 바뀌었을 때 가족 전체를 함께 옮기는 기능.
