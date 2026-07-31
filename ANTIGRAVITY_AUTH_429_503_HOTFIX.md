# WhyNot 회원가입 429·503 오류 수정 요청서

## 결론

현재 오류는 서로 다른 두 문제입니다.

1. `503 Service Unavailable`
   - 서버가 `user_accounts`를 조회/저장하거나 `user_sessions`를 저장하지 못했습니다.
   - 기존 1차 패치의 전체 마이그레이션은 `user_accounts`가 이미 있다고 가정했지만, 전달 ZIP에는 해당 테이블을 처음 만드는 SQL이 포함되지 않았습니다.
   - 따라서 새 환경 또는 인증 마이그레이션이 빠진 환경에서는 가입이 실패할 수 있습니다.
2. `429 Too Many Requests`
   - 기존 코드는 가입·로그인·복구 제한을 충분히 분리하지 않았고, 위 `503`도 실패 횟수로 계속 누적했습니다.
   - 저장소 장애 상태에서 가입 버튼을 반복하면 실제 원인인 `503`이 `429`에 가려졌습니다.

화면만으로 `user_accounts`와 `user_sessions` 중 정확히 어느 테이블이 누락됐는지는 단정할 수 없습니다. 수정 코드는 앞으로 응답의 `code`를 통해 다음처럼 구분합니다.

- `AUTH_SCHEMA_NOT_READY`: 인증 테이블 또는 PostgREST 스키마 캐시가 준비되지 않음
- `AUTH_STORAGE_UNAVAILABLE`: 테이블은 있으나 저장소 연결/처리에 실패
- `AUTH_RATE_LIMITED`: 실제 요청 제한

## 절대 금지

- 기존 UI/CSS 재디자인 금지
- 원격 Supabase SQL 자동 실행 금지
- GitHub push, PR, Vercel 배포 금지
- `.env`, 서비스 역할 키, 비밀번호, 복구 코드, 세션 토큰 출력 금지
- 기존 운영 계정/방 데이터 삭제 금지

## 교체할 파일

프로젝트 루트 기준으로 다음 파일을 교체합니다.

- `server.ts`
- `src/App.tsx`
- `scripts/verify_phase1_security.mjs`

기존 `src/index.css`는 건드리지 않습니다.

## 새로 추가할 파일

- `supabase_auth_hotfix_preflight.sql`
- `supabase_auth_hotfix_forward.sql`
- `supabase_auth_hotfix_postflight.sql`

## 코드에서 수정된 내용

### 서버

- 가입·로그인·복구·아이디 확인 제한 키를 API 경로별로 분리했습니다.
- `500~599` 저장소 장애는 요청 제한 횟수에서 제거합니다.
- 성공한 가입/로그인/복구도 해당 실패 횟수를 초기화합니다.
- `429` 응답에 `Retry-After`, `retryAfterSeconds`, `AUTH_RATE_LIMITED`를 제공합니다.
- 계정 조회, 계정 저장, 세션 저장 실패 단계를 구분합니다.
- Supabase의 중복 아이디 오류 `23505`는 `503`이 아니라 `409`로 응답합니다.
- 로그에는 DB 오류 코드와 메시지만 남기고 입력 비밀번호·복구 코드·토큰은 남기지 않습니다.

### 프론트엔드

- 가입/로그인 요청 중 같은 버튼을 다시 눌러 중복 요청하는 것을 막습니다.
- UI 구조와 CSS 클래스는 유지합니다.
- `429`이면 남은 대기 시간을 사용자에게 안내합니다.
- 서버가 보낸 실제 `503` 원인 메시지를 로그인 모달에서 확인할 수 있습니다.

### DB 준비 SQL

- `user_accounts`와 `user_sessions`를 없을 때만 생성합니다.
- 기존 계정 행이나 회의실 데이터는 수정하거나 삭제하지 않습니다.
- 두 인증 테이블의 브라우저 `anon`, `authenticated` 직접 권한을 제거합니다.
- 서버 전용 `service_role`만 필요한 CRUD 권한을 가집니다.
- RLS를 활성화하고 강제합니다.
- PostgREST 스키마 캐시를 다시 읽도록 알립니다.

## Antigravity가 수행할 로컬 작업 순서

1. 현재 변경 파일을 별도 백업합니다.
2. 위 세 코드 파일을 교체하고 SQL 세 파일을 추가합니다.
3. 다음 명령만 로컬에서 실행합니다.

```bash
npm run lint
npm run build:server
node scripts/verify_phase1_security.mjs
```

4. 원격 DB SQL은 자동 실행하지 말고 멈춥니다.
5. 사용자에게 빌드·검사 결과와 변경 파일 목록을 보고합니다.

## 사용자가 Supabase에서 별도로 확인할 순서

코드만 교체해도 잘못된 `429` 누적과 중복 제출은 해결되지만, 실제 인증 테이블이 없다면 가입은 계속 실패합니다. 다음 SQL 적용은 사용자 승인 후 대상 Supabase SQL Editor에서 수동으로 해야 합니다.

1. `supabase_auth_hotfix_preflight.sql` 실행
2. 결과에서 `rooms`, `participants`가 모두 존재하는지 확인
3. 맞는 WhyNot 프로젝트일 때만 `supabase_auth_hotfix_forward.sql` 실행
4. `supabase_auth_hotfix_postflight.sql` 실행
5. 다음 결과 확인
   - `user_accounts_exists = true`
   - `user_sessions_exists = true`
   - 두 테이블 모두 `rls_enabled = true`, `rls_forced = true`
   - `anon`, `authenticated` 권한 결과가 0행

## 환경변수 확인

값 자체를 출력하지 말고 존재 여부만 확인합니다.

- `SUPABASE_URL`: 서버 환경에 존재해야 함
- `SUPABASE_SERVICE_ROLE_KEY`: 서버 환경에 존재해야 함
- 서비스 역할 키를 `VITE_` 접두사 변수에 넣으면 안 됨

## 완료 판정

다음을 모두 만족해야 완료입니다.

- 회원가입 1회 요청이 `201` 반환
- 응답에 `Set-Cookie`가 있고 `HttpOnly`, `SameSite=Strict` 포함
- 같은 버튼을 빠르게 여러 번 눌러도 네트워크 가입 요청은 1개
- DB 장애를 반복해도 응답이 `429`로 변하지 않고 원래 `503` 유지
- 잘못된 가입 입력을 제한 횟수 이상 반복했을 때만 `429`
- 기존 화면 배치와 `src/index.css`가 변경되지 않음

## 아직 단정할 수 없는 부분

현재 브라우저 콘솔 화면만으로는 실제 운영 DB의 테이블 존재 여부와 Vercel 서버 로그를 볼 수 없습니다. 따라서 `503`의 정확한 원격 원인은 다음 중 하나일 수 있습니다.

- `user_accounts` 누락
- `user_sessions` 누락
- 마이그레이션 후 PostgREST 캐시 미갱신
- 잘못된 Supabase 프로젝트 URL/서비스 역할 키
- Supabase 일시 장애

이번 수정은 이 원인들을 응답 코드와 서버 로그로 구분하고, 가장 가능성이 높은 인증 테이블 누락을 안전하게 보완합니다.

