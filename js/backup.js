// 백업 파일의 모양. 화면 기능을 쓰지 않아서 Node 테스트로 그대로 검증한다.
// 지워진 것까지 모두 담는다. 되살릴 수 없는 백업은 백업이 아니다.
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
