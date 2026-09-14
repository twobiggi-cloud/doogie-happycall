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
