# V2 2단계: 한 달 달력 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 월 단위 달력에서 이번 달 해피콜 진행 상황을 한눈에 보고, 날짜를 누르면 그날 집계와 명단이 열려 그 자리에서 콜을 처리할 수 있게 한다.

**Architecture:** 데이터베이스는 바꾸지 않는다. 이미 불러온 환자·처방·콜에서 날짜별로 모아 계산한다. 날짜 격자와 집계는 브라우저 기능을 쓰지 않는 순수 함수로 `js/calendar.js`에 새로 두고 Node 테스트로 검증한다. 화면은 `js/ui.js`에 달력 탭을 더한다.

**Tech Stack:** 정적 HTML + ES 모듈(빌드 없음), Node 24 `node:test`, Supabase(조회만), Vercel 배포(`feat/v1` = production)

**Spec:** `docs/superpowers/specs/2026-09-26-happycall-v2-design.md` 4장 (한 달 달력)

## Global Constraints

- 콜이 달력에서 속하는 날짜는 **예정일(`dueOn`)**이다. 예정일이 없는 콜(부재로 마감된 콜)은 **처리한 날(`doneAt`)**에 둔다. 둘 다 없는 콜(문자 대기)은 달력 위 별도 줄에 모은다.
- 달력 숫자와 나중에 만들 월 통계는 같은 기준으로 센다. 완료 = `done`, 미연결 마감 = `closed_no_answer`, 남음 = `pending`, 문자 대기 = `sms_pending`.
- 지연 = `pending`이면서 예정일이 오늘보다 앞선 콜.
- 연결률 = 완료 ÷ (완료 + 미연결 마감). 분모가 0이면 표시하지 않는다.
- 목요일과 일요일은 콜을 잡지 않는 날이라 흐리게 표시한다.
- 화면 글자 크기는 지금 크기를 유지한다.
- 실제 환자 정보는 코드·문서·커밋·캡처에 넣지 않는다. 예시 환자로만 시험한다.
- `feat/v1`에 push하면 곧바로 실제 배포다. **push 전에 사용자에게 묻는다.**
- 날짜는 모두 `YYYY-MM-DD` 문자열로 다룬다. 달은 `YYYY-MM` 문자열로 다룬다.

---

### Task 1: 달력 날짜 격자

**Files:**
- Create: `js/calendar.js`, `tests/calendar.test.js`

**Interfaces:**
- Produces:
  - `monthKeyOf(ymd): string` — `'2026-10-13'` → `'2026-10'`
  - `shiftMonth(ym, delta): string` — `'2026-10'`, `-1` → `'2026-09'`
  - `monthLabel(ym): string` — `'2026-10'` → `'2026년 10월'`
  - `monthGrid(ym): string[][]` — 일요일 시작, 6주 × 7칸. 앞뒤 달 날짜도 실제 날짜 문자열로 채운다

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/calendar.test.js`를 새로 만든다.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthKeyOf, shiftMonth, monthLabel, monthGrid } from '../js/calendar.js';

test('날짜에서 달을 뽑는다', () => {
  assert.equal(monthKeyOf('2026-10-13'), '2026-10');
  assert.equal(monthKeyOf('2026-01-01'), '2026-01');
});

test('달을 앞뒤로 옮긴다', () => {
  assert.equal(shiftMonth('2026-10', -1), '2026-09');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('달 이름은 한국어로', () => {
  assert.equal(monthLabel('2026-10'), '2026년 10월');
});

test('달력 격자는 일요일 시작 6주', () => {
  const grid = monthGrid('2026-10');
  assert.equal(grid.length, 6);
  assert.equal(grid[0].length, 7);
  // 2026-10-01은 목요일이라 첫 주는 9월 27일(일)부터 시작한다
  assert.equal(grid[0][0], '2026-09-27');
  assert.equal(grid[0][4], '2026-10-01');
  assert.equal(grid[5][6], '2026-11-07');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL. `Cannot find module '../js/calendar.js'`

- [ ] **Step 3: `js/calendar.js` 쓰기**

```js
// 달력 격자와 날짜별 집계. 브라우저 기능을 쓰지 않아서 Node 테스트로 그대로 검증한다.
import { addDays, isoDay } from './schedule.js';

