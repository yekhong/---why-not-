import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { 
  Room, 
  RoomStatus, 
  Idea, 
  CriterionProposal, 
  Criterion, 
  Evaluation, 
  EliminationRound,
  RoomDetails
} from './src/types';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://xbsuhqrhzksvhicvhkyc.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialized Gemini / Potens AI Client
const POTENS_API_URL = 'https://ai.potens.ai/api/chat';

async function callPotensAI(prompt: string, model: string = 'claude-4-6-sonnet'): Promise<string> {
  const apiKey = process.env.POTENS_API_KEY || process.env.GEMINI_API_KEY || '';
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('POTENS_API_KEY environment variable is not configured.');
  }

  const response = await fetch(POTENS_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt: prompt,
      model: model
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Potens AI request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  // Standard chat completion response resolution
  return data.text || data.message || data.content || (data.choices && data.choices[0]?.message?.content) || JSON.stringify(data);
}

let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY || '';
    if (!key || key === 'MY_GEMINI_API_KEY') {
      return null;
    }
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

// ----------------------------------------------------------------
// Configurable weights for scoring
// ----------------------------------------------------------------
const SCORE_CONFIG = {
  keepWeight: 2,
  neutralWeight: 1,
  excludeWeight: 0,
  objectiveConstraintPenalty: 3,
};

// ----------------------------------------------------------------
// In-Memory Database Stores
// ----------------------------------------------------------------
const rooms = new Map<string, Room>();
const ideas = new Map<string, Idea[]>();
const criterionProposals = new Map<string, CriterionProposal[]>();
const criteria = new Map<string, Criterion[]>();
const evaluations = new Map<string, Evaluation[]>();
const eliminationRounds = new Map<string, EliminationRound[]>();
const participants = new Map<string, Map<string, string>>(); // room_id -> Map<user_id, nickname>
const roomInvites = new Map<string, { id: string; roomId: string; inviteToken: string; createdBy: string; expiresAt: string; isActive: boolean; createdAt: string }>();

// Cache for AI summarized comments to avoid repeating calls on every request
const aiCommentsCache = new Map<string, Record<string, { objectiveComments: string[]; preferenceComments: string[] }>>();
// Cache for AI final summaries
const aiFinalSummaries = new Map<string, string>();
// Map for 4단계 Star Votes: room_id -> Map<user_id, string[]> (userId to array of selected ideaIds)
const starVotesMap = new Map<string, Map<string, string[]>>();
// Map for 3단계 Active Re-editing Evaluators: room_id -> Set<user_id>
const reEditingEvaluatorsMap = new Map<string, Set<string>>();

