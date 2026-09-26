# 두기 해피콜 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 "두기 해피콜" Artifact 화면을 빌드 없는 정적 웹앱으로 옮기고, 처방 한 건마다 콜을 자동으로 잡는 운영 규칙과 Supabase 저장·이메일 로그인을 붙인다.

**Architecture:** `index.html` 한 장과 작은 ES 모듈 몇 개로 된 정적 사이트다. 날짜·일정·재시도 규칙과 문구 생성은 브라우저 API를 쓰지 않는 순수 함수(`js/schedule.js`, `js/texts.js`, `js/model.js`)로 분리해 Node 내장 테스트로 검증한다. 저장은 Supabase이며, 여러 테이블을 함께 바꾸는 등록과 통화 결과 저장은 데이터베이스 함수 두 개로 한 번에 처리한다.

**Tech Stack:** HTML/CSS/바닐라 JS(ES 모듈), `@supabase/supabase-js@2.116.0`(jsDelivr `+esm`), Node 24 `node:test`, Supabase(Postgres, Auth 매직 링크, RLS), Vercel(정적 배포).

**Spec:** `C:/Users/User.DESKTOP-BLBKBC2/ops-os/customer-view-os-workshop/05_3회차준비과제/닥터두기/2_기획안_V1_V2.md` (커밋 785d918). 이 계획은 스펙을 근거로 한다. 실행자는 두 문서를 함께 읽는다.

## Global Constraints

- 처방 일수는 1~90일만 받는다.
- 전화번호는 숫자 10~11자리만 받고, 하이픈을 떼고 저장한다. 전화번호가 환자 고유값이다.
- 소진일 = 처방일 + 처방 일수.
- 중간 콜 = 처방일 + 처방 일수의 절반(소수점 버림). **처방 일수 15일 이하면 만들지 않는다.**
- 소진 전 콜 = 소진일 3일 전.
- 계산된 날이 **목요일이면 수요일, 일요일이면 토요일**로 당긴다.
- 부재중은 다음 콜 요일로 미룬다(목·일 건너뜀). **3회째 부재면** 문자 문구를 띄우고 그 콜만 마감한다.
- 소진 전 콜: 다음 재시도 날이 **소진일과 같거나 늦으면** 3회 전이라도 바로 문자 문구를 띄운다.
- 중간 콜: 다음 재시도 날이 소진 전 콜 예정일과 같거나 늦으면 문자 없이 중간 콜만 마감한다.
- 문자 창을 닫고 "문자 보냈음"을 누르지 않으면 오늘 목록에 "문자 대기"로 남는다.
- 악화는 "원장 전달 필요" 탭에 올리고 내원 필요를 자동 체크한다. "메신저로 전달함"을 누를 때까지 남는다.
- 원장 전달 문구에는 이름, 증상, 통화 메모가 들어간다.
- 등록 창 처방 일수 버튼은 30일, 15일, 10일이다.
- 예정일 전인 콜도 환자 상세에서 통화 기록·부재중 처리할 수 있다.
- 기존 화면과 색은 그대로 둔다.
- 이번 주는 예시 환자로만 검증한다. 실제 환자 정보는 넣지 않는다.
- Supabase 프로젝트는 `yblqrtwbvqrshqmnizij`(twobiggi-cloud's Project)다. 스키마 001·002는 이미 적용돼 있다.
- 로그인은 이메일 매직 링크, 허용 이메일은 `allowed_emails` 표에 등록된 계정 하나다. 앱 사용자 생성과 신규 가입 차단은 끝나 있다.
- 앱에는 publishable 키만 넣는다. `service_role` 키는 저장소·앱 어디에도 넣지 않는다.
- 날짜는 브라우저 로컬(한국 시간) 기준 `YYYY-MM-DD` 문자열로 다룬다.
- 빌드 단계를 두지 않는다. 외부 연동은 Supabase와 Vercel뿐이다. 한의사랑·카카오·문자 자동 발송은 연동하지 않는다.
- git: `feat/v1` 브랜치에서 작업하고 태스크마다 커밋한다. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`를 넣는다. push는 사용자에게 묻고 한다.

## 스펙에 없어서 이 계획이 정한 것

실행 전에 사용자에게 보여주고 확인받는다. 바뀌면 해당 태스크의 테스트부터 고친다.

1. **파일 구성:** 스펙의 "HTML 한 파일"은 "빌드 없이 파일만 올리는 정적 앱"으로 해석한다. 일정 규칙을 자동 테스트하려고 `index.html`과 JS 모듈 몇 개로 나눈다.
2. **짧은 처방:** 소진 전 콜 날짜가 처방일보다 앞서면 처방일로 한다. 처방일이 목·일이면 다음 콜 요일로 한다. (예: 2일 처방)
3. **겹칠 때 우선순위:** 중간 콜이 3회째 부재이면서 재시도 한계에도 닿으면, 문자 없이 마감한다. 소진 전 콜이 곧 이어받기 때문이다.
4. **처방 마감 시점 추가:** 소진 전 콜이 부재로 끝나 "문자 보냈음"을 누르면 처방도 마감한다.
5. **한 번에 저장:** 등록(환자·처방·콜)과 통화 결과(시도 기록·콜·처방)는 데이터베이스 함수로 한 번에 저장한다. 중간에 끊겨도 반쪽 데이터가 남지 않는다.

## 파일 구조

```
doogie-happycall/
  .gitignore
  .vercelignore
  package.json                 # "type": "module", 테스트·로컬 서버 명령
  README.md                    # 실행·테스트·배포 방법
  index.html                   # 화면 뼈대
  css/app.css                  # 기존 Artifact 스타일 + 추가 스타일
  js/config.js                 # Supabase 주소와 publishable 키
  js/schedule.js               # 날짜·일정·재시도 규칙 (순수 함수)
  js/texts.js                  # 라벨, 기본 스크립트, 문구 생성, 입력 검사 (순수 함수)
  js/model.js                  # DB 행 → 화면용 객체, 목록 고르기 (순수 함수)
  js/store.js                  # Supabase 읽기·쓰기, 로그인
  js/ui.js                     # 화면 그리기, 모달, 버튼 동작
  js/main.js                   # 로그인 여부에 따라 로그인 화면/앱 전환
  scripts/serve.mjs            # 의존성 없는 로컬 정적 서버 (포트 5173)
  .claude/launch.json          # 미리보기 서버 설정
  supabase/migrations/001_init.sql
  supabase/migrations/002_move_is_allowed_to_private.sql
  supabase/migrations/003_rpc.sql
  tests/schedule.test.js
  tests/texts.test.js
  tests/model.test.js
  reference/artifact-original.html   # 옮기기 전 원본 (참고용)
  docs/superpowers/plans/2026-09-15-happycall-v1.md
```

## 테스트 전략

| 대상 | 방법 |
|---|---|
| `schedule.js`, `texts.js`, `model.js` | `npm test` (Node 내장 `node:test`) |
| 데이터베이스 함수와 RLS | Supabase MCP `execute_sql`로 역할과 JWT 이메일을 바꿔 실행 |
| 화면 흐름 | 사용자 Chrome에서 로그인한 뒤 Claude in Chrome 도구로 스펙의 완료 확인 1~7을 그대로 수행 |

매직 링크는 사용자의 메일에서 열리므로, 로그인이 필요한 화면 확인은 사용자 Chrome에서 한다. Claude in Chrome 확장이 연결돼 있지 않으면 사용자에게 같은 단계를 안내하고 결과를 받는다.

---

### Task 1: 일정 규칙

**Files:**
- Create: `package.json`, `.gitignore`, `js/schedule.js`
- Test: `tests/schedule.test.js`

**Interfaces:**
- Consumes: 없음
- Produces (모든 날짜는 `'YYYY-MM-DD'` 문자열):
  - `addDays(ymd: string, days: number): string`
  - `daysBetween(fromYmd: string, toYmd: string): number`
  - `isoDay(ymd: string): number` — 월=1 … 일=7
  - `isCallDay(ymd: string): boolean`
  - `pullBackToCallDay(ymd: string): string`
  - `nextCallDayAfter(ymd: string): string`
  - `todayYMD(now?: Date): string`
  - `runoutOn(prescribedOn: string, days: number): string`
  - `planCalls(prescribedOn: string, days: number): { runoutOn: string, calls: Array<{ kind: 'mid'|'pre_runout', dueOn: string }> }`
  - `hasPastCall(calls: Array<{dueOn: string}>, today: string): boolean`
  - `decideNoAnswer(call: { kind, noAnswerCount }, ctx: { today, runoutOn, preRunoutDueOn? }): { status: 'pending'|'sms_pending'|'closed_no_answer', dueOn: string|null, noAnswerCount: number }`
  - `decideSmsSent(call: { kind }): { status: 'closed_no_answer', closePrescription: 'completed'|null }`
  - `decideAnswered(call: { kind }, input: { result, note, visitNeeded, closeEarly }): { status: 'done', result, note, visitNeeded: boolean, escalation: 'pending'|'none', closePrescription: 'completed'|'early'|null }`
  - `defaultVisitNeededFor(result: string): boolean`
  - `isOnTodayList(call: { status, dueOn }, today: string): boolean`
  - `overdueDays(dueOn: string, today: string): number`

2026년 요일 참고: 9/10목 9/14월 9/15화 9/16수 9/17목 9/18금 9/19토 9/20일 9/21월 9/23수 9/25금 9/26토 9/27일 9/28월 9/30수 10/1목 10/2금 10/5월 10/10토 10/11일 10/12월 10/13화 10/15목 10/16금 10/28수 10/29목 10/31토.

- [ ] **Step 1: 프로젝트 설정 파일 만들기**

`package.json`:

```json
{
  "name": "doogie-happycall",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "serve": "node scripts/serve.mjs"
  }
}
```

`.gitignore`:

```
node_modules/
.vercel/
.env*
.DS_Store
```

- [ ] **Step 2: 실패하는 테스트 쓰기**

`tests/schedule.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, isoDay, isCallDay, pullBackToCallDay, nextCallDayAfter, todayYMD,
  runoutOn, planCalls, hasPastCall, decideNoAnswer, decideSmsSent, decideAnswered,
  defaultVisitNeededFor, isOnTodayList, overdueDays,
} from '../js/schedule.js';

test('addDays는 달이 바뀌어도 맞게 센다', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
});

test('daysBetween은 뒤 날짜가 크면 양수', () => {
  assert.equal(daysBetween('2026-09-15', '2026-09-18'), 3);
  assert.equal(daysBetween('2026-09-18', '2026-09-15'), -3);
});

test('isoDay는 월=1, 목=4, 일=7', () => {
  assert.equal(isoDay('2026-09-14'), 1);
  assert.equal(isoDay('2026-09-17'), 4);
  assert.equal(isoDay('2026-09-20'), 7);
});

test('목요일과 일요일은 콜 요일이 아니다', () => {
  assert.equal(isCallDay('2026-09-17'), false);
  assert.equal(isCallDay('2026-09-20'), false);
  assert.equal(isCallDay('2026-09-18'), true);
});

test('콜 없는 요일은 앞날로 당긴다', () => {
  assert.equal(pullBackToCallDay('2026-09-17'), '2026-09-16');
  assert.equal(pullBackToCallDay('2026-09-20'), '2026-09-19');
  assert.equal(pullBackToCallDay('2026-09-18'), '2026-09-18');
});

test('다음 콜 요일은 목·일을 건너뛴다', () => {
  assert.equal(nextCallDayAfter('2026-09-16'), '2026-09-18');
  assert.equal(nextCallDayAfter('2026-09-19'), '2026-09-21');
  assert.equal(nextCallDayAfter('2026-09-14'), '2026-09-15');
});

test('todayYMD는 브라우저 로컬 날짜를 쓴다', () => {
  assert.equal(todayYMD(new Date(2026, 8, 15, 23, 59)), '2026-09-15');
});

test('소진일은 처방일 + 처방 일수', () => {
  assert.equal(runoutOn('2026-09-15', 30), '2026-10-15');
});

test('30일 처방은 중간 콜과 소진 전 콜 두 건', () => {
  assert.deepEqual(planCalls('2026-09-15', 30), {
    runoutOn: '2026-10-15',
    calls: [
      { kind: 'mid', dueOn: '2026-09-30' },
      { kind: 'pre_runout', dueOn: '2026-10-12' },
    ],
  });
});

test('15일 처방은 중간 콜 없이 한 건, 일요일이면 토요일로', () => {
  assert.deepEqual(planCalls('2026-09-15', 15), {
    runoutOn: '2026-09-30',
    calls: [{ kind: 'pre_runout', dueOn: '2026-09-26' }],
  });
});

test('16일 처방부터 중간 콜이 생긴다', () => {
  assert.deepEqual(planCalls('2026-09-15', 16).calls, [
    { kind: 'mid', dueOn: '2026-09-23' },
    { kind: 'pre_runout', dueOn: '2026-09-28' },
  ]);
});

test('10일 처방에서 목요일에 걸린 소진 전 콜은 수요일로 당겨진다', () => {
  assert.deepEqual(planCalls('2026-09-10', 10), {
    runoutOn: '2026-09-20',
    calls: [{ kind: 'pre_runout', dueOn: '2026-09-16' }],
  });
});

test('콜이 처방일보다 앞서면 처방일로, 처방일이 쉬는 요일이면 다음 콜 요일로', () => {
  assert.equal(planCalls('2026-09-15', 2).calls[0].dueOn, '2026-09-15');
  assert.equal(planCalls('2026-09-20', 3).calls[0].dueOn, '2026-09-21');
});

test('hasPastCall은 오늘보다 앞선 콜이 있으면 참', () => {
  assert.equal(hasPastCall([{ dueOn: '2026-09-14' }], '2026-09-15'), true);
  assert.equal(hasPastCall([{ dueOn: '2026-09-15' }], '2026-09-15'), false);
});

