// 달력 격자와 날짜별 집계. 브라우저 기능을 쓰지 않아서 Node 테스트로 그대로 검증한다.
import { addDays, isoDay } from './schedule.js';

export function monthKeyOf(ymd) {
  return ymd.slice(0, 7);
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
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