// ----------------------------------------------------------------
// Seed Mock Data Creator
// ----------------------------------------------------------------
function seedData() {
  console.log('Seeding initial room data for demonstration...');

  // --- ROOM 0: 고민하조 팀 프로젝트 (Default Seed Room) ---
  const r0Id = 'room-gominhajo';
  rooms.set(r0Id, {
    id: r0Id,
    title: '고민하조 팀 프로젝트',
    description: '새싹 3번째 프로젝트, Antigravity 툴 활용',
    hostId: 'user_gominhajo_test',
    status: 'IDEA_SUBMISSION',
    minResponseThreshold: 4,
    eliminationConfig: { countPerRound: 1, tieBreak: 'random' },
    deadlines: { ideaSubmissionAt: '2026-08-01T18:00:00Z' },
    createdAt: new Date().toISOString(),
  });

  ideas.set(r0Id, [
    {
      id: 'idea-gh-1',
      roomId: r0Id,
      title: 'AI 회의록 자동 요약 서비스',
      description: `1. 서비스 정의: 화상회의 녹음 파일 또는 실시간 회의 음성을 업로드하면 AI가 핵심 논의사항, 결정사항, 액션아이템을 자동으로 정리해주는 B2B SaaS 툴.\n2. 타겟 사용자: 주 3회 이상 화상회의를 하는 5~50인 규모 스타트업/중소기업의 팀장급 실무자.\n3. 핵심기능: ① 회의 녹음 업로드 또는 줌/구글밋 연동 자동 녹취 ② 화자 분리 및 발언 요약 ③ 결정사항·액션아이템 자동 추출 및 담당자 태깅 ④ 슬랙/노션으로 요약본 자동 전송.\n4. 해결해야하는 문제: 회의 후 누군가 수동으로 회의록을 작성해야 하는 반복 업무 부담, 회의 중 메모에 집중하느라 논의에 온전히 참여하지 못하는 문제.\n5. 유사서비스 및 차별점: 클로바노트, Otter.ai 등 유사 서비스 존재. 차별점은 단순 전사(STT)에 그치지 않고 "결정사항/액션아이템"만 구조화해서 뽑아내는 것과, 국내 협업툴(슬랙/노션) 연동에 특화된 점.\n6. 리스크: 음성 인식 정확도가 한국어 전문용어·사투리에서 떨어질 수 있음. 회의 녹음에 대한 참석자 동의·개인정보 이슈 발생 가능.`,
      submitterId: 'user_gominhajo_test',
      submitterName: 'GOMINHAJO',
      status: 'ACTIVE',
    },
    {
      id: 'idea-gh-2',
      roomId: r0Id,
      title: '동네 소상공인 마감할인 매칭 앱',
      description: `1. 서비스 정의: 마감 임박 재고를 가진 동네 가게(베이커리, 반찬가게 등)와 근처 소비자를 실시간 위치 기반으로 매칭해 할인 판매하는 O2O 커머스 앱.\n2. 타겟 사용자: 신선식품 폐기 부담이 있는 동네 소상공인, 저렴하게 먹거리를 구매하고 싶은 1인 가구·자취생.\n3. 핵심기능: ① 매장이 마감 1~2시간 전 남은 재고를 사진과 함께 할인 등록 ② 소비자 반경 1km 내 실시간 알림 ③ 앱 내 결제 및 픽업 예약 ④ 소진 완료 자동 마감 처리.\n4. 해결해야하는 문제: 소상공인의 마감 재고 폐기로 인한 매출 손실과 환경 부담, 소비자 입장에서는 신선식품을 저렴하게 구매할 채널 부족.\n5. 유사서비스 및 차별점: 해외의 Too Good To Go, 국내의 라스트오더가 유사 서비스로 이미 존재. 차별점을 확보하려면 특정 상권(대학가, 오피스 밀집 지역) 집중 공략이나 소상공인 대상 무료 온보딩 지원 등이 필요한 상황.\n6. 리스크: 이미 시장을 선점한 경쟁 서비스가 있어 신규 진입 장벽이 높음. 초기 매장 확보(공급 측) 없이는 소비자 앱으로서 매력이 없는 닭과 달걀 문제.`,
      submitterId: 'user_member_1',
      submitterName: '익명 참여자 A',
      status: 'ACTIVE',
    },
    {
      id: 'idea-gh-3',
      roomId: r0Id,
      title: '반려동물 건강기록 공유 플랫폼',
      description: `1. 서비스 정의: 반려동물의 병원 진료기록, 접종이력, 체중변화 등을 한 곳에 모아 관리하고 이사·이직·병원 변경 시 새 병원에 기록을 쉽게 공유할 수 있는 헬스케어 서비스.\n2. 타겟 사용자: 반려동물을 여러 병원에서 진료받거나, 지역 이동이 잦은 반려인.\n3. 핵심기능: ① 진료기록 사진 촬영으로 자동 스캔·입력 ② 접종 스케줄 알림 ③ 체중·건강 변화 그래프 ④ QR코드로 새 병원에 기록 즉시 공유.\n4. 해결해야하는 문제: 반려동물이 병원을 옮길 때마다 이전 진료 이력을 구두로만 전달해야 해서 정보 누락이 발생하고, 접종 시기를 놓치는 경우가 많음.\n5. 유사서비스 및 차별점: 펫나우, 삐약 등 반려동물 건강관리 앱이 존재하나 대부분 자체 기록 입력에 그침. 차별점은 병원 간 기록 "공유"에 특화된 점과 QR 기반 간편 전달 기능.\n6. 리스크: 실제 병원 시스템과의 연동이 안 되면 결국 보호자가 수동 입력해야 해서 사용률이 낮을 수 있음. 병원 측 협조 없이는 데이터 신뢰성 확보가 어려움.`,
      submitterId: 'user_member_2',
      submitterName: '익명 참여자 B',
      status: 'ACTIVE',
    },
    {
      id: 'idea-gh-4',
      roomId: r0Id,
      title: '신입 개발자를 위한 코드리뷰 연습 플랫폼',
      description: `1. 서비스 정의: 실제 오픈소스 프로젝트의 PR(Pull Request)을 기반으로 코드리뷰 연습을 하고, AI가 리뷰 품질에 대해 피드백을 주는 개발자 학습 서비스.\n2. 타겟 사용자: 코드리뷰 경험이 부족한 신입/주니어 개발자, 코드리뷰 문화를 도입하려는 소규모 개발팀.\n3. 핵심기능: ① 난이도별 실전 PR 문제 제공 ② 사용자가 직접 리뷰 코멘트 작성 ③ AI가 리뷰의 구체성·건설성·놓친 이슈를 채점 ④ 우수 리뷰 사례 학습 콘텐츠 제공.\n4. 해결해야하는 문제: 신입 개발자가 코드리뷰를 어떻게 해야 할지 감을 못 잡고, 실무에서 배우기 전까지 연습할 곳이 없는 문제.\n5. 유사서비스 및 차별점: 백준, 프로그래머스 등은 문제풀이 중심이라 "리뷰 스킬" 자체를 훈련하는 서비스는 국내에 거의 없음. 실제 오픈소스 PR을 소재로 쓴다는 점이 차별점.\n6. 리스크: 오픈소스 PR을 학습 콘텐츠로 가공하는 데 라이선스 이슈가 있을 수 있음. AI의 리뷰 채점 기준이 주관적이라 사용자 신뢰를 얻기 어려울 수 있음.`,
      submitterId: 'user_member_3',
      submitterName: '익명 참여자 C',
      status: 'ACTIVE',
    },
    {
      id: 'idea-gh-5',
      roomId: r0Id,
      title: '프리랜서 계약서 자동 생성·검토 툴',
      description: `1. 서비스 정의: 업종별 표준 계약서 템플릿에 조건을 입력하면 자동으로 계약서를 생성하고, AI가 불공정 조항을 사전에 짚어주는 리걸테크 서비스.\n2. 타겟 사용자: 디자이너·개발자·마케터 등 계약서 검토 경험이 적은 프리랜서, 프리랜서를 자주 고용하는 소규모 스튜디오.\n3. 핵심기능: ① 업종별(디자인/개발/영상 등) 계약서 템플릿 ② 조건 입력 시 자동 문서 생성 ③ AI 불공정 조항 하이라이트(예: 과도한 저작권 양도, 무제한 수정 조항) ④ 전자서명 연동.\n4. 해결해야하는 문제: 프리랜서들이 법률 지식 부족으로 불공정 계약을 그대로 수용하거나, 매번 계약서를 새로 찾아 작성하는 비효율.\n5. 유사서비스 및 차별점: 모두싸인, 계약서 템플릿 사이트는 "생성"에 집중하는 반면, 이 서비스는 "검토(불공정 조항 탐지)"에 특화된 점이 차별점.\n6. 리스크: 법률 자문이 아닌 AI 검토 결과에 대한 법적 책임 소재가 불분명함. 업종별 표준 계약 관행이 다양해 템플릿의 범용성 확보가 어려울 수 있음.`,
      submitterId: 'user_member_4',
      submitterName: '익명 참여자 D',
      status: 'ACTIVE',
    },
    {
      id: 'idea-gh-6',
      roomId: r0Id,
      title: '팀 회식 메뉴 익명 취향 조사 봇',
      description: `1. 서비스 정의: 회식 전 팀원들의 알레르기·못 먹는 음식·선호 메뉴를 익명으로 모아 자동으로 후보 3곳을 추천해주는 슬랙/카카오톡 챗봇.\n2. 타겟 사용자: 회식 장소 정하는 데 매번 시간을 쓰는 5~15인 규모 팀의 총무 담당자 또는 팀장.\n3. 핵심기능: ① 슬랙 명령어로 설문 자동 발송 ② 알레르기·비선호 메뉴는 익명 수집 ③ 팀원 답변 기반 근처 맛집 후보 3곳 자동 추천 ④ 투표로 최종 장소 확정.\n4. 해결해야하는 문제: 회식 메뉴 정할 때 못 먹는 음식이 있어도 말하기 어려워 나중에 불만이 생기거나, 장소 정하는 데만 카톡방에서 며칠씩 걸리는 문제.\n5. 유사서비스 및 차별점: 왓츠팟, 캐치테이블 등 예약 서비스는 있지만 "익명으로 못 먹는 것부터 걸러내는" 기능에 특화된 서비스는 없음. 회사 회식이라는 특수 상황(눈치, 알레르기 공개 부담)에 맞춘 점이 차별점.\n6. 리스크: 단순 기능이라 시장성/수익모델이 약함(B2C 유료화 어려움). 이미 사내 협업툴 내 설문 기능으로 대체 가능해 진짜 페인포인트인지 검증 필요.`,
      submitterId: 'user_member_5',
      submitterName: '익명 참여자 E',
      status: 'ACTIVE',
    }
  ]);

  criterionProposals.set(r0Id, [
    { id: 'prop-gh-1', roomId: r0Id, rawText: '1달 내 MVP 스케줄 구현 가능성: 주어진 스케줄 및 개발 역량 내에서 완성이 가능한가?', proposerId: 'user_gominhajo_test', isAiSuggested: false },
    { id: 'prop-gh-2', roomId: r0Id, rawText: '타겟 유저 페인포인트 해소력: 아이디어가 타겟 사용자층의 명확한 가려운 곳을 효과적으로 해결해 주는가?', proposerId: 'user_member_1', isAiSuggested: false },
    { id: 'prop-gh-3', roomId: r0Id, rawText: '유사 서비스 대비 독자적 차별성: 국내외 경쟁 플랫폼 대비 독보적인 우위나 정체성을 갖추었는가?', proposerId: 'gemini-ai', isAiSuggested: true },
  ]);

  // --- ROOM 1: 스타트업 하반기 SNS 마케팅 기획 (Status: EVALUATION) ---
  const r1Id = 'room-marketing';
  rooms.set(r1Id, {
    id: r1Id,
    title: '스타트업 하반기 SNS 마케팅 기획',
    description: '올해 하반기 예산 1,500만원 내로 진행할 수 있는 인플루언서 및 SNS 바이럴 마케팅 아이디어를 구체화하고 선별합니다.',
    hostId: 'host-123',
    status: 'EVALUATION',
    minResponseThreshold: 3,
    eliminationConfig: { countPerRound: 1, tieBreak: 'random' },
    deadlines: { ideaSubmissionAt: '2026-07-25T18:00:00Z' },
    createdAt: new Date().toISOString(),
  });

  ideas.set(r1Id, [
    {
      id: 'idea-m1',
      roomId: r1Id,
      title: '숏폼 릴스/쇼츠 제작 챌린지',
      description: '인기 가요 비트에 맞춰 자사 제품을 유쾌하게 노출하는 댄스 챌린지 진행. 참가자 중 50명을 추첨해 자사 제품 풀세트 및 백화점 상품권 제공.',
      submitterId: 'user-jy',
      submitterName: '김지현 대리',
      status: 'ACTIVE',
    },
    {
      id: 'idea-m2',
      roomId: r1Id,
      title: '사무실 간식 배달 게릴라 어택',
      description: '사연을 신청한 직장인 20개 팀을 선정해 간식 박스 및 커피차를 보냄. 해당 과정과 생생한 소감을 유튜브 스케치 영상으로 편집해 홍보.',
      submitterId: 'user-jh',
      submitterName: '박준형 과장',
      status: 'ACTIVE',
    },
    {
      id: 'idea-m3',
      roomId: r1Id,
      title: '테크 크리에이터 언박싱 대규모 협찬',
      description: 'IT/테크 중심 중소형 유튜버 30명에게 대규모 자사 신제품 협찬을 진행해 실사용 솔직 리뷰 영상 노출 극대화.',
      submitterId: 'user-mw',
      submitterName: '이민우 팀장',
      status: 'ACTIVE',
    },
  ]);

  criteria.set(r1Id, [
    { id: 'crit-m1', roomId: r1Id, name: '예산 적합성', description: '총 예산 1,500만원 이내에서 실현 가능한가?', confirmed: true },
    { id: 'crit-m2', roomId: r1Id, name: '바이럴 파급력', description: 'SNS상에서 대중들의 관심과 공유를 이끌어내기 유리한가?', confirmed: true },
    { id: 'crit-m3', roomId: r1Id, name: '준비 난이도', description: '현재 3인 마케팅팀 인원으로 1달 이내 준비 가능한 범위인가?', confirmed: true },
  ]);

  // Seed some evaluations for Room 1 (Currently 2 people evaluated. Threshold is 3, so results remain hidden until 1 more evaluates!)
  const room1Evals: Evaluation[] = [
    {
      id: 'eval-m1-1',
      roomId: r1Id,
      ideaId: 'idea-m1',
      evaluatorId: 'user-eval1',
      decision: 'KEEP',
      round: 1
    },
    {
      id: 'eval-m2-1',
      roomId: r1Id,
      ideaId: 'idea-m2',
      evaluatorId: 'user-eval1',
      decision: 'EXCLUDE',
      excludedCriterionIds: ['crit-m3'],
      reasonText: '커피차 대여와 게릴라 방문 기획에 손이 너무 많이 가고 우리 3명이서 현장 통제까지 하기는 불가능해 보여요.',
      reasonType: 'OBJECTIVE_CONSTRAINT',
      round: 1
    },
    {
      id: 'eval-m3-1',
      roomId: r1Id,
      ideaId: 'idea-m3',
      evaluatorId: 'user-eval1',
      decision: 'NEUTRAL',
      round: 1
    },
    // Evaluator 2
    {
      id: 'eval-m1-2',
      roomId: r1Id,
      ideaId: 'idea-m1',
      evaluatorId: 'user-eval2',
      decision: 'KEEP',
      round: 1
    },
    {
      id: 'eval-m2-2',
      roomId: r1Id,
      ideaId: 'idea-m2',
      evaluatorId: 'user-eval2',
      decision: 'NEUTRAL',
      round: 1
    },
    {
      id: 'eval-m3-2',
      roomId: r1Id,
      ideaId: 'idea-m3',
      evaluatorId: 'user-eval2',
      decision: 'EXCLUDE',
      excludedCriterionIds: ['crit-m1'],
      reasonText: '30명에게 협찬비와 신제품 단가를 다 지급하면 1,500만원 예산 초과 리스크가 있습니다.',
      reasonType: 'OBJECTIVE_CONSTRAINT',
      round: 1
    },
  ];
  evaluations.set(r1Id, room1Evals);

  const room1Participants = new Map<string, string>();
  room1Participants.set('host-123', '이지형 실장 (개설자)');
  room1Participants.set('user-jy', '김지현 대리');
  room1Participants.set('user-jh', '박준형 과장');
  room1Participants.set('user-mw', '이민우 팀장');
  participants.set(r1Id, room1Participants);


  // --- ROOM 2: 대학생 졸작 주제 선정 (Status: CLOSED - Finished!) ---
  const r2Id = 'room-grad-project';
  rooms.set(r2Id, {
    id: r2Id,
    title: '컴공 4인 졸업작품 주제 결정',
    description: '컴퓨터공학과 4인 졸업프로젝트 최종 주제를 익명 평가를 통해 결정합니다. 6개월 내 제작이 가능하며 기술적 도전과제가 충분해야 합니다.',
    hostId: 'user-sua',
    status: 'CLOSED',
    minResponseThreshold: 3,
    eliminationConfig: { countPerRound: 1, tieBreak: 'random' },
    deadlines: {},
    createdAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
  });

  ideas.set(r2Id, [
    {
      id: 'idea-g1',
      roomId: r2Id,
      title: 'AI 기반 수어 인식 및 번역 웹캠 앱',
      description: '웹캠 영상 속 사용자의 수어 동작을 실시간 딥러닝 모델(MediaPipe + LSTM)로 판별해 한국어 텍스트와 음성으로 동시 출력하는 소통 보조 도구.',
      submitterId: 'user-jw',
      submitterName: '한정우',
      status: 'WINNER',
    },
    {
      id: 'idea-g2',
      roomId: r2Id,
      title: '블록체인 기반 대학 중고 전공서적 거래 앱',
      description: '학교 인증 학생 간 투명한 거래를 보장하기 위해 솔리디티 스마트 컨트랙트를 연동한 중고 전공 서적 안전 직거래 및 이력 추적 플랫폼.',
      submitterId: 'user-sua',
      submitterName: '최수아',
      status: 'ELIMINATED',
      eliminatedRound: 2
    },
    {
      id: 'idea-g3',
      roomId: r2Id,
      title: '실시간 지하철 혼잡도 예측 및 대안 길찾기',
      description: '서울시 지하철 승하차 공공데이터와 날씨 정보를 바탕으로 혼잡 노선을 피하고 상대적으로 쾌적한 최단 대안 경로를 알려주는 대중교통 내비게이션.',
      submitterId: 'user-yj',
      submitterName: '정유진',
      status: 'ELIMINATED',
      eliminatedRound: 1
    }
  ]);

  criteria.set(r2Id, [
    { id: 'crit-g1', roomId: r2Id, name: '기술적 도전과제', description: '졸업작품 심사에 통과할 만큼 학술적/기술적 깊이가 있는가?', confirmed: true },
    { id: 'crit-g2', roomId: r2Id, name: '구현 가능성 (6개월)', description: '4인 팀원 역량으로 6개월 내 배포까지 완료 가능한가?', confirmed: true },
    { id: 'crit-g3', roomId: r2Id, name: '실용성', description: '단순 장난감이 아닌 실 사용자나 타겟층의 불편함을 진짜로 해소하는가?', confirmed: true },
  ]);

  // Evaluated by all 4 team members
  const room2Evals: Evaluation[] = [
    // 1st evaluator
    { id: 'e2-1', roomId: r2Id, ideaId: 'idea-g1', evaluatorId: 'user-jw', decision: 'KEEP', round: 1 },
    { id: 'e2-2', roomId: r2Id, ideaId: 'idea-g2', evaluatorId: 'user-jw', decision: 'NEUTRAL', round: 1 },
    { id: 'e2-3', roomId: r2Id, ideaId: 'idea-g3', evaluatorId: 'user-jw', decision: 'EXCLUDE', excludedCriterionIds: ['crit-g1'], reasonText: '지하철 길찾기는 이미 카카오나 네이버 맵에 있고 혼잡도 우회 알고리즘은 학부 수준에서 단순 데이터 분석 이상의 기술적 어필이 적을 듯.', reasonType: 'OBJECTIVE_CONSTRAINT', round: 1 },
    // 2nd evaluator
    { id: 'e2-4', roomId: r2Id, ideaId: 'idea-g1', evaluatorId: 'user-sua', decision: 'KEEP', round: 1 },
    { id: 'e2-5', roomId: r2Id, ideaId: 'idea-g2', evaluatorId: 'user-sua', decision: 'KEEP', round: 1 },
    { id: 'e2-6', roomId: r2Id, ideaId: 'idea-g3', evaluatorId: 'user-sua', decision: 'NEUTRAL', round: 1 },
    // 3rd evaluator
    { id: 'e2-7', roomId: r2Id, ideaId: 'idea-g1', evaluatorId: 'user-yj', decision: 'NEUTRAL', round: 1 },
    { id: 'e2-8', roomId: r2Id, ideaId: 'idea-g2', evaluatorId: 'user-yj', decision: 'EXCLUDE', excludedCriterionIds: ['crit-g2'], reasonText: '팀원 중에 솔리디티 만져본 사람이 전혀 없어서 6개월 내에 스마트 컨트랙트랑 프론트 앱까지 다 연동하는 건 너무 위험성이 높습니다.', reasonType: 'OBJECTIVE_CONSTRAINT', round: 1 },
    { id: 'e2-9', roomId: r2Id, ideaId: 'idea-g3', evaluatorId: 'user-yj', decision: 'KEEP', round: 1 },
    // 4th evaluator
    { id: 'e2-10', roomId: r2Id, ideaId: 'idea-g1', evaluatorId: 'user-kh', decision: 'KEEP', round: 1 },
    { id: 'e2-11', roomId: r2Id, ideaId: 'idea-g2', evaluatorId: 'user-kh', decision: 'EXCLUDE', excludedCriterionIds: ['crit-g2'], reasonText: '블록체인 가스비 감당이나 대학교 학생 간 분쟁 방지 같은 정책 설계가 6개월 안에 힘들 것 같아요.', reasonType: 'PREFERENCE', round: 1 },
    { id: 'e2-12', roomId: r2Id, ideaId: 'idea-g3', evaluatorId: 'user-kh', decision: 'EXCLUDE', excludedCriterionIds: ['crit-g1'], reasonText: '지하철 길찾기 기능은 작년 우수작품과 너무 유사해서 교수님 피드백 때 크게 혼날 우려가 있습니다.', reasonType: 'OBJECTIVE_CONSTRAINT', round: 1 },
  ];
  evaluations.set(r2Id, room2Evals);

  const r2Rounds: EliminationRound[] = [
    {
      id: 'round-g1',
      roomId: r2Id,
      roundNumber: 1,
      eliminatedIdeaIds: ['idea-g3'],
      aiSummaryText: '1라운드에서는 "실실간 지하철 혼잡도 예측 및 대안 길찾기" 아이디어가 소거되었습니다. 주된 탈락 사유로는 해당 아이디어가 기존 상용 네비게이션 앱과의 차별성이 부족하고, 이미 과거 졸업작품 트렌드와 겹쳐 컴퓨터공학 심사 기준인 "기술적 도전과제" 측면에서 우려된다는 점이 지적되었습니다.'
    },
    {
      id: 'round-g2',
      roomId: r2Id,
      roundNumber: 2,
      eliminatedIdeaIds: ['idea-g2'],
      aiSummaryText: '2라운드에서는 "블록체인 기반 대학 중고 전공서적 거래 앱"이 소거되었습니다. 팀원 중 스마트 컨트랙트 개발 경험자가 없어 6개월 이내에 완성하기에는 기술 학습 난이도 및 환경 구축 리스크(구현 가능성)가 매우 높다는 현실적인 제약이 득표에 큰 영향을 주었습니다.'
    }
  ];
  eliminationRounds.set(r2Id, r2Rounds);

  const room2Participants = new Map<string, string>();
  room2Participants.set('user-sua', '최수아 (개설자)');
  room2Participants.set('user-jw', '한정우');
  room2Participants.set('user-yj', '정유진');
  room2Participants.set('user-kh', '김강현');
  participants.set(r2Id, room2Participants);

  aiFinalSummaries.set(r2Id, `
### 🎉 졸업작품 최종 선정 결론 리포트

컴공 4인 졸업작품 주제 선정을 위한 다단계 소거 평가를 완수했습니다. 최종 선정작은 **"AI 기반 수어 인식 및 번역 웹캠 앱"**입니다.

#### 1. 최종 선정작 강점 분석
* **"AI 기반 수어 인식 및 번역 웹캠 앱"**은 실시간 웹캠 및 MediaPipe, LSTM 연동이라는 명확한 핵심 기술 스택을 보유하여 심사위원들이 중요시하는 **기술적 도전과제** 요건을 매우 훌륭히 만족시켰습니다.
* 또한, 청각장애인과 일반인 간의 실시간 소통을 돕는다는 뚜렷한 소셜 임팩트가 있어 실용성 면에서도 가장 압도적인 지지를 모았습니다. 

#### 2. 단계별 소거 타임라인 및 근거 요약
* **[1라운드 소거] "실시간 지하철 혼잡도 예측"**: 기존 대기업 맵 서비스(네이버, 카카오)와의 기능적 중복이 많아 독창성과 기술적 차별성을 소명하기 어렵다는 "필수 제약 우려"가 크게 작용하였습니다.
* **[2라운드 소거] "블록체인 기반 중고 도서 장터"**: 블록체인(Solidity) 도입에 따른 기술 숙련도 부재와 트랜잭션 수수료(Gas fee) 처리 및 안전 직거래 프로세스를 6개월 프로젝트 기간 내에 완성하기는 팀 역량 한계를 크게 초과한다는 "구현 난이도 제약"으로 최종 라운드에서 제외되었습니다.

#### 3. 팀원 토론 하이라이트
* 블록체인 아이디어의 경우 "참신하고 재미있겠다"는 선호 의견도 있었으나, 현실적인 구현 스케줄을 감안해야 한다는 객관적 제약에 밀려 최종적으로 탈락한 아쉬운 후보였습니다. 최종 선정된 "수어 번역" 과제를 완수하기 위해 조속히 기술 조사를 시작하는 것을 추천합니다.
`);


  // --- ROOM 3: 사내 친환경 제로웨이스트 캠페인 발굴 (Status: CRITERIA_PROPOSAL) ---
  const r3Id = 'room-eco';
  rooms.set(r3Id, {
    id: r3Id,
    title: '사내 제로웨이스트 캠페인 발굴',
    description: '임직원들이 자발적으로 참여하고 회사 일회용품 사용을 획기적으로 줄일 수 있는 전사 친환경 캠페인을 제안하고 선별해 봅니다.',
    hostId: 'user-hewoo',
    status: 'CRITERIA_PROPOSAL',
    minResponseThreshold: 3,
    eliminationConfig: { countPerRound: 1, tieBreak: 'random' },
    deadlines: {},
    createdAt: new Date().toISOString(),
  });

  ideas.set(r3Id, [
    {
      id: 'idea-e1',
      roomId: r3Id,
      title: '사내 텀블러 세척기 도입 및 에코 포인트제',
      description: '공용 탕비실에 초고속 텀블러 자동 세척 기기를 배치하고, 텀블러 사용 시 태그하여 사내 카페에서 쓸 수 있는 탄소중립 포인트를 적립함.',
      submitterId: 'user-hewoo',
      submitterName: '정현우 캠페이너',
      status: 'ACTIVE',
    },
    {
      id: 'idea-e2',
      roomId: r3Id,
      title: '종이 없는 디지털 회의 전용 위크 선포',
      description: '회의실 내 종이 인쇄를 전면 금지하고 태블릿이나 노트북 화면 공유만을 사용. 모든 서명과 문서 정리는 디지털 노션으로 대체.',
      submitterId: 'user-je',
      submitterName: '이지은 주임',
      status: 'ACTIVE',
    }
  ]);

  criterionProposals.set(r3Id, [
    { id: 'prop-1', roomId: r3Id, rawText: '전사 임직원들의 실제 참여 편의성이 높은가? (귀찮으면 절대 안 함)' },
    { id: 'prop-2', roomId: r3Id, rawText: '세척기 기기 렌탈이나 인센티브 포인트 지급을 위한 초기 예산 확보가 용이한가?' },
    { id: 'prop-3', roomId: r3Id, rawText: '단순 친환경 생색내기가 아니라, 실제 종이나 컵 사용 감소량이 유의미하게 측정될 만큼 실효성이 있는가?' },
    { id: 'prop-4', roomId: r3Id, rawText: '일회성 이벤트성으로 반짝 끝나지 않고 영구적으로 지속될 수 있는 정책인가?' },
  ]);

  const room3Participants = new Map<string, string>();
  room3Participants.set('user-hewoo', '정현우 캠페이너 (개설자)');
  room3Participants.set('user-je', '이지은 주임');
  participants.set(r3Id, room3Participants);
}

// Initialize seed data
seedData();

// ----------------------------------------------------------------
// AI LLM Helper Services (using @google/genai)
// ----------------------------------------------------------------

/**
 * Helper: Smart local clustering algorithm for proposals when offline
 * Clusters proposals based on key topic words (e.g., "호빵", "기술", "비용", "유저")
 */