test('소진 전 콜 첫 부재는 다음 콜 요일로 미룬다', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 0 }, { today: '2026-10-12', runoutOn: '2026-10-15' }),
    { status: 'pending', dueOn: '2026-10-13', noAnswerCount: 1 },
  );
});

test('소진 전 콜 부재 3회째면 문자 대기', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 2 }, { today: '2026-10-12', runoutOn: '2026-10-30' }),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 3 },
  );
});

test('소진 전 콜 다음 재시도가 소진일과 같으면 3회 전이라도 문자 대기', () => {
  assert.deepEqual(
    decideNoAnswer({ kind: 'pre_runout', noAnswerCount: 1 }, { today: '2026-09-23', runoutOn: '2026-09-25' }),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 2 },
  );
});

test('중간 콜 부재는 다음 콜 요일로 미룬다', () => {
  assert.deepEqual(
    decideNoAnswer(
      { kind: 'mid', noAnswerCount: 0 },
      { today: '2026-09-30', runoutOn: '2026-10-15', preRunoutDueOn: '2026-10-12' },
    ),
    { status: 'pending', dueOn: '2026-10-02', noAnswerCount: 1 },
  );
});

test('중간 콜 부재 3회째면 문자 대기', () => {
  assert.deepEqual(
    decideNoAnswer(
      { kind: 'mid', noAnswerCount: 2 },
      { today: '2026-10-05', runoutOn: '2026-10-15', preRunoutDueOn: '2026-10-12' },
    ),
    { status: 'sms_pending', dueOn: null, noAnswerCount: 3 },
  );
});

test('중간 콜 다음 재시도가 소진 전 콜 날짜에 닿으면 3회째여도 문자 없이 마감', () => {
  assert.deepEqual(
    decideNoAnswer(
      { kind: 'mid', noAnswerCount: 2 },
      { today: '2026-10-10', runoutOn: '2026-10-15', preRunoutDueOn: '2026-10-12' },
    ),
    { status: 'closed_no_answer', dueOn: null, noAnswerCount: 3 },
  );
});

test('문자 보냄: 소진 전 콜이면 처방도 마감', () => {
  assert.deepEqual(decideSmsSent({ kind: 'pre_runout' }), { status: 'closed_no_answer', closePrescription: 'completed' });
  assert.deepEqual(decideSmsSent({ kind: 'mid' }), { status: 'closed_no_answer', closePrescription: null });
});

test('악화는 원장 전달 대기', () => {
  assert.deepEqual(
    decideAnswered({ kind: 'mid' }, { result: 'worse', note: '가려움 심해짐', visitNeeded: true, closeEarly: false }),
    { status: 'done', result: 'worse', note: '가려움 심해짐', visitNeeded: true, escalation: 'pending', closePrescription: null },
  );
});

test('소진 전 콜을 저장하면 처방 마감, 조기 마감 체크가 우선', () => {
  const base = { result: 'improved', note: '', visitNeeded: false };
  assert.equal(decideAnswered({ kind: 'pre_runout' }, { ...base, closeEarly: false }).closePrescription, 'completed');
  assert.equal(decideAnswered({ kind: 'pre_runout' }, { ...base, closeEarly: true }).closePrescription, 'early');
  assert.equal(decideAnswered({ kind: 'mid' }, { ...base, closeEarly: false }).closePrescription, null);
});

test('악화를 고르면 내원 필요 기본값이 켜진다', () => {
  assert.equal(defaultVisitNeededFor('worse'), true);
  assert.equal(defaultVisitNeededFor('improved'), false);
});

test('오늘 목록: 예정일이 오늘까지인 대기 콜과 모든 문자 대기', () => {
  assert.equal(isOnTodayList({ status: 'pending', dueOn: '2026-09-15' }, '2026-09-15'), true);
  assert.equal(isOnTodayList({ status: 'pending', dueOn: '2026-09-14' }, '2026-09-15'), true);
  assert.equal(isOnTodayList({ status: 'pending', dueOn: '2026-09-16' }, '2026-09-15'), false);
  assert.equal(isOnTodayList({ status: 'sms_pending', dueOn: '2026-09-30' }, '2026-09-15'), true);
  assert.equal(isOnTodayList({ status: 'done', dueOn: '2026-09-14' }, '2026-09-15'), false);
});