export function monthKeyOf(ymd) {
  return ymd.slice(0, 7);
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = total % 12 + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}년 ${m}월`;
}

// 일요일 시작 6주 격자. 앞뒤 달 날짜도 실제 날짜로 채워 빈칸을 두지 않는다.
export function monthGrid(ym) {
  const first = `${ym}-01`;
  const start = addDays(first, -(isoDay(first) % 7)); // 일요일=7 → 0칸 앞
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) week.push(addDays(start, w * 7 + d));
    weeks.push(week);
  }
  return weeks;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, 실패 0

- [ ] **Step 5: 커밋**

```bash
git add js/calendar.js tests/calendar.test.js
git commit -F - <<'MSG'
feat: 달력 날짜 격자 계산

일요일 시작 6주 격자와 달 이동, 달 이름 표시를 만든다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 2: 날짜별 집계와 달 요약

**Files:**
- Modify: `js/calendar.js`, `tests/calendar.test.js`

**Interfaces:**
- Consumes: `model.callViews(patients)` 결과 배열(`{ patient, prescription, call }`)
- Produces:
  - `calendarDateOf(call): string|null` — 예정일, 없으면 처리한 날, 둘 다 없으면 `null`
  - `bucketByDate(views): Map<string, view[]>` — 날짜 → 그날 콜 목록
  - `undatedViews(views): view[]` — 날짜가 없는 콜(문자 대기)
  - `countsOf(views): { total, done, closed, pending, sms }`
  - `summarize(views, today): { total, done, closed, pending, sms, late, rate }` — `rate`는 연결률(%) 또는 `null`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`tests/calendar.test.js` 맨 위 import에 `calendarDateOf, bucketByDate, undatedViews, countsOf, summarize`를 더하고 파일 끝에 붙인다.

```js
const view = (call) => ({ patient: { id: 'p' }, prescription: { id: 'r' }, call });

test('콜이 달력에서 속하는 날짜', () => {
  assert.equal(calendarDateOf({ dueOn: '2026-10-13', status: 'pending', doneAt: null }), '2026-10-13');
  assert.equal(calendarDateOf({ dueOn: null, status: 'closed_no_answer', doneAt: '2026-10-14T02:00:00Z' }), '2026-10-14');
  assert.equal(calendarDateOf({ dueOn: null, status: 'sms_pending', doneAt: null }), null);
});

test('날짜별로 모으고 날짜 없는 콜은 따로 둔다', () => {
  const views = [
    view({ dueOn: '2026-10-13', status: 'done', doneAt: '2026-10-13T01:00:00Z' }),
    view({ dueOn: '2026-10-13', status: 'pending', doneAt: null }),
    view({ dueOn: null, status: 'sms_pending', doneAt: null }),
  ];
  const map = bucketByDate(views);
  assert.equal(map.get('2026-10-13').length, 2);
  assert.equal(undatedViews(views).length, 1);
});

test('상태별로 센다', () => {
  const views = [
    view({ dueOn: '2026-10-13', status: 'done', doneAt: '2026-10-13T01:00:00Z' }),
    view({ dueOn: '2026-10-13', status: 'closed_no_answer', doneAt: '2026-10-13T02:00:00Z' }),
    view({ dueOn: '2026-10-14', status: 'pending', doneAt: null }),
    view({ dueOn: null, status: 'sms_pending', doneAt: null }),
  ];
  assert.deepEqual(countsOf(views), { total: 4, done: 1, closed: 1, pending: 1, sms: 1 });
});

test('달 요약은 지연과 연결률까지', () => {
  const views = [
    view({ dueOn: '2026-10-10', status: 'done', doneAt: '2026-10-10T01:00:00Z' }),
    view({ dueOn: '2026-10-11', status: 'closed_no_answer', doneAt: '2026-10-11T01:00:00Z' }),
    view({ dueOn: '2026-10-12', status: 'pending', doneAt: null }),
    view({ dueOn: '2026-10-20', status: 'pending', doneAt: null }),
  ];
  const s = summarize(views, '2026-10-15');
  assert.equal(s.total, 4);
  assert.equal(s.done, 1);
  assert.equal(s.pending, 2);
  assert.equal(s.late, 1);   // 10-12 예정인데 오늘이 10-15
  assert.equal(s.rate, 50);  // 완료 1 / (완료 1 + 미연결 마감 1)
});

test('연결된 콜도 마감된 콜도 없으면 연결률은 없다', () => {
  const s = summarize([view({ dueOn: '2026-10-20', status: 'pending', doneAt: null })], '2026-10-15');
  assert.equal(s.rate, null);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL. `calendarDateOf is not a function`

- [ ] **Step 3: `js/calendar.js`에 함수 더하기**

파일 끝에 붙인다.

```js
// 콜이 달력에서 놓이는 날. 예정일이 먼저고, 부재로 마감돼 예정일이 지워진 콜은 처리한 날에 둔다.
export function calendarDateOf(call) {
  if (call.dueOn) return call.dueOn;
  if (call.doneAt) return String(call.doneAt).slice(0, 10);
  return null;
}

