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

export function staffLabel(staff) {
  if (!staff) return '';
  const name = String(staff.name ?? '').trim();
  if (name) return name;
  const email = String(staff.email ?? '');
  return email.includes('@') ? email.split('@')[0] : email;
}