test('overdueDays는 지난 날수, 미래면 0', () => {
  assert.equal(overdueDays('2026-09-13', '2026-09-15'), 2);
  assert.equal(overdueDays('2026-09-16', '2026-09-15'), 0);
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` (`js/schedule.js`를 찾을 수 없음)

- [ ] **Step 4: 최소 구현**

`js/schedule.js`:

```js
// 두기 해피콜 일정 규칙. 날짜는 모두 'YYYY-MM-DD' 문자열로 다룬다.
// 브라우저 API를 쓰지 않아서 Node 테스트로 그대로 검증한다.

export const MID_CALL_SKIP_MAX_DAYS = 15; // 처방 일수가 이 값 이하면 중간 콜 없음
export const PRE_RUNOUT_OFFSET_DAYS = 3;  // 소진 3일 전
export const MAX_NO_ANSWER = 3;           // 부재 3회째에 마감
export const NO_CALL_ISO_DAYS = [4, 7];   // 목요일, 일요일

const DAY_MS = 86400000;

function toUTC(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(ymd, days) {
  return fromUTC(toUTC(ymd) + days * DAY_MS);
}

export function daysBetween(fromYmd, toYmd) {
  return Math.round((toUTC(toYmd) - toUTC(fromYmd)) / DAY_MS);
}

export function isoDay(ymd) {
  const day = new Date(toUTC(ymd)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isCallDay(ymd) {
  return !NO_CALL_ISO_DAYS.includes(isoDay(ymd));
}

export function pullBackToCallDay(ymd) {
  let d = ymd;
  while (!isCallDay(d)) d = addDays(d, -1);
  return d;
}

export function nextCallDayAfter(ymd) {
  let d = addDays(ymd, 1);
  while (!isCallDay(d)) d = addDays(d, 1);
  return d;
}

export function todayYMD(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function runoutOn(prescribedOn, days) {
  return addDays(prescribedOn, days);
}

// 짧은 처방에서 콜이 처방일보다 앞서지 않게 한다.
function notBeforePrescription(dueOn, prescribedOn) {
  if (dueOn >= prescribedOn) return dueOn;
  return isCallDay(prescribedOn) ? prescribedOn : nextCallDayAfter(prescribedOn);
}

export function planCalls(prescribedOn, days) {
  const runout = runoutOn(prescribedOn, days);
  const calls = [];
  if (days > MID_CALL_SKIP_MAX_DAYS) {
    const mid = pullBackToCallDay(addDays(prescribedOn, Math.floor(days / 2)));
    calls.push({ kind: 'mid', dueOn: notBeforePrescription(mid, prescribedOn) });
  }
  const pre = pullBackToCallDay(addDays(runout, -PRE_RUNOUT_OFFSET_DAYS));
  calls.push({ kind: 'pre_runout', dueOn: notBeforePrescription(pre, prescribedOn) });
  return { runoutOn: runout, calls };
}

export function hasPastCall(calls, today) {
  return calls.some((c) => c.dueOn < today);
}

export function decideNoAnswer(call, ctx) {
  const noAnswerCount = call.noAnswerCount + 1;
  const next = nextCallDayAfter(ctx.today);
  if (call.kind === 'mid') {
    // 소진 전 콜이 곧 이어받으므로 문자 없이 마감한다. 3회째와 겹쳐도 이쪽이 우선이다.
    if (next >= ctx.preRunoutDueOn) return { status: 'closed_no_answer', dueOn: null, noAnswerCount };
    if (noAnswerCount >= MAX_NO_ANSWER) return { status: 'sms_pending', dueOn: null, noAnswerCount };
    return { status: 'pending', dueOn: next, noAnswerCount };
  }
  if (noAnswerCount >= MAX_NO_ANSWER || next >= ctx.runoutOn) {
    return { status: 'sms_pending', dueOn: null, noAnswerCount };
  }
  return { status: 'pending', dueOn: next, noAnswerCount };
}

export function decideSmsSent(call) {
  return { status: 'closed_no_answer', closePrescription: call.kind === 'pre_runout' ? 'completed' : null };
}

export function decideAnswered(call, input) {
  let closePrescription = null;
  if (input.closeEarly) closePrescription = 'early';
  else if (call.kind === 'pre_runout') closePrescription = 'completed';
  return {
    status: 'done',
    result: input.result,
    note: input.note,
    visitNeeded: Boolean(input.visitNeeded),
    escalation: input.result === 'worse' ? 'pending' : 'none',
    closePrescription,
  };
}

export function defaultVisitNeededFor(result) {
  return result === 'worse';
}

export function isOnTodayList(call, today) {
  if (call.status === 'sms_pending') return true;
  return call.status === 'pending' && call.dueOn <= today;
}

export function overdueDays(dueOn, today) {
  return Math.max(0, daysBetween(dueOn, today));
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, `# fail 0`

- [ ] **Step 6: 커밋**

```bash
git add package.json .gitignore js/schedule.js tests/schedule.test.js
git commit -F - <<'MSG'
feat: 처방 일수 기준 콜 일정과 부재·통화 결과 규칙

목·일 당김, 15일 이하 중간 콜 생략, 부재 3회·소진일 한계를 순수 함수로 두고 테스트한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: 라벨, 기본 스크립트, 문구, 입력 검사

**Files:**
- Create: `js/texts.js`
- Test: `tests/texts.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `CONDITION_LABELS: { urticaria, cough, other }`
  - `RESULT_LABELS: { improved, same, worse, unknown }`
  - `KIND_LABELS: { mid, pre_runout }`
  - `CALL_STATUS_LABELS: { pending, done, sms_pending, closed_no_answer }`
  - `DAYS_PRESETS: number[]` — `[30, 15, 10]`
  - `DEFAULT_SCRIPTS: { urticaria, cough, other, closing_mid, closing_pre_runout, sms_no_answer }` (문자열)
  - `normalizePhone(input: string): string`
  - `isValidPhone(digits: string): boolean`
  - `formatPhone(digits: string): string`
  - `isValidDays(days: number): boolean`
  - `conditionText(condition: string, conditionLabel: string): string`
  - `formatKoreanDate(ymd: string): string` — 예: `'10월 15일(목)'`
  - `fillTemplate(template: string, values: object): string`
  - `buildEscalationText({ name, condition, conditionLabel, note }): string`
  - `buildCallScript({ condition, kind, name, runoutOn, scripts }): string`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/texts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAYS_PRESETS, DEFAULT_SCRIPTS, normalizePhone, isValidPhone, formatPhone, isValidDays,
  conditionText, formatKoreanDate, fillTemplate, buildEscalationText, buildCallScript,
} from '../js/texts.js';

test('처방 일수 버튼은 30, 15, 10', () => {
  assert.deepEqual(DAYS_PRESETS, [30, 15, 10]);
});

test('전화번호는 숫자만 남긴다', () => {
  assert.equal(normalizePhone('010-1234-5678'), '01012345678');
  assert.equal(normalizePhone(' 010 1234 5678 '), '01012345678');
});

test('전화번호는 10~11자리만 통과', () => {
  assert.equal(isValidPhone('01012345678'), true);
  assert.equal(isValidPhone('0212345678'), true);
  assert.equal(isValidPhone('010123'), false);
  assert.equal(isValidPhone('010123456789'), false);
});

test('전화번호 표시는 하이픈을 넣는다', () => {
  assert.equal(formatPhone('01012345678'), '010-1234-5678');
  assert.equal(formatPhone('0212345678'), '021-234-5678');
});

test('처방 일수는 1~90 정수만', () => {
  assert.equal(isValidDays(1), true);
  assert.equal(isValidDays(90), true);
  assert.equal(isValidDays(0), false);
  assert.equal(isValidDays(91), false);
  assert.equal(isValidDays(10.5), false);
});

test('증상 표시', () => {
  assert.equal(conditionText('cough', ''), '기침');
  assert.equal(conditionText('other', '아토피'), '아토피');
  assert.equal(conditionText('other', ''), '기타');
});

test('한국어 날짜 표시', () => {
  assert.equal(formatKoreanDate('2026-10-15'), '10월 15일(목)');
});

test('fillTemplate은 아는 값만 바꾼다', () => {
  assert.equal(fillTemplate('안녕 {name}, {x}', { name: '홍' }), '안녕 홍, {x}');
});

test('원장 전달 문구에는 이름, 증상, 통화 메모', () => {
  assert.equal(
    buildEscalationText({ name: '홍길동', condition: 'urticaria', conditionLabel: '', note: '가려움 심해짐' }),
    '[해피콜 악화] 홍길동 / 두드러기\n통화 메모: 가려움 심해짐',
  );
  assert.equal(
    buildEscalationText({ name: '홍길동', condition: 'cough', conditionLabel: '', note: '  ' }),
    '[해피콜 악화] 홍길동 / 기침\n통화 메모: 메모 없음',
  );
});

test('통화 스크립트는 증상 스크립트 뒤에 콜 종류별 마무리', () => {
  const scripts = { urticaria: '안녕 {name}', other: '기타', closing_mid: '남은 약 잘 드세요', closing_pre_runout: '약이 {runout}에 떨어져요' };
  assert.equal(
    buildCallScript({ condition: 'urticaria', kind: 'pre_runout', name: '홍길동', runoutOn: '2026-10-15', scripts }),
    '안녕 홍길동\n\n[소진 전 콜 마무리]\n약이 10월 15일(목)에 떨어져요',
  );
  assert.equal(
    buildCallScript({ condition: 'unknown-key', kind: 'mid', name: '홍길동', runoutOn: '2026-10-15', scripts }),
    '기타\n\n[중간 콜 마무리]\n남은 약 잘 드세요',
  );
});

test('기본 스크립트는 여섯 개이고 자리표시가 들어 있다', () => {
  assert.deepEqual(
    Object.keys(DEFAULT_SCRIPTS).sort(),
    ['closing_mid', 'closing_pre_runout', 'cough', 'other', 'sms_no_answer', 'urticaria'],
  );
  assert.match(DEFAULT_SCRIPTS.sms_no_answer, /\{name\}/);
  assert.match(DEFAULT_SCRIPTS.closing_pre_runout, /\{runout\}/);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` (`js/texts.js`)

- [ ] **Step 3: 최소 구현**

`js/texts.js`. 증상별 스크립트 세 개는 기존 Artifact 문구를 그대로 옮긴 것이다.

```js
// 화면에 보이는 라벨과 문구. 브라우저 API를 쓰지 않는다.

export const CONDITION_LABELS = { urticaria: '두드러기', cough: '기침', other: '기타' };
export const RESULT_LABELS = { improved: '호전', same: '유지', worse: '악화', unknown: '판단보류' };
export const KIND_LABELS = { mid: '중간 콜', pre_runout: '소진 전 콜' };
export const CALL_STATUS_LABELS = { pending: '대기', done: '완료', sms_pending: '문자 대기', closed_no_answer: '부재 마감' };
export const DAYS_PRESETS = [30, 15, 10];

export const DEFAULT_SCRIPTS = {
  urticaria: `안녕하세요, {name}님. 두기한의원입니다. 처방해드린 약 잘 드시고 계신지 확인차 연락드렸어요. 통화 잠시 괜찮으실까요?

1. 두드러기 증상은 처음보다 어떠세요? 나아지셨나요, 비슷한가요, 심해지셨나요?
2. 가려운 정도는 어느 정도세요? (거의 없음 / 참을 만함 / 많이 힘듦)
3. 밤에 가려움 때문에 잠을 설치는 날이 있으신가요?
4. 두드러기가 새로 올라오는 부위나 빈도에 변화가 있으신가요?
5. 약은 빠짐없이 드시고 계신가요? 속쓰림 등 불편한 점은 없으셨어요?

[호전] 다행이네요! 지금처럼 유지해주시고 다음 콜 때 다시 확인드릴게요.
[유지/악화] 조금 더 자세히 봐드려야 할 것 같아요. 원장님과 상의해서 처방 조정이 필요할 수 있는데, 가까운 시일 내 내원 가능하신 날짜가 있으실까요?

통화 감사합니다. 불편하신 점 있으면 언제든 연락 주세요.`,
  cough: `안녕하세요, {name}님. 두기한의원입니다. 처방약 복용 경과 확인차 연락드렸습니다.

1. 기침 증상은 어떠세요? 횟수나 강도에 변화가 있으신가요?
2. 가래가 동반되나요? 색이나 양에 변화가 있으신가요?
3. 밤에 기침 때문에 잠에서 깨는 경우가 있으신가요?
4. 숨이 차거나 가슴이 답답한 느낌은 없으신가요?
5. 약 복용은 잘 하고 계신가요? 불편한 점은 없으셨어요?

[호전] 잘 관리되고 계시네요, 지금처럼 유지해주세요.
[유지/악화] 증상 재평가가 필요할 수 있어 내원을 권해드리고 싶은데, 가능하신 날짜가 있으실까요?

통화 감사합니다. 불편하신 점 있으면 언제든 연락 주세요.`,
  other: `안녕하세요, {name}님. 두기한의원입니다. 처방약 복용 경과 확인차 연락드렸습니다.

1. 요즘 증상은 처음과 비교해 어떠세요?
2. 일상생활에 불편함을 주는 정도인가요?
3. 약은 빠짐없이 드시고 계신가요? 불편한 점은 없으셨어요?

[호전] 다행이네요! 지금처럼 유지해주세요.
[유지/악화] 내원해서 다시 한번 봐드리는 게 좋을 것 같은데, 가능하신 날짜가 있으실까요?

통화 감사합니다. 불편하신 점 있으면 언제든 연락 주세요.`,
  closing_mid: '남은 약도 빠짐없이 잘 드시고, 약을 다 드실 때쯤 한 번 더 연락드릴게요.',
  closing_pre_runout: '약이 {runout}에 떨어질 예정인데, 그 전에 내원 가능하신 날이 있으실까요?',
  sms_no_answer: '안녕하세요, {name}님. 두기한의원입니다. 처방약 복용 경과 확인차 몇 차례 연락드렸는데 통화가 어려우셨어요. 불편하시거나 궁금한 점이 있으면 편하실 때 한의원으로 연락 주세요.',
};

export function normalizePhone(input) {
  return String(input ?? '').replace(/\D/g, '');
}

export function isValidPhone(digits) {
  return /^[0-9]{10,11}$/.test(digits);
}

export function formatPhone(digits) {
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

export function isValidDays(days) {
  return Number.isInteger(days) && days >= 1 && days <= 90;
}

export function conditionText(condition, conditionLabel) {
  if (condition === 'other' && conditionLabel) return conditionLabel;
  return CONDITION_LABELS[condition] ?? CONDITION_LABELS.other;
}

export function formatKoreanDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일(${dow})`;
}

export function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

export function buildEscalationText({ name, condition, conditionLabel, note }) {
  const memo = String(note ?? '').trim() || '메모 없음';
  return `[해피콜 악화] ${name} / ${conditionText(condition, conditionLabel)}\n통화 메모: ${memo}`;
}

export function buildCallScript({ condition, kind, name, runoutOn, scripts }) {
  const body = fillTemplate(scripts[condition] ?? scripts.other, { name });
  const closing = fillTemplate(scripts[kind === 'mid' ? 'closing_mid' : 'closing_pre_runout'], {
    runout: formatKoreanDate(runoutOn),
  });
  return `${body}\n\n[${KIND_LABELS[kind]} 마무리]\n${closing}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add js/texts.js tests/texts.test.js
git commit -F - <<'MSG'
feat: 라벨·기본 스크립트·원장 전달 문구·입력 검사

기존 Artifact 스크립트를 옮기고 콜 종류별 마무리 문장과 부재 문자 문구를 더한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: 화면용 데이터 모양과 목록 고르기

**Files:**
- Create: `js/model.js`
- Test: `tests/model.test.js`

**Interfaces:**
- Consumes: `schedule.js`의 `isOnTodayList(call, today)`, `addDays(ymd, days)`
- Produces:
  - `toPatient(row): Patient` — Supabase 중첩 행(snake_case)을 아래 모양(camelCase)으로 바꾼다
    - `Patient = { id, name, phone, condition, conditionLabel, prescriptions: Prescription[] }`
    - `Prescription = { id, patientId, prescribedOn, days, runoutOn, status, closedReason, calls: Call[] }` (처방일 최신순)
    - `Call = { id, prescriptionId, kind, dueOn, status, noAnswerCount, result, note, visitNeeded, visitBooked, escalation, escalatedAt, doneAt, attempts: Attempt[] }`
    - `Attempt = { id, attemptedAt, outcome, note, staffName }` (최신순)
  - `CallView = { patient, prescription, call }`
  - `callViews(patients): CallView[]`
  - `todayCalls(patients, today): CallView[]` — 진행 중 처방만, 예정일순
  - `upcomingCalls(patients, today): CallView[]` — 진행 중 처방의 대기 콜 중 오늘 다음날~7일 뒤
  - `escalationCalls(patients): CallView[]`
  - `visitCalls(patients): CallView[]`
  - `preRunoutCall(prescription): Call|null`
  - `activePrescriptionCount(patients): number`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/model.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPatient, callViews, todayCalls, upcomingCalls, escalationCalls, visitCalls,
  preRunoutCall, activePrescriptionCount,
} from '../js/model.js';

const row = {
  id: 'p1', name: '홍길동', phone: '01012345678', condition: 'urticaria', condition_label: null,
  created_at: '2026-09-15T00:00:00Z',
  prescriptions: [{
    id: 'r1', prescribed_on: '2026-09-15', days: 30, runout_on: '2026-10-15', status: 'active',
    closed_reason: null, created_at: '2026-09-15T00:00:00Z',
    calls: [
      {
        id: 'c2', kind: 'pre_runout', due_on: '2026-10-12', status: 'pending', no_answer_count: 0,
        result: null, note: null, visit_needed: false, visit_booked: false, escalation: 'none',
        escalated_at: null, done_at: null, call_attempts: [],
      },
      {
        id: 'c1', kind: 'mid', due_on: '2026-09-30', status: 'done', no_answer_count: 1,
        result: 'worse', note: '가려움', visit_needed: true, visit_booked: false, escalation: 'pending',
        escalated_at: null, done_at: '2026-09-30T01:00:00Z',
        call_attempts: [
          { id: 'a1', attempted_at: '2026-09-29T01:00:00Z', outcome: 'no_answer', note: null, staff_name: '김직원' },
          { id: 'a2', attempted_at: '2026-09-30T01:00:00Z', outcome: 'answered', note: '가려움', staff_name: '김직원' },
        ],
      },
    ],
  }],
};

const ids = (views) => views.map((v) => v.call.id);

test('toPatient는 camelCase로 바꾸고 빈 값을 채운다', () => {
  const p = toPatient(row);
  assert.equal(p.conditionLabel, '');
  const rx = p.prescriptions[0];
  assert.equal(rx.runoutOn, '2026-10-15');
  assert.equal(rx.patientId, 'p1');
  const mid = rx.calls.find((c) => c.id === 'c1');
  assert.equal(mid.noAnswerCount, 1);
  assert.equal(mid.visitNeeded, true);
  assert.equal(mid.prescriptionId, 'r1');
  assert.deepEqual(mid.attempts.map((a) => a.id), ['a2', 'a1']);
  assert.equal(mid.attempts[1].note, '');
  assert.equal(mid.attempts[1].staffName, '김직원');
});

test('callViews는 모든 콜을 환자·처방과 묶는다', () => {
  assert.deepEqual(ids(callViews([toPatient(row)])).sort(), ['c1', 'c2']);
});

test('todayCalls는 진행 중 처방의 오늘까지 대기 콜만', () => {
  assert.deepEqual(ids(todayCalls([toPatient(row)], '2026-10-12')), ['c2']);
  assert.deepEqual(ids(todayCalls([toPatient(row)], '2026-10-11')), []);
});

test('처방이 마감되면 todayCalls에서 빠진다', () => {
  const closed = structuredClone(row);
  closed.prescriptions[0].status = 'closed';
  closed.prescriptions[0].closed_reason = 'early';
  assert.deepEqual(ids(todayCalls([toPatient(closed)], '2026-10-12')), []);
});

test('upcomingCalls는 오늘 다음날부터 7일 뒤까지', () => {
  assert.deepEqual(ids(upcomingCalls([toPatient(row)], '2026-10-06')), ['c2']);
  assert.deepEqual(ids(upcomingCalls([toPatient(row)], '2026-10-01')), []);
  assert.deepEqual(ids(upcomingCalls([toPatient(row)], '2026-10-12')), []);
});

test('원장 전달과 내원 예약 목록', () => {
  assert.deepEqual(ids(escalationCalls([toPatient(row)])), ['c1']);
  assert.deepEqual(ids(visitCalls([toPatient(row)])), ['c1']);
});

test('preRunoutCall과 진행 중 처방 수', () => {
  const p = toPatient(row);
  assert.equal(preRunoutCall(p.prescriptions[0]).id, 'c2');
  assert.equal(activePrescriptionCount([p]), 1);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` (`js/model.js`)

- [ ] **Step 3: 최소 구현**

`js/model.js`:

```js
// Supabase에서 받은 행을 화면이 쓰는 모양으로 바꾸고, 탭별 목록을 고른다.
import { isOnTodayList, addDays } from './schedule.js';

const newestFirst = (key) => (a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0);

function toAttempt(a) {
  return { id: a.id, attemptedAt: a.attempted_at, outcome: a.outcome, note: a.note ?? '', staffName: a.staff_name ?? '' };
}

function toCall(c, prescriptionId) {
  return {
    id: c.id,
    prescriptionId,
    kind: c.kind,
    dueOn: c.due_on,
    status: c.status,
    noAnswerCount: c.no_answer_count,
    result: c.result,
    note: c.note ?? '',
    visitNeeded: c.visit_needed,
    visitBooked: c.visit_booked,
    escalation: c.escalation,
    escalatedAt: c.escalated_at,
    doneAt: c.done_at,
    attempts: (c.call_attempts ?? []).map(toAttempt).sort(newestFirst('attemptedAt')),
  };
}

function toPrescription(r, patientId) {
  return {
    id: r.id,
    patientId,
    prescribedOn: r.prescribed_on,
    days: r.days,
    runoutOn: r.runout_on,
    status: r.status,
    closedReason: r.closed_reason,
    calls: (r.calls ?? []).map((c) => toCall(c, r.id)),
  };
}

export function toPatient(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    condition: row.condition,
    conditionLabel: row.condition_label ?? '',
    prescriptions: (row.prescriptions ?? []).map((r) => toPrescription(r, row.id)).sort(newestFirst('prescribedOn')),
  };
}

export function callViews(patients) {
  const views = [];
  for (const patient of patients) {
    for (const prescription of patient.prescriptions) {
      for (const call of prescription.calls) views.push({ patient, prescription, call });
    }
  }
  return views;
}

function byDueDate(a, b) {
  if (a.call.dueOn !== b.call.dueOn) return a.call.dueOn < b.call.dueOn ? -1 : 1;
  return a.patient.name.localeCompare(b.patient.name, 'ko');
}

export function todayCalls(patients, today) {
  return callViews(patients)
    .filter((v) => v.prescription.status === 'active' && isOnTodayList(v.call, today))
    .sort(byDueDate);
}

export function upcomingCalls(patients, today) {
  const until = addDays(today, 7);
  return callViews(patients)
    .filter((v) => v.prescription.status === 'active' && v.call.status === 'pending'
      && v.call.dueOn > today && v.call.dueOn <= until)
    .sort(byDueDate);
}

export function escalationCalls(patients) {
  return callViews(patients).filter((v) => v.call.escalation === 'pending').sort(byDueDate);
}

export function visitCalls(patients) {
  return callViews(patients).filter((v) => v.call.visitNeeded && !v.call.visitBooked).sort(byDueDate);
}

export function preRunoutCall(prescription) {
  return prescription.calls.find((c) => c.kind === 'pre_runout') ?? null;
}

export function activePrescriptionCount(patients) {
  return patients.reduce((n, p) => n + p.prescriptions.filter((r) => r.status === 'active').length, 0);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add js/model.js tests/model.test.js
git commit -F - <<'MSG'
feat: Supabase 행을 화면용 객체로 바꾸고 탭별 목록을 고른다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: 등록·통화 결과를 한 번에 저장하는 데이터베이스 함수

**Files:**
- Create: `supabase/migrations/001_init.sql`, `supabase/migrations/002_move_is_allowed_to_private.sql` (이미 적용된 SQL 사본)
- Create: `supabase/migrations/003_rpc.sql`
- Test: Supabase MCP `execute_sql` (project_id `yblqrtwbvqrshqmnizij`)

**Interfaces:**
- Consumes: 적용된 테이블 `patients`, `prescriptions`, `calls`, `call_attempts`와 RLS 정책 "허용 이메일만"
- Produces:
  - `public.register_prescription(p_phone text, p_name text, p_condition text, p_condition_label text, p_prescribed_on date, p_days int, p_runout_on date, p_calls jsonb) returns uuid` — `p_calls`는 `[{ "kind": "mid"|"pre_runout", "dueOn": "YYYY-MM-DD" }]`. 같은 전화번호가 있으면 기존 환자에 처방만 붙인다. 반환값은 새 처방 id.
  - `public.save_call_outcome(p_call_id uuid, p_outcome text, p_note text, p_staff_name text, p_status text, p_due_on date, p_no_answer_count int, p_result text, p_visit_needed boolean, p_escalation text, p_close_prescription text) returns void`
    - `p_outcome`이 `null`이면 시도 기록을 남기지 않는다(문자 보냄).
    - `p_due_on`, `p_result`가 `null`이면 기존 값을 유지한다.
    - `p_note`는 `p_outcome = 'answered'`일 때만 콜 메모로 저장한다.
    - `p_close_prescription`이 `'completed'` 또는 `'early'`면 진행 중 처방을 마감한다.

SQL 테스트에서 허용 이메일 사용자로 실행할 때는 쿼리 앞에 아래 두 줄을 붙인다.

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"allowed@example.com"}', true);
```

- [ ] **Step 1: 이미 적용된 마이그레이션 사본을 저장소로 옮기기**

```bash
mkdir -p supabase/migrations
cp "C:/Users/USER~1.DES/AppData/Local/Temp/claude/C--Users-User-DESKTOP-BLBKBC2-ops-os/2da49d9f-02fa-4897-abca-770111f0164d/scratchpad/happycall/001_init.sql" supabase/migrations/001_init.sql
cp "C:/Users/USER~1.DES/AppData/Local/Temp/claude/C--Users-User-DESKTOP-BLBKBC2-ops-os/2da49d9f-02fa-4897-abca-770111f0164d/scratchpad/happycall/002_move_is_allowed_to_private.sql" supabase/migrations/002_move_is_allowed_to_private.sql
```

스크래치패드 파일이 없으면 MCP `list_migrations`로 적용된 두 마이그레이션(`init_happycall_schema`, `move_is_allowed_to_private_schema`)의 SQL을 받아 같은 이름으로 저장한다.

- [ ] **Step 2: 실패하는 테스트 실행**

MCP `execute_sql`:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"allowed@example.com"}', true);
select public.register_prescription('01000000000', '테스트A', 'urticaria', '', date '2026-09-15', 30, date '2026-10-15',
  '[{"kind":"mid","dueOn":"2026-09-30"},{"kind":"pre_runout","dueOn":"2026-10-12"}]'::jsonb);
```

Expected: ERROR `function public.register_prescription(...) does not exist`

- [ ] **Step 3: 마이그레이션 파일 쓰기**

`supabase/migrations/003_rpc.sql`:

```sql
-- 등록과 통화 결과 저장을 한 번에 처리한다.
-- security invoker라서 호출한 사람의 RLS가 그대로 적용된다.

create or replace function public.register_prescription(
  p_phone text,
  p_name text,
  p_condition text,
  p_condition_label text,
  p_prescribed_on date,
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

  insert into prescriptions (patient_id, prescribed_on, days, runout_on)
  values (v_patient_id, p_prescribed_on, p_days, p_runout_on)
  returning id into v_prescription_id;

  insert into calls (prescription_id, kind, due_on)
  select v_prescription_id, c ->> 'kind', (c ->> 'dueOn')::date
  from jsonb_array_elements(p_calls) as c;

  return v_prescription_id;
end;
$$;

create or replace function public.save_call_outcome(
  p_call_id uuid,
  p_outcome text,
  p_note text,
  p_staff_name text,
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
begin
  if p_outcome is not null then
    insert into call_attempts (call_id, outcome, note, staff_name)
    values (p_call_id, p_outcome, nullif(p_note, ''), nullif(p_staff_name, ''));
  end if;

  update calls set
    status = p_status,
    due_on = coalesce(p_due_on, due_on),
    no_answer_count = p_no_answer_count,
    result = coalesce(p_result, result),
    note = case when p_outcome = 'answered' then nullif(p_note, '') else note end,
    visit_needed = p_visit_needed,
    escalation = p_escalation,
    done_at = case when p_status in ('done', 'closed_no_answer') then now() else done_at end
  where id = p_call_id
  returning prescription_id into v_prescription_id;

  if v_prescription_id is null then
    raise exception 'call % not found', p_call_id;
  end if;

  if p_close_prescription is not null then
    update prescriptions
    set status = 'closed', closed_reason = p_close_prescription
    where id = v_prescription_id and status = 'active';
  end if;
end;
$$;

revoke all on function public.register_prescription(text, text, text, text, date, int, date, jsonb) from public, anon;
grant execute on function public.register_prescription(text, text, text, text, date, int, date, jsonb) to authenticated;

revoke all on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text) from public, anon;
grant execute on function public.save_call_outcome(uuid, text, text, text, text, date, int, text, boolean, text, text) to authenticated;
```

- [ ] **Step 4: 마이그레이션 적용**

MCP `apply_migration` — project_id `yblqrtwbvqrshqmnizij`, name `add_happycall_rpc`, query는 `003_rpc.sql` 전체.
Expected: `{"success":true}`

- [ ] **Step 5: 등록 테스트 (30일, 새 환자)**

Step 2의 SQL을 다시 실행한다. Expected: uuid 한 개 반환.

이어서:

```sql
select p.name, r.days, r.runout_on, c.kind, c.due_on, c.status
from patients p
join prescriptions r on r.patient_id = p.id
join calls c on c.prescription_id = r.id
where p.phone = '01000000000'
order by c.due_on;
```

Expected: 2행 — `(테스트A, 30, 2026-10-15, mid, 2026-09-30, pending)`, `(테스트A, 30, 2026-10-15, pre_runout, 2026-10-12, pending)`

- [ ] **Step 6: 같은 전화번호로 두 번째 처방 테스트 (15일)**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"allowed@example.com"}', true);
select public.register_prescription('01000000000', '다른이름', 'cough', '', date '2026-10-16', 15, date '2026-10-31',
  '[{"kind":"pre_runout","dueOn":"2026-10-28"}]'::jsonb);
select (select count(*) from patients where phone = '01000000000') as patients,
       (select name from patients where phone = '01000000000') as name,
       (select count(*) from prescriptions r join patients p on p.id = r.patient_id where p.phone = '01000000000') as prescriptions;
```

Expected: `patients = 1`, `name = 테스트A`, `prescriptions = 2`

- [ ] **Step 7: 허용되지 않은 이메일은 등록 못 함**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"stranger@example.com"}', true);
select public.register_prescription('01099999999', '침입', 'cough', '', date '2026-09-15', 10, date '2026-09-25',
  '[{"kind":"pre_runout","dueOn":"2026-09-22"}]'::jsonb);
```

Expected: ERROR `new row violates row-level security policy for table "patients"`

- [ ] **Step 8: 중간 콜 악화 저장 테스트**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"allowed@example.com"}', true);
select public.save_call_outcome(
  (select c.id from calls c join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id
   where p.phone = '01000000000' and r.days = 30 and c.kind = 'mid'),
  'answered', '가려움 심해짐', '김직원', 'done', null, 0, 'worse', true, 'pending', null);
select c.status, c.result, c.note, c.visit_needed, c.escalation, c.done_at is not null as done,
       (select count(*) from call_attempts a where a.call_id = c.id) as attempts, r.status as rx_status
from calls c join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id
where p.phone = '01000000000' and r.days = 30 and c.kind = 'mid';
```

Expected: `(done, worse, 가려움 심해짐, true, pending, true, 1, active)`

- [ ] **Step 9: 소진 전 콜 부재 저장 테스트**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"allowed@example.com"}', true);
select public.save_call_outcome(
  (select c.id from calls c join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id
   where p.phone = '01000000000' and r.days = 30 and c.kind = 'pre_runout'),
  'no_answer', '', '김직원', 'pending', date '2026-10-13', 1, null, false, 'none', null);
select c.status, c.due_on, c.no_answer_count, c.note, (select count(*) from call_attempts a where a.call_id = c.id) as attempts
from calls c join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id
where p.phone = '01000000000' and r.days = 30 and c.kind = 'pre_runout';
```

Expected: `(pending, 2026-10-13, 1, null, 1)`

- [ ] **Step 10: 문자 보냄으로 소진 전 콜과 처방 마감 테스트**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"allowed@example.com"}', true);
select public.save_call_outcome(
  (select c.id from calls c join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id
   where p.phone = '01000000000' and r.days = 30 and c.kind = 'pre_runout'),
  null, '', '김직원', 'closed_no_answer', null, 1, null, false, 'none', 'completed');
select c.status, c.done_at is not null as done, (select count(*) from call_attempts a where a.call_id = c.id) as attempts,
       r.status as rx_status, r.closed_reason
from calls c join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id
where p.phone = '01000000000' and r.days = 30 and c.kind = 'pre_runout';
```

Expected: `(closed_no_answer, true, 1, closed, completed)`

- [ ] **Step 11: 목요일로 미루기는 데이터베이스가 거부**

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"allowed@example.com"}', true);
select public.save_call_outcome(
  (select c.id from calls c join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id
   where p.phone = '01000000000' and r.days = 15 and c.kind = 'pre_runout'),
  'no_answer', '', '김직원', 'pending', date '2026-10-29', 1, null, false, 'none', null);
```

Expected: ERROR `violates check constraint "calls_due_on_check"`

- [ ] **Step 12: 테스트 데이터 정리와 보안 점검**

MCP `execute_sql` (역할 전환 없이):

```sql
delete from public.patients where phone in ('01000000000', '01099999999');
select (select count(*) from public.patients) as patients,
       (select count(*) from public.prescriptions) as prescriptions,
       (select count(*) from public.calls) as calls,
       (select count(*) from public.call_attempts) as call_attempts;
```

Expected: 모두 0

MCP `get_advisors` type `security`.
Expected: `allowed_emails`의 "RLS Enabled No Policy" INFO 한 건만 남는다. 그 외 WARN이 있으면 원인을 고치고 이 태스크의 테스트를 다시 돌린다.

- [ ] **Step 13: 커밋**

```bash
git add supabase/migrations
git commit -F - <<'MSG'
feat: 등록과 통화 결과를 한 번에 저장하는 데이터베이스 함수

환자·처방·콜, 시도 기록·콜·처방을 각각 한 트랜잭션으로 저장해 반쪽 데이터가 남지 않게 한다.
이미 적용된 001·002 마이그레이션 사본도 함께 보관한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: 로그인과 목록 화면 (읽기)

**Files:**
- Create: `reference/artifact-original.html`, `css/app.css`, `index.html`, `js/config.js`, `js/store.js`, `js/ui.js`, `js/main.js`, `scripts/serve.mjs`, `.claude/launch.json`

**Interfaces:**
- Consumes: `schedule.js`(`todayYMD`, `overdueDays`), `model.js`(`toPatient`, `todayCalls`, `upcomingCalls`, `escalationCalls`, `visitCalls`, `activePrescriptionCount`), `texts.js`(라벨, `formatPhone`, `conditionText`, `formatKoreanDate`, `normalizePhone`, `DEFAULT_SCRIPTS`)
- Produces:
  - `store.js`: `getSession(): Promise<Session|null>`, `onAuthChange(cb: (session) => void)`, `sendLoginLink(email: string): Promise<void>`, `signOut(): Promise<void>`, `loadAll(): Promise<Patient[]>`, `loadScripts(): Promise<Record<string,string>>`
  - `ui.js` (Task 6이 이 이름을 그대로 쓴다): `state`, `$(id)`, `esc(s)`, `toast(msg)`, `scriptsWithDefaults()`, `findView(callId): CallView|null`, `findPatient(id): Patient|null`, `refresh()`, `run(action, successMsg): Promise<boolean>`, `conditionBadge(patient)`, `kindBadge(call)`, `resultBadge(result)`, `render()`, `openModal(html, wide?)`, `closeModal()`, `openDetailModal(patient)`, `onAppClick(e)`, `startApp()`, `stopApp()`

- [ ] **Step 1: 원본 Artifact 보관**

`Artifact` 도구 `action: "read"`, url `https://claude.ai/code/artifact/e9f146a2-9533-4bda-816c-afa757767f40`로 원문 HTML을 받아 `reference/artifact-original.html`에 그대로 저장한다. 결과가 로컬 파일로 저장됐다고 나오면 그 파일을 복사한다.

- [ ] **Step 2: 기존 스타일 옮기기**

```bash
mkdir -p css
node -e "const fs=require('fs');const h=fs.readFileSync('reference/artifact-original.html','utf8');const b=[...h.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]);console.log('style blocks:',b.length);fs.writeFileSync('css/app.css',b[b.length-1].trim()+'\n')"
```

Expected: `style blocks: 2`. `css/app.css` 앞부분에 `--bg:#F2F6F1;`가 있고 끝부분에 `[hidden]{display:none !important;}`가 있다.

이어서 아래 스타일을 `css/app.css` 끝에 덧붙인다:

```bash
cat >> css/app.css <<'CSS'

/* ---- 해피콜 V1 추가 ---- */
.header-actions{display:flex; gap:8px; align-items:center;}
.section-title{margin:22px 0 8px; font-size:13.5px; color:var(--text-muted); font-weight:700;}
.login-card{max-width:380px; margin:12vh auto 0; background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:28px 24px; box-shadow:var(--shadow); display:flex; flex-direction:column; gap:12px; align-items:flex-start;}
.login-card h1{font-size:20px; font-weight:800;}
.login-card p{margin:0; color:var(--text-muted); font-size:13.5px;}
.login-card form{display:flex; flex-direction:column; gap:8px; width:100%;}
.login-card .search-input{min-width:0; width:100%;}
.login-message{min-height:1.4em;}
.badge-kind{background:var(--info-soft); color:var(--info);}
.badge-sms{background:var(--danger-soft); color:var(--danger);}
.preview-box{background:var(--accent-soft); color:var(--accent-strong); border-radius:10px; padding:10px 12px; font-size:13px; line-height:1.6; margin-bottom:6px;}
.preview-box.warn{background:var(--warn-soft); color:var(--warn);}
.copy-box{width:100%; min-height:120px; border:1px solid var(--border); border-radius:9px; padding:10px 12px; font-size:13px; line-height:1.65; background:var(--surface-alt); color:var(--text); resize:vertical;}
.field-hint{font-size:12px; color:var(--text-faint);}
.existing-note{font-size:12.5px; color:var(--accent-strong); font-weight:600; min-height:1.2em;}
.rx-block{border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-bottom:10px;}
.rx-head{display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; font-size:13px; margin-bottom:6px;}
.call-line{display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; align-items:center; font-size:12.5px; padding:8px 0; border-top:1px dashed var(--border);}
CSS
```

- [ ] **Step 3: 화면 뼈대**

`index.html`:

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>두기 해피콜</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="css/app.css">
</head>
<body>

<div id="loading" class="page"><div class="empty">불러오는 중…</div></div>

<div id="login-screen" class="page" hidden>
  <div class="login-card">
    <div class="brand-mark">🌿</div>
    <h1>두기 해피콜</h1>
    <p>허용된 이메일로 로그인 링크를 받으세요.</p>
    <form id="login-form">
      <input type="email" id="login-email" class="search-input" placeholder="이메일" autocomplete="email" required>
      <button type="submit" class="btn btn-primary">로그인 링크 받기</button>
    </form>
    <p id="login-message" class="login-message"></p>
  </div>
</div>

<div id="app" class="page" hidden>
  <div class="app-header">
    <div class="brand">
      <div class="brand-mark">🌿</div>
      <div>
        <h1>두기 해피콜</h1>
        <p>처방 한 건마다 약이 떨어지기 전에 콜이 잡혀요</p>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn btn-primary" id="btn-open-register">+ 처방 등록</button>
      <button class="btn btn-ghost btn-sm" id="btn-sign-out">로그아웃</button>
    </div>
  </div>

  <div class="stats">
    <div class="stat-tile warn"><div class="num mono" id="stat-escalation">0</div><div class="lbl">원장 전달 필요</div></div>
    <div class="stat-tile"><div class="num mono" id="stat-today">0</div><div class="lbl">오늘 콜</div></div>
    <div class="stat-tile upcoming"><div class="num mono" id="stat-visit">0</div><div class="lbl">내원 예약 필요</div></div>
    <div class="stat-tile"><div class="num mono" id="stat-active">0</div><div class="lbl">진행 중 처방</div></div>
  </div>

  <div class="tabs">
    <button class="tab-btn" data-tab="escalation">원장 전달 필요 <span class="count" id="tab-count-escalation">0</span></button>
    <button class="tab-btn active" data-tab="today">오늘 콜 <span class="count" id="tab-count-today">0</span></button>
    <button class="tab-btn" data-tab="visit">내원 예약 필요 <span class="count" id="tab-count-visit">0</span></button>
    <button class="tab-btn" data-tab="all">전체 환자 <span class="count" id="tab-count-all">0</span></button>
    <button class="tab-btn" data-tab="scripts">스크립트</button>
  </div>

  <div class="panel" id="panel-escalation" hidden></div>
  <div class="panel" id="panel-today"></div>
  <div class="panel" id="panel-visit" hidden></div>
  <div class="panel" id="panel-all" hidden></div>
  <div class="panel" id="panel-scripts" hidden></div>

  <div class="footer-note">예시 환자로 검증 중입니다. 실제 진료 판단은 원장님 확인을 거쳐주세요.</div>
</div>

<div id="modal-root"></div>
<div id="toast" class="toast"></div>

<script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 4: Supabase 설정과 데이터 읽기**

`js/config.js`:

```js
// 공개해도 되는 publishable 키만 둔다. 실제 보호는 데이터베이스의 RLS가 한다.
// service_role 키는 절대 넣지 않는다.
export const SUPABASE_URL = 'https://yblqrtwbvqrshqmnizij.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xOuNk0xCh8D2CqdwsThS_w__LqNPbHv';
```

`js/store.js`:

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { toPatient } from './model.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

function check(error) {
  if (error) throw error;
}

// ---- 로그인 ----

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  check(error);
  return data.session;
}

export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => callback(session));
}

export async function sendLoginLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
  });
  check(error);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  check(error);
}