function clusterProposalsLocally(proposals: string[]): { name: string; description: string }[] {
  if (!proposals || proposals.length === 0) {
    return [
      { name: '기술적 구현 가능성', description: '가용한 팀 리소스 및 스케줄 범위 내에서 MVP 구축이 가능한가' },
      { name: '타겟 사용자 차별 가치', description: '기존 서비스 대비 타겟 사용자에게 명확한 페인포인트 해소 가치를 제공하는가' },
      { name: '비용 및 운영 리스크 적정성', description: '가용 예산을 초과하지 않으며 법적/보안 리스크가 제어 가능한가' }
    ];
  }

  // Group proposals by common keywords/topics
  const groups: { [key: string]: string[] } = {};

  for (const rawProp of proposals) {
    const text = rawProp.trim();
    if (!text) continue;

    const mainTopic = text.split(/[:\s]/)[0]?.replace(/[^\w가-힣]/g, '') || text.slice(0, 4);
    let matchedKey = '';

    for (const k of Object.keys(groups)) {
      if (text.includes(k) || k.includes(mainTopic.slice(0, 2))) {
        matchedKey = k;
        break;
      }
    }

    if (!matchedKey) {
      matchedKey = mainTopic.length >= 2 ? mainTopic : text.slice(0, 4);
    }

    if (!groups[matchedKey]) {
      groups[matchedKey] = [];
    }
    groups[matchedKey].push(text);
  }

  const result: { name: string; description: string }[] = [];

  for (const [groupKey, itemTexts] of Object.entries(groups)) {
    const firstTitle = itemTexts[0].split(':')[0]?.trim() || `${groupKey} 평가`;
    const cleanTitle = firstTitle.length > 15 ? firstTitle.slice(0, 15) : firstTitle;

    if (itemTexts.length > 1) {
      const titlesSummary = itemTexts.map(t => `'${t.split(':')[0]?.slice(0, 8)}'`).join(', ');
      result.push({
        name: cleanTitle.includes(groupKey) ? cleanTitle : `${groupKey} 기호도 및 관련성`,
        description: `제안된 ${titlesSummary} 등 ${itemTexts.length}개 의견을 통합한 평가 기준`
      });
    } else {
      const fullText = itemTexts[0];
      const parts = fullText.split(':');
      const descPart = parts[1]?.trim() || fullText;
      result.push({
        name: cleanTitle,
        description: `제안된 '${descPart.slice(0, 35)}...' 의견을 반영한 평가 기준`
      });
    }
  }

  return result.length > 0 ? result : [
    { name: '기술적 구현 가능성', description: '가용한 팀 리소스 및 스케줄 범위 내에서 MVP 구축이 가능한가' },
    { name: '타겟 사용자 차별 가치', description: '기존 서비스 대비 타겟 사용자에게 명확한 페인포인트 해소 가치를 제공하는가' },
    { name: '비용 및 운영 리스크 적정성', description: '가용 예산을 초과하지 않으며 법적/보안 리스크가 제어 가능한가' }
  ];
}

/**
 * 1. Cluster criteria proposal texts into 3-5 confirmed criteria candidates using Potens AI only
 */
async function aiClusterCriteria(
  proposals: string[],
  roomMeta?: { category?: string; title?: string; description?: string; deadline?: string; team?: string; environment?: string }
): Promise<{ name: string; description: string }[]> {
  if (!proposals || proposals.length === 0) {
    return [
      { name: '기술적 구현 가능성', description: '가용한 팀 리소스 및 스케줄 범위 내에서 MVP 구축이 가능한가' },
      { name: '타겟 사용자 차별 가치', description: '기존 서비스 대비 타겟 사용자에게 명확한 페인포인트 해소 가치를 제공하는가' },
      { name: '비용 및 운영 리스크 적정성', description: '가용 예산을 초과하지 않으며 법적/보안 리스크가 제어 가능한가' }
    ];
  }

  const proposalsListText = proposals.map((text, idx) => `${idx + 1}. ${text}`).join('\n');
  const category = roomMeta?.category || '기획';
  const roomTitle = roomMeta?.title || '아이디어 평가';
  const roomDesc = roomMeta?.description || '제안된 아이디어 평가 및 비교';
  const deadline = roomMeta?.deadline || '1달 이내';
  const team = roomMeta?.team || '팀 프로젝트 팀원';
  const environment = roomMeta?.environment || '가용 예산 및 인력 리소스 범위 내';

  const prompt = `당신은 다양한 산업과 프로젝트에서 사용되는 평가 기준을 설계하고 구조화하는 평가 체계 설계 전문가이자 데이터 분류 전문가입니다.

입력된 평가 기준 목록을 의미 기반으로 분석하여 다음 작업을 수행하세요:
1. 의미가 같거나 유사한 평가 기준을 통합합니다.
2. 하나의 기준에 여러 평가 개념이 섞여 있으면 분리합니다.
3. 관련성이 높은 평가 기준끼리 의미 기반으로 클러스터링합니다.
4. 모든 아이디어를 공정하게 평가할 수 있는 핵심 3개~5개 통합 평가 기준을 도출하세요.

[평가 대상 분야]
${category}

[프로젝트 또는 평가 목적]
${roomTitle}: ${roomDesc}

[프로젝트 조건]
프로젝트 목표: ${roomTitle} 아이디어 최적안 선정
핵심 대상: 서비스 타겟 유저
프로젝트 기간: ${deadline}
팀 구성: ${team}
실행 환경: ${environment}

[평가 기준 목록]
${proposalsListText}

## 작성 지침
1. 수집된 모든 제안 항목을 빠짐없이 분석하여 중복/유사 기준을 그룹화하고 핵심 3개~5개 기준을 도출하세요.
2. 각 통합 평가 기준은 15자 이내의 명확한 기준명("name")과 1문장의 구체 설명("description")을 작성하세요.
3. 마크다운 없이 Pure JSON 배열 포맷으로만 출력하세요.

JSON 출력 예시:
[
  { "name": "기준명 1", "description": "설명 1" },
  { "name": "기준명 2", "description": "설명 2" },
  { "name": "기준명 3", "description": "설명 3" }
]`;

  try {
    let rawText = '';
    // Exclusively call Potens AI
    try {
      rawText = await callPotensAI(prompt, 'gemini-2.5-flash');
    } catch (potensErr) {
      console.warn('Potens AI call failed in aiClusterCriteria:', potensErr);
    }

    if (rawText) {
      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const jsonParsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(jsonParsed) && jsonParsed.length > 0) {
          const suggestions = jsonParsed.map((item: any) => {
            if (typeof item === 'string') {
              return { name: item.slice(0, 15), description: 'Potens AI 통합 클러스터링 추천 기준' };
            }
            return {
              name: String(item.name || item.title || item.rawText || '').slice(0, 15),
              description: String(item.description || item.desc || 'Potens AI 통합 클러스터링 추천 기준')
            };
          }).filter(item => item.name);

          if (suggestions.length > 0) {
            return suggestions;
          }
        }
      }
    }
  } catch (err) {
    console.warn('aiClusterCriteria failed, executing smart local clustering algorithm:', err);
  }

  // Execute Smart Local Clustering Algorithm for Fallback
  return clusterProposalsLocally(proposals);
}

/**
 * 2. Rephrase reasons & comments into safe, objective, anonymous summaries
 */
