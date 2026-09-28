# V2 6단계: 휴지통과 백업 내보내기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax로 추적한다.

**Goal:** 잘못 등록한 환자와 처방을 **되돌릴 수 있게** 지우고(휴지통), 지금까지의 데이터를 **파일 하나로 내려받아** 보관할 수 있게 한다. 실제 환자 정보를 넣기 전에 반드시 있어야 하는 두 가지다.

**Architecture:** 지우는 것은 행을 없애지 않고 `deleted_at`에 시각을 적는 방식이다(되돌리기 가능). 화면은 지워지지 않은 것만 보여주고, **관리** 탭에서 휴지통을 보고 되돌린다. 백업은 이미 불러온 데이터로 브라우저에서 파일을 만들어 내려받는다(서버 작업 없음). 백업 파일의 모양을 만드는 부분은 `js/backup.js`의 순수 함수로 두고 Node 테스트로 검증한다.

**Tech Stack:** 정적 HTML + ES 모듈(빌드 없음), Supabase Postgres + RLS, Node 24 `node:test`, Vercel 배포(`feat/v1` = production)

**Spec:** `docs/superpowers/specs/2026-09-26-happycall-v2-design.md` 10장 추천 4 (실제 환자 전환 전 필수: 삭제 대신 휴지통, 데이터 내보내기 백업)

## Global Constraints

- **행을 실제로 지우지 않는다.** 환자와 처방에 `deleted_at`을 적고 화면에서만 숨긴다. 통화 기록과 부재 기록은 그대로 남는다.
- 환자를 지우면 그 환자의 처방과 콜도 화면에서 함께 사라진다. 되돌리면 함께 돌아온다.
- **지울 때 이유를 받는다.** 지운 것과 되돌린 것 모두 `change_logs`에 남는다.
- 휴지통에서 **영구 삭제는 하지 않는다.** 보관 기간과 파기 기준은 원장님이 정한 뒤에 만든다.
- 백업 파일에는 **지워진 것까지 모두** 담는다. 되살릴 수 없는 백업은 백업이 아니다.
- 백업 파일은 개인정보가 담긴 파일이다. 화면에 "안전한 곳에 보관하세요" 안내를 함께 둔다.
- 실제 환자 정보는 코드·문서·커밋·캡처에 넣지 않는다. 예시 환자로만 시험한다.
- 데이터베이스 변경은 `supabase/migrations`에 번호 순서로 남기고, 적용 후 `get_advisors`(security)를 돌린다. 시험용 행은 반드시 지운다.
- 새 기능도 세 경우(허용 계정 / 허용되지 않은 계정 / 로그인 안 함)로 확인한다. 허용 계정 컨텍스트:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"doogieclinic@naver.com"}', true);
```

- `feat/v1`에 push하면 곧바로 실제 배포다. **push 전에 사용자에게 묻는다.**

---

### Task 1: 지워진 표시 자리 (마이그레이션 015)

**Files:** Create `supabase/migrations/015_soft_delete.sql`

**Produces:** `patients.deleted_at`, `prescriptions.deleted_at`, `change_logs.target_type`에 `'patient'` 허용

- [ ] **Step 1: 실패 확인** — `select deleted_at from public.patients limit 1;` → ERROR 42703
- [ ] **Step 2: 파일 쓰기**

```sql
-- 지운 것을 되돌릴 수 있어야 한다. 행을 없애지 않고 지운 시각만 적는다.
alter table public.patients add column if not exists deleted_at timestamptz;
alter table public.prescriptions add column if not exists deleted_at timestamptz;

create index if not exists patients_deleted_idx on public.patients (deleted_at);
create index if not exists prescriptions_deleted_idx on public.prescriptions (deleted_at);

alter table public.change_logs drop constraint if exists change_logs_target_type_check;
alter table public.change_logs add constraint change_logs_target_type_check
  check (target_type in ('prescription', 'call', 'patient'));