// ---- 읽기 ----

export async function loadAll() {
  const { data, error } = await supabase
    .from('patients')
    .select(`
      id, name, phone, condition, condition_label, created_at,
      prescriptions (
        id, prescribed_on, days, runout_on, status, closed_reason, created_at,
        calls (
          id, kind, due_on, status, no_answer_count, result, note, visit_needed, visit_booked,
          escalation, escalated_at, done_at,
          call_attempts ( id, attempted_at, outcome, note, staff_name )
        )
      )`)
    .order('created_at', { ascending: false });
  check(error);
  return data.map(toPatient);
}

export async function loadScripts() {
  const { data, error } = await supabase.from('scripts').select('key, text');
  check(error);
  return Object.fromEntries(data.map((r) => [r.key, r.text]));
}
```

- [ ] **Step 5: 목록 화면**

`js/ui.js`:

```js
import * as store from './store.js';
import { todayYMD, overdueDays } from './schedule.js';
import {
  todayCalls, upcomingCalls, escalationCalls, visitCalls, activePrescriptionCount,
} from './model.js';
import {
  RESULT_LABELS, KIND_LABELS, CALL_STATUS_LABELS, DEFAULT_SCRIPTS,
  normalizePhone, formatPhone, conditionText, formatKoreanDate,
} from './texts.js';