async function aiSummarizeComments(
  ideaTitle: string,
  comments: { text: string; type: 'OBJECTIVE_CONSTRAINT' | 'PREFERENCE' }[]
): Promise<{ objectiveComments: string[]; preferenceComments: string[] }> {
  const objectiveList = comments.filter(c => c.type === 'OBJECTIVE_CONSTRAINT' && c.text.trim()).map(c => c.text);
  const preferenceList = comments.filter(c => c.type === 'PREFERENCE' && c.text.trim()).map(c => c.text);

  if (objectiveList.length === 0 && preferenceList.length === 0) {
    return { objectiveComments: [], preferenceComments: [] };
  }

  const ai = getGeminiClient();
  if (!ai) {
    // Robust simulated comments summarizing - maintains anonymity with standard paraphrasing
    return {
      objectiveComments: objectiveList.map(t => `[완전익명 요약] 해당 안에 대하여 실질적 물리 제약 및 리소스 한계 우려가 공유되었습니다: ${t.replace(/대리|과장|과장님|팀장|나|내가/g, '특정 직무자')}`),
      preferenceComments: preferenceList.map(t => `[완전익명 요약] 감성/체감 만족도 혹은 구성원의 정성적 아쉬움이 공유되었습니다: ${t.replace(/대리|과장|과장님|팀장|나|내가/g, '일부 구성원')}`)
    };
  }

  try {
    const prompt = `
당신은 익명성을 철저히 지키는 소거형 의사결정 비서입니다.
아이디어 "${ideaTitle}"에 대해 수집된 개별 제외 사유(코멘트) 목록을 분석하고 재구성해 주세요.
작성자들의 독특한 문체, 호칭(팀장님, 과장님 등), 직급, 특정인만 아는 에피소드, 그리고 작성자의 개성이 드러나는 어투를 완벽하게 정제하고 지워야 합니다.
비슷한 지적 사항은 중복을 제거해 단일한 객관식 개조형 문장으로 함축하십시오. 

[필수 제약 (Objective) 우려 사유들]
${objectiveList.map(o => `- ${o}`).join('\n')}

[단순 선호 (Preference) 우려 사유들]
${preferenceList.map(p => `- ${p}`).join('\n')}

아래 JSON 포맷에 맞춰 엄격히 정제된 결과를 출력하십시오.

JSON 출력 포맷:
{
  "objectiveComments": ["재구성된 필수 제약 요약 문장 1", "재구성된 필수 제약 요약 문장 2"],
  "preferenceComments": ["재구성된 선호도 아쉬움 요약 문장 1", "재구성된 선호도 아쉬움 요약 문장 2"]
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (err) {
    console.error('Gemini AI comments summarization failed:', err);
    return {
      objectiveComments: objectiveList.map(t => `실행 제약 지적: ${t}`),
      preferenceComments: preferenceList.map(t => `선호도 관련 피드백: ${t}`)
    };
  }
}

/**
 * 3. Summarize a round of elimination
 */
async function aiSummarizeRound(
  roundNumber: number,
  eliminatedIdeaTitles: string[],
  reasons: string[]
): Promise<string> {
  const prompt = `
아이디어 소거 프로세스의 퍼실리테이터로서, ${roundNumber}라운드 소거 결과를 분석하고 투표 사유를 바탕으로 탈락 사유를 익명으로 투명하고 기분 상하지 않게 마크다운 형식으로 2~3줄 요약해 주십시오.

소거된 대상 아이디어: ${eliminatedIdeaTitles.join(', ')}
팀원들의 제외 의견들 요약:
${reasons.map(r => `- ${r}`).join('\n')}

개인 신원 유추가 안 되도록 건조하고 존중을 담은 객관적인 논조로 요약해 주십시오.
`;

  // 1. Try Potens AI first
  try {
    const text = await callPotensAI(prompt, 'gemini-2.5-flash');
    if (text && text.trim()) return text.trim();
  } catch (potensErr) {
    console.warn('Potens AI round summary failed, fallback to Gemini SDK:', potensErr);
  }

  // 2. Fallback to Gemini SDK
  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      if (response.text?.trim()) return response.text.trim();
    } catch (err) {
      console.error('Gemini AI round summary failed:', err);
    }
  }

  return `${roundNumber}라운드에서 다음 아이디어들이 소거되었습니다: [${eliminatedIdeaTitles.join(', ')}]. 주요 요인은 주어진 평가 기준(예산 한계 또는 실행 준비 복잡성)을 만족시키기 어렵다는 의견과 기술적 현실성 부족이 주를 이루었기 때문입니다.`;
}

/**
 * 4. Generate final CLOSED summary report (Potens AI / Gemini AI)
 */
async function aiGenerateFinalSummary(
  roomTitle: string,
  winnerIdeas: string[],
  allEliminatedIdeasWithRounds: { title: string; round: number; reason: string }[],
  controversialIdeas: string[]
): Promise<string> {
  const prompt = `
# 기능 목표
최종 선정된 아이디어와 평가 기준, 투표 결과, 참여자 피드백을 AI가 종합하여 임원진이 검토해도 납득할 수 있는 최종 결과 요약 리포트를 마크다운으로 생성합니다.

단순히 최종 아이디어를 축하하거나 참여자 의견을 나열하는 수준이 아니라 다음 내용을 논리적으로 연결해야 합니다:
- 회의 또는 프로젝트 목표: ${roomTitle}
- 최종 선정(우승) 아이디어: ${winnerIdeas.join(', ')}
- 가장 의견 대립 및 논란이 팽팽했던 아이디어: ${controversialIdeas.join(', ')}

[각 라운드별 탈락 이력 및 사유]
${allEliminatedIdeasWithRounds.map(i => `- [${i.round}라운드 소거] "${i.title}": ${i.reason}`).join('\n')}

# 반드시 유지할 기본 양식
### 🎉 최종 결과 요약 리포트

**"${winnerIdeas.join(', ')}"** 아이디어가 최후의 선택으로 남았습니다!

* **최종 선정 강점**:

# 최종 결과 요약 리포트 구성
최종 출력은 다음 순서로 작성해 주세요.

## 1. 최종 선정 강점
AI가 핵심 강점을 3개 이내로 요약합니다.
각 강점은 다음 구조(강점, 근거가 된 평가 기준, 관련 참여자 피드백, 최종 선정에 미친 영향)로 작성합니다.

예시 형식:
1. 높은 실행 가능성
   - 현재 팀의 기술과 일정 안에서 구현할 수 있다는 의견이 반복적으로 확인되었습니다.

2. 문제 해결 방향의 명확성
   - 다른 아이디어보다 대상 사용자의 문제와 해결 방식이 구체적으로 연결되어 있습니다.

3. 팀 내 높은 수용성
   - 찬성 의견과 최종 투표 결과에서 상대적으로 높은 합의 수준이 확인되었습니다.

## 2. 객관적 분석 및 리스크 검토
- 최종 선정 아이디어를 무조건 긍정적으로 포장하지 않고 실제 데이터와 참여자 의견을 기준으로 객관적 구성
- 긍정/부정 피드백 반영, 약점, 실행 위험, 검증 필요 가정 제시
- 근거가 부족하거나 데이터 부족 시 "현재 수집된 데이터만으로는 확정하기 어려우며, 추가 검증이 필요합니다."라고 명시
- 만약 아이디어 내용이 불충분하거나 데이터가 불충분하여 세부 리포트를 생성하기 어려운 경우, 2단계의 제안된 평가 기준 목록과 3단계 익명 평가 내용을 바탕으로 평가 기준별 종합 점수 항목으로 정돈하여 표시해주십시오.

## 3. 가장 뜨거웠던 쟁점작 분석
- 의견이 가장 갈렸던 아이디어의 가치관 충돌 양상 및 보완 방향

## 4. 최종 실행 권고안
- 부족한 논리 보완 방향, 예상 위험과 대응 방안 및 다음 단계 실행 가이드

마크다운 양식을 정교하게 활용해 정돈된 비즈니스 보고서로 출력해 주십시오.
`;

  // 1. Try Potens AI first
  try {
    const text = await callPotensAI(prompt, 'gemini-2.5-flash');
    if (text && text.trim()) return text.trim();
  } catch (potensErr) {
    console.warn('Potens AI final summary failed, fallback to Gemini SDK:', potensErr);
  }

  // 2. Fallback to Gemini SDK
  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      if (response.text?.trim()) return response.text.trim();
    } catch (err) {
      console.error('Gemini AI final summary failed:', err);
    }
  }

  // 3. Fallback simulation output
  return `
### 🎉 최종 결과 요약 리포트

**"${winnerIdeas.join(', ')}"** 아이디어가 최후의 선택으로 남았습니다!

* **최종 선정 강점**:

1. **높은 실행 가능성**
   - 현재 팀의 기술과 일정 안에서 구현할 수 있다는 의견이 반복적으로 확인되었습니다.

2. **문제 해결 방향의 명확성**
   - 다른 아이디어보다 대상 사용자의 문제와 해결 방식이 구체적으로 연결되어 있습니다.

3. **팀 내 높은 수용성**
   - 찬성 의견과 최종 투표 결과에서 상대적으로 높은 합의 수준이 확인되었습니다.

* **탈락 이력 타임라인**:
  ${allEliminatedIdeasWithRounds.map(i => `  - **[${i.round}라운드 탈락] "${i.title}"**: ${i.reason}`).join('\n')}
* **가장 뜨거웠던 쟁점작**:
  - **"${controversialIdeas.join(', ') || '없음'}"**은 찬성과 반대가 팽팽히 충돌하며 활발한 토론 사유가 축적되었으나, 현실적 리스크 장벽에 부딪쳐 아깝게 막판 소거되었습니다.
`;
}


// ----------------------------------------------------------------
// API Endpoints
// ----------------------------------------------------------------

/**
 * Toggle Room Pin
 */
app.post('/api/rooms/:id/pin', (req, res) => {
  const { id } = req.params;
  const room = rooms.get(id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  
  room.isPinned = !room.isPinned;
  res.json({ success: true, isPinned: room.isPinned });
});

/**
 * Create / Refresh 3-Minute Room Invite Token
 */
app.post('/api/rooms/:id/invites', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  const room = rooms.get(id);
  if (!room && id !== 'room-gominhajo') {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  const now = new Date();
  // Reuse existing valid active token if it has > 15 seconds remaining
  for (const [token, inv] of roomInvites.entries()) {
    if (inv.roomId === id && inv.isActive) {
      const exp = new Date(inv.expiresAt);
      if (exp.getTime() - now.getTime() > 15000) {
        return res.json({ success: true, invite: inv });
      }
    }
  }

  // Generate new 3-minute invite token
  const inviteToken = `inv_${Math.random().toString(36).substring(2, 11)}${Date.now().toString(36)}`;
  const expiresAt = new Date(now.getTime() + 3 * 60 * 1000).toISOString(); // EXACTLY 3 MINUTES

  const inviteRecord = {
    id: `invite-${Math.random().toString(36).substring(2, 9)}`,
    roomId: id,
    inviteToken,
    createdBy: userId || room?.hostId || 'host',
    expiresAt,
    isActive: true,
    createdAt: now.toISOString()
  };

  roomInvites.set(inviteToken, inviteRecord);

  // Synchronize invite record to Supabase DB room_invites table for direct frontend fallback
  supabase.from('room_invites').insert({
    room_id: id,
    invite_token: inviteToken,
    created_by: inviteRecord.createdBy,
    expires_at: expiresAt,
    is_active: true
  }).then(({ error }) => {
    if (error) console.warn('Supabase DB room_invites insert notice:', error);
  });

  res.json({ success: true, invite: inviteRecord });
});

/**
 * Deactivate Room Invite Token
 */
app.delete('/api/rooms/:id/invites', (req, res) => {
  const { id } = req.params;
  for (const [token, inv] of roomInvites.entries()) {
    if (inv.roomId === id && inv.isActive) {
      inv.isActive = false;
    }
  }
  res.json({ success: true, message: '초대 링크가 비활성화되었습니다.' });
});

/**
 * Validate Invite Token & Fetch Room Landing Details (Strict 3-minute server clock check)
 */
app.get('/api/invites/:token', (req, res) => {
  const { token } = req.params;
  const inv = roomInvites.get(token);

  if (!inv) {
    return res.json({ isValid: false, errorCode: 'NOT_FOUND', errorMessage: '존재하지 않는 초대 링크입니다.' });
  }

  if (!inv.isActive) {
    return res.json({ isValid: false, errorCode: 'DEACTIVATED', errorMessage: '방장에 의해 비활성화된 초대 링크입니다.' });
  }

  // Strict Server-time 3-minute check
  const nowTime = new Date().getTime();
  const expireTime = new Date(inv.expiresAt).getTime();
  const secondsRemaining = Math.max(0, Math.floor((expireTime - nowTime) / 1000));

  if (expireTime <= nowTime) {
    return res.json({ isValid: false, errorCode: 'EXPIRED', errorMessage: '생성된 지 3분이 지나 만료된 초대 링크입니다.', secondsRemaining: 0 });
  }

  const room = rooms.get(inv.roomId) || (inv.roomId === 'room-gominhajo' ? {
    id: 'room-gominhajo',
    title: '고민하조 팀 프로젝트',
    description: '새싹 3번째 프로젝트, Antigravity 툴 활용',
    category: '기획',
    isPublic: true,
    maxParticipants: 4,
    targetWinnerCount: 1,
    isPinned: true,
    hostId: 'user_gominhajo_test',
    status: 'IDEA_SUBMISSION',
    minResponseThreshold: 4,
    eliminationConfig: { countPerRound: 1, tieBreak: 'random' },
    deadlines: { ideaSubmissionAt: '2026-08-01T18:00:00Z' },
    createdAt: new Date().toISOString(),
  } as Room : null);

  if (!room) {
    return res.json({ isValid: false, errorCode: 'ROOM_DELETED', errorMessage: '삭제된 회의실입니다.' });
  }

  if (room.status === 'CLOSED') {
    return res.json({ isValid: false, errorCode: 'ROOM_CLOSED', errorMessage: '이미 종료된 회의실입니다.' });
  }

  const pMap = participants.get(inv.roomId) || new Map<string, string>();
  const participantCount = Math.max(1, pMap.size);
  const maxParticipants = room.maxParticipants || 6;
  const hostNickname = pMap.get(room.hostId) || '방장';

  res.json({
    isValid: true,
    room,
    hostNickname,
    participantCount,
    maxParticipants,
    expiresAt: inv.expiresAt,
    secondsRemaining
  });
});

/**
 * Atomic Join via Invite Token (Re-verifies 3-min expiration & Capacity limit at CLICK TIME)
 */
app.post('/api/invites/:token/join', (req, res) => {
  const { token } = req.params;
  const { userId, nickname } = req.body;

  if (!userId) {
    return res.status(400).json({ error: '사용자 ID가 필요합니다.' });
  }

  const inv = roomInvites.get(token);
  if (!inv) {
    return res.status(404).json({ error: '존재하지 않는 초대 링크입니다.' });
  }

  if (!inv.isActive) {
    return res.status(400).json({ error: '비활성화된 초대 링크입니다.' });
  }

  // Re-verify strict 3-minute expiration AT THE EXACT MOMENT OF JOINING
  const nowTime = new Date().getTime();
  const expireTime = new Date(inv.expiresAt).getTime();

  if (expireTime <= nowTime) {
    return res.status(400).json({ error: '생성된 지 3분이 지나 만료된 초대 링크입니다.' });
  }

  const room = rooms.get(inv.roomId) || (inv.roomId === 'room-gominhajo' ? {
    id: 'room-gominhajo',
    maxParticipants: 4,
    status: 'IDEA_SUBMISSION'
  } : null);

  if (!room) {
    return res.status(404).json({ error: '삭제된 회의실입니다.' });
  }

  if (room.status === 'CLOSED') {
    return res.status(400).json({ error: '이미 종료된 회의실입니다.' });
  }

  let pMap = participants.get(inv.roomId);
  if (!pMap) {
    pMap = new Map<string, string>();
    participants.set(inv.roomId, pMap);
  }

  const maxCap = room.maxParticipants || 6;
  const isAlreadyMember = pMap.has(userId);

  if (!isAlreadyMember && pMap.size >= maxCap) {
    return res.status(400).json({ error: `최대 참가 가능 인원(${maxCap}명)이 차서 참가할 수 없습니다.` });
  }

  pMap.set(userId, nickname || '참여자');

  res.json({
    success: true,
    alreadyMember: isAlreadyMember,
    roomId: inv.roomId,
    message: '회의실에 참가가 완료되었습니다.'
  });
});

/**
 * Update Room Status (Milestone Transition)
 */
app.post('/api/rooms/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const room = rooms.get(id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });

  if (status) {
    room.status = status as RoomStatus;
  }
  res.json({ success: true, status: room.status });
});

/**
 * 5. Submit an Idea (Public)
 */
app.post('/api/rooms/:id/ideas', (req, res) => {
  const { id } = req.params;
  const { title, description, submitterId, submitterName, attachmentUrl, pdfAttachmentUrl, tags } = req.body;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'IDEA_SUBMISSION') {
    return res.status(400).json({ error: '현재 아이디어 등록 단계가 아닙니다.' });
  }

  if (!title || !submitterName) {
    return res.status(400).json({ error: '아이디어 제목과 작성자 이름은 필수입니다.' });
  }

  const roomIdeas = ideas.get(id) || [];
  
  // If the same user wants to edit their idea before submission closes:
  const existingIdeaIndex = roomIdeas.findIndex(i => i.submitterId === submitterId && i.id === req.body.id);
  
  const newIdea: Idea = {
    id: req.body.id || `idea-${Math.random().toString(36).substr(2, 9)}`,
    roomId: id,
    title,
    description,
    submitterId,
    submitterName,
    attachmentUrl,
    pdfAttachmentUrl,
    tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
    status: 'ACTIVE',
  };

  if (existingIdeaIndex >= 0) {
    roomIdeas[existingIdeaIndex] = newIdea;
  } else {
    roomIdeas.push(newIdea);
  }
  
  ideas.set(id, roomIdeas);
  res.status(201).json(newIdea);
});

/**
 * Update an Idea (Public / Owner only)
 */
app.put('/api/rooms/:id/ideas/:ideaId', (req, res) => {
  const { id, ideaId } = req.params;
  const { title, description, submitterId, attachmentUrl, pdfAttachmentUrl, tags } = req.body;

  const roomIdeas = ideas.get(id) || [];
  const existingIdeaIndex = roomIdeas.findIndex(i => i.id === ideaId);

  if (existingIdeaIndex === -1) {
    return res.status(404).json({ error: '아이디어를 찾을 수 없습니다.' });
  }

  const existingIdea = roomIdeas[existingIdeaIndex];
  if (existingIdea.submitterId !== submitterId) {
    return res.status(403).json({ error: '작성자 본인만 수정할 수 있습니다.' });
  }

  const updatedIdea: Idea = {
    ...existingIdea,
    title: title || existingIdea.title,
    description: description !== undefined ? description : existingIdea.description,
    attachmentUrl: attachmentUrl !== undefined ? attachmentUrl : existingIdea.attachmentUrl,
    pdfAttachmentUrl: pdfAttachmentUrl !== undefined ? pdfAttachmentUrl : existingIdea.pdfAttachmentUrl,
    tags: Array.isArray(tags) ? tags : existingIdea.tags,
  };

  roomIdeas[existingIdeaIndex] = updatedIdea;
  ideas.set(id, roomIdeas);
  res.json(updatedIdea);
});

/**
 * Delete an Idea (Public / Owner only)
 */
app.delete('/api/rooms/:id/ideas/:ideaId', (req, res) => {
  const { id, ideaId } = req.params;
  const submitterId = req.query.submitterId as string || req.body.submitterId;

  const roomIdeas = ideas.get(id) || [];
  const existingIdeaIndex = roomIdeas.findIndex(i => i.id === ideaId);

  if (existingIdeaIndex === -1) {
    return res.status(404).json({ error: '아이디어를 찾을 수 없습니다.' });
  }

  const existingIdea = roomIdeas[existingIdeaIndex];
  if (submitterId && existingIdea.submitterId !== submitterId) {
    return res.status(403).json({ error: '작성자 본인만 삭제할 수 있습니다.' });
  }

  roomIdeas.splice(existingIdeaIndex, 1);
  ideas.set(id, roomIdeas);
  res.json({ success: true, deletedId: ideaId });
});

/**
 * Update a Criterion Proposal (Host or Author only)
 */
app.put('/api/rooms/:id/proposals/:proposalId', (req, res) => {
  const { id, proposalId } = req.params;
  const { rawText, userId } = req.body;

  if (!rawText || !rawText.trim()) {
    return res.status(400).json({ error: '평가 기준 내용을 입력해 주세요.' });
  }

  const room = rooms.get(id);
  const isHost = room ? room.hostId === userId : false;

  const roomProposals = criterionProposals.get(id) || [];
  const existingIdx = roomProposals.findIndex(p => p.id === proposalId);

  if (existingIdx !== -1) {
    const existing = roomProposals[existingIdx];
    const isAuthor = existing.proposerId === userId && !existing.isAiSuggested;

    if (!isHost && !isAuthor) {
      return res.status(403).json({ error: '이 평가 기준을 수정할 권한이 없습니다.' });
    }

    existing.rawText = rawText.trim();
    roomProposals[existingIdx] = existing;
    criterionProposals.set(id, roomProposals);
    return res.json({ success: true, proposal: existing });
  }

  res.json({ success: true, message: '평가 기준 수정 완료' });
});

/**
 * Delete a Criterion Proposal (Host or Author only)
 */
app.delete('/api/rooms/:id/proposals/:proposalId', (req, res) => {
  const { id, proposalId } = req.params;
  const userId = (req.query.userId as string) || req.body?.userId;

  const room = rooms.get(id);
  const isHost = room ? room.hostId === userId : false;

  const roomProposals = criterionProposals.get(id) || [];
  const existingIdx = roomProposals.findIndex(p => p.id === proposalId);

  if (existingIdx !== -1) {
    const existing = roomProposals[existingIdx];
    const isAuthor = existing.proposerId === userId && !existing.isAiSuggested;

    if (!isHost && !isAuthor) {
      return res.status(403).json({ error: '이 평가 기준을 삭제할 권한이 없습니다.' });
    }

    roomProposals.splice(existingIdx, 1);
    criterionProposals.set(id, roomProposals);
    return res.json({ success: true, deletedId: proposalId });
  }

  res.json({ success: true, message: '평가 기준 삭제 완료' });
});


/**
 * Health Check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * 1. Get room list (Summary representation)
 */
app.get('/api/rooms', (req, res) => {
  const list = Array.from(rooms.values()).map(r => {
    const rIdeas = ideas.get(r.id) || [];
    const rEvals = evaluations.get(r.id) || [];
    const rParticipants = participants.get(r.id);
    const uniqueEvaluators = new Set(rEvals.map(e => e.evaluatorId)).size;
    const participantCount = rParticipants ? rParticipants.size : 1;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category || '기획',
      isPublic: r.isPublic !== undefined ? r.isPublic : true,
      maxParticipants: r.maxParticipants || 10,
      isPinned: r.isPinned || false,
      status: r.status,
      ideasCount: rIdeas.length,
      evaluatorsCount: Math.max(participantCount, uniqueEvaluators),
      minResponseThreshold: r.minResponseThreshold,
      createdAt: r.createdAt
    };
  });
  res.json(list);
});

/**
 * 2. Create room
 */
app.post('/api/rooms', (req, res) => {
  const { title, description, hostId, minResponseThreshold, eliminationConfig, deadlines, category, maxParticipants, isPublic, targetWinnerCount } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: '방 제목은 필수입니다.' });
  }

  const newId = `room-${Math.random().toString(36).substr(2, 9)}`;
  const newRoom: Room = {
    id: newId,
    title,
    description: description || '',
    category: category || '기획',
    isPublic: isPublic !== undefined ? isPublic : true,
    maxParticipants: Math.min(Math.max(Number(maxParticipants) || 4, 1), 6), // 최대 6명 제한
    targetWinnerCount: Math.min(Math.max(Number(targetWinnerCount) || 1, 1), 3), // 최소 1개 ~ 최대 3개
    isPinned: false,
    hostId: hostId || 'host-user',
    status: 'IDEA_SUBMISSION', // Starts in IDEA_SUBMISSION state
    minResponseThreshold: minResponseThreshold || 3,
    eliminationConfig: {
      countPerRound: eliminationConfig?.countPerRound || 1,
      ratioPerRound: eliminationConfig?.ratioPerRound,
      tieBreak: eliminationConfig?.tieBreak || 'random',
    },
    deadlines: deadlines || {},
    createdAt: new Date().toISOString(),
  };

  rooms.set(newId, newRoom);
  ideas.set(newId, []);
  criterionProposals.set(newId, []);
  criteria.set(newId, []);
  evaluations.set(newId, []);
  eliminationRounds.set(newId, []);
  
  const roomParticipants = new Map<string, string>();
  roomParticipants.set(newRoom.hostId, '개설자');
  participants.set(newId, roomParticipants);

  // Synchronize new room to Supabase DB rooms table for direct DB queries
  supabase.from('rooms').insert({
    id: newId,
    title: newRoom.title,
    description: newRoom.description,
    category: newRoom.category,
    is_public: newRoom.isPublic,
    max_participants: newRoom.maxParticipants,
    target_winner_count: newRoom.targetWinnerCount,
    is_pinned: newRoom.isPinned,
    host_id: newRoom.hostId,
    status: newRoom.status,
    min_response_threshold: newRoom.minResponseThreshold,
    elimination_config: newRoom.eliminationConfig,
    deadlines: newRoom.deadlines
  }).then(({ error }) => {
    if (error) console.warn('Supabase DB room insert notice:', error);
  });

  supabase.from('participants').insert({
    room_id: newId,
    user_id: newRoom.hostId,
    nickname: '개설자'
  }).then(({ error }) => {
    if (error) console.warn('Supabase DB host participant insert notice:', error);
  });

  res.status(201).json(newRoom);
});

/**
 * Update room settings (Host only)
 */
app.patch('/api/rooms/:id', (req, res) => {
  const { id } = req.params;
  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  const { title, description, category, maxParticipants, targetWinnerCount, minResponseThreshold, hostId } = req.body;

  if (hostId && room.hostId !== hostId) {
    return res.status(403).json({ error: '방장만 방 설정을 변경할 수 있습니다.' });
  }

  if (title !== undefined) room.title = title;
  if (description !== undefined) room.description = description;
  if (category !== undefined) room.category = category;
  if (maxParticipants !== undefined) room.maxParticipants = Math.min(Math.max(Number(maxParticipants) || 4, 1), 6);
  if (targetWinnerCount !== undefined) room.targetWinnerCount = Math.min(Math.max(Number(targetWinnerCount) || 1, 1), 3);
  if (minResponseThreshold !== undefined) room.minResponseThreshold = Number(minResponseThreshold) || 3;

  rooms.set(id, room);
  res.json({ success: true, room });
});

/**
 * 3. Fetch detailed room info with strict anonymity gate filters
 */
app.get('/api/rooms/:id', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query; // Used to identify if the current caller has evaluations, etc.

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  // Synchronize criterionProposals with Supabase DB criterion_proposals table
  try {
    const { data: dbProps } = await supabase.from('criterion_proposals').select('*').eq('room_id', id);
    if (dbProps && Array.isArray(dbProps)) {
      const mappedDbProps: CriterionProposal[] = dbProps.map(p => ({
        id: p.id,
        roomId: p.room_id,
        rawText: p.raw_text || (p as any).rawText || '',
        proposerId: p.proposer_id || (p as any).proposerId || 'anon',
        clusterId: p.cluster_id || (p as any).clusterId,
        isAiSuggested: p.is_ai_suggested !== undefined ? p.is_ai_suggested : Boolean(p.proposer_id === 'gemini-ai' || p.id?.startsWith('prop-ai-'))
      }));

      // Merge DB proposals into server memory
      const memoryProps = criterionProposals.get(id) || [];
      const combined = [...mappedDbProps];
      memoryProps.forEach(mp => {
        if (!combined.some(cp => cp.id === mp.id || (cp.rawText && mp.rawText && cp.rawText.trim() === mp.rawText.trim()))) {
          combined.push(mp);
        }
      });
      criterionProposals.set(id, combined);
    }
  } catch (err) {
    console.warn('Supabase DB proposals sync notice in GET /api/rooms/:id:', err);
  }

  const roomIdeas = ideas.get(id) || [];
  const roomCriteria = criteria.get(id) || [];
  const rawProposals = criterionProposals.get(id) || [];
  const seenProposalTexts = new Set<string>();
  const roomProposals = rawProposals.filter(p => {
    const key = p.rawText ? p.rawText.trim() : '';
    if (!key || seenProposalTexts.has(key)) return false;
    seenProposalTexts.add(key);
    return true;
  });
  if (roomProposals.length !== rawProposals.length) {
    criterionProposals.set(id, roomProposals);
  }

  const roomEvals = evaluations.get(id) || [];
  const roomRounds = eliminationRounds.get(id) || [];

  // Compute unique evaluators and dynamic target threshold (excluding evaluators currently re-editing)
  const allEvaluators = Array.from(new Set(roomEvals.map(e => String(e.evaluatorId)).filter(Boolean)));
  const roomReEditSet = reEditingEvaluatorsMap.get(id) || new Set<string>();
  const activeCompletedEvaluators = allEvaluators.filter(eId => !roomReEditSet.has(eId));
  const evaluatorsCount = activeCompletedEvaluators.length;
  const roomParticipants = participants.get(id);
  const targetThreshold = Math.max(room.minResponseThreshold || 1, roomParticipants ? roomParticipants.size : 1);
  const minResponseThresholdMet = evaluatorsCount >= targetThreshold;
  room.minResponseThreshold = targetThreshold;

  // Filter evaluations to only return the current caller's private evaluations if they want to view/edit them
  const myEvaluations = userId 
    ? roomEvals.filter(e => e.evaluatorId === String(userId)).map(({ evaluatorId, ...rest }) => rest as Evaluation)
    : [];

  const hasEvaluated = userId ? allEvaluators.includes(String(userId)) : false;

  const rStarVotes = starVotesMap.get(id) || new Map<string, string[]>();
  const myStarVotes = userId && rStarVotes.has(String(userId)) ? rStarVotes.get(String(userId))! : [];
  const isStarVoteSubmitted = Boolean(userId && rStarVotes.has(String(userId)));

  // Aggregate total star votes per ideaId
  const starVoteCounts: Record<string, number> = {};
  roomIdeas.forEach(i => { starVoteCounts[i.id] = 0; });
  rStarVotes.forEach(selectedArr => {
    selectedArr.forEach(ideaId => {
      starVoteCounts[ideaId] = (starVoteCounts[ideaId] || 0) + 1;
    });
  });

  // Calculate unique participants who have submitted 1 or more ideas
  const uniqueSubmitters = new Set(roomIdeas.map(i => i.submitterId || (i as any).participantId || (i as any).userId || (i as any).email || (i as any).createdBy).filter(Boolean));
  const completedParticipantsCount = uniqueSubmitters.size;

  // Determine starVoteStatus using unique submitters count (uniqueSubmitters.size)
  const starVoteThreshold = uniqueSubmitters.size || 1;
  let starVoteStatus: 'voting' | 'tie_pending' | 'finalized' = 'voting';
  if (room.status === 'CLOSED') {
    starVoteStatus = 'finalized';
  } else if (rStarVotes.size >= starVoteThreshold) {
    const activeIdeas = roomIdeas.filter(i => i.status === 'ACTIVE');
    const targetWinners = room.targetWinnerCount || 1;
    const sortedIdeas = [...activeIdeas].sort((a, b) => (starVoteCounts[b.id] || 0) - (starVoteCounts[a.id] || 0));
    if (sortedIdeas.length > targetWinners) {
      const boundaryScore = starVoteCounts[sortedIdeas[targetWinners - 1].id] || 0;
      const nextScore = starVoteCounts[sortedIdeas[targetWinners].id] || 0;
      if (boundaryScore === nextScore) {
        starVoteStatus = 'tie_pending';
      }
    }
  }

  let finalSummary = aiFinalSummaries.get(id);
  if (room.status === 'CLOSED' && (!finalSummary || finalSummary.includes('에 대한 단계별 익명 스크리닝이 완료되어'))) {
    finalSummary = await generateFinalRoomReport(id, room, roomIdeas, roomRounds);
  }

  const result: RoomDetails = {
    room,
    ideas: roomIdeas,
    criteria: roomCriteria,
    proposals: roomProposals,
    proposalsCount: roomProposals.length,
    completedParticipantsCount,
    rounds: roomRounds,
    evaluatorsCount,
    myEvaluations,
    hasEvaluated,
    minResponseThresholdMet,
    scoreConfig: SCORE_CONFIG,
    aiFinalSummary: finalSummary,
    starVotes: starVoteCounts,
    myStarVotes,
    isStarVoteSubmitted,
    starVoteCount: rStarVotes.size,
    starVoteStatus
  };

  // ---------------------------------------------------------------
  // SECURITY GATE: ONLY release aggregation and rephrased comments 
  // if threshold is met OR room is already CLOSED/ELIMINATION
  // ---------------------------------------------------------------
  const isEvaluationClosed = room.status === 'ELIMINATION' || room.status === 'CLOSED';
  
  if (minResponseThresholdMet || isEvaluationClosed) {
    // 1. Calculate aggregated scores for each idea with criteria compliance weighting
    const aggregatedScores: Record<string, {
      score: number;
      keepCount: number;
      neutralCount: number;
      excludeCount: number;
      objectiveExcludeCount: number;
      avgCriteriaComplianceRatio: number;
      criteriaMatchCounts: Record<string, number>;
    }> = {};

    const totalCriteriaCount = Math.max(1, roomCriteria.length || roomProposals.length || 1);

    // Initialize map
    roomIdeas.forEach(idea => {
      aggregatedScores[idea.id] = {
        score: 0,
        keepCount: 0,
        neutralCount: 0,
        excludeCount: 0,
        objectiveExcludeCount: 0,
        avgCriteriaComplianceRatio: 0,
        criteriaMatchCounts: {},
      };
    });

    // Per-idea tracking for weighted calculation
    const weightedPointsMap: Record<string, number> = {};
    const complianceRatiosMap: Record<string, number[]> = {};

    roomIdeas.forEach(idea => {
      weightedPointsMap[idea.id] = 0;
      complianceRatiosMap[idea.id] = [];
    });

    // Populate from all evaluations
    const MAX_VOTERS = 6;
    roomEvals.forEach(ev => {
      const scoreObj = aggregatedScores[ev.ideaId];
      if (scoreObj) {
        const checkedList = ev.excludedCriterionIds || [];
        const matchedCount = checkedList.length;
        const voterRatio = Math.min(1, Math.max(0, matchedCount / totalCriteriaCount));

        complianceRatiosMap[ev.ideaId]?.push(voterRatio);

        // Record per-criterion match/approval count
        checkedList.forEach(critId => {
          scoreObj.criteriaMatchCounts[critId] = (scoreObj.criteriaMatchCounts[critId] || 0) + 1;
        });

        if (ev.decision === 'KEEP') {
          scoreObj.keepCount += 1;
          // Weighted voter score: full 100 points scaled by criteria compliance ratio
          weightedPointsMap[ev.ideaId] += voterRatio * 100;
        } else if (ev.decision === 'NEUTRAL') {
          scoreObj.neutralCount += 1;
          weightedPointsMap[ev.ideaId] += voterRatio * 50; // Partial score for neutral with compliance
        } else if (ev.decision === 'EXCLUDE') {
          scoreObj.excludeCount += 1;
          if (ev.reasonType === 'OBJECTIVE_CONSTRAINT') {
            scoreObj.objectiveExcludeCount += 1;
          }
        }
      }
    });

    // Calculate final weighted score (0~100) and average criteria compliance ratio (%)
    roomIdeas.forEach(idea => {
      const scoreObj = aggregatedScores[idea.id];
      if (scoreObj) {
        // Final score: total weighted points divided by MAX_VOTERS (clamped 0~100)
        scoreObj.score = Math.min(100, Math.max(0, Math.round(weightedPointsMap[idea.id] / MAX_VOTERS)));

        // Average criteria compliance ratio
        const ratios = complianceRatiosMap[idea.id] || [];
        if (ratios.length > 0) {
          const sumRatio = ratios.reduce((acc, r) => acc + r, 0);
          scoreObj.avgCriteriaComplianceRatio = Math.round((sumRatio / ratios.length) * 100);
        } else {
          scoreObj.avgCriteriaComplianceRatio = 0;
        }
      }
    });

    result.aggregatedScores = aggregatedScores;

    // 2. Fetch or calculate AI Summarized Comments
    // Let's see if we have them cached
    if (!aiCommentsCache.has(id)) {
      // Aggregate comments per idea
      const commentMap: Record<string, { text: string; type: 'OBJECTIVE_CONSTRAINT' | 'PREFERENCE' }[]> = {};
      roomIdeas.forEach(idea => {
        commentMap[idea.id] = [];
      });

      roomEvals.forEach(ev => {
        if (ev.reasonText && ev.reasonText.trim()) {
          commentMap[ev.ideaId]?.push({
            text: ev.reasonText,
            type: ev.reasonType || 'PREFERENCE',
          });
        }
      });

      // We do rephrasing asynchronously or lazily. For instant UX in seed rooms, 
      // let's run them.
      const summarized: Record<string, { objectiveComments: string[]; preferenceComments: string[] }> = {};
      
      for (const idea of roomIdeas) {
        const commentsForIdea = commentMap[idea.id] || [];
        summarized[idea.id] = await aiSummarizeComments(idea.title, commentsForIdea);
      }

      aiCommentsCache.set(id, summarized);
    }

    result.aiSummarizedComments = aiCommentsCache.get(id);
  }

  res.json(result);
});

/**
 * 4. Join room (Register nickname)
 */
app.post('/api/rooms/:id/join', (req, res) => {
  const { id } = req.params;
  const { userId, nickname } = req.body;

  if (!userId || !nickname) {
    return res.status(400).json({ error: 'userId와 nickname은 필수입니다.' });
  }

  let rParticipants = participants.get(id);
  if (!rParticipants) {
    rParticipants = new Map<string, string>();
    participants.set(id, rParticipants);
  }

  rParticipants.set(userId, nickname);
  res.json({ success: true, nickname });
});

/**
 * 5. Submit an Idea (Public)
 */
app.post('/api/rooms/:id/ideas', (req, res) => {
  const { id } = req.params;
  const { title, description, submitterId, submitterName, attachmentUrl } = req.body;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'IDEA_SUBMISSION') {
    return res.status(400).json({ error: '현재 아이디어 등록 단계가 아닙니다.' });
  }

  if (!title || !submitterName) {
    return res.status(400).json({ error: '아이디어 제목과 작성자 이름은 필수입니다.' });
  }

  const roomIdeas = ideas.get(id) || [];
  
  // If the same user wants to edit their idea before submission closes:
  const existingIdeaIndex = roomIdeas.findIndex(i => i.submitterId === submitterId && i.id === req.body.id);
  
  if (existingIdeaIndex < 0) {
    const trimmedTitle = title.trim();
    const trimmedDesc = description ? description.trim() : '';
    const isDupTitle = roomIdeas.some(i => i.title.trim() === trimmedTitle);
    const isDupDesc = trimmedDesc && roomIdeas.some(i => i.description && i.description.trim() === trimmedDesc);
    if (isDupTitle || isDupDesc) {
      return res.status(400).json({ error: '동일한 내용의 아이디어가 등록되어 있습니다.' });
    }
  }
  
  const newIdea: Idea = {
    id: req.body.id || `idea-${Math.random().toString(36).substr(2, 9)}`,
    roomId: id,
    title,
    description,
    submitterId,
    submitterName,
    attachmentUrl,
    status: 'ACTIVE',
  };

  if (existingIdeaIndex >= 0) {
    roomIdeas[existingIdeaIndex] = newIdea;
  } else {
    roomIdeas.push(newIdea);
  }

  ideas.set(id, roomIdeas);
  res.status(201).json(newIdea);
});

/**
 * 5-0. Update Evaluation Re-edit status (Realtime re-editing synchronization)
 */
app.post('/api/rooms/:id/re-edit-status', (req, res) => {
  const { id } = req.params;
  const { userId, isReEditing } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId는 필수입니다.' });
  }

  let set = reEditingEvaluatorsMap.get(id);
  if (!set) {
    set = new Set<string>();
    reEditingEvaluatorsMap.set(id, set);
  }

  if (isReEditing) {
    set.add(String(userId));
    // Clear user's submitted evaluations from Express memory so evaluators list and count are 100% synchronized
    let rEvals = evaluations.get(id);
    if (rEvals) {
      const filtered = rEvals.filter(e => String(e.evaluatorId) !== String(userId));
      evaluations.set(id, filtered);
    }
  } else {
    set.delete(String(userId));
  }

  res.json({ success: true, isReEditing: set.has(String(userId)), totalReEditingCount: set.size });
});

/**
 * 5-1. Submit Evaluations for 1차 투표 및 익명 평가
 */
app.post('/api/rooms/:id/evaluations', (req, res) => {
  const { id } = req.params;
  const { evaluatorId, submissions } = req.body;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (!evaluatorId || !Array.isArray(submissions)) {
    return res.status(400).json({ error: 'evaluatorId와 submissions 배열이 필수입니다.' });
  }

  // Clear re-editing status when submitting evaluations
  const reEditSet = reEditingEvaluatorsMap.get(id);
  if (reEditSet) {
    reEditSet.delete(String(evaluatorId));
  }

  // Record evaluation records
  let rEvals = evaluations.get(id);
  if (!rEvals) {
    rEvals = [];
    evaluations.set(id, rEvals);
  }

  // Invalidate previous evals by this evaluator
  const otherEvals = rEvals.filter(e => String(e.evaluatorId) !== String(evaluatorId));

  const newEvals: Evaluation[] = submissions.map((sub: any) => ({
    id: `eval-${Math.random().toString(36).substring(2, 9)}`,
    roomId: id,
    ideaId: sub.ideaId,
    evaluatorId: String(evaluatorId),
    decision: sub.decision || 'KEEP',
    excludedCriterionIds: sub.excludedCriterionIds || [],
    reasonText: sub.reasonText || '',
    reasonType: sub.reasonType || 'PREFERENCE',
    round: 1,
  }));

  const updatedEvals = [...otherEvals, ...newEvals];
  evaluations.set(id, updatedEvals);

  const uniqueEvaluatorsCount = new Set(updatedEvals.map(e => e.evaluatorId)).size;

  // Invalidate AI comment cache for fresh recalculation
  aiCommentsCache.delete(id);

  res.status(201).json({
    success: true,
    evaluatorsCount: uniqueEvaluatorsCount,
    evaluationsCount: updatedEvals.length
  });
});

/**
 * 5-2. Update Room Status
 */
app.post('/api/rooms/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (status) {
    room.status = status;
  }

  res.json({ success: true, status: room.status });
});

/**
 * AI Idea Development Helper Endpoint (IA 2.2: AI 아이디어 디벨롭 보조 기능)
 */
app.post('/api/rooms/:id/ideas/develop', async (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: '제목과 설명을 모두 입력해주세요.' });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.json({
      enhancedDescription: `${description}\n\n[AI 디벨롭 제안]\n- 기대 효과: 구현 시 팀 전체의 작업 효율 및 투명성을 30% 이상 향상시킬 수 있습니다.\n- 기술 제약 및 고려사항: 초기 연동 시 48시간 내 MVP 구현이 가능한 범위로 기능을 구체화할 것을 추천합니다.`
    });
  }

  try {
    const prompt = `
당신은 해커톤 및 아이디어 기획 전문가입니다.
제출하려는 다음 아이디어를 검토하고, 구체적인 기대 효과, 기술적 구현 가능성 모듈, 그리고 고려해야 할 객관적 제약 사항을 포함하여 디벨롭된 정제 문안으로 보완해 주십시오.

[원문 제목]
${title}

[원문 내용]
${description}

출력 형식: 보완된 아이디어 설명 텍스트 (한국어)
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    res.json({
      enhancedDescription: response.text || description
    });
  } catch (err) {
    console.error('AI idea development failed:', err);
    res.json({
      enhancedDescription: `${description}\n\n[AI 디벨롭 제안]\n- 구현 가능성: 핵심 MVP 기능 위주로 단계적 릴리즈 구체화 필요.`
    });
  }
});

