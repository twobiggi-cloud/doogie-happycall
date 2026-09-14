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