const TABS = ['escalation', 'today', 'visit', 'all', 'scripts'];

export const state = { patients: [], scripts: {}, tab: 'today', search: '', staffName: '', detailPatientId: null };

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
export function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export function scriptsWithDefaults() {
  return { ...DEFAULT_SCRIPTS, ...state.scripts };
}

// 시각(ISO)을 한국 날짜 표시로
function localDate(iso) {
  return formatKoreanDate(todayYMD(new Date(iso)));
}

// ---- 찾기 ----

export function findView(callId) {
  for (const patient of state.patients) {
    for (const prescription of patient.prescriptions) {
      const call = prescription.calls.find((c) => c.id === callId);
      if (call) return { patient, prescription, call };
    }
  }
  return null;
}

export function findPatient(id) {
  return state.patients.find((p) => p.id === id) ?? null;
}

// ---- 불러오기와 저장 공통 ----

export async function refresh() {
  try {
    const [patients, scripts] = await Promise.all([store.loadAll(), store.loadScripts()]);
    state.patients = patients;
    state.scripts = scripts;
    render();
    if (state.detailPatientId) openDetailModal(findPatient(state.detailPatientId));
  } catch (err) {
    console.error(err);
    toast('불러오지 못했어요. 새로고침해주세요.');
  }
}

export async function run(action, successMsg) {
  try {
    await action();
  } catch (err) {
    console.error(err);
    toast('저장하지 못했어요. 다시 시도해주세요.');
    return false;
  }
  if (successMsg) toast(successMsg);
  await refresh();
  return true;
}

// ---- 배지 ----

export function conditionBadge(patient) {
  const cls = { urticaria: 'badge-urticaria', cough: 'badge-cough' }[patient.condition] ?? 'badge-other';
  return `<span class="badge ${cls}">${esc(conditionText(patient.condition, patient.conditionLabel))}</span>`;
}

export function kindBadge(call) {
  return `<span class="badge badge-kind">${KIND_LABELS[call.kind]}</span>`;
}

export function resultBadge(result) {
  return result ? `<span class="badge badge-${result}">${RESULT_LABELS[result]}</span>` : '';
}

// ---- 탭 ----

export function render() {
  const today = todayYMD();
  const escalations = escalationCalls(state.patients);
  const todays = todayCalls(state.patients, today);
  const visits = visitCalls(state.patients);

  $('stat-escalation').textContent = escalations.length;
  $('stat-today').textContent = todays.length;
  $('stat-visit').textContent = visits.length;
  $('stat-active').textContent = activePrescriptionCount(state.patients);
  $('tab-count-escalation').textContent = escalations.length;
  $('tab-count-today').textContent = todays.length;
  $('tab-count-visit').textContent = visits.length;
  $('tab-count-all').textContent = state.patients.length;

  TABS.forEach((t) => { $(`panel-${t}`).hidden = t !== state.tab; });
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));

  if (state.tab === 'escalation') renderEscalation(escalations);
  if (state.tab === 'today') renderToday(todays, today);
  if (state.tab === 'visit') renderVisit(visits);
  if (state.tab === 'all') renderAll();
  if (state.tab === 'scripts') renderScripts();
}

function callCard({ patient, prescription, call }, today) {
  const pills = [conditionBadge(patient), kindBadge(call)];
  if (call.noAnswerCount > 0) pills.push(`<span class="badge badge-other">부재 ${call.noAnswerCount}/3</span>`);
  const late = overdueDays(call.dueOn, today);
  if (call.status === 'sms_pending') pills.push('<span class="badge badge-sms">문자 대기</span>');
  else if (late > 0) pills.push(`<span class="badge badge-overdue">${late}일 지연</span>`);
  else if (call.dueOn === today) pills.push('<span class="badge badge-today">오늘</span>');

  const last = call.attempts[0];
  const note = last
    ? `<div class="case-note">최근 시도(${localDate(last.attemptedAt)}): ${last.outcome === 'no_answer' ? '부재중' : esc(last.note || '메모 없음')}</div>`
    : '';
  const actions = call.status === 'sms_pending'
    ? `<button class="btn btn-primary btn-sm" data-action="sms" data-id="${call.id}">✉️ 문자 문구 열기</button>`
    : `<button class="btn btn-primary btn-sm" data-action="call" data-id="${call.id}">📞 통화 기록</button>
       <button class="btn btn-sm" data-action="no-answer" data-id="${call.id}">부재중</button>`;

  return `
    <div class="case-card">
      <div class="case-top">
        <div class="case-id">
          <div class="case-name">${esc(patient.name)}</div>
          <div class="case-meta-row">${pills.join('')}</div>
          <div class="case-phone mono">${esc(formatPhone(patient.phone))}</div>
        </div>
        <div class="case-due">
          <div>예정일</div><div class="d">${formatKoreanDate(call.dueOn)}</div>
          <div>소진 ${formatKoreanDate(prescription.runoutOn)}</div>
        </div>
      </div>
      ${note}
      <div class="case-actions">
        ${actions}
        <button class="btn btn-ghost btn-sm" data-action="detail" data-id="${patient.id}">상세 · 이력</button>
      </div>
    </div>`;
}

function renderToday(list, today) {
  let html = list.length
    ? list.map((v) => callCard(v, today)).join('')
    : '<div class="empty">오늘 걸 콜이 없어요.</div>';
  const upcoming = upcomingCalls(state.patients, today);
  if (upcoming.length) {
    html += '<h3 class="section-title">이번 주 예정</h3>';
    html += upcoming.map(({ patient, call }) => `
      <div class="upcoming-row">
        <span>${esc(patient.name)} ${conditionBadge(patient)} ${kindBadge(call)}</span>
        <span class="mono">${formatKoreanDate(call.dueOn)}</span>
      </div>`).join('');
  }
  $('panel-today').innerHTML = html;
}

function renderEscalation(list) {
  $('panel-escalation').innerHTML = list.length ? list.map(({ patient, call }) => `
    <div class="case-card">
      <div class="case-top">
        <div class="case-id">
          <div class="case-name">${esc(patient.name)}</div>
          <div class="case-meta-row">${conditionBadge(patient)}${kindBadge(call)}${resultBadge(call.result)}</div>
        </div>
        <div class="case-due"><div>통화일</div><div class="d">${call.doneAt ? localDate(call.doneAt) : '-'}</div></div>
      </div>
      <div class="case-note">${esc(call.note || '메모 없음')}</div>
      <div class="case-actions">
        <button class="btn btn-primary btn-sm" data-action="escalate" data-id="${call.id}">💬 전달 문구 열기</button>
        <button class="btn btn-ghost btn-sm" data-action="detail" data-id="${patient.id}">상세 · 이력</button>
      </div>
    </div>`).join('') : '<div class="empty">원장님께 전달할 악화 환자가 없어요.</div>';
}