/**
 * 6-1. AI Suggest 3 Criteria Based on Registered Ideas (Gemini AI)
 */
app.post('/api/rooms/:id/criteria/suggest', async (req, res) => {
  const { id } = req.params;
  const room = rooms.get(id);
  
  // 1단계 제출된 아이디어 목록 (클라이언트 전송 또는 서버 메모리 데이터)
  const clientIdeas = req.body?.ideas;
  const roomIdeas: Idea[] = (Array.isArray(clientIdeas) && clientIdeas.length > 0)
    ? clientIdeas
    : (ideas.get(id) || []).filter(i => i.status !== 'ELIMINATED');

  const category = room?.category || '기획';
  const roomTitle = room?.title || '프로젝트 아이디어 선별';
  const roomDesc = room?.description || '팀 내 아이디어 평가 및 선별';
  const goal = `${roomTitle}${roomDesc ? ` (${roomDesc})` : ''}`;
  const target = category === '디자인' ? '사용자 및 고객' : '프로젝트 타겟 사용자 및 이해관계자';
  const deadline = room?.deadlines?.ideaSubmissionAt ? `마감일: ${room.deadlines.ideaSubmissionAt}` : '진행 기간 내';
  const team = `최대 ${room?.maxParticipants || 6}명 참여`;
  const environment = '가용 예산 및 기술 스택 범위 내';

  // 아이디어가 2개 미만인 경우: 회의방 개설 정보(카테고리, 주제, 설명, 제약조건) 기반 AI 분석
  if (roomIdeas.length < 2) {
    const ideaCount = roomIdeas.length;
    const ideasListText = '없음 (아이디어 수집 중)';
    const roomMetadataPrompt = `당신은 20년 경력의 아이디어 평가 퍼실리테이터입니다.
회의방에 등록된 아이디어가 존재하므로, 제출된 아이디어들을 종합 분석하여 추후 비교 평가하기에 적합한 핵심 기준 3가지를 제안하세요.
회의방에 등록된 아이디어가 존재하지 않으면, 회의방 개설 조건(카테고리, 주제, 한 줄 설명, 제약조건)을 분석하여, 추후 제출될 아이디어들을 비교 평가하기에 적합한 핵심 기준 3가지를 제안하세요.

## 입력 정보
* 평가 분야(카테고리): ${category}
* 회의 주제(방 제목): ${roomTitle}
* 한 줄 설명 및 제약 조건: ${roomDesc}
* 프로젝트 기간/마감: ${deadline}
* 팀 구성/인원: ${team}
* 실행 환경/제약 조건: ${environment}
* 등록된 아이디어 수: ${ideaCount}개
* 등록된 아이디어 목록:
${ideasListText}

## 작성 지침
1. 회의 주제 및 제약 조건(예산, 인력, 기한)과 등록된 아이디어들의 공통점/차이점을 종합 반영한 핵심 평가 기준 3개를 도출하세요.
2. 각 평가 기준은 15자 이내의 기준명("name")과 1문장의 구체 설명("description")을 작성하세요.
3. 마크다운 없이 Pure JSON 배열 포맷으로만 출력하세요.

JSON 출력 예시:
[
  { "name": "기준명 1", "description": "설명 1" },
  { "name": "기준명 2", "description": "설명 2" },
  { "name": "기준명 3", "description": "설명 3" }
]`;

    try {
      let rawText = '';
      // 1. Try Potens AI API endpoint first
      try {
        rawText = await callPotensAI(roomMetadataPrompt, 'gemini-2.5-flash');
      } catch (potensErr) {
        console.warn('Potens AI call failed, fallback to Gemini SDK...', potensErr);
      }

      // 2. Fallback to Gemini SDK if Potens AI fails
      if (!rawText) {
        const ai = getGeminiClient();
        if (ai) {
          try {
            const resp = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: roomMetadataPrompt,
              config: { responseMimeType: 'application/json' }
            });
            rawText = resp.text || '';
          } catch (e) {}
        }
      }

      if (rawText) {
        const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length >= 3) {
          return res.json({ suggestions: parsed.slice(0, 3) });
        }
      }
    } catch (e) {
      console.warn('Gemini room metadata criteria generation error, using dynamic fallback:', e);
    }

    // 카테고리/회의주제/제약조건 기반 동적 기본 추천 기준
    let categorySuggestions = [];
    if (category === '디자인') {
      categorySuggestions = [
        { name: '콘셉트 독창성 및 표현력', description: `[${roomTitle}] 주제의 브랜딩 및 시각적 콘셉트를 명확하게 표현하는가` },
        { name: '사용 편의성 및 UI/UX', description: '타겟 고객이 직관적이고 편리하게 이용할 수 있는 구조인가' },
        { name: '제조 및 제작 가능성', description: '주어진 기간과 리소스 범위 내에서 현실적으로 제작 가능한가' }
      ];
    } else if (category === '개발' || category === 'IT') {
      categorySuggestions = [
        { name: '기술 스택 및 구현 가능성', description: '팀의 역량으로 주어진 마감 기간 내 아키텍처 구축 및 개발이 가능한가' },
        { name: '시스템 확장성 및 보안', description: '유저 데이터 취급 및 서비스 확장 시 보안 리스크가 제어되는가' },
        { name: '핵심 기능 페인포인트 해소', description: `[${roomTitle}] 회의가 정의한 타겟 문제를 기술적으로 해결하는가` }
      ];
    } else if (category === '마케팅') {
      categorySuggestions = [
        { name: '타겟 파급력 및 바이럴성', description: '예산 범위 내에서 타겟 고객의 수월한 참여와 확산을 유도하는가' },
        { name: '예산 대비 ROI 효율성', description: '가용한 마케팅 예산 대비 기대 효과와 ROI가 뛰어난가' },
        { name: '단기 실행 및 준비 난이도', description: '현재 인력과 스케줄 범위 내에서 1달 이내 즉시 집행 가능한가' }
      ];
    } else {
      categorySuggestions = [
        { name: '핵심 문제 해결력', description: `[${roomTitle}] 회의 주제가 정의한 타겟 고객의 불편함을 명확히 해결하는가` },
        { name: '단기 MVP 실현 가능성', description: '팀 역량 및 가용 인력/스케줄 범위 내에서 1달 이내 구축 가능한가' },
        { name: '비용 및 운영 적정성', description: '가용 예산 한계를 초과하지 않으며 부작용 리스크가 제어 가능한가' }
      ];
    }

    return res.json({
      suggestions: categorySuggestions,
      notice: '아이디어가 2개 미만이어서 회의 카테고리/주제/제약조건 기반 맞춤 기준이 제안되었습니다.'
    });
  }

  // 18개 초과 시 제약
  if (roomIdeas.length > 18) {
    return res.status(400).json({
      error: '입력 정보 확인 필요 (등록된 아이디어가 18개 이하이어야 평가 기준을 생성할 수 있습니다.)',
      message: '입력 정보 확인 필요'
    });
  }
  const ideaCount = roomIdeas.length;
  
  // 1단계 제출된 아이디어 목록 포맷팅 (없을 경우 안내 텍스트)
  const ideasListText = roomIdeas.length > 0 
    ? roomIdeas.map((idea, idx) => {
        const desc = idea.description ? idea.description.replace(/\n+/g, ' ').trim() : '';
        return `  ${idx + 1}. ${idea.title}${desc ? `: ${desc}` : ''}`;
      }).join('\n')
    : '  - 등록된 아이디어 없음 (회의방 카테고리, 주제, 한 줄 설명 및 제약 조건을 반영하여 기준 생성 필요)';

  const prompt = `# 아이디어 평가 기준 추천 프롬프트

당신은 다양한 분야에서 대중의 공감과 선택을 이끌어낸 프로젝트를 다수 기획한 20년 경력의 아이디어 평가 전문가입니다.

프로젝트의 목적과 조건, 등록된 아이디어의 공통점과 차이점을 종합적으로 분석하여 아이디어를 공정하게 비교할 수 있는 평가 기준 3가지를 추천하세요.

## 입력 정보

- 평가 분야: ${category}
- 프로젝트 목표: ${goal}
- 핵심 대상: ${target}
- 프로젝트 기간: ${deadline}
- 팀 구성: ${team}
- 실행 환경: ${environment}
- 등록된 아이디어 수: ${ideaCount}개
- 등록된 아이디어:
${ideasListText}

## 분석 절차

다음 과정을 내부적으로 수행하되 분석 내용은 출력하지 마세요.

1. 프로젝트의 핵심 목표와 성공 조건을 파악합니다.
2. 등록된 아이디어들의 공통점과 주요 차이점을 분석합니다.
3. 아이디어 간 우열을 실질적으로 구분할 수 있는 후보 기준을 도출합니다.
4. 공정성, 변별력, 평가 가능성을 검토하여 최종 기준 3개를 선정합니다.

## 기준 선정 원칙

- 아이디어를 직접 평가하거나 순위를 매기지 마세요.
- 모든 아이디어에 동일하게 적용할 수 있는 기준을 선정하세요.
- 프로젝트 목표와 핵심 대상에게 제공하는 가치를 우선 고려하세요.
- 프로젝트 기간, 팀 역량과 실행 환경 안에서 실현 가능한지를 고려하세요.
- 등록된 아이디어의 차이를 명확하게 구분할 수 있는 기준을 우선하세요.
- 특정 아이디어에만 유리하거나 불리한 기준은 제외하세요.
- 의미나 평가 대상이 서로 겹치는 기준은 제외하세요.
- 모든 프로젝트에 적용할 수 있는 지나치게 일반적인 기준은 피하세요.
- 주관적인 취향보다 관찰하거나 비교할 수 있는 요소를 기준으로 삼으세요.
- 팀원이 별도의 설명 없이 이해할 수 있는 구체적이고 간결한 표현을 사용하세요.

## 분야별 분석 관점

평가 분야에 따라 다음 관점을 참고하세요.

- 기획: 문제 해결력, 대상 가치, 차별성, 구조의 논리성, 서비스 흐름, 실행 범위
- 디자인: 사용성, 정보 전달력, 콘셉트 적합성, 시각적 일관성, 제작 가능성
- 기타 분야: 해당 분야의 목적, 대상 가치, 결과물의 품질과 실행 조건을 분석하여 적합한 관점을 설정

위 항목을 그대로 복사하지 말고, 프로젝트 조건과 등록된 아이디어의 특성에 맞는 평가 기준으로 구체화하세요.

## 입력 검증

- 등록된 아이디어가 없다면, 회의방 생성에 사용되는 회의 주제(방 제목), 한 줄 설명 및 제약 조건, 카테고리의 내용을 반영하여 평가 기준을 생성하세요.
- 등록된 아이디어가 18개를 초과하면 평가 기준을 생성하지 마세요.
- 아이디어를 비교하는 데 필요한 정보가 부족하면 임의로 가정하지 마세요.
- 입력이 유효하지 않은 경우에만 다음과 같이 출력하세요.

\`\`\`text
입력 정보 확인 필요
\`\`\`

## 출력 형식

\`\`\`text
1. 기준명: 1문장의 구체적인 맞춤 평가 설명
2. 기준명: 1문장의 구체적인 맞춤 평가 설명
3. 기준명: 1문장의 구체적인 맞춤 평가 설명
\`\`\`

## 출력 제한

- 평가 기준은 반드시 3개만 작성하세요.
- 각 기준명은 15자 이내로 작성하세요.
- 각 기준마다 프로젝트 조건과 아이디어 특성을 반영한 1문장의 구체적인 평가 설명을 작성하세요.
- 세 기준은 서로 다른 평가 대상을 측정해야 합니다.
- 이유, 평가 질문, 점수, 가중치, 순위, 서론과 결론은 작성하지 마세요.
- 입력 정보에 없는 사실을 추측하거나 추가하지 마세요.`;

  try {
    let rawResponseText = '';

    // 1. Try Potens AI API endpoint first
    try {
      rawResponseText = await callPotensAI(prompt, 'gemini-2.5-flash');
    } catch (potensErr) {
      console.warn('Potens AI call failed, fallback to Gemini SDK...', potensErr);
    }

    // 2. Fallback to Gemini AI Client (@google/genai) if Potens AI fails
    if (!rawResponseText) {
      const ai = getGeminiClient();
      if (ai) {
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
          });
          rawResponseText = response.text || '';
        } catch (gErr) {
          console.warn('Gemini AI SDK call failed:', gErr);
        }
      }
    }

    if (rawResponseText.trim() === '입력 정보 확인 필요') {
      return res.status(400).json({ error: '입력 정보 확인 필요' });
    }

    let parsedItems: { name: string; description: string }[] = [];

    // Try parsing JSON format
    try {
      const cleaned = rawResponseText.replace(/```json/g, '').replace(/```/g, '').trim();
      if (cleaned.startsWith('[') || cleaned.startsWith('{')) {
        const jsonParsed = JSON.parse(cleaned);
        if (Array.isArray(jsonParsed)) {
          parsedItems = jsonParsed.map(item => {
            if (typeof item === 'string') {
              const parts = item.split(/[:\-\=]/);
              return {
                name: (parts[0] || item).trim().slice(0, 15),
                description: parts[1] ? parts.slice(1).join(':').trim() : `${category} 분야 [${roomTitle}] 맞춤 평가 기준`
              };
            }
            return {
              name: (item.name || item.title || item.rawText || '맞춤 평가 기준').trim().slice(0, 15),
              description: item.description || item.desc || `${category} 분야 [${roomTitle}] 맞춤 평가 기준`
            };
          });
        }
      }
    } catch (e) {
      // Continue to line parsing
    }

    // Parse line by line "1. 기준명: 설명"
    if (parsedItems.length === 0 && rawResponseText) {
      const lines = rawResponseText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('```') || trimmed.startsWith('#') || trimmed.includes('입력 정보 확인 필요')) continue;

        const cleanedLine = trimmed.replace(/^(\d+[\.\)]|[\*\-])\s*/, '').trim();
        if (cleanedLine && !cleanedLine.startsWith('```') && !cleanedLine.startsWith('#')) {
          const colonIndex = cleanedLine.search(/[:\-\=]/);
          let name = cleanedLine;
          let desc = '';
          if (colonIndex > 0) {
            name = cleanedLine.substring(0, colonIndex).trim();
            desc = cleanedLine.substring(colonIndex + 1).trim();
          }
          if (name) {
            parsedItems.push({
              name: name.slice(0, 15),
              description: desc || `등록된 아이디어 특성 및 [${roomTitle}] 목표 달성에 부합하는지 평가`
            });
          }
        }
      }
    }

    if (parsedItems.length >= 3) {
      const suggestions = parsedItems.slice(0, 3).map((item, idx) => ({
        name: item.name,
        description: item.description || `${category} 분야 [${roomTitle}] 핵심 맞춤 평가 기준 #${idx + 1}`
      }));
      return res.json({ suggestions });
    }

    throw new Error('Could not parse 3 valid criteria names');
  } catch (err) {
    console.warn('Gemini criteria suggestion failed, using fallback:', err);
    res.json({
      suggestions: [
        { name: '기술적 실현 가능성', description: '팀의 현재 역량과 리소스로 한 달 이내 안정적으로 구현 및 배포가 가능한가?' },
        { name: '타겟 파급력 및 차별성', description: '기존 시장 서비스 대비 타겟 사용자에게 명확한 차별적 이점을 제공하는가?' },
        { name: '운영 리스크 및 비용 적정성', description: '예산 범위를 초과하지 않으며 법적/개인정보 등 부작용 리스크가 제어 가능한가?' }
      ]
    });
  }
});

