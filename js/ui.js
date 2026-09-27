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
  fillTemplate, buildEscalationText, buildCallScript, staffLabel,
} from './texts.js';

const TABS = ['escalation', 'today', 'visit', 'all', 'scripts'];

export const state = { patients: [], scripts: {}, tab: 'today', search: '', staff: null, detailPatientId: null };

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
