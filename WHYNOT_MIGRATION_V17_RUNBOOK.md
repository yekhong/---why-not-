# V17 계정 복구 및 마이그레이션 순서

## 확인된 과거 파일 순서 충돌

`supabase/migrations`의 동일 날짜 파일은 이름순으로 V12.1 → V11 → V12 → V10이 됩니다. V12.1은 V12에서 추가한 `room_voter_registrations.hidden_at`을 사용하고, V12는 개인 보관을 종료된 방으로 다시 제한합니다. V10은 V11이 비활성화한 참여자 자동 초대 수락 함수를 다시 활성화합니다. V16도 파일명으로는 V15보다 먼저 나옵니다. 이전에 적용된 파일의 이름이나 내용을 바꾸면 마이그레이션 이력과 충돌할 수 있어 수정하지 않았습니다.

**기존 운영 DB:** 마이그레이션 이력과 `user_accounts`, `user_sessions`, `participants`, `room_voter_registrations`의 현재 스키마를 먼저 확인하세요. V16까지 적용된 DB에 한해 새 `20260927142754_atomic_account_recovery_v17.sql`을 순방향으로 적용합니다. 이 파일은 복구 RPC를 추가하고 V11의 명시적 초대 응답 정책 및 V12.1의 모든 상태 개인 보관 함수를 다시 확정합니다. 운영 DB에는 이 작업에서 아무 SQL도 실행하지 않았습니다.

**새 DB:** `supabase_master_migration_full.sql`을 V16 기준 초기 스키마로 적용하고, 그 다음 V17 파일을 적용하세요. 과거 개별 파일을 단순 파일명 순서로 재생하지 마세요. V12를 잘못된 순서로 실행하며 이미 `hidden_at`을 비운 기록은 V17로 복원할 수 없습니다.

**애플리케이션 반영 순서:** V17 RPC의 존재와 `service_role` 전용 실행 권한을 확인한 후 새 서버 코드를 배포해야 합니다. 먼저 코드를 배포하면 계정 복구 요청이 503을 반환합니다. `npm run test:audit`은 두 서버 인스턴스의 API 호출을 모의 PostgREST로 검증하고, 별도의 메모리 PostgreSQL에서 V17 SQL 자체와 세션 INSERT 실패 시 전체 롤백도 검증합니다. 실제 Supabase 운영 DB의 적용 상태와 실행 결과는 별도로 확인해야 합니다.