/**
 * 6. Submit a Criterion Proposal (Anonymous proposal with min 1 ~ max 3 limit per user)
 */
app.post('/api/rooms/:id/criteria/propose', (req, res) => {
  const { id } = req.params;
  const { rawText, proposerId, isAiSuggested } = req.body;
  const isAi = Boolean(isAiSuggested || req.body.id?.startsWith('prop-ai-') || proposerId === 'gemini-ai');

  let room = rooms.get(id);
  if (!room) {
    room = {
      id,
      title: '회의실',
      description: '',
      hostId: proposerId || 'host',
      status: 'CRITERIA_PROPOSAL',
      minResponseThreshold: 3,
      eliminationConfig: { countPerRound: 1, tieBreak: 'random' },
      deadlines: {},
      createdAt: new Date().toISOString()
    };
    rooms.set(id, room);
  }

  if (room.status !== 'CRITERIA_PROPOSAL') {
    return res.status(400).json({ error: '현재 기준 제안 단계가 아닙니다.' });
  }

  if (!rawText || !rawText.trim()) {
    return res.status(400).json({ error: '제안 텍스트를 입력해 주세요.' });
  }

  const proposals = criterionProposals.get(id) || [];
  const trimmedText = rawText.trim();

  // Prevent duplicate proposal content
  const existingDup = proposals.find(p => p.rawText.trim() === trimmedText);
  if (existingDup) {
    return res.status(400).json({ error: '동일한 내용의 기준이 등록되어 있습니다.' });
  }

  if (proposals.length >= 21) {
    return res.status(400).json({ error: '평가 기준은 최대 21개까지 등록할 수 있습니다.' });
  }

  if (proposerId) {
    const userProps = proposals.filter(p => p.proposerId === proposerId);
    const userAiCount = userProps.filter(p => p.isAiSuggested || p.id.startsWith('prop-ai-')).length;
    const userDirectCount = userProps.length - userAiCount;

    if (isAi && userAiCount >= 3) {
      return res.status(400).json({ error: 'AI 기반 평가 기준은 최대 3개까지만 등록할 수 있습니다.' });
    }
    if (!isAi && userDirectCount >= 3) {
      return res.status(400).json({ error: '직접 작성 평가 기준은 최대 3개까지만 등록할 수 있습니다.' });
    }
  }

  const newProposal: CriterionProposal = {
    id: req.body.id || (isAi ? `prop-ai-${Math.random().toString(36).substr(2, 9)}` : `prop-${Math.random().toString(36).substr(2, 9)}`),
    roomId: id,
    rawText: trimmedText,
    proposerId: proposerId || 'anon',
    isAiSuggested: isAi,
  };

  proposals.push(newProposal);
  criterionProposals.set(id, proposals);

  res.status(201).json(newProposal);
});