function renderVisit(list) {
  $('panel-visit').innerHTML = list.length ? list.map(({ patient, call }) => `
    <div class="case-card">
      <div class="case-top">
        <div class="case-id">
          <div class="case-name">${esc(patient.name)}</div>
          <div class="case-meta-row">${conditionBadge(patient)}<span class="badge badge-visit">내원 예약 필요</span>${resultBadge(call.result)}</div>
          <div class="case-phone mono">${esc(formatPhone(patient.phone))}</div>
        </div>
      </div>
      <div class="case-note">${esc(call.note || '메모 없음')}</div>
      <div class="case-actions">
        <button class="btn btn-primary btn-sm" data-action="visit-booked" data-id="${call.id}">✅ 예약 완료로 표시</button>
        <button class="btn btn-ghost btn-sm" data-action="detail" data-id="${patient.id}">상세 · 이력</button>
      </div>
    </div>`).join('') : '<div class="empty">내원 예약이 필요한 환자가 없어요.</div>';
}

function renderAll() {
  const el = $('panel-all');
  if (!el.dataset.ready) {
    el.innerHTML = `
      <div class="toolbar"><input class="search-input" id="search-input" placeholder="이름 또는 전화번호로 검색"></div>
      <div class="table-wrap"><table>
        <thead><tr><th>환자명</th><th>전화번호</th><th>증상</th><th>진행 중 처방</th><th>다음 콜</th><th></th></tr></thead>
        <tbody id="all-body"></tbody>
      </table></div>`;
    $('search-input').addEventListener('input', (e) => { state.search = e.target.value; renderAllRows(); });
    el.dataset.ready = '1';
  }
  renderAllRows();
}

function nextOpenCallDate(patient) {
  const dates = patient.prescriptions
    .filter((r) => r.status === 'active')
    .flatMap((r) => r.calls.filter((c) => c.status === 'pending' || c.status === 'sms_pending'))
    .map((c) => c.dueOn)
    .sort();
  return dates[0] ?? null;
}

function renderAllRows() {
  const q = state.search.trim();
  const digits = normalizePhone(q);
  const rows = state.patients
    .filter((p) => !q || p.name.includes(q) || (digits && p.phone.includes(digits)))
    .map((p) => {
      const next = nextOpenCallDate(p);
      return `<tr>
        <td class="name-cell" data-action="detail" data-id="${p.id}">${esc(p.name)}</td>
        <td class="mono">${esc(formatPhone(p.phone))}</td>
        <td>${esc(conditionText(p.condition, p.conditionLabel))}</td>
        <td>${p.prescriptions.filter((r) => r.status === 'active').length}건</td>
        <td class="mono">${next ? formatKoreanDate(next) : '-'}</td>
        <td><button class="btn btn-ghost btn-sm" data-action="detail" data-id="${p.id}">상세</button></td>
      </tr>`;
    }).join('');
  $('all-body').innerHTML = rows
    || '<tr><td colspan="6" style="color:var(--text-muted); text-align:center; padding:24px;">등록된 환자가 없어요.</td></tr>';
}

const SCRIPT_SECTIONS = [
  ['urticaria', '두드러기 콜 스크립트'],
  ['cough', '기침 콜 스크립트'],
  ['other', '기타 콜 스크립트'],
  ['closing_mid', '중간 콜 마무리 문장'],
  ['closing_pre_runout', '소진 전 콜 마무리 문장 · {runout} 자리에 소진일이 들어가요'],
  ['sms_no_answer', '부재 안내 문자 · {name} 자리에 환자 이름이 들어가요'],
];

function renderScripts() {
  const scripts = scriptsWithDefaults();
  $('panel-scripts').innerHTML = SCRIPT_SECTIONS.map(([key, title]) => `
    <div class="script-card">
      <h3>${esc(title)}</h3>
      <textarea id="script-${key}">${esc(scripts[key])}</textarea>
      <div class="row-end"><button class="btn btn-primary btn-sm" data-action="save-script" data-id="${key}">저장</button></div>
    </div>`).join('');
}

// ---- 모달 ----

export function openModal(html, wide = false) {
  state.detailPatientId = null;
  $('modal-root').innerHTML = `<div class="modal-overlay" data-overlay="1"><div class="modal${wide ? ' wide' : ''}">${html}</div></div>`;
}

export function closeModal() {
  state.detailPatientId = null;
  $('modal-root').innerHTML = '';
}

const KIND_ORDER = { mid: 0, pre_runout: 1 };

export function openDetailModal(patient) {
  if (!patient) return;
  const blocks = patient.prescriptions.map((rx) => {
    const rxStatus = rx.status === 'active' ? '진행 중' : rx.closedReason === 'early' ? '조기 마감' : '마감';
    const calls = rx.calls.slice().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]).map((c) => {
      const open = rx.status === 'active';
      const buttons = [
        open && c.status === 'pending' ? `<button class="btn btn-sm" data-action="call" data-id="${c.id}">통화 기록</button>` : '',
        open && c.status === 'pending' ? `<button class="btn btn-sm" data-action="no-answer" data-id="${c.id}">부재중</button>` : '',
        open && c.status === 'sms_pending' ? `<button class="btn btn-sm" data-action="sms" data-id="${c.id}">문자 문구</button>` : '',
      ].join(' ');
      const attempts = c.attempts.map((a) => `
        <div class="history-item">
          <div class="h-top">
            <span class="h-date">${localDate(a.attemptedAt)}</span>
            <span>${a.outcome === 'no_answer' ? '부재중' : '통화'}</span>
            ${a.staffName ? `<span style="color:var(--text-faint)">${esc(a.staffName)}</span>` : ''}
          </div>
          ${a.note ? `<div class="h-note">${esc(a.note)}</div>` : ''}
        </div>`).join('');
      return `
        <div class="call-line">
          <span>${kindBadge(c)} ${formatKoreanDate(c.dueOn)} · ${CALL_STATUS_LABELS[c.status]}
            ${c.noAnswerCount ? `· 부재 ${c.noAnswerCount}/3` : ''} ${resultBadge(c.result)}
            ${c.escalation === 'sent' ? '<span class="badge badge-other">원장 전달함</span>' : ''}</span>
          <span>${buttons}</span>
        </div>
        ${attempts}`;
    }).join('');
    return `
      <div class="rx-block">
        <div class="rx-head">
          <strong>${formatKoreanDate(rx.prescribedOn)} 처방 · ${rx.days}일</strong>
          <span>소진 ${formatKoreanDate(rx.runoutOn)} · ${rxStatus}</span>
        </div>
        ${calls}
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-head">
      <div><h2>${esc(patient.name)}</h2><div class="sub">${esc(formatPhone(patient.phone))} · ${esc(conditionText(patient.condition, patient.conditionLabel))}</div></div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    ${blocks || '<div class="empty">처방이 없어요.</div>'}
    <div class="modal-footer"><button class="btn" data-action="close">닫기</button></div>`, true);
  state.detailPatientId = patient.id;
}

// ---- 버튼 ----

export function onAppClick(e) {
  if (e.target.dataset && e.target.dataset.overlay) { closeModal(); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'close') closeModal();
  if (action === 'detail') openDetailModal(findPatient(id));
}

let bound = false;

export function startApp() {
  if (!bound) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
    $('btn-sign-out').addEventListener('click', () => store.signOut());
    $('app').addEventListener('click', onAppClick);
    $('modal-root').addEventListener('click', onAppClick);
    bound = true;
  }
  refresh();
}

export function stopApp() {
  state.patients = [];
  state.scripts = {};
  closeModal();
}
```

`js/main.js`:

```js
import { getSession, onAuthChange, sendLoginLink } from './store.js';
import { startApp, stopApp } from './ui.js';

const loading = document.getElementById('loading');
const loginScreen = document.getElementById('login-screen');
const appRoot = document.getElementById('app');
const loginMessage = document.getElementById('login-message');

let started = false;

function show(session) {
  loading.hidden = true;
  loginScreen.hidden = Boolean(session);
  appRoot.hidden = !session;
  if (session && !started) { started = true; startApp(); }
  if (!session && started) { started = false; stopApp(); }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  if (!email) return;
  loginMessage.textContent = '보내는 중…';
  try {
    await sendLoginLink(email);
    loginMessage.textContent = '메일함에서 로그인 링크를 눌러주세요.';
  } catch (err) {
    console.error(err);
    loginMessage.textContent = '로그인 링크를 보내지 못했어요. 허용된 이메일인지 확인해주세요.';
  }
});

onAuthChange(show);
getSession().then(show).catch((err) => { console.error(err); show(null); });
```

- [ ] **Step 6: 로컬 서버**

`scripts/serve.mjs`:

```js
// 의존성 없는 정적 파일 서버. 기본 포트 5173.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 5173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = normalize(pathname).replace(/^[/\\]+/, '');
  const file = join(root, relative === '' ? 'index.html' : relative);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
```

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "happycall",
      "runtimeExecutable": "node",
      "runtimeArgs": ["scripts/serve.mjs"],
      "port": 5173
    }
  ]
}
```

- [ ] **Step 7: 사용자에게 Supabase 로그인 주소 설정 요청**

로그인 링크가 로컬 주소로 돌아오게 하려면 대시보드 설정이 필요하다. 연결 도구로는 바꿀 수 없어 사용자에게 안내한다.

1. `https://supabase.com/dashboard/project/yblqrtwbvqrshqmnizij/auth/url-configuration` 열기
2. **Site URL**: `http://localhost:5173` 입력 후 저장 (Task 7에서 배포 주소로 바꾼다)
3. **Redirect URLs**에 `http://localhost:5173/**` 추가 후 저장

사용자가 "했다"고 답하기 전에는 Step 8의 로그인 확인으로 넘어가지 않는다.

- [ ] **Step 8: 화면 확인**

1. `npm test` → Expected: PASS, `# fail 0`
2. `preview_start` name `happycall` → Browser pane에 로그인 화면("두기 해피콜", 이메일 칸, "로그인 링크 받기")이 보인다. `read_console_messages` onlyErrors → Expected: 오류 없음
3. MCP `execute_sql`로 예시 데이터 한 건을 넣는다. 오늘이 목·일이면 전날로 잡는다.

```sql
with d as (
  select case when extract(isodow from (now() at time zone 'Asia/Seoul')::date) in (4, 7)
              then (now() at time zone 'Asia/Seoul')::date - 1
              else (now() at time zone 'Asia/Seoul')::date end as due
), p as (
  insert into public.patients (name, phone, condition) values ('홍길동 (화면확인)', '01000000009', 'urticaria') returning id
), r as (
  insert into public.prescriptions (patient_id, prescribed_on, days, runout_on)
  select p.id, d.due - 3, 3, d.due from p, d returning id
)
insert into public.calls (prescription_id, kind, due_on)
select r.id, 'pre_runout', d.due from r, d returning due_on;
```

4. 사용자에게 요청: 본인 Chrome에서 `http://localhost:5173`을 열고 허용된 이메일로 "로그인 링크 받기" → 메일의 링크 클릭.
5. Claude in Chrome 도구(`tabs_context_mcp`, `read_page`, `find`, `computer`)로 그 탭을 확인한다. Expected:
   - 통계 "오늘 콜" 1, "진행 중 처방" 1
   - "오늘 콜" 탭에 "홍길동 (화면확인)" 카드, 배지 "두드러기", "소진 전 콜", "오늘" 또는 "1일 지연"
   - "전체 환자" 탭에서 "홍"을 입력하면 한 줄, "0100000000"을 입력해도 한 줄
   - "상세 · 이력"을 누르면 처방 한 블록과 콜 한 줄이 보이고 "닫기"로 닫힌다
   - "스크립트" 탭에 카드 여섯 개
   - 브라우저 콘솔 오류 없음
   Claude in Chrome이 연결돼 있지 않으면 같은 항목을 사용자에게 보고 달라고 한다.
6. 예시 데이터 정리:

```sql
delete from public.patients where phone = '01000000009';
```

- [ ] **Step 9: 커밋**

```bash
git add reference css index.html js/config.js js/store.js js/ui.js js/main.js scripts .claude/launch.json
git commit -F - <<'MSG'
feat: 이메일 로그인과 해피콜 목록 화면

기존 Artifact 화면과 색을 옮기고 Supabase에서 환자·처방·콜을 읽어 탭별로 보여준다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 6: 등록·통화·부재·문자·원장 전달 흐름 (쓰기)

**Files:**
- Modify: `js/store.js` (쓰기 함수 추가)
- Modify: `js/ui.js` (import 교체, `onAppClick` 교체, `startApp`에 한 줄 추가, 모달 함수 추가)

**Interfaces:**
- Consumes: Task 4 데이터베이스 함수, Task 1 `planCalls`, `hasPastCall`, `decideNoAnswer`, `decideSmsSent`, `decideAnswered`, `defaultVisitNeededFor`, `todayYMD`, Task 2 문구 함수, Task 3 `preRunoutCall`, Task 5 `ui.js` 공통 함수
- Produces:
  - `store.js`: `findPatientByPhone(phone): Promise<{id, name, condition, conditionLabel}|null>`, `registerPrescription({ phone, name, condition, conditionLabel, prescribedOn, days, runoutOn, calls }): Promise<string>`, `saveCallOutcome(callId, { outcome, note, staffName, status, dueOn, noAnswerCount, result, visitNeeded, escalation, closePrescription }): Promise<void>`, `markEscalationSent(callId): Promise<void>`, `markVisitBooked(callId): Promise<void>`, `saveScript(key, text): Promise<void>`
  - `ui.js`: `openRegisterModal()`, `openCallModal(view)`, `handleNoAnswer(view)`, `openSmsModal(view)`, `openEscalationModal(view)`, `copyText(text)`

- [ ] **Step 1: 쓰기 함수 추가**

`js/store.js` 끝에 덧붙인다:

```js
// ---- 쓰기 ----

