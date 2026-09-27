import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAYS_PRESETS, DEFAULT_SCRIPTS, normalizePhone, isValidPhone, formatPhone, isValidDays,
  conditionText, formatKoreanDate, fillTemplate, buildEscalationText, buildCallScript, staffLabel,
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

test('staffLabel은 이름이 있으면 이름, 없으면 이메일 앞부분', () => {
  assert.equal(staffLabel({ email: 'kim@clinic.example', name: '김직원' }), '김직원');
  assert.equal(staffLabel({ email: 'kim@clinic.example', name: '' }), 'kim');
  assert.equal(staffLabel({ email: 'kim@clinic.example', name: '   ' }), 'kim');
  assert.equal(staffLabel(null), '');
});