export function bucketByDate(views) {
  const map = new Map();
  for (const v of views) {
    const date = calendarDateOf(v.call);
    if (!date) continue;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(v);
  }
  return map;
}

// 문자 대기는 날짜가 없다. 달력 아래가 아니라 위에 따로 보여 놓치지 않게 한다.
export function undatedViews(views) {
  return views.filter((v) => calendarDateOf(v.call) === null);
}

export function countsOf(views) {
  const counts = { total: views.length, done: 0, closed: 0, pending: 0, sms: 0 };
  for (const { call } of views) {
    if (call.status === 'done') counts.done += 1;
    else if (call.status === 'closed_no_answer') counts.closed += 1;
    else if (call.status === 'sms_pending') counts.sms += 1;
    else counts.pending += 1;
  }
  return counts;
}

export function summarize(views, today) {
  const counts = countsOf(views);
  const late = views.filter((v) => v.call.status === 'pending' && v.call.dueOn && v.call.dueOn < today).length;
  const reached = counts.done + counts.closed;
  const rate = reached === 0 ? null : Math.round((counts.done / reached) * 100);
  return { ...counts, late, rate };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS, 실패 0

- [ ] **Step 5: 커밋**

```bash
git add js/calendar.js tests/calendar.test.js
git commit -F - <<'MSG'
feat: 날짜별 콜 집계와 달 요약 계산

예정일이 지워진 콜은 처리한 날에 두고, 문자 대기는 날짜 없는 목록으로 뺀다.
완료·미연결 마감·남음·지연과 연결률을 같은 기준으로 센다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 3: 달력 화면

**Files:**
- Modify: `index.html`, `js/ui.js`, `css/app.css`

**Interfaces:**
- Consumes: Task 1·2의 함수, `model.callViews`
- Produces: 탭 `달력`, 달 요약 줄, 6주 격자(날짜 칸에 `3건 · 2완료`), 월 이동 버튼, 오늘 강조, 선택한 날짜 강조

- [ ] **Step 1: `index.html`에 탭과 칸 더하기**

`발송 대기` 탭 버튼 아래에 덧붙인다.

```html
    <button class="tab-btn" data-tab="calendar">달력</button>
```

`panel-shipment` 아래에 덧붙인다.

```html
  <div class="panel" id="panel-calendar" hidden></div>
```

- [ ] **Step 2: `css/app.css`에 달력 모양 더하기**

파일 끝에 덧붙인다.

```css
.cal-head{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;}
.cal-title{font-size:16px; font-weight:800;}
.cal-summary{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;}
.cal-chip{border:1px solid var(--border); background:var(--surface); border-radius:20px; padding:5px 11px; font-size:12.5px; font-weight:600; color:var(--text-muted);}
.cal-chip b{color:var(--text); font-family:var(--mono); margin-left:4px;}
.cal-chip.late b{color:var(--danger);}
.cal-grid{display:grid; grid-template-columns:repeat(7,1fr); gap:6px;}
.cal-dow{text-align:center; font-size:11.5px; font-weight:700; color:var(--text-muted); padding-bottom:2px;}
.cal-cell{min-height:64px; border:1px solid var(--border); border-radius:10px; background:var(--surface); padding:6px 7px; text-align:left; display:flex; flex-direction:column; gap:3px;}
.cal-cell:hover{border-color:var(--accent);}
.cal-cell .d{font-family:var(--mono); font-size:12.5px; font-weight:700;}
.cal-cell .n{font-size:11.5px; color:var(--text-muted); line-height:1.35;}
.cal-cell.other{background:var(--bg); color:var(--text-faint);}
.cal-cell.rest .d{color:var(--text-faint);}
.cal-cell.today{border-color:var(--accent); border-width:2px; padding:5px 6px;}
.cal-cell.picked{background:var(--accent-soft); border-color:var(--accent);}
.cal-cell.has-late{border-left:3px solid var(--danger);}
.cal-cell.all-done .n{color:var(--success);}
.cal-day{margin-top:16px;}
```

- [ ] **Step 3: `js/ui.js`에 탭과 상태 더하기**

import에 달력 함수를 더한다.

```js
import {
  monthKeyOf, shiftMonth, monthLabel, monthGrid, bucketByDate, undatedViews, countsOf, summarize,
} from './calendar.js';
```

`model.js` import 줄에 `callViews`를 더한다.

```js
import {
  todayCalls, upcomingCalls, escalationCalls, visitCalls, activePrescriptionCount, preRunoutCall, awaitingShipment, callViews,
} from './model.js';
```

`TABS`와 `state`를 고친다.

```js
const TABS = ['escalation', 'today', 'shipment', 'calendar', 'visit', 'all', 'scripts'];
```

```js
export const state = { patients: [], scripts: {}, tab: 'today', search: '', staff: null, detailPatientId: null, month: null, pickedDate: null };
```

`render()`의 탭 분기에 달력을 더한다.

```js
  if (state.tab === 'calendar') renderCalendar(today);
```

- [ ] **Step 4: 달력 그리기**

`renderVisit` 함수 앞에 덧붙인다.

```js
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function renderCalendar(today) {
  const month = state.month ?? monthKeyOf(today);
  state.month = month;
  const views = callViews(state.patients);
  const monthViews = views.filter((v) => {
    const date = calendarDateOfView(v);
    return date && monthKeyOf(date) === month;
  });
  const sum = summarize(monthViews, today);
  const buckets = bucketByDate(views);
  const waiting = undatedViews(views);

  const chips = [
    `<span class="cal-chip">해피콜<b>${sum.total}</b></span>`,
    `<span class="cal-chip">완료<b>${sum.done}</b></span>`,
    `<span class="cal-chip">남음<b>${sum.pending}</b></span>`,
    `<span class="cal-chip late">지연<b>${sum.late}</b></span>`,
    `<span class="cal-chip">문자 마감<b>${sum.closed}</b></span>`,
    sum.rate === null ? '' : `<span class="cal-chip">연결률<b>${sum.rate}%</b></span>`,
  ].join('');

  const cells = monthGrid(month).map((week) => week.map((date) => {
    const list = buckets.get(date) ?? [];
    const counts = countsOf(list);
    const late = list.some((v) => v.call.status === 'pending' && v.call.dueOn && v.call.dueOn < today);
    const classes = ['cal-cell'];
    if (monthKeyOf(date) !== month) classes.push('other');
    if (!isCallDay(date)) classes.push('rest');
    if (date === today) classes.push('today');
    if (date === state.pickedDate) classes.push('picked');
    if (late) classes.push('has-late');
    if (counts.total > 0 && counts.pending === 0 && counts.sms === 0) classes.push('all-done');
    const line = counts.total === 0 ? '' : `<div class="n">${counts.total}건 · ${counts.done}완료</div>`;
    return `<button class="${classes.join(' ')}" data-action="cal-day" data-id="${date}">
      <span class="d">${Number(date.slice(8))}</span>${line}</button>`;
  }).join('')).join('');

  $('panel-calendar').innerHTML = `
    <div class="cal-head">
      <button class="btn btn-sm" data-action="cal-prev">← 지난달</button>
      <div class="cal-title">${monthLabel(month)}</div>
      <button class="btn btn-sm" data-action="cal-next">다음달 →</button>
      <button class="btn btn-ghost btn-sm" data-action="cal-today">이번달</button>
    </div>
    <div class="cal-summary">${chips}</div>
    ${waiting.length === 0 ? '' : `<div class="banner">📨 날짜 없이 문자 대기 중인 콜 ${waiting.length}건이 있어요. '오늘 콜' 탭에서 처리해주세요.</div>`}
    <div class="cal-grid">${DOW.map((d) => `<div class="cal-dow">${d}</div>`).join('')}${cells}</div>
    <div class="cal-day" id="cal-day"></div>`;

  renderCalendarDay(buckets, today);
}
```

`calendarDateOfView`는 아래 도우미로 둔다(같은 파일 안, `renderCalendar` 앞).

```js
const calendarDateOfView = (v) => (v.call.dueOn ? v.call.dueOn : (v.call.doneAt ? String(v.call.doneAt).slice(0, 10) : null));
```

`isCallDay`는 `schedule.js`에서 가져온다. import 목록에 더한다.

```js
import {
  todayYMD, overdueDays, planCalls, hasPastCall, decideNoAnswer, decideSmsSent, decideAnswered,
  defaultVisitNeededFor, isCallDay,
} from './schedule.js';
```

- [ ] **Step 5: 확인**

- Run: `node --check js/ui.js && node --check js/calendar.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0

- [ ] **Step 6: 커밋**

```bash
git add index.html js/ui.js css/app.css
git commit -F - <<'MSG'
feat: 한 달 달력 화면

이번 달 요약과 날짜별 건수를 격자로 보여준다. 오늘은 테두리로, 지연이 있는
날은 왼쪽 줄로 표시하고, 목·일은 흐리게 둔다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 4: 날짜를 누르면 그날 집계와 명단

**Files:**
- Modify: `js/ui.js`

**Interfaces:**
- Consumes: Task 3의 `renderCalendar`
- Produces: 날짜 선택 시 `대상 N · 완료 N · 부재 마감 N · 남음 N` 집계와 그날 콜 카드 목록(통화 기록·부재중 버튼 포함), 월 이동 버튼 동작

- [ ] **Step 1: 그날 목록 그리기**

`renderCalendar` 아래에 덧붙인다.

```js
function renderCalendarDay(buckets, today) {
  const date = state.pickedDate;
  if (!date) {
    $('cal-day').innerHTML = '<div class="empty">날짜를 누르면 그날 해피콜이 여기 보여요.</div>';
    return;
  }
  const list = (buckets.get(date) ?? []).slice().sort((a, b) => a.patient.name.localeCompare(b.patient.name, 'ko'));
  const c = countsOf(list);
  const head = `
    <div class="section-title">${formatKoreanDate(date)}</div>
    <div class="cal-summary">
      <span class="cal-chip">대상<b>${c.total}</b></span>
      <span class="cal-chip">완료<b>${c.done}</b></span>
      <span class="cal-chip">문자 마감<b>${c.closed}</b></span>
      <span class="cal-chip">남음<b>${c.pending}</b></span>
    </div>`;
  const body = list.length === 0
    ? '<div class="empty">이날은 잡힌 해피콜이 없어요.</div>'
    : list.map((v) => callCard(v, today)).join('');
  $('cal-day').innerHTML = head + body;
}
```

- [ ] **Step 2: 버튼 연결하기**

`onAppClick`의 `ship` 분기 아래에 덧붙인다.

```js
  if (action === 'cal-prev') { state.month = shiftMonth(state.month ?? monthKeyOf(todayYMD()), -1); state.pickedDate = null; render(); }
  if (action === 'cal-next') { state.month = shiftMonth(state.month ?? monthKeyOf(todayYMD()), 1); state.pickedDate = null; render(); }
  if (action === 'cal-today') { state.month = monthKeyOf(todayYMD()); state.pickedDate = todayYMD(); render(); }
  if (action === 'cal-day') { state.pickedDate = state.pickedDate === id ? null : id; render(); }
```

- [ ] **Step 3: 확인**

- Run: `node --check js/ui.js` → Expected: 출력 없음
- Run: `npm test` → Expected: PASS, 실패 0
- Run: `grep -n "cal-day\|cal-prev\|cal-next" js/ui.js` → Expected: 다섯 줄 이상

- [ ] **Step 4: 커밋**

```bash
git add js/ui.js
git commit -F - <<'MSG'
feat: 달력에서 날짜를 누르면 그날 집계와 명단

그날 대상·완료·문자 마감·남음을 세고, 명단에서 바로 통화 기록과 부재중
처리를 할 수 있게 한다. 지난달과 다음달로도 옮길 수 있다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

### Task 5: 화면 확인과 문서

**Files:**
- Modify: `CLAUDE.md`
- Test: 로컬 서버와 브라우저, MCP `execute_sql`

- [ ] **Step 1: 이번 달 달력 보기**

로컬 서버를 켜고 로그인한 화면에서 `달력` 탭을 연다.
Expected: 이번 달 격자가 보이고, 오늘 칸에 테두리가 있다. 콜이 있는 날에 `N건 · N완료`가 보인다. 요약 줄의 `해피콜` 숫자가 그 달 칸 숫자의 합과 같다.

- [ ] **Step 2: 날짜 눌러 보기**

콜이 있는 날짜를 누른다.
Expected: 아래에 그날 집계와 명단이 뜨고, 명단의 "📞 통화 기록" 버튼이 동작한다. 같은 날짜를 다시 누르면 접힌다.

- [ ] **Step 3: 달 옮겨 보기**

"← 지난달"과 "다음달 →", "이번달"을 눌러 본다.
Expected: 제목과 요약 숫자가 그달 기준으로 바뀐다. 콜이 없는 달이면 모든 숫자가 0이고 격자는 그대로 보인다.

- [ ] **Step 4: 지연과 완료 표시 확인**

MCP로 예시 콜 하나를 지난 날짜로 옮긴다.

```sql
update public.calls set due_on = current_date - 3
where id = (select c.id from calls c where c.status = 'pending' order by c.due_on limit 1);
```

화면을 새로고침하고 달력을 본다.
Expected: 그 날짜 칸 왼쪽에 빨간 줄이 생기고, 요약의 `지연` 숫자가 1 이상이다.

확인 후 되돌린다(원래 값은 바꾸기 전에 적어 둔다).

- [ ] **Step 5: 시험 흔적 정리**

```sql
select (select count(*) from public.patients) as 환자, (select count(*) from public.calls) as 콜;
```

Expected: `환자 = 3`, `콜 = 5`

- [ ] **Step 6: `CLAUDE.md` 고치기**

"## 파일과 역할" 표의 `js/model.js` 줄 아래에 덧붙인다.

```markdown
| `js/calendar.js` | 달력 격자와 날짜별 집계 | 브라우저 기능을 쓰지 않는다. 숫자 기준은 월 통계와 같아야 한다 |
```

"## V2에서 할 일"의 3번 줄에서 이번에 끝낸 부분을 표시한다.

```markdown
3. **일정과 달력**: 처방 수정과 콜 날짜 변경, 변경 사유, ~~월 달력과 날짜별 명단~~ (2026-09-27 완료), 휴진일
```

- [ ] **Step 7: 커밋**

```bash
git add CLAUDE.md
git commit -F - <<'MSG'
docs: 달력 모듈과 완료 단계를 규칙 파일에 반영

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 8: 올릴지 묻기**

`npm test` 통과와 예시 데이터만 남았는지 확인하고 **사용자에게 물어본 뒤에만** push한다.

---

## 이 계획에서 하지 않는 것

- 달력에서 콜 날짜를 끌어 옮기거나 고치는 기능(기획안 3장). 다음 단계에서 한다.
- 휴진일·공휴일 표시(기획안 10장 추천).
- 월 통계 화면(기획안 7장). 달력 요약과 같은 기준으로 나중에 만든다.
- 문자 대기 콜에 날짜를 되살리는 데이터베이스 변경.
