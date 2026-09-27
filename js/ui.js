import * as store from './store.js';
import {
  todayYMD, overdueDays, planCalls, hasPastCall, decideNoAnswer, decideSmsSent, decideAnswered,
  defaultVisitNeededFor, isCallDay,
} from './schedule.js';
import {
  monthKeyOf, shiftMonth, monthLabel, monthGrid, calendarDateOf, bucketByDate, undatedViews, countsOf, summarize,
} from './calendar.js';
import {
  todayCalls, upcomingCalls, escalationCalls, visitCalls, activePrescriptionCount, preRunoutCall, awaitingShipment,
  callViews,
} from './model.js';
import {
  CONDITION_LABELS, RESULT_LABELS, KIND_LABELS, CALL_STATUS_LABELS, DAYS_PRESETS, DEFAULT_SCRIPTS,
  normalizePhone, isValidPhone, formatPhone, isValidDays, conditionText, formatKoreanDate,
  fillTemplate, buildEscalationText, buildCallScript, staffLabel,
  RELATION_PRESETS, patientLabel, addressName,
} from './texts.js';

const TABS = ['escalation', 'today', 'shipment', 'calendar', 'visit', 'all', 'scripts'];

export const state = {
  patients: [], scripts: {}, tab: 'today', search: '', staff: null, detailPatientId: null,
  month: null, pickedDate: null,
};

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

let saving = false;

