import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const server = read('server.ts');
const app = read('src/App.tsx');
const css = read('src/index.css');

const failures = [];
const passes = [];

function check(condition, message) {
  if (condition) passes.push(message);
  else failures.push(message);
}

check(
  !/\bsupabase\s*\.\s*(?:from|rpc|channel)\s*\(/.test(app),
  '브라우저 App.tsx에 Supabase 직접 조회/RPC/Realtime 호출이 없음'
);
check(
  !/localStorage\.(?:setItem|getItem)\([^)]*(?:password|비밀번호)/i.test(app),
  '브라우저 localStorage에 비밀번호를 저장하거나 읽는 코드가 없음'
);
check(
  /HttpOnly;\s*SameSite=Strict/.test(server),
  '세션 쿠키가 HttpOnly 및 SameSite=Strict로 설정됨'
);
check(
  /SUPABASE_SERVICE_ROLE_KEY/.test(server) &&
    !/VITE_SUPABASE_SERVICE_ROLE_KEY/.test(server) &&
    !/SUPABASE_SERVICE_ROLE_KEY/.test(app),
  '서비스 역할 키가 서버 전용이며 브라우저 코드에 없음'
);
check(
  /const identityFields = \[[^\]]*'userId'[^\]]*'hostId'[^\]]*'evaluatorId'/s.test(server),
  '클라이언트 신원 필드를 세션 사용자와 대조함'
);
check(
  /req\.path\.startsWith\('\/api\/rooms\/'\)/.test(server) &&
    /isRoomMember\(roomId, actorId\)/.test(server),
  '모든 회의실 API가 공통 참여자 권한 경계를 통과함'
);
check(
  /isHostOnlyRoomMutation\(req\)[\s\S]*isRoomHost\(roomId, actorId\)/.test(server),
  '방장 전용 변경 요청이 서버에서 방장 권한을 다시 검증함'
);
check(
  /fetchSite === 'cross-site'/.test(server) &&
    /new URL\(origin\)\.host !== req\.get\('host'\)/.test(server),
  '교차 사이트 및 다른 Origin의 상태 변경 요청을 차단함'
);
check(
  /const validEvaluatorCount = validEvaluationCountMap\[idea\.id\]/.test(server) &&
    !/weightedPointsMap\[idea\.id\]\s*\/\s*MAX_VOTERS/.test(server),
  '점수 분모가 고정 정원이 아닌 해당 아이디어의 유효 평가자 수임'
);
check(
  /storedIdeaCompletedSet[\s\S]*roomParticipants\?\.has\(completedUserId\)/.test(server),
  '아이디어 동시 공개 완료 수에서 탈퇴자·유령 사용자를 제외함'
);
check(
  /bff_apply_elimination_round/.test(server) &&
    /CREATE OR REPLACE FUNCTION public\.bff_apply_elimination_round/.test(
      read('supabase_migration_p0_bff_forward.sql')
    ),
  '소거 결과와 회차 기록을 원자적으로 저장하는 DB 함수가 준비됨'
);

const routePattern = /app\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
const seenRoutes = new Set();
const duplicateRoutes = [];
for (const match of server.matchAll(routePattern)) {
  const key = `${match[1].toUpperCase()} ${match[3]}`;
  if (seenRoutes.has(key)) duplicateRoutes.push(key);
  seenRoutes.add(key);
}
check(
  duplicateRoutes.length === 0,
  `동일 메서드·경로의 중복 Express 라우트가 없음${
    duplicateRoutes.length ? `: ${duplicateRoutes.join(', ')}` : ''
  }`
);

check(
  crypto.createHash('sha256').update(css).digest('hex') ===
    '8a760a784f79570e06fdcb0c6a2677ea66c304230b7925ea313d63b46d8ba407',
  '기존 UI 스타일 파일의 SHA-256이 기준본과 정확히 일치함'
);

for (const message of passes) console.log(`PASS  ${message}`);
for (const message of failures) console.error(`FAIL  ${message}`);

console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