```

- [ ] **Step 3: 적용** — MCP `apply_migration` name `soft_delete` → `{"success":true}`
- [ ] **Step 4: 확인** — 환자 3명의 `deleted_at`이 모두 null. `target_type = 'patient'` 기록이 들어갔다 지워진다
- [ ] **Step 5: 보안 점검 후 커밋** — `get_advisors` 새 WARN 없음

---

### Task 2: 지우고 되돌리는 함수 (마이그레이션 016)

**Files:** Create `supabase/migrations/016_trash_rpc.sql`

**Produces:** `trash_patient(uuid, text)`, `restore_patient(uuid)`, `trash_prescription(uuid, text)`, `restore_prescription(uuid)`
- 이미 처리된 대상이면 `이미 처리됐습니다` 예외, 이유가 비면 `바꾼 이유를 적어주세요` 예외

- [ ] **Step 1: 실패 확인** — `select public.trash_patient('00000000-0000-0000-0000-000000000000'::uuid, '시험');` → ERROR 42883
- [ ] **Step 2: 파일 쓰기** — 네 함수 모두 `security invoker`, `search_path = public`. 담당자는 `allowed_emails.display_name`에서 채우고, 결과를 `change_logs`에 남긴다. 지우기는 `deleted_at is null`일 때만, 되돌리기는 `deleted_at is not null`일 때만 갱신하고 대상이 없으면 예외를 던진다. 네 함수 모두 `revoke ... from public, anon` 후 `grant execute ... to authenticated`
- [ ] **Step 3: 적용** — name `trash_rpc`
- [ ] **Step 4: 시험 환자 등록 후 지우기** — `지워짐 = true`, 기록에 `환자 … 휴지통으로`
- [ ] **Step 5: 두 번 지우기** → `이미 처리됐습니다`
- [ ] **Step 6: 되돌리기** → `deleted_at`이 null, 기록에 `환자 … 되돌림`
- [ ] **Step 7: 이유 없이 지우기** → `바꾼 이유를 적어주세요`. 처방 지우기도 확인
- [ ] **Step 8: 허용되지 않은 계정** → 막힌다
- [ ] **Step 9: 정리(시험 환자 삭제·기록 삭제)와 보안 점검, 커밋**

---

### Task 3: 백업 파일 모양

**Files:** Create `js/backup.js`, `tests/backup.test.js`

**Produces:** `buildBackup({ patients, scripts, changes, generatedAt })`, `backupFileName(generatedAt)`

- [ ] **Step 1: 실패하는 테스트 쓰기** — 개수 집계(`patients/prescriptions/calls/attempts/changes`), 지워진 것 포함, 파일 이름 `두기해피콜-백업-YYYY-MM-DD.json`
- [ ] **Step 2: 실패 확인** — `npm test` → `Cannot find module '../js/backup.js'`
- [ ] **Step 3: 구현**

```js
export function buildBackup({ patients, scripts, changes, generatedAt }) {
  const list = patients ?? [];
  const prescriptions = list.flatMap((p) => p.prescriptions ?? []);
  const calls = prescriptions.flatMap((r) => r.calls ?? []);
  const attempts = calls.flatMap((c) => c.attempts ?? []);
  return {
    app: '두기 해피콜',
    version: 1,
    generatedAt,
    counts: {
      patients: list.length,
      prescriptions: prescriptions.length,
      calls: calls.length,
      attempts: attempts.length,
      changes: (changes ?? []).length,
    },
    patients: list,
    scripts: scripts ?? {},
    changes: changes ?? [],
  };
}

export function backupFileName(generatedAt) {
  return `두기해피콜-백업-${String(generatedAt).slice(0, 10)}.json`;
}
```

- [ ] **Step 4: 통과 확인** — `npm test`
- [ ] **Step 5: 커밋**

---

### Task 4: 지워진 것 가려내기

**Files:** Modify `js/store.js`, `js/model.js`, `tests/model.test.js`

**Produces:** `store.trashPatient/restorePatient/trashPrescription/restorePrescription`, 조회에 `deleted_at` 포함, `model.livePatients`, `model.trashRows`, `toPatient`에 `deletedAt`

- [ ] **Step 1: 실패하는 테스트 쓰기** — 화면에는 살아 있는 것만, 휴지통은 최근 지운 것부터
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: `js/model.js` 고치기** — `deletedAt` 매핑, `livePatients`, `trashRows`
- [ ] **Step 4: `js/store.js` 고치기** — `PATIENT_SELECT`에 `deleted_at` 두 줄, 네 함수 추가, 충돌 문구에 `이미 처리됐습니다` 추가
- [ ] **Step 5: 통과 확인**
- [ ] **Step 6: 커밋**

---

### Task 5: 관리 탭 — 백업과 휴지통

**Files:** Modify `index.html`, `js/ui.js`, `css/app.css`

**Produces:** 탭 `관리`(휴지통 숫자), 백업 내려받기 버튼, 휴지통 목록과 되돌리기, 상세 창의 지우기 버튼과 이유 창

- [ ] **Step 1: `index.html`** — `관리` 탭 버튼과 `panel-admin`
- [ ] **Step 2: `css/app.css`** — `.admin-box`, `.trash-row`
- [ ] **Step 3: `js/ui.js` 상태** — `state.allPatients`, `refresh()`에서 `livePatients`로 화면용 목록 만들기, `render()`에서 `trashRows` 숫자
- [ ] **Step 4: `renderAdmin(trash)`** — 백업 안내와 버튼, 휴지통 목록(되돌리기 버튼)
- [ ] **Step 5: `downloadBackup()`** — `buildBackup` → Blob → `a.download = backupFileName(...)` → toast로 개수 알림
- [ ] **Step 6: 상세 창 버튼** — 처방마다 `🗑 처방 지우기`, 바닥에 `🗑 환자 지우기`
- [ ] **Step 7: `openTrashModal(kind, id, title)`** — 이유 필수, 저장 후 상세 닫기
- [ ] **Step 8: 확인** — `node --check`, `npm test`
- [ ] **Step 9: 커밋**

---

### Task 6: 화면 확인과 문서

- [ ] **Step 1** 시험 환자 등록 후 `🗑 환자 지우기` → 목록에서 사라지고 관리 탭 숫자 1 증가
- [ ] **Step 2** 휴지통에서 `되돌리기` → 목록에 다시 나타남
- [ ] **Step 3** `🗑 처방 지우기` → 환자는 남고 그 처방·콜만 사라짐, 되돌리기 확인
- [ ] **Step 4** `💾 백업 파일 받기` → `두기해피콜-백업-2026-09-28.json` 내려받기, 개수 안내 확인
- [ ] **Step 5** 시험 데이터 정리 → 환자 3명·콜 5건·기록 0건
- [ ] **Step 6** `CLAUDE.md`와 `README.md`에 휴지통·백업 규칙 반영
- [ ] **Step 7** 커밋
- [ ] **Step 8** 올릴지 묻기

---

## 이 계획에서 하지 않는 것

- 영구 삭제와 보관 기간에 따른 자동 파기. 원장님이 기준을 정한 뒤에 만든다.
- 백업 파일을 다시 불러오는 복원 기능.
- 정해진 시각에 자동으로 받는 백업.
- 콜 하나만 지우는 기능. 콜은 처방을 지우면 함께 숨는다.