export async function run(action, successMsg) {
  if (saving) return false;
  saving = true;
  try {
    try {
      await action();
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
    if (successMsg) toast(successMsg);
    await refresh();
    return true;
  } finally {
    saving = false;
  }
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
  if (state.tab === 'calendar') renderCalendar(today);
  if (state.tab === 'visit') renderVisit(visits);
  if (state.tab === 'all') renderAll();
  if (state.tab === 'scripts') renderScripts();
}

function callCard({ patient, prescription, call }, today) {
  const pills = [conditionBadge(patient), kindBadge(call)];
  if (call.noAnswerCount > 0) pills.push(`<span class="badge badge-other">부재 ${call.noAnswerCount}/3</span>`);
  const late = overdueDays(call.dueOn, today);
  if (call.status === 'done') pills.push('<span class="badge badge-improved">완료</span>');
  else if (call.status === 'closed_no_answer') pills.push('<span class="badge badge-ended">문자로 마감</span>');
  else if (call.status === 'sms_pending') pills.push('<span class="badge badge-sms">문자 대기</span>');
  else if (late > 0) pills.push(`<span class="badge badge-overdue">${late}일 지연</span>`);
  else if (call.dueOn === today) pills.push('<span class="badge badge-today">오늘</span>');

  const last = call.attempts[0];
  const note = last
    ? `<div class="case-note">최근 시도(${localDate(last.attemptedAt)}): ${last.outcome === 'no_answer' ? '부재중' : esc(last.note || '메모 없음')}</div>`
    : '';
  const finished = call.status === 'done' || call.status === 'closed_no_answer';
  const actions = finished
    ? ''
    : (call.status === 'sms_pending'
      ? `<button class="btn btn-primary btn-sm" data-action="sms" data-id="${call.id}">✉️ 문자 문구 열기</button>`
      : `<button class="btn btn-primary btn-sm" data-action="call" data-id="${call.id}">📞 통화 기록</button>
         <button class="btn btn-sm" data-action="no-answer" data-id="${call.id}">부재중</button>`);

  return `
    <div class="case-card">
      <div class="case-top">
        <div class="case-id">
          <div class="case-name">${esc(patientLabel(patient))}</div>
          <div class="case-meta-row">${pills.join('')}</div>
          <div class="case-phone mono">${esc(formatPhone(patient.phone))}</div>
        </div>
        <div class="case-due">
          <div>${finished ? '처리한 날' : '예정일'}</div><div class="d">${finished ? (call.doneAt ? localDate(call.doneAt) : '-') : formatKoreanDate(call.dueOn)}</div>
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
        <span>${esc(patientLabel(patient))} ${conditionBadge(patient)} ${kindBadge(call)}</span>
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
          <div class="case-name">${esc(patientLabel(patient))}</div>
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
            <div class="case-name">${esc(patientLabel(patient))}</div>
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
          <button class="btn btn-ghost btn-sm" data-action="detail" data-id="${patient.id}">상세 · 이력</button>
        </div>
      </div>`;
  }).join('');
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function renderCalendar(today) {
  const month = state.month ?? monthKeyOf(today);
  state.month = month;
  const views = callViews(state.patients);
  const buckets = bucketByDate(views);
  const waiting = undatedViews(views);
  const monthViews = views.filter((v) => {
    const date = calendarDateOf(v.call);
    return date && monthKeyOf(date) === month;
  });
  const sum = summarize(monthViews, today);

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

function renderVisit(list) {
  $('panel-visit').innerHTML = list.length ? list.map(({ patient, call }) => `
    <div class="case-card">
      <div class="case-top">
        <div class="case-id">
          <div class="case-name">${esc(patientLabel(patient))}</div>
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
        <td class="name-cell" data-action="detail" data-id="${p.id}">${esc(patientLabel(p))}</td>
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
          <span>${rx.shippedOn
            ? `발송 ${formatKoreanDate(rx.shippedOn)} · 소진 ${formatKoreanDate(rx.runoutOn)}`
            : '발송 대기'} · ${rxStatus}</span>
        </div>
        ${calls}
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-head">
      <div><h2>${esc(patientLabel(patient))}</h2><div class="sub">${esc(formatPhone(patient.phone))} · ${esc(conditionText(patient.condition, patient.conditionLabel))}</div></div>
      <button class="close-x" data-action="close">✕</button>
    </div>
    ${blocks || '<div class="empty">처방이 없어요.</div>'}
    <div class="modal-footer"><button class="btn" data-action="close">닫기</button></div>`, true);
  state.detailPatientId = patient.id;
}

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
  const form = { condition: 'urticaria', existing: null, relation: 'self', family: [], lookup: 0 };

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
    <div class="field" id="rg-family-field" hidden>
      <label>이 번호로 등록된 가족</label>
      <div class="fam-list" id="rg-family"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>환자명 *</label><input type="text" id="rg-name" maxlength="50"></div>
      <div class="field"><label>증상</label>${pillGroup('rg-condition', Object.entries(CONDITION_LABELS), form.condition)}</div>
    </div>
    <div class="field" id="rg-relation-field">
      <label>이 번호의 주인과의 관계</label>
      ${pillGroup('rg-relation', RELATION_PRESETS, 'self')}
      <span class="field-hint">전화를 받는 분이 환자가 아닐 때 '자녀', '모'처럼 골라주세요.</span>
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
    <div class="field">
      <label>약 발송일</label>
      <input type="date" id="rg-ship" value="${today}">
      <label class="checkbox-row"><input type="checkbox" id="rg-ship-unknown"> 아직 모름 (발송 대기로 두기)</label>
      <span class="field-hint">콜 날짜는 발송일부터 셉니다.</span>
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
    form.existing = id === 'new' ? null : (form.family.find((p) => p.id === id) ?? null);
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
      $('rg-relation-field').hidden = false;
    }
    renderFamily();
  };

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
  $('rg-ship').addEventListener('input', updatePreview);
  $('rg-ship-unknown').addEventListener('change', () => {
    $('rg-ship').disabled = $('rg-ship-unknown').checked;
    updatePreview();
  });
  updatePreview();

  $('rg-submit').addEventListener('click', async () => {
    const phone = normalizePhone($('rg-phone').value);
    const name = $('rg-name').value.trim();
    const read = readPlan();
    if (!isValidPhone(phone)) { toast('전화번호는 숫자 10~11자리로 넣어주세요.'); return; }
    if (!form.existing && !name) { toast('환자명을 넣어주세요.'); return; }
    if (!read) { toast('처방일·발송일과 처방 일수(1~90일)를 확인해주세요.'); return; }
    const ok = await run(() => store.registerPrescription({
      phone,
      name: form.existing ? form.existing.name : name,
      relation: form.existing ? form.existing.relation : form.relation,
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
    if (ok) closeModal();
  });
}

// ---- 통화 기록 ----

export function openCallModal(view) {
  if (!view) return;
  const { patient, prescription, call } = view;
  const script = buildCallScript({
    condition: patient.condition, kind: call.kind, name: addressName(patient),
    runoutOn: prescription.runoutOn, scripts: scriptsWithDefaults(),
  });
  let result = 'improved';

  openModal(`
    <div class="modal-head">
      <div>
        <h2>통화 기록 · ${esc(patientLabel(patient))}</h2>
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
    const d = decideAnswered(call, {
      result,
      note: $('cl-note').value.trim(),
      visitNeeded: $('cl-visit').checked,
      closeEarly: $('cl-close-early').checked,
    });
    const ok = await run(() => store.saveCallOutcome(call.id, {
      expectedStatus: call.status, outcome: 'answered', note: d.note, status: d.status, dueOn: null,
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
    expectedStatus: call.status, outcome: 'no_answer', note: '', status: d.status, dueOn: d.dueOn,
    noAnswerCount: d.noAnswerCount, result: null, visitNeeded: call.visitNeeded,
    escalation: call.escalation, closePrescription: null,
  }), message);
  if (ok && d.status === 'sms_pending') openSmsModal(findView(call.id));
}

// ---- 부재 문자 ----

export function openShipModal(row) {
  const { patient, prescription } = row;
  const today = todayYMD();
  openModal(`
    <div class="modal-head">
      <div><h2>발송일 입력 · ${esc(patientLabel(patient))}</h2>
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

function openSmsModal(view) {
  if (!view) return;
  const { patient, call } = view;
  const text = fillTemplate(scriptsWithDefaults().sms_no_answer, { name: addressName(patient) });

  openModal(`
    <div class="modal-head">
      <div><h2>부재 안내 문자 · ${esc(patientLabel(patient))}</h2><div class="sub">${esc(formatPhone(patient.phone))} · 부재 ${call.noAnswerCount}회</div></div>
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
      expectedStatus: call.status, outcome: null, note: '', status: d.status, dueOn: null,
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
    name: patientLabel(patient), condition: patient.condition, conditionLabel: patient.conditionLabel, note: call.note,
  });

  openModal(`
    <div class="modal-head">
      <div><h2>원장 전달 · ${esc(patientLabel(patient))}</h2><div class="sub">한의사랑 메신저에 붙여넣어 주세요</div></div>
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

// ---- 버튼 ----

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
  if (action === 'ship') {
    const row = awaitingShipment(state.patients, todayYMD()).find((v) => v.prescription.id === id);
    if (row) openShipModal(row);
  }
  if (action === 'cal-prev') { state.month = shiftMonth(state.month ?? monthKeyOf(todayYMD()), -1); state.pickedDate = null; render(); }
  if (action === 'cal-next') { state.month = shiftMonth(state.month ?? monthKeyOf(todayYMD()), 1); state.pickedDate = null; render(); }
  if (action === 'cal-today') { state.month = monthKeyOf(todayYMD()); state.pickedDate = todayYMD(); render(); }
  if (action === 'cal-day') { state.pickedDate = state.pickedDate === id ? null : id; render(); }
  if (action === 'escalate') openEscalationModal(findView(id));
  if (action === 'visit-booked') run(() => store.markVisitBooked(id), '예약 완료로 표시했어요.');
  if (action === 'save-script') run(() => store.saveScript(id, $(`script-${id}`).value), '스크립트를 저장했어요.');
}

let bound = false;

export function startApp() {
  if (!bound) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
    $('btn-sign-out').addEventListener('click', () => store.signOut());
    $('btn-open-register').addEventListener('click', openRegisterModal);
    $('app').addEventListener('click', onAppClick);
    $('modal-root').addEventListener('click', onAppClick);
    bound = true;
  }
  refresh();
}

export function stopApp() {
  state.patients = [];
  state.scripts = {};
  state.staff = null;
  $('staff-name').textContent = '';
  closeModal();
}