/**
 * 6-2. Edit a Criterion Proposal
 */
app.put('/api/rooms/:id/criteria/proposals/:proposalId', (req, res) => {
  const { id, proposalId } = req.params;
  const { rawText } = req.body;

  const proposals = criterionProposals.get(id) || [];
  const target = proposals.find(p => p.id === proposalId);
  if (!target) {
    return res.status(404).json({ error: '제안을 찾을 수 없습니다.' });
  }

  if (rawText && rawText.trim()) {
    target.rawText = rawText.trim();
  }

  res.json({ success: true, proposal: target });
});

/**
 * 6-3. Delete a Criterion Proposal
 */
app.delete('/api/rooms/:id/criteria/proposals/:proposalId', (req, res) => {
  const { id, proposalId } = req.params;

  let proposals = criterionProposals.get(id) || [];
  proposals = proposals.filter(p => p.id !== proposalId);
  criterionProposals.set(id, proposals);
  res.json({ success: true, deletedId: proposalId });

});

/**
 * 7. AI Cluster proposals (Transition to review)
 */
app.post('/api/rooms/:id/criteria/cluster', async (req, res) => {
  const { id } = req.params;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'CRITERIA_PROPOSAL') {
    return res.status(400).json({ error: '현재 기준 제안 수집 단계가 아닙니다.' });
  }

  const proposals = criterionProposals.get(id) || [];
  const rawTexts = proposals.map(p => p.rawText);

  if (rawTexts.length === 0) {
    return res.status(400).json({ error: '수집된 제안이 없습니다. 기준을 먼저 작성해 주세요.' });
  }

  const clustered = await aiClusterCriteria(rawTexts, {
    category: room.category,
    title: room.title,
    description: room.description
  });

  // Store them as unconfirmed criteria
  const candidates: Criterion[] = clustered.map((c, i) => ({
    id: `crit-candidate-${i}-${Math.random().toString(36).substr(2, 5)}`,
    roomId: id,
    name: c.name,
    description: c.description,
    confirmed: false,
  }));

  criteria.set(id, candidates);
  
  // Transition status to CRITERIA_REVIEW
  room.status = 'CRITERIA_REVIEW';
  rooms.set(id, room);

  res.json({ success: true, candidates });
});

/**
 * 8. Host confirms criteria and moves to EVALUATION
 */
app.post('/api/rooms/:id/criteria/confirm', (req, res) => {
  const { id } = req.params;
  const { confirmedCriteria } = req.body; // Array of Criteria with edits

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'CRITERIA_REVIEW') {
    return res.status(400).json({ error: '기준 검토 단계가 아닙니다.' });
  }

  if (!Array.isArray(confirmedCriteria) || confirmedCriteria.length === 0) {
    return res.status(400).json({ error: '최소 1개 이상의 기준이 확정되어야 합니다.' });
  }

  const finalized: Criterion[] = confirmedCriteria.map(c => ({
    id: c.id || `crit-${Math.random().toString(36).substr(2, 9)}`,
    roomId: id,
    name: c.name,
    description: c.description,
    confirmed: true,
  }));

  criteria.set(id, finalized);
  
  // Transition to EVALUATION status
  room.status = 'EVALUATION';
  rooms.set(id, room);

  res.json({ success: true, criteria: finalized });
});

/**
 * 9. Submit evaluations for all ideas by a user (Anonymous)
 */
app.post('/api/rooms/:id/evaluations', (req, res) => {
  const { id } = req.params;
  const { evaluatorId, submissions } = req.body; // submissions: Array of evaluations

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'EVALUATION') {
    return res.status(400).json({ error: '현재 평가 단계가 아닙니다.' });
  }

  if (!evaluatorId || !Array.isArray(submissions)) {
    return res.status(400).json({ error: '유효하지 않은 제출 정보입니다.' });
  }

  const roomEvals = evaluations.get(id) || [];

  // Remove existing evaluations for this user to allow updating/re-submitting
  const filteredEvals = roomEvals.filter(e => e.evaluatorId !== evaluatorId);

  // Add new submissions
  submissions.forEach(sub => {
    filteredEvals.push({
      id: `eval-${Math.random().toString(36).substr(2, 9)}`,
      roomId: id,
      ideaId: sub.ideaId,
      evaluatorId,
      decision: sub.decision,
      excludedCriterionIds: sub.excludedCriterionIds,
      reasonText: sub.reasonText,
      reasonType: sub.reasonType,
      round: 1, // Store default round
    });
  });

  evaluations.set(id, filteredEvals);

  // Invalidate rephrased comments cache for this room since comments changed
  aiCommentsCache.delete(id);

  res.json({ success: true, count: submissions.length });
});

/**
 * 9.5. Seed mock evaluations for testing (Developer helper)
 */
app.post('/api/rooms/:id/seed-evaluations', (req, res) => {
  const { id } = req.params;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  const roomIdeas = ideas.get(id) || [];
  const roomCriteria = criteria.get(id) || [];

  if (roomIdeas.length === 0) {
    return res.status(400).json({ error: '등록된 아이디어가 없어 가상 피드백을 추가할 수 없습니다.' });
  }

  const roomEvals = evaluations.get(id) || [];

  // Calculate distinct current evaluators
  const currentEvaluators = new Set(roomEvals.map(e => e.evaluatorId));
  const currentCount = currentEvaluators.size;
  const targetThreshold = room.minResponseThreshold || 4;

  // Calculate needed count to reach targetThreshold
  const neededCount = Math.max(1, targetThreshold - currentCount);

  // Generate dynamic mock voters with UNIQUE IDs (no ID collision with existing evaluators)
  const greekLetters = ['알파', '베타', '감마', '델타', '엡실론', '제타', '에타', '타우'];
  const mockVoters: { id: string; name: string }[] = [];
  let counter = 1;
  const timestamp = Date.now();
  while (mockVoters.length < neededCount) {
    const candidateId = `mock-user-${timestamp}-${counter}`;
    if (!currentEvaluators.has(candidateId)) {
      mockVoters.push({
        id: candidateId,
        name: `가상참여자_${greekLetters[mockVoters.length % greekLetters.length]}`
      });
    }
    counter++;
  }

  let rParticipants = participants.get(id);
  if (!rParticipants) {
    rParticipants = new Map<string, string>();
    participants.set(id, rParticipants);
  }

  mockVoters.forEach((voter, idx) => {
    rParticipants!.set(voter.id, voter.name);

    roomIdeas.forEach((idea, ideaIdx) => {
      // Alternate KEEP and EXCLUDE decisions with varied criteria and reasons
      let decision: 'KEEP' | 'EXCLUDE' = (idx + ideaIdx) % 2 === 0 ? 'KEEP' : 'EXCLUDE';
      let reasonText = '';
      let reasonType: 'OBJECTIVE_CONSTRAINT' | 'PREFERENCE' | undefined;
      let excludedCriterionIds: string[] = [];

      if (decision === 'EXCLUDE') {
        reasonType = idx % 2 === 0 ? 'OBJECTIVE_CONSTRAINT' : 'PREFERENCE';
        if (roomCriteria.length > 0) {
          excludedCriterionIds = [roomCriteria[ideaIdx % roomCriteria.length].id];
        }
        reasonText = idx % 2 === 0
          ? '현재 가용한 개발/기획 리소스를 크게 초과하는 복잡한 과제입니다. 일정 내 배포가 어렵습니다.'
          : '기존 진행 서비스 대비 차별성이 부족하고 독창적 강점이 명확히 전달되지 않습니다.';
      }

      roomEvals.push({
        id: `eval-mock-${voter.id}-${idea.id}`,
        roomId: id,
        ideaId: idea.id,
        evaluatorId: voter.id,
        decision,
        excludedCriterionIds: excludedCriterionIds.length > 0 ? excludedCriterionIds : undefined,
        reasonText: reasonText || undefined,
        reasonType,
        round: 1
      });
    });
  });

  evaluations.set(id, roomEvals);
  aiCommentsCache.delete(id); // Clear cache

  res.json({
    success: true,
    addedCount: neededCount,
    message: `가상 참여자 ${neededCount}명의 평가가 성공적으로 생성되어 정족수(${targetThreshold}명)를 즉시 달성했습니다!`
  });
});

/**
 * 10. Switch room status manually
 */
app.post('/api/rooms/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  const validStatuses: RoomStatus[] = [
    'DRAFT', 'IDEA_SUBMISSION', 'CRITERIA_PROPOSAL', 
    'CRITERIA_REVIEW', 'EVALUATION', 'ELIMINATION', 'CLOSED'
  ];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: '올바르지 않은 단계 정보입니다.' });
  }

  room.status = status;
  rooms.set(id, room);
  res.json({ success: true, status: room.status });
});

// Helper function to check if all participants completed star votes and auto-transition to 5단계 CLOSED
async function checkAndAutoTransitionStarVotes(roomId: string) {
  const room = rooms.get(roomId);
  if (!room || room.status === 'CLOSED') return { status: room?.status || 'CLOSED', message: '' };

  const rStarVotes = starVotesMap.get(roomId) || new Map<string, string[]>();
  const roomIdeas = ideas.get(roomId) || [];
  const activeIdeas = roomIdeas.filter(i => i.status === 'ACTIVE');

  // Determine total required participants: combining unique submitters and registered participants
  const roomParticipants = participants.get(roomId);
  const participantIds = roomParticipants ? Array.from(roomParticipants.keys()) : [];
  const uniqueSubmitters = new Set([
    ...roomIdeas.map(i => i.submitterId || (i as any).participantId || (i as any).userId || (i as any).email || (i as any).createdBy).filter(Boolean),
    ...participantIds
  ]);
  const requiredCount = Math.max(uniqueSubmitters.size, room.minResponseThreshold || 1);
  const currentVoteCount = rStarVotes.size;

  if (currentVoteCount < requiredCount) {
    return { status: room.status, starVoteStatus: 'voting', message: `현재 투표 진행 중 (${currentVoteCount}/${requiredCount}명 완료)` };
  }

  // Calculate total star votes per active idea
  const starVoteCounts: Record<string, number> = {};
  activeIdeas.forEach(i => { starVoteCounts[i.id] = 0; });
  rStarVotes.forEach(selectedArr => {
    selectedArr.forEach(ideaId => {
      if (starVoteCounts[ideaId] !== undefined) {
        starVoteCounts[ideaId] += 1;
      }
    });
  });

  const targetWinners = room.targetWinnerCount || 1;

  // Sort active ideas by starVoteCounts desc
  const sortedIdeas = [...activeIdeas].sort((a, b) => (starVoteCounts[b.id] || 0) - (starVoteCounts[a.id] || 0));

  // Check if tie exists at boundary
  let isTieAtBoundary = false;
  if (sortedIdeas.length > targetWinners) {
    const boundaryScore = starVoteCounts[sortedIdeas[targetWinners - 1].id] || 0;
    const nextScore = starVoteCounts[sortedIdeas[targetWinners].id] || 0;
    if (boundaryScore === nextScore) {
      isTieAtBoundary = true;
    }
  }

  if (isTieAtBoundary) {
    // If tie occurs at boundary, set room status to CLOSED so view advances to 5단계, but with tie_pending flag for roulette
    room.status = 'CLOSED';
    rooms.set(roomId, room);
    return { status: 'CLOSED', starVoteStatus: 'tie_pending', message: '최종 선정 경계에서 동률이 발생하여 5단계 결정 게임(룰렛)으로 이동합니다.' };
  }

  // No tie: auto-transition to 5단계 CLOSED & mark winners
  const winnerIdeas = sortedIdeas.slice(0, targetWinners);
  const winnerIds = new Set(winnerIdeas.map(i => i.id));

  roomIdeas.forEach(idea => {
    if (winnerIds.has(idea.id)) {
      idea.status = 'WINNER';
    } else if (idea.status === 'ACTIVE') {
      idea.status = 'ELIMINATED';
    }
  });

  room.status = 'CLOSED';
  rooms.set(roomId, room);
  ideas.set(roomId, roomIdeas);

  const roomRounds = eliminationRounds.get(roomId) || [];
  aiCommentsCache.delete(roomId);
  await generateFinalRoomReport(roomId, room, roomIdeas, roomRounds);

  return { status: 'CLOSED', starVoteStatus: 'finalized', message: '🎉 모든 참여자의 2차 투표가 완료되어 5단계 최종 결과로 자동 전환되었습니다!' };
}