export async function findPatientByPhone(phone) {
  const { data, error } = await supabase
    .from('patients')
    .select('id, name, condition, condition_label')
    .eq('phone', phone)
    .maybeSingle();
  check(error);
  return data ? { id: data.id, name: data.name, condition: data.condition, conditionLabel: data.condition_label ?? '' } : null;
}

export async function registerPrescription({ phone, name, condition, conditionLabel, prescribedOn, days, runoutOn, calls }) {
  const { data, error } = await supabase.rpc('register_prescription', {
    p_phone: phone,
    p_name: name,
    p_condition: condition,
    p_condition_label: conditionLabel ?? '',
    p_prescribed_on: prescribedOn,
    p_days: days,
    p_runout_on: runoutOn,
    p_calls: calls,
  });
  check(error);
  return data;
}

export async function saveCallOutcome(callId, o) {
  const { error } = await supabase.rpc('save_call_outcome', {
    p_call_id: callId,
    p_outcome: o.outcome ?? null,
    p_note: o.note ?? '',
    p_staff_name: o.staffName ?? '',
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

export async function markEscalationSent(callId) {
  const { error } = await supabase
    .from('calls')
    .update({ escalation: 'sent', escalated_at: new Date().toISOString() })
    .eq('id', callId);
  check(error);
}

export async function markVisitBooked(callId) {
  const { error } = await supabase.from('calls').update({ visit_booked: true }).eq('id', callId);
  check(error);
}

export async function saveScript(key, text) {
  const { error } = await supabase.from('scripts').upsert({ key, text, updated_at: new Date().toISOString() });
  check(error);
}
```

- [ ] **Step 2: `ui.js` import 교체**

`js/ui.js` 맨 위 import 네 개를 아래로 바꾼다:

```js
import * as store from './store.js';
import {
  todayYMD, overdueDays, planCalls, hasPastCall, decideNoAnswer, decideSmsSent, decideAnswered,
  defaultVisitNeededFor,
} from './schedule.js';
import {
  todayCalls, upcomingCalls, escalationCalls, visitCalls, activePrescriptionCount, preRunoutCall,
} from './model.js';
import {
  CONDITION_LABELS, RESULT_LABELS, KIND_LABELS, CALL_STATUS_LABELS, DAYS_PRESETS, DEFAULT_SCRIPTS,
  normalizePhone, isValidPhone, formatPhone, isValidDays, conditionText, formatKoreanDate,
  fillTemplate, buildEscalationText, buildCallScript,
} from './texts.js';
```

- [ ] **Step 3: `onAppClick` 교체와 `startApp` 한 줄 추가**

`js/ui.js`의 `onAppClick` 함수 전체를 아래로 바꾼다:

```js
export function onAppClick(e) {
  if (e.target.dataset && e.target.dataset.overlay) { closeModal(); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'close') closeModal();
  if (action === 'detail') openDetailModal(findPatient(id));
  if (action === 'call') openCallModal(findView(id));
  if (action === 'no-answer') handleNoAnswer(findView(id));
  if (action === 'sms') openSmsModal(findView(id));
  if (action === 'escalate') openEscalationModal(findView(id));
  if (action === 'visit-booked') run(() => store.markVisitBooked(id), '예약 완료로 표시했어요.');
  if (action === 'save-script') run(() => store.saveScript(id, $(`script-${id}`).value), '스크립트를 저장했어요.');
}
```

`startApp`의 `$('btn-sign-out')...` 줄 바로 아래에 한 줄을 더한다:

```js
    $('btn-open-register').addEventListener('click', openRegisterModal);
```

- [ ] **Step 4: 모달 함수 추가**

`js/ui.js`의 `// ---- 버튼 ----` 줄 바로 위에 덧붙인다:

```js
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했어요.');
  } catch {
    toast('복사하지 못했어요. 글자를 직접 선택해 복사해주세요.');
  }
}

function pillGroup(id, entries, selected) {
  return `<div class="pill-group" id="${id}">${entries.map(([value, label]) =>
    `<button type="button" class="pill-opt${String(value) === String(selected) ? ' selected' : ''}" data-val="${value}">${label}</button>`).join('')}</div>`;
}

function selectPill(groupId, value) {
  document.querySelectorAll(`#${groupId} .pill-opt`).forEach((b) => b.classList.toggle('selected', b.dataset.val === String(value)));
}

// ---- 처방 등록 ----

export function openRegisterModal() {
  const today = todayYMD();
  const form = { condition: 'urticaria', existing: null, lookup: 0 };

  openModal(`
    <div class="modal-head">
      <div><h2>처방 등록</h2><div class="sub">전화번호부터 넣으면 기존 환자인지 바로 알려드려요.</div></div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    <div class="field">
      <label>전화번호 *</label>
      <input type="tel" id="rg-phone" inputmode="numeric" placeholder="01012345678">
      <span class="existing-note" id="rg-existing"></span>
    </div>
    <div class="field-row">
      <div class="field"><label>환자명 *</label><input type="text" id="rg-name" maxlength="50"></div>
      <div class="field"><label>증상</label>${pillGroup('rg-condition', Object.entries(CONDITION_LABELS), form.condition)}</div>
    </div>
    <div class="field" id="rg-other-field" hidden><label>기타 증상 이름</label><input type="text" id="rg-other" placeholder="예: 아토피"></div>
    <div class="field-row">
      <div class="field"><label>처방일</label><input type="date" id="rg-date" value="${today}"></div>
      <div class="field">
        <label>처방 일수 *</label>
        ${pillGroup('rg-days-presets', DAYS_PRESETS.map((d) => [d, `${d}일`]), 30)}
        <input type="number" id="rg-days" min="1" max="90" value="30">
      </div>
    </div>
    <div id="rg-preview"></div>
    <div class="modal-footer">
      <button class="btn" data-action="close">취소</button>
      <button class="btn btn-primary" id="rg-submit">등록</button>
    </div>`);

  const setCondition = (condition, locked) => {
    form.condition = condition;
    selectPill('rg-condition', condition);
    $('rg-other-field').hidden = condition !== 'other';
    document.querySelectorAll('#rg-condition .pill-opt').forEach((b) => { b.disabled = locked; });
  };

  const readPlan = () => {
    const days = Number($('rg-days').value);
    const date = $('rg-date').value;
    if (!date || !isValidDays(days)) return null;
    return { date, days, plan: planCalls(date, days) };
  };

  const updatePreview = () => {
    const read = readPlan();
    if (!read) {
      $('rg-preview').innerHTML = '<div class="preview-box warn">처방일을 넣고, 처방 일수는 1~90일로 넣어주세요.</div>';
      return;
    }
    const lines = read.plan.calls.map((c) => `${KIND_LABELS[c.kind]} ${formatKoreanDate(c.dueOn)}`).join(', ');
    let html = `<div class="preview-box">소진일 ${formatKoreanDate(read.plan.runoutOn)} · ${lines}</div>`;
    if (hasPastCall(read.plan.calls, today)) {
      html += '<div class="preview-box warn">이미 지난 콜 날짜가 있어요. 저장하면 바로 지연으로 떠요.</div>';
    }
    $('rg-preview').innerHTML = html;
  };

  $('rg-phone').addEventListener('input', async () => {
    const phone = normalizePhone($('rg-phone').value);
    const token = ++form.lookup;
    form.existing = null;
    $('rg-existing').textContent = '';
    $('rg-name').disabled = false;
    setCondition(form.condition, false);
    if (!isValidPhone(phone)) return;
    try {
      const found = await store.findPatientByPhone(phone);
      if (token !== form.lookup || !found) return;
      form.existing = found;
      $('rg-name').value = found.name;
      $('rg-name').disabled = true;
      $('rg-other').value = found.conditionLabel;
      setCondition(found.condition, true);
      $('rg-existing').textContent = '기존 환자예요. 새 처방만 추가돼요.';
    } catch (err) {
      console.error(err);
    }
  });

  $('rg-condition').addEventListener('click', (e) => {
    const b = e.target.closest('.pill-opt');
    if (b && !b.disabled) setCondition(b.dataset.val, false);
  });

  $('rg-days-presets').addEventListener('click', (e) => {
    const b = e.target.closest('.pill-opt');
    if (!b) return;
    $('rg-days').value = b.dataset.val;
    selectPill('rg-days-presets', b.dataset.val);
    updatePreview();
  });

  $('rg-days').addEventListener('input', () => { selectPill('rg-days-presets', $('rg-days').value); updatePreview(); });
  $('rg-date').addEventListener('input', updatePreview);
  updatePreview();

  $('rg-submit').addEventListener('click', async () => {
    const phone = normalizePhone($('rg-phone').value);
    const name = $('rg-name').value.trim();
    const read = readPlan();
    if (!isValidPhone(phone)) { toast('전화번호는 숫자 10~11자리로 넣어주세요.'); return; }
    if (!form.existing && !name) { toast('환자명을 넣어주세요.'); return; }
    if (!read) { toast('처방일과 처방 일수(1~90일)를 확인해주세요.'); return; }
    const ok = await run(() => store.registerPrescription({
      phone,
      name: form.existing ? form.existing.name : name,
      condition: form.condition,
      conditionLabel: form.condition === 'other' ? $('rg-other').value.trim() : '',
      prescribedOn: read.date,
      days: read.days,
      runoutOn: read.plan.runoutOn,
      calls: read.plan.calls,
    }), form.existing ? '기존 환자에 처방을 추가했어요.' : '등록했어요.');
    if (ok) closeModal();
  });
}

// ---- 통화 기록 ----

export function openCallModal(view) {
  if (!view) return;
  const { patient, prescription, call } = view;
  const script = buildCallScript({
    condition: patient.condition, kind: call.kind, name: patient.name,
    runoutOn: prescription.runoutOn, scripts: scriptsWithDefaults(),
  });
  let result = 'improved';

  openModal(`
    <div class="modal-head">
      <div>
        <h2>통화 기록 · ${esc(patient.name)}</h2>
        <div class="sub">${esc(formatPhone(patient.phone))} · ${KIND_LABELS[call.kind]} · 소진 ${formatKoreanDate(prescription.runoutOn)}</div>
      </div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    <div class="script-view">${esc(script)}</div>
    <div class="field">
      <label>증상 상태</label>
      ${pillGroup('cl-result', Object.entries(RESULT_LABELS), result)}
      <span class="field-hint" id="cl-worse-hint" hidden>악화로 저장하면 '원장 전달 필요'에 올라가요.</span>
    </div>
    <div class="field"><label>통화 메모</label><textarea id="cl-note" placeholder="증상 경과, 특이사항"></textarea></div>
    <div class="field"><label class="checkbox-row"><input type="checkbox" id="cl-visit"> 내원 예약이 필요해요</label></div>
    <div class="field"><label class="checkbox-row"><input type="checkbox" id="cl-close-early"> 이 처방 조기 마감 (복용 중단 등)</label></div>
    <div class="field"><label>담당 직원</label><input type="text" id="cl-staff" value="${esc(state.staffName)}"></div>
    <div class="modal-footer">
      <button class="btn" data-action="close">취소</button>
      <button class="btn btn-primary" id="cl-submit">저장</button>
    </div>`, true);

  $('cl-result').addEventListener('click', (e) => {
    const b = e.target.closest('.pill-opt');
    if (!b) return;
    result = b.dataset.val;
    selectPill('cl-result', result);
    $('cl-worse-hint').hidden = result !== 'worse';
    if (defaultVisitNeededFor(result)) $('cl-visit').checked = true;
  });

  $('cl-submit').addEventListener('click', async () => {
    state.staffName = $('cl-staff').value.trim();
    const d = decideAnswered(call, {
      result,
      note: $('cl-note').value.trim(),
      visitNeeded: $('cl-visit').checked,
      closeEarly: $('cl-close-early').checked,
    });
    const ok = await run(() => store.saveCallOutcome(call.id, {
      outcome: 'answered', note: d.note, staffName: state.staffName, status: d.status, dueOn: null,
      noAnswerCount: call.noAnswerCount, result: d.result, visitNeeded: d.visitNeeded,
      escalation: d.escalation, closePrescription: d.closePrescription,
    }), d.escalation === 'pending' ? "저장했어요. '원장 전달 필요'에 올라갔어요." : '저장했어요.');
    if (ok) closeModal();
  });
}

// ---- 부재중 ----

export async function handleNoAnswer(view) {
  if (!view) return;
  const { prescription, call } = view;
  const pre = preRunoutCall(prescription);
  const d = decideNoAnswer(call, {
    today: todayYMD(),
    runoutOn: prescription.runoutOn,
    preRunoutDueOn: pre ? pre.dueOn : prescription.runoutOn,
  });
  const message = {
    pending: d.dueOn ? `${formatKoreanDate(d.dueOn)}에 다시 뜨게 했어요.` : '',
    closed_no_answer: '중간 콜을 마감했어요. 소진 전 콜이 이어받아요.',
    sms_pending: '',
  }[d.status];
  const ok = await run(() => store.saveCallOutcome(call.id, {
    outcome: 'no_answer', note: '', staffName: state.staffName, status: d.status, dueOn: d.dueOn,
    noAnswerCount: d.noAnswerCount, result: null, visitNeeded: call.visitNeeded,
    escalation: call.escalation, closePrescription: null,
  }), message);
  if (ok && d.status === 'sms_pending') openSmsModal(findView(call.id));
}

// ---- 부재 문자 ----

export function openSmsModal(view) {
  if (!view) return;
  const { patient, call } = view;
  const text = fillTemplate(scriptsWithDefaults().sms_no_answer, { name: patient.name });

  openModal(`
    <div class="modal-head">
      <div><h2>부재 안내 문자 · ${esc(patient.name)}</h2><div class="sub">${esc(formatPhone(patient.phone))} · 부재 ${call.noAnswerCount}회</div></div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    <textarea class="copy-box" id="sms-text">${esc(text)}</textarea>
    <p class="field-hint">복사해서 문자로 보낸 뒤 '문자 보냈음'을 눌러주세요. 그냥 닫으면 오늘 목록에 '문자 대기'로 남아요.</p>
    <div class="modal-footer">
      <button class="btn" id="sms-copy">복사</button>
      <button class="btn btn-primary" id="sms-sent">문자 보냈음</button>
    </div>`);

  $('sms-copy').addEventListener('click', () => copyText($('sms-text').value));
  $('sms-sent').addEventListener('click', async () => {
    const d = decideSmsSent(call);
    const ok = await run(() => store.saveCallOutcome(call.id, {
      outcome: null, note: '', staffName: state.staffName, status: d.status, dueOn: null,
      noAnswerCount: call.noAnswerCount, result: null, visitNeeded: call.visitNeeded,
      escalation: call.escalation, closePrescription: d.closePrescription,
    }), '문자 보냄으로 마감했어요.');
    if (ok) closeModal();
  });
}

// ---- 원장 전달 ----

export function openEscalationModal(view) {
  if (!view) return;
  const { patient, call } = view;
  const text = buildEscalationText({
    name: patient.name, condition: patient.condition, conditionLabel: patient.conditionLabel, note: call.note,
  });

  openModal(`
    <div class="modal-head">
      <div><h2>원장 전달 · ${esc(patient.name)}</h2><div class="sub">한의사랑 메신저에 붙여넣어 주세요</div></div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    <textarea class="copy-box" id="esc-text">${esc(text)}</textarea>
    <div class="modal-footer">
      <button class="btn" id="esc-copy">복사</button>
      <button class="btn btn-primary" id="esc-sent">메신저로 전달함</button>
    </div>`);

  $('esc-copy').addEventListener('click', () => copyText($('esc-text').value));
  $('esc-sent').addEventListener('click', async () => {
    const ok = await run(() => store.markEscalationSent(call.id), '전달 완료로 표시했어요.');
    if (ok) closeModal();
  });
}
```

- [ ] **Step 5: 자동 테스트 다시 확인**

Run: `npm test`
Expected: PASS, `# fail 0`

- [ ] **Step 6: 스펙 완료 확인 1~7을 화면에서 수행**

사용자 Chrome의 `http://localhost:5173` 탭에서 Claude in Chrome 도구로 진행한다. 로그인이 풀려 있으면 Task 5 Step 8의 4번을 다시 요청한다. 아래에서 "다가오는 목요일"은 실행일 이후 첫 목요일이다.

1. **처방 3건 등록.** "+ 처방 등록"으로 차례로 넣는다.
   - `01011110001` / 예시가 / 두드러기 / 처방일 오늘 / 30일
   - `01011110002` / 예시나 / 기침 / 처방일 오늘 / 15일
   - `01011110003` / 예시다 / 기타(아토피) / 처방일 다가오는 목요일 / 10일
   Expected: 미리보기가 각각 콜 2건, 1건, 1건을 보여준다. 등록 뒤 MCP로 확인:

```sql
select p.phone, r.days, count(c.*) as calls,
       string_agg(c.kind || ':' || c.due_on || ':' || extract(isodow from c.due_on), ', ' order by c.due_on) as detail
from patients p join prescriptions r on r.patient_id = p.id join calls c on c.prescription_id = r.id
where p.phone like '0101111000%' group by p.phone, r.days order by p.phone;
```

   Expected: `01011110001 30 2`, `01011110002 15 1`, `01011110003 10 1`. `detail`의 요일 숫자에 4와 7이 없다.

2. **목요일 당김.** 1번의 세 번째 등록 미리보기에서 소진 전 콜이 수요일로 표시됐는지 본다. 10일 처방은 소진 3일 전이 처방일과 같은 요일이라 목요일 처방일이면 반드시 목요일에 걸린다. Expected: `소진 전 콜 N월 N일(수)`.

3. **같은 전화번호.** "+ 처방 등록"에서 `01011110001`을 입력한다. Expected: "기존 환자예요. 새 처방만 추가돼요."가 뜨고 이름 칸이 "예시가"로 잠긴다. 처방일 오늘, 15일로 등록한다. MCP 확인:

```sql
select (select count(*) from patients where phone = '01011110001') as patients,
       (select count(*) from prescriptions r join patients p on p.id = r.patient_id where p.phone = '01011110001') as prescriptions;
```

   Expected: `patients = 1`, `prescriptions = 2`

4. **중간 콜 부재 3회.** "전체 환자" → "예시가" 상세 → 30일 처방의 "중간 콜" 줄에서 "부재중"을 세 번 누른다. 누를 때마다 상세 창이 새 내용으로 다시 열린다. Expected: 1·2번째에는 토스트 "N월 N일에 다시 뜨게 했어요."와 줄에 "부재 1/3", "부재 2/3". 3번째에는 "부재 안내 문자" 창이 뜬다. "복사" → 토스트 "복사했어요." → "문자 보냈음". 다시 상세를 열면 중간 콜은 "부재 마감", 같은 처방의 소진 전 콜은 "대기". MCP 확인:

```sql
select c.kind, c.status, c.no_answer_count, (select count(*) from call_attempts a where a.call_id = c.id) as attempts, r.status as rx
from calls c join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id
where p.phone = '01011110001' and r.days = 30 order by c.kind;
```

   Expected: `mid closed_no_answer 3 3 active`, `pre_runout pending 0 0 active`

5. **악화 전달.** "예시나" 상세 → 소진 전 콜 "통화 기록" → 증상 "악화" (내원 필요 체크가 자동으로 켜지고 안내 문구가 보임) → 메모 "밤에 기침 심해짐" → 저장. Expected: 토스트 "저장했어요. '원장 전달 필요'에 올라갔어요.", 통계 "원장 전달 필요" 1. "원장 전달 필요" 탭 → "전달 문구 열기" → 문구가 `[해피콜 악화] 예시나 / 기침` 과 `통화 메모: 밤에 기침 심해짐` → "복사" → "메신저로 전달함". Expected: 탭에서 빠지고 통계 0, "내원 예약 필요" 탭에 "예시나"가 남는다.

6. **새로고침.** 페이지를 새로고침한다. Expected: 1~5의 결과(통계 숫자, 탭 내용, 상세의 상태와 부재 횟수)가 그대로다.

7. **Table Editor 확인.** MCP 확인:

```sql
select (select count(*) from patients where phone like '0101111000%') as patients,
       (select count(*) from prescriptions r join patients p on p.id = r.patient_id where p.phone like '0101111000%') as prescriptions,
       (select count(*) from calls c join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id where p.phone like '0101111000%') as calls,
       (select count(*) from call_attempts a join calls c on c.id = a.call_id join prescriptions r on r.id = c.prescription_id join patients p on p.id = r.patient_id where p.phone like '0101111000%') as call_attempts;
```

   Expected: `patients 3`, `prescriptions 4`, `calls 5`, `call_attempts 4`. 사용자에게 Supabase 대시보드 Table Editor에서 같은 행이 보이는지 확인하고, 화면 캡처를 `supabase_tables.png`로 저장해 달라고 요청한다(과제 3에 첨부).

어느 단계든 Expected와 다르면 멈추고 superpowers:systematic-debugging으로 원인을 찾는다. 규칙 문제면 Task 1~3 테스트를 먼저 고친다. 예시 데이터는 발표용으로 남긴다.

- [ ] **Step 7: 커밋**

```bash
git add js/store.js js/ui.js
git commit -F - <<'MSG'
feat: 처방 등록·통화 기록·부재 문자·원장 전달 흐름

스펙 완료 확인 1~7을 예시 환자로 화면에서 통과했다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 7: 배포와 과제 기록

**Files:**
- Create: `.vercelignore`, `README.md`
- Modify (워크숍 저장소): `05_3회차준비과제/닥터두기/3_구현기록.md`, `05_3회차준비과제/닥터두기/README.md`

**Interfaces:**
- Consumes: Task 1~6 결과
- Produces: GitHub 저장소 주소, Vercel 배포 주소, 채워진 과제 3 문서

- [ ] **Step 1: 배포 제외 목록과 README**

`.vercelignore`:

```
tests
scripts
supabase
docs
reference
.claude
```

`README.md`:

````markdown
# 두기 해피콜

처방 한 건마다 약이 떨어지기 전에 해피콜이 잡히는 접수실용 웹앱입니다.
기획: 워크숍 저장소 `05_3회차준비과제/닥터두기/2_기획안_V1_V2.md`

## 로컬에서 열기

```bash
npm run serve
```

브라우저에서 http://localhost:5173 을 엽니다. 허용된 이메일로 로그인 링크를 받습니다.

## 테스트

```bash
npm test
```

## 데이터베이스

- Supabase 프로젝트 `yblqrtwbvqrshqmnizij`
- 스키마는 `supabase/migrations`에 순서대로 있습니다
- 로그인 허용 이메일은 `allowed_emails` 테이블에서 관리합니다
- 앱에는 publishable 키만 들어 있습니다. service_role 키는 넣지 않습니다

## 배포

Vercel에서 이 GitHub 저장소를 불러와 배포합니다. 빌드 명령은 없습니다.
배포 주소가 바뀌면 Supabase Authentication의 URL Configuration에 새 주소를 넣습니다.
````

커밋:

```bash
git add .vercelignore README.md
git commit -F - <<'MSG'
docs: 실행·테스트·배포 안내와 배포 제외 목록

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 2: GitHub 저장소 (사용자 단계)**

사용자에게 안내한다: github.com에서 새 저장소 `doogie-happycall`을 만든다(README 추가하지 않음, 비공개 권장). 주소를 받는다.

사용자 허락을 받은 뒤 push한다. `<저장소 주소>`는 사용자가 준 주소로 바꾼다.

```bash
git remote add origin <저장소 주소>
git push -u origin feat/v1
```

main에 합칠지 사용자에게 묻고, 동의하면:

```bash
git switch main
git merge --ff-only feat/v1
git push -u origin main
git switch feat/v1
```

- [ ] **Step 3: Vercel 배포 (사용자 단계)**

사용자에게 안내한다: vercel.com 로그인 → Add New → Project → GitHub의 `doogie-happycall` Import → Framework Preset "Other", Build Command 비움, Output Directory 비움 → Deploy. 배포 주소를 받는다.

배포가 막히면 멈추고 막힌 지점(계정·권한·설정 화면)을 그대로 받아 Step 6의 "외부 연동 시도"에 적는다. 로컬 확인 결과는 Task 6에 이미 있으므로 과제 기록은 계속 진행한다.

- [ ] **Step 4: Supabase 주소 설정 (사용자 단계)**

`https://supabase.com/dashboard/project/yblqrtwbvqrshqmnizij/auth/url-configuration`에서:
- **Site URL**: 배포 주소
- **Redirect URLs**: `<배포 주소>/**` 추가 (`http://localhost:5173/**`는 남겨둔다)

- [ ] **Step 5: 배포 주소 확인**

사용자 Chrome에서 배포 주소를 열고 로그인 링크로 로그인한다. Claude in Chrome으로 확인한다. Expected: 로그인 뒤 Task 6의 예시 환자 3명과 통계가 로컬과 같다. 콘솔 오류 없음.

- [ ] **Step 6: 과제 3 기록 (워크숍 저장소)**

워크숍 저장소 `C:/Users/User.DESKTOP-BLBKBC2/ops-os/customer-view-os-workshop`에서 최신을 받는다. 현재 브랜치가 `doogie/v1-v2-plan`이면:

```bash
git switch main
git pull --ff-only
git switch doogie/v1-v2-plan
git merge main
```

`05_3회차준비과제/닥터두기/3_구현기록.md`의 빈칸을 Task 6·7 결과로 채운다. 반드시 들어갈 값:

| 칸 | 값 |
|---|---|
| 프로젝트 GitHub 저장소 주소 | Step 2의 주소 |
| 배포 주소 | Step 3의 주소 |
| 마지막으로 push한 날짜 | push한 날짜 |
| 되는 것 표 | 처방 등록·콜 자동 생성, 목·일 당김, 같은 번호 처방 추가, 부재 3회 문자 마감, 악화 원장 전달, 내원 예약 표시, 스크립트 편집, 이메일 로그인. Task 6 결과대로 됨/일부/안 됨 |
| V1이 답해야 할 질문 | 스펙의 핵심 질문 그대로 |
| 실제로 해 본 것 / 결과 | Task 6 Step 6의 1~7과 결과 |
| Supabase 프로젝트 이름 | `twobiggi-cloud's Project` |
| 테이블 이름 | `patients`, `prescriptions`, `calls`, `call_attempts`, `scripts`, `allowed_emails` |
| 행이 생겼다 | 예 |
| 캡처 파일 이름 | `supabase_tables.png` (사용자가 준 파일을 이 폴더에 넣는다) |
| 외부 연동 시도 | Supabase 이메일 로그인과 Vercel 배포. 막힌 지점이 있으면 그대로 |
| 발표 때 보여줄 것 | 30일 처방 등록 미리보기에서 콜 두 건이 목·일을 피해 잡히는 장면 |
| 다음에 할 일 | V2 첫 후보: 실제 환자 운영 시작과 환자 안내 문구 |

실제 환자 정보, 비밀번호, service_role 키는 적지 않는다. `README.md` 체크리스트에서 끝난 항목을 `[x]`로 바꾼다.

```bash
git add "05_3회차준비과제/닥터두기"
git commit -F - <<'MSG'
docs(닥터두기): 해피콜 V1 구현 기록

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

워크숍 저장소 main에 합쳐 push할지 사용자에게 묻고, 동의하면 합친 뒤 push하고 GitHub 웹에서 폴더 내용이 보이는지 확인한다.