/**
 * 10.2 Submit Star Vote (4단계 2차 투표 별 스티커 투표)
 */
app.post('/api/rooms/:id/star-vote', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, selectedIdeaIds } = req.body;

    const room = rooms.get(id);
    if (!room) {
      return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    }

    if (!userId || !Array.isArray(selectedIdeaIds)) {
      return res.status(400).json({ error: '올바르지 않은 투표 정보입니다.' });
    }

    const targetWinners = room.targetWinnerCount || 1;
    if (selectedIdeaIds.length !== targetWinners) {
      return res.status(400).json({ error: `별 스티커 ${targetWinners}개를 모두 사용해 주세요.` });
    }

    let rStarVotes = starVotesMap.get(id);
    if (!rStarVotes) {
      rStarVotes = new Map<string, string[]>();
      starVotesMap.set(id, rStarVotes);
    }

    rStarVotes.set(String(userId), selectedIdeaIds);

    const transitionResult = await checkAndAutoTransitionStarVotes(id);

    res.json({ success: true, count: selectedIdeaIds.length, ...transitionResult });
  } catch (err: any) {
    console.error('Submit star-vote error:', err);
    res.status(500).json({ error: err?.message || '별 스티커 투표 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * 10.3 Seed Mock Star Votes (4단계 정족수 달성용 가상 시뮬레이션 버튼 API)
 */
app.post('/api/rooms/:id/seed-star-votes', async (req, res) => {
  try {
    const { id } = req.params;

    const room = rooms.get(id);
    if (!room) {
      return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    }

    const roomIdeas = ideas.get(id) || [];
    const activeIdeas = roomIdeas.filter(i => i.status === 'ACTIVE');

    if (activeIdeas.length === 0) {
      return res.status(400).json({ error: '투표 대상 활성 후보가 없습니다.' });
    }

    let rStarVotes = starVotesMap.get(id);
    if (!rStarVotes) {
      rStarVotes = new Map<string, string[]>();
      starVotesMap.set(id, rStarVotes);
    }

    // Quorum equals unique submitters + registered participants count
    const roomParticipants = participants.get(id);
    const participantIds = roomParticipants ? Array.from(roomParticipants.keys()) : [];
    const uniqueSubmitters = new Set([
      ...roomIdeas.map(i => i.submitterId || (i as any).participantId || (i as any).userId || (i as any).email || (i as any).createdBy).filter(Boolean),
      ...participantIds
    ]);
    const targetThreshold = Math.max(uniqueSubmitters.size, room.minResponseThreshold || 1);
    const currentCount = rStarVotes.size;

    if (currentCount >= targetThreshold) {
      return res.status(400).json({ error: '이미 2차 투표 정족수가 달성되었습니다.' });
    }

    const neededCount = targetThreshold - currentCount;
    const targetWinners = room.targetWinnerCount || 1;
    const timestamp = Date.now();

    for (let i = 0; i < neededCount; i++) {
      const mockUserId = `mock-star-voter-${timestamp}-${i + 1}`;
      
      // Pick distinct targetWinners ideas for this mock voter
      const shuffledIdeas = [...activeIdeas].sort(() => 0.5 - Math.random());
      const selectedIds = shuffledIdeas.slice(0, Math.min(targetWinners, activeIdeas.length)).map(item => item.id);

      rStarVotes.set(mockUserId, selectedIds);
    }

    starVotesMap.set(id, rStarVotes);

    const transitionResult = await checkAndAutoTransitionStarVotes(id);

    res.json({
      success: true,
      addedCount: neededCount,
      message: `가상 참여자 ${neededCount}명의 별 스티커 투표가 성공적으로 생성되어 전체 투표(${targetThreshold}명)가 완료되었습니다!`,
      ...transitionResult
    });
  } catch (err: any) {
    console.error('Seed star votes error:', err);
    res.status(500).json({ error: err?.message || '가상 투표 시뮬레이션 생성 중 오류가 발생했습니다.' });
  }
});

/**
 * 10.5 Final Vote for remaining 2 candidate ideas
 */
app.post('/api/rooms/:id/final-vote', async (req, res) => {
  const { id } = req.params;
  const { winnerIdeaId } = req.body;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (!winnerIdeaId) {
    return res.status(400).json({ error: '투표할 최종 후보가 선택되지 않았습니다.' });
  }

  const roomIdeas = ideas.get(id) || [];
  const selectedIds = Array.isArray(winnerIdeaId) ? winnerIdeaId : [winnerIdeaId];

  roomIdeas.forEach(idea => {
    if (selectedIds.includes(idea.id)) {
      idea.status = 'WINNER';
    } else if (idea.status === 'ACTIVE') {
      idea.status = 'ELIMINATED';
    }
  });

  room.status = 'CLOSED';
  rooms.set(id, room);
  ideas.set(id, roomIdeas);

  const roomRounds = eliminationRounds.get(id) || [];
  aiCommentsCache.delete(id);

  // Auto trigger final report generation
  await generateFinalRoomReport(id, room, roomIdeas, roomRounds);

  res.json({
    success: true,
    closed: true,
    message: '🎉 최종 후보 투표가 성공적으로 완료되어 결과가 확정되었습니다!'
  });
});

/**
 * 11. Core Elimination Loop
 */
app.post('/api/rooms/:id/elimination/next', async (req, res) => {
  const { id } = req.params;
  const { eliminateIdeaIds } = req.body; // Specific array of idea ids to eliminate (useful for host selecting objective exclusions)

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  // Ensure status is ELIMINATION or transition there
  if (room.status !== 'ELIMINATION') {
    room.status = 'ELIMINATION';
    rooms.set(id, room);
  }

  const roomIdeas = ideas.get(id) || [];
  const activeIdeas = roomIdeas.filter(i => i.status === 'ACTIVE');

  if (activeIdeas.length <= 1) {
    // Already down to last candidate! Move to CLOSED
    room.status = 'CLOSED';
    rooms.set(id, room);
    
    // Auto-mark winner
    if (activeIdeas.length === 1) {
      activeIdeas[0].status = 'WINNER';
    }
    
    return res.json({ finished: true, message: '이미 소거가 종료되었습니다.' });
  }

  const roomRounds = eliminationRounds.get(id) || [];
  const currentRoundNum = roomRounds.length + 1;

  let ideasToEliminate: Idea[] = [];

  // Case A: Host specified which idea(s) to eliminate (e.g. following Objective Constraint candidates)
  if (Array.isArray(eliminateIdeaIds) && eliminateIdeaIds.length > 0) {
    ideasToEliminate = activeIdeas.filter(i => eliminateIdeaIds.includes(i.id));
  } else {
    // Case B: Rule-based Elimination (Top ~60% survival ratio based on 유지 찬성 vs 제외 희망 votes)
    const targetWinners = room.targetWinnerCount || 1;
    const totalCount = activeIdeas.length;

    if (totalCount <= targetWinners) {
      room.status = 'CLOSED';
      activeIdeas.forEach((i, idx) => {
        if (idx < targetWinners) i.status = 'WINNER';
      });
      rooms.set(id, room);
      ideas.set(id, roomIdeas);
      await generateFinalRoomReport(id, room, roomIdeas, roomRounds);
      return res.json({ finished: true, message: '목표 생존 수 이하로 소거가 최종 완료되었습니다.' });
    }

    const evs = evaluations.get(id) || [];

    // Calculate metrics per active idea (netScore = keepCount - excludeCount)
    const ideaMetrics = activeIdeas.map(idea => {
      const ideaEvals = evs.filter(e => e.ideaId === idea.id);
      const keepCount = ideaEvals.filter(e => e.decision === 'KEEP').length;
      const excludeCount = ideaEvals.filter(e => e.decision === 'EXCLUDE').length;
      const netScore = keepCount - excludeCount;
      return { idea, keepCount, excludeCount, netScore };
    });

    // Ranking: 1. netScore desc, 2. keepCount desc, 3. excludeCount asc
    ideaMetrics.sort((a, b) => {
      if (b.netScore !== a.netScore) return b.netScore - a.netScore;
      if (b.keepCount !== a.keepCount) return b.keepCount - a.keepCount;
      return a.excludeCount - b.excludeCount;
    });

    // 60% survival ratio rule (Guaranteed at least 1 elimination per round)
    const passTargetCount = Math.max(targetWinners, Math.min(Math.ceil(totalCount * 0.6), totalCount - 1));

    // Boundary tie-breaker handling
    let passCount = passTargetCount;
    if (passCount < ideaMetrics.length) {
      const boundary = ideaMetrics[passCount - 1];
      while (passCount < ideaMetrics.length) {
        const nextItem = ideaMetrics[passCount];
        if (
          nextItem.netScore === boundary.netScore &&
          nextItem.keepCount === boundary.keepCount &&
          nextItem.excludeCount === boundary.excludeCount
        ) {
          if (passCount + 1 >= ideaMetrics.length) break; // Avoid eliminating 0
          passCount++;
        } else {
          break;
        }
      }
    }

    const eliminatedMetrics = ideaMetrics.slice(passCount);
    ideasToEliminate = eliminatedMetrics.map(m => m.idea);

    // Fallback: If tie-breaker produced 0 eliminations, force eliminate lowest-ranked candidate
    if (ideasToEliminate.length === 0 && ideaMetrics.length > targetWinners) {
      ideasToEliminate = [ideaMetrics[ideaMetrics.length - 1].idea];
    }
  }

  if (ideasToEliminate.length === 0) {
    return res.status(400).json({ error: '소거할 아이디어가 지정되지 않았습니다.' });
  }

  // Mark selected ideas as eliminated
  ideasToEliminate.forEach(idea => {
    idea.status = 'ELIMINATED';
    idea.eliminatedRound = currentRoundNum;
  });

  ideas.set(id, roomIdeas);

  // Gather comments/reasons for these eliminated ideas to create AI round summary
  const evs = evaluations.get(id) || [];
  const targetIds = ideasToEliminate.map(i => i.id);
  const eliminatedReasons = evs
    .filter(e => targetIds.includes(e.ideaId) && e.reasonText)
    .map(e => e.reasonText!);

  const aiSummary = await aiSummarizeRound(
    currentRoundNum, 
    ideasToEliminate.map(i => i.title), 
    eliminatedReasons.length > 0 ? eliminatedReasons : ['기준 평점이 다소 부족하여 소거되었습니다.']
  );

  const newRound: EliminationRound = {
    id: `round-${id}-${currentRoundNum}`,
    roomId: id,
    roundNumber: currentRoundNum,
    eliminatedIdeaIds: targetIds,
    aiSummaryText: aiSummary,
  };

  roomRounds.push(newRound);
  eliminationRounds.set(id, roomRounds);

  // Check if we are now left with 1 active idea
  const remainingActive = roomIdeas.filter(i => i.status === 'ACTIVE');
  let isClosedNow = false;
  if (remainingActive.length === 1) {
    remainingActive[0].status = 'WINNER';
    room.status = 'CLOSED';
    rooms.set(id, room);
    isClosedNow = true;
    ideas.set(id, roomIdeas);

    // Auto trigger final report generation
    await generateFinalRoomReport(id, room, roomIdeas, roomRounds);
  } else if (remainingActive.length === 0) {
    // Edge case - eliminated all. Mark last eliminated as winner instead or rollback
    ideasToEliminate[0].status = 'WINNER';
    room.status = 'CLOSED';
    rooms.set(id, room);
    isClosedNow = true;
    ideas.set(id, roomIdeas);
    await generateFinalRoomReport(id, room, roomIdeas, roomRounds);
  }

  res.json({
    success: true,
    eliminated: targetIds,
    roundNumber: currentRoundNum,
    closed: isClosedNow,
  });
});

/**
 * 12. Close room and generate final AI report manually
 */
app.post('/api/rooms/:id/close', async (req, res) => {
  const { id } = req.params;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  room.status = 'CLOSED';
  rooms.set(id, room);

  const roomIdeas = ideas.get(id) || [];
  
  // Find current active ideas and mark them as WINNER
  const activeIdeas = roomIdeas.filter(i => i.status === 'ACTIVE');
  activeIdeas.forEach(i => {
    i.status = 'WINNER';
  });
  ideas.set(id, roomIdeas);

  const roomRounds = eliminationRounds.get(id) || [];

  const summary = await generateFinalRoomReport(id, room, roomIdeas, roomRounds);

  res.json({ success: true, aiFinalSummary: summary });
});

/**
 * Helper to generate final room report
 */
async function generateFinalRoomReport(
  id: string,
  room: Room,
  roomIdeas: Idea[],
  roomRounds: EliminationRound[]
): Promise<string> {
  const winners = roomIdeas.filter(i => i.status === 'WINNER').map(i => i.title);
  
  // Map eliminated info
  const evs = evaluations.get(id) || [];
  const eliminatedList = roomIdeas
    .filter(i => i.status === 'ELIMINATED')
    .map(idea => {
      const relatedRound = roomRounds.find(r => r.eliminatedIdeaIds.includes(idea.id));
      const relatedComments = evs
        .filter(e => e.ideaId === idea.id && e.reasonText)
        .map(e => e.reasonText);
      return {
        title: idea.title,
        round: idea.eliminatedRound || relatedRound?.roundNumber || 1,
        reason: relatedComments.length > 0 ? relatedComments.slice(0, 2).join(' / ') : '평가 기준 하달 소거'
      };
    });

  // Highlight controversial ideas (where voters are split between KEEP and EXCLUDE)
  const controversialList: string[] = [];
  const evMap: Record<string, { keep: number; exclude: number }> = {};
  
  evs.forEach(e => {
    if (!evMap[e.ideaId]) evMap[e.ideaId] = { keep: 0, exclude: 0 };
    if (e.decision === 'KEEP') evMap[e.ideaId].keep += 1;
    if (e.decision === 'EXCLUDE') evMap[e.ideaId].exclude += 1;
  });

  roomIdeas.forEach(idea => {
    const counts = evMap[idea.id];
    if (counts && counts.keep > 0 && counts.exclude > 0) {
      // If absolute difference is small (e.g. <= 1) and there are multiple votes
      if (Math.abs(counts.keep - counts.exclude) <= 1) {
        controversialList.push(idea.title);
      }
    }
  });

  const finalSummaryText = await aiGenerateFinalSummary(
    room.title,
    winners.length > 0 ? winners : ['없음'],
    eliminatedList,
    controversialList
  );

  aiFinalSummaries.set(id, finalSummaryText);
  return finalSummaryText;
}


// ----------------------------------------------------------------
// Vite Middleware setup for full-stack build
// ----------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = fs.existsSync(path.join(currentDir, 'dist'))
      ? path.join(currentDir, 'dist')
      : path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;

if (!process.env.VERCEL) {
  startServer();
}

