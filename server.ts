import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
  CriteriaEvaluationValue,
  EliminationRound,
  RoomDetails,
  DecisionMode,
  FinalVoteStatus,
  DecisionRound,
  DecisionReport
} from './src/types';

dotenv.config();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (IS_PRODUCTION && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error(
    'Production startup blocked: SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY are required.'
  );
}

// Browser code must never receive the service-role key. In local development without
// Supabase configuration, the in-memory stores remain available for isolated testing.
const supabase = createClient(
  SUPABASE_URL || 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY || 'local-development-only-key'
);

const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

const app = express();
const PORT = 3000;

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// Do not allow an untrusted origin to submit cookie-authenticated mutations.
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const originHost = new URL(origin).host;
    const reqHost = req.get('host');
    const allowedHosts = [reqHost, 'why-not-self.vercel.app', 'why-not.vercel.app', 'localhost:3000', 'localhost:5173'];
    if (!allowedHosts.includes(originHost)) {
      return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
    }
  } catch {
    return res.status(403).json({ error: '잘못된 요청 출처입니다.' });
  }
  next();
});

// ----------------------------------------------------------------
// Secure User Accounts Data Store & Cryptographic Helpers
// ----------------------------------------------------------------
interface UserAccount {
  id: string;
  loginId: string;
  passwordHash: string;
  nickname: string;
  recoveryCodeHash: string;
  createdAt: string;
  updatedAt: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  failedRecoveryAttempts: number;
}

const userAccountsMap = new Map<string, UserAccount>(); // loginId.toLowerCase() -> UserAccount

interface UserSession {
  userId: string;
  loginId: string;
  nickname: string;
  expiresAt: number;
}

interface AuthenticatedRequest extends Request {
  auth?: UserSession;
}

const SESSION_COOKIE_NAME = 'whynot_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const sessionStore = new Map<string, UserSession>();
const authAttempts = new Map<string, { count: number; resetAt: number }>();

function legacyHashString(input: string): string {
  // Read-only compatibility for accounts created by the previous implementation.
  // A successful login automatically upgrades this hash to scrypt.
  return crypto
    .createHash('sha256')
    .update(input + 'whynot_secure_salt_2026_v1')
    .digest('hex');
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

function verifyPassword(password: string, storedHash: string): { valid: boolean; needsUpgrade: boolean } {
  if (!storedHash.startsWith('scrypt$')) {
    const legacy = legacyHashString(password);
    const a = Buffer.from(legacy);
    const b = Buffer.from(storedHash);
    return {
      valid: a.length === b.length && crypto.timingSafeEqual(a, b),
      needsUpgrade: legacy === storedHash
    };
  }

  const [, saltText, expectedText] = storedHash.split('$');
  if (!saltText || !expectedText) return { valid: false, needsUpgrade: false };
  try {
    const expected = Buffer.from(expectedText, 'base64url');
    const actual = crypto.scryptSync(password, Buffer.from(saltText, 'base64url'), expected.length);
    return {
      valid: actual.length === expected.length && crypto.timingSafeEqual(actual, expected),
      needsUpgrade: false
    };
  } catch {
    return { valid: false, needsUpgrade: false };
  }
}

function hashOpaqueSecret(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generateRecoveryCode(): string {
  const hex = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `RC-${hex.match(/.{1,4}/g)?.join('-')}`;
}

function isPasswordAcceptable(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length >= 8 &&
    password.length <= 64 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password)
  );
}

function normalizeLoginId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 120 ||
    /[\s\u0000-\u001F\u007F]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizeNickname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 30 ||
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizeOptionalHttpUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('참고 링크 형식이 올바르지 않습니다.');
  }
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error();
    }
    return parsed.toString();
  } catch {
    throw new Error('참고 링크는 http 또는 https 주소만 사용할 수 있습니다.');
  }
}

function parseCookies(req: Request): Record<string, string> {
  return (req.headers.cookie || '').split(';').reduce<Record<string, string>>((acc, pair) => {
    const index = pair.indexOf('=');
    if (index < 0) return acc;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function setSessionCookie(res: Response, rawToken: string) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`
  );
}

function clearSessionCookie(res: Response) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
  );
}

function enforceAuthRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = `${req.ip || 'unknown'}:${String(req.body?.loginId || req.body?.recoveryCode || '').toLowerCase()}`;
  const now = Date.now();
  const current = authAttempts.get(key);
  if (!current || current.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return next();
  }
  if (current.count >= 10) {
    res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
  }
  current.count += 1;
  next();
}

async function issueSession(account: UserAccount, res: Response): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashOpaqueSecret(rawToken);
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const session: UserSession = {
    userId: account.id,
    loginId: account.loginId,
    nickname: account.nickname,
    expiresAt
  };

  sessionStore.set(tokenHash, session);
  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('user_sessions').insert({
      token_hash: tokenHash,
      user_id: account.id,
      expires_at: new Date(expiresAt).toISOString(),
      created_at: new Date().toISOString()
    });
    if (error) {
      sessionStore.delete(tokenHash);
      throw new Error(`세션 저장 실패: ${error.message}`);
    }
  } else if (IS_PRODUCTION) {
    sessionStore.delete(tokenHash);
    throw new Error('운영 환경에서는 영구 세션 저장소가 필요합니다.');
  }

  setSessionCookie(res, rawToken);
}

async function resolveSession(req: Request): Promise<UserSession | null> {
  const rawToken = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!rawToken) return null;
  const tokenHash = hashOpaqueSecret(rawToken);
  const cached = sessionStore.get(tokenHash);
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached;
    sessionStore.delete(tokenHash);
  }

  if (!SUPABASE_CONFIGURED) return null;
  const { data, error } = await supabase
    .from('user_sessions')
    .select('user_id, expires_at, user_accounts!inner(login_id,nickname,status)')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error || !data || new Date(data.expires_at).getTime() <= Date.now()) return null;

  const relatedAccount = Array.isArray(data.user_accounts)
    ? data.user_accounts[0]
    : data.user_accounts;
  if (!relatedAccount || relatedAccount.status !== 'ACTIVE') return null;
  const session: UserSession = {
    userId: data.user_id,
    loginId: relatedAccount.login_id,
    nickname: relatedAccount.nickname,
    expiresAt: new Date(data.expires_at).getTime()
  };
  sessionStore.set(tokenHash, session);
  return session;
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const session = await resolveSession(req);
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  req.auth = session;
  next();
}

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
// Map for 1단계 Explicitly Completed Users: room_id -> Set<user_id>
const ideaCompletedUsersMap = new Map<string, Set<string>>();
// Map for 2단계 Explicitly Completed Users: room_id -> Set<user_id>
const criteriaCompletedUsersMap = new Map<string, Set<string>>();
// Criteria-set approval votes. The persisted equivalent is defined in the phase-2 migration.
const criteriaSetApprovalsMap = new Map<string, Map<string, 'APPROVE' | 'REVISE'>>();
function getCriteriaSetVersion(room: Room): number {
  return Math.max(1, Number(room.criteriaSetVersion || 1));
}

function criteriaPhase(room: Room, phase: 'CRITERIA_PROPOSAL' | 'CRITERIA_REVIEW'): string {
  return `${phase}:v${getCriteriaSetVersion(room)}`;
}

function criteriaCompletionCacheKey(room: Room): string {
  return `${room.id}:v${getCriteriaSetVersion(room)}`;
}

function criteriaApprovalCacheKey(roomId: string, version: number): string {
  return `${roomId}:v${version}`;
}

// Participants eligible for a phase are frozen when the phase starts.
const phaseParticipantSnapshots = new Map<string, Map<string, Set<string>>>();
// Phase 3 keeps each decision attempt immutable instead of overwriting previous results.
const decisionRoundsMap = new Map<string, DecisionRound[]>();
// The final report is a frozen snapshot. It is not regenerated on every page load.
const decisionReportsMap = new Map<string, DecisionReport>();

function getPhaseParticipants(roomId: string, phase: string): Set<string> {
  let roomSnapshots = phaseParticipantSnapshots.get(roomId);
  if (!roomSnapshots) {
    roomSnapshots = new Map<string, Set<string>>();
    phaseParticipantSnapshots.set(roomId, roomSnapshots);
  }
  let snapshot = roomSnapshots.get(phase);
  if (!snapshot) {
    snapshot = new Set(participants.get(roomId)?.keys() || []);
    roomSnapshots.set(phase, snapshot);
  }
  return snapshot;
}

async function loadOrCreatePhaseParticipants(roomId: string, phase: string): Promise<Set<string>> {
  const cached = phaseParticipantSnapshots.get(roomId)?.get(phase);
  if (cached) return cached;

  if (SUPABASE_CONFIGURED) {
    const { data, error } = await supabase
      .from('room_phase_participants')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('phase', phase);
    if (!error && data && data.length > 0) {
      const snapshot = new Set(data.map((row: any) => String(row.user_id)));
      let roomSnapshots = phaseParticipantSnapshots.get(roomId);
      if (!roomSnapshots) {
        roomSnapshots = new Map();
        phaseParticipantSnapshots.set(roomId, roomSnapshots);
      }
      roomSnapshots.set(phase, snapshot);
      return snapshot;
    }
  }

  const snapshot = getPhaseParticipants(roomId, phase);
  if (SUPABASE_CONFIGURED && snapshot.size > 0) {
    const { error } = await supabase.from('room_phase_participants').upsert(
      Array.from(snapshot).map(userId => ({
        room_id: roomId,
        phase,
        user_id: userId
      })),
      { onConflict: 'room_id,phase,user_id' }
    );
    if (error && IS_PRODUCTION) {
      throw new Error('단계 참여자 스냅샷을 안전하게 저장하지 못했습니다.');
    }
  }
  return snapshot;
}

function getCurrentDecisionRound(room: Room): DecisionRound | undefined {
  const rounds = decisionRoundsMap.get(room.id) || [];
  if (room.currentRoundId) {
    return rounds.find(round => round.id === room.currentRoundId && round.status === 'ACTIVE');
  }
  return [...rounds].reverse().find(round => round.status === 'ACTIVE');
}

async function loadDecisionRounds(roomId: string): Promise<DecisionRound[]> {
  const cached = decisionRoundsMap.get(roomId);
  if (cached) return cached;

  const rounds: DecisionRound[] = [];
  if (SUPABASE_CONFIGURED) {
    const { data, error } = await supabase
      .from('evaluation_rounds')
      .select('id,room_id,round_number,decision_mode,status,started_at,completed_at')
      .eq('room_id', roomId)
      .order('round_number', { ascending: true });
    if (!error && data) {
      data.forEach((row: any) => rounds.push({
        id: String(row.id),
        roomId: String(row.room_id),
        roundNumber: Number(row.round_number),
        decisionMode: row.decision_mode === 'QUICK' ? 'QUICK' : 'STRUCTURED',
        status: row.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
        startedAt: row.started_at || new Date().toISOString(),
        completedAt: row.completed_at || undefined
      }));
    }
  }
  decisionRoundsMap.set(roomId, rounds);
  return rounds;
}

async function ensureDecisionRound(room: Room, candidateIdeas: Idea[]): Promise<DecisionRound> {
  await loadDecisionRounds(room.id);
  const existing = getCurrentDecisionRound(room);
  if (existing) return existing;

  const roomRounds = decisionRoundsMap.get(room.id) || [];
  const round: DecisionRound = {
    id: `decision-round-${crypto.randomUUID()}`,
    roomId: room.id,
    roundNumber: roomRounds.length + 1,
    decisionMode: room.decisionMode || 'STRUCTURED',
    status: 'ACTIVE',
    startedAt: new Date().toISOString()
  };

  if (SUPABASE_CONFIGURED) {
    try {
      await supabase.from('evaluation_rounds').insert({
        id: round.id,
        room_id: room.id,
        round_number: round.roundNumber,
        decision_mode: round.decisionMode,
        status: round.status,
        started_at: round.startedAt
      });
      if (candidateIdeas.length > 0) {
        await supabase.from('round_candidates').insert(
          candidateIdeas.map(idea => ({
            id: `round-candidate-${crypto.randomUUID()}`,
            room_id: room.id,
            round_id: round.id,
            idea_id: idea.id,
            outcome: 'ACTIVE'
          }))
        );
      }
      await supabase
        .from('rooms')
        .update({ current_round_id: round.id })
        .eq('id', room.id);
    } catch (err) {
      console.warn('ensureDecisionRound DB notice:', err);
    }
  }

  room.currentRoundId = round.id;
  roomRounds.push(round);
  decisionRoundsMap.set(room.id, roomRounds);
  return round;
}

async function completeDecisionRound(
  room: Room,
  roomIdeas: Idea[],
  resultSnapshot: Record<string, unknown>
): Promise<void> {
  const round = getCurrentDecisionRound(room);
  if (!round || round.status === 'COMPLETED') return;

  const completedAt = new Date().toISOString();
  if (SUPABASE_CONFIGURED) {
    try {
      await supabase
        .from('evaluation_rounds')
        .update({
          status: 'COMPLETED',
          completed_at: completedAt,
          result_snapshot: resultSnapshot
        })
        .eq('id', round.id)
        .eq('status', 'ACTIVE');

      for (const idea of roomIdeas) {
        await supabase
          .from('round_candidates')
          .update({ outcome: idea.status })
          .eq('round_id', round.id)
          .eq('idea_id', idea.id);
      }
    } catch (err) {
      console.warn('completeDecisionRound DB notice:', err);
    }
  }

  round.status = 'COMPLETED';
  round.completedAt = completedAt;
}

async function loadCriteriaApprovalVotes(
  roomId: string,
  version: number = 1
): Promise<Map<string, 'APPROVE' | 'REVISE'>> {
  const cacheKey = criteriaApprovalCacheKey(roomId, version);
  const cached = criteriaSetApprovalsMap.get(cacheKey);
  if (cached) return cached;
  const votes = new Map<string, 'APPROVE' | 'REVISE'>();
  if (SUPABASE_CONFIGURED) {
    const { data, error } = await supabase
      .from('criterion_approvals')
      .select('user_id,vote')
      .eq('room_id', roomId)
      .eq('criteria_set_version', version);
    if (!error && data) {
      data.forEach((row: any) => {
        if (row.vote === 'APPROVE' || row.vote === 'REVISE') votes.set(String(row.user_id), row.vote);
      });
    }
  }
  criteriaSetApprovalsMap.set(cacheKey, votes);
  return votes;
}

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

const LOCAL_DB_FILE = path.join(process.cwd(), '.local_db.json');

function saveLocalState() {
  if (SUPABASE_CONFIGURED) return;
  try {
    const data = {
      rooms: Array.from(rooms.entries()),
      ideas: Array.from(ideas.entries()),
      criterionProposals: Array.from(criterionProposals.entries()),
      criteria: Array.from(criteria.entries()),
      evaluations: Array.from(evaluations.entries()),
      eliminationRounds: Array.from(eliminationRounds.entries()),
      participants: Array.from(participants.entries()).map(([k, v]) => [k, Array.from(v.entries())]),
      roomInvites: Array.from(roomInvites.entries()),
      aiFinalSummaries: Array.from(aiFinalSummaries.entries()),
      starVotesMap: Array.from(starVotesMap.entries()).map(([k, v]) => [k, Array.from(v.entries())]),
      reEditingEvaluatorsMap: Array.from(reEditingEvaluatorsMap.entries()).map(([k, v]) => [k, Array.from(v.values())]),
      ideaCompletedUsersMap: Array.from(ideaCompletedUsersMap.entries()).map(([k, v]) => [k, Array.from(v.values())]),
      criteriaCompletedUsersMap: Array.from(criteriaCompletedUsersMap.entries()).map(([k, v]) => [k, Array.from(v.values())]),
      criteriaSetApprovalsMap: Array.from(criteriaSetApprovalsMap.entries()).map(([k, v]) => [k, Array.from(v.entries())]),
    };
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Local DB] Failed to save local state:', err);
  }
}

function loadLocalState() {
  try {
    if (!fs.existsSync(LOCAL_DB_FILE)) return;
    const raw = fs.readFileSync(LOCAL_DB_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data.rooms) data.rooms.forEach(([k, v]: any) => rooms.set(k, v));
    if (data.ideas) data.ideas.forEach(([k, v]: any) => ideas.set(k, v));
    if (data.criterionProposals) data.criterionProposals.forEach(([k, v]: any) => criterionProposals.set(k, v));
    if (data.criteria) data.criteria.forEach(([k, v]: any) => criteria.set(k, v));
    if (data.evaluations) data.evaluations.forEach(([k, v]: any) => evaluations.set(k, v));
    if (data.eliminationRounds) data.eliminationRounds.forEach(([k, v]: any) => eliminationRounds.set(k, v));
    if (data.participants) data.participants.forEach(([k, v]: any) => participants.set(k, new Map(v)));
    if (data.roomInvites) data.roomInvites.forEach(([k, v]: any) => roomInvites.set(k, v));
    if (data.aiFinalSummaries) data.aiFinalSummaries.forEach(([k, v]: any) => aiFinalSummaries.set(k, v));
    if (data.starVotesMap) data.starVotesMap.forEach(([k, v]: any) => starVotesMap.set(k, new Map(v)));
    if (data.reEditingEvaluatorsMap) data.reEditingEvaluatorsMap.forEach(([k, v]: any) => reEditingEvaluatorsMap.set(k, new Set(v)));
    if (data.ideaCompletedUsersMap) data.ideaCompletedUsersMap.forEach(([k, v]: any) => ideaCompletedUsersMap.set(k, new Set(v)));
    if (data.criteriaCompletedUsersMap) data.criteriaCompletedUsersMap.forEach(([k, v]: any) => criteriaCompletedUsersMap.set(k, new Set(v)));
    if (data.criteriaSetApprovalsMap) data.criteriaSetApprovalsMap.forEach(([k, v]: any) => criteriaSetApprovalsMap.set(k, new Map(v)));
    console.log(`[Local DB] Restored Phase 2 local state (${rooms.size} rooms).`);
  } catch (err) {
    console.warn('[Local DB] Failed to load local state:', err);
  }
}

// Initialize seed data and restore local database state when in offline/local mode
if (!SUPABASE_CONFIGURED) {
  seedData();
  loadLocalState();
}

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
interface DecisionReportEvidence {
  roomTitle: string;
  winnerIdeas: string[];
  selectedReasons: string[];
  majorConcerns: string[];
  unverifiedAssumptions: string[];
  nextValidationTasks: string[];
}

function renderDeterministicDecisionReport(evidence: DecisionReportEvidence): string {
  const renderItems = (items: string[], fallback: string) =>
    (items.length > 0 ? items : [fallback]).map(item => `- ${item}`).join('\n');
  return `### 최종 결정 근거 리포트

## 1. 선정 이유
${renderItems(evidence.selectedReasons, '최종 익명 투표 결과에 따라 선정되었습니다.')}

## 2. 주요 우려
${renderItems(evidence.majorConcerns, '수집된 평가에서 반복적으로 확인된 주요 우려가 없습니다.')}

## 3. 미확인 가정
${renderItems(evidence.unverifiedAssumptions, '현재 자료만으로 확인하기 어려운 가정은 다음 실행 단계에서 별도로 확인해야 합니다.')}

## 4. 다음 검증 과제
${renderItems(evidence.nextValidationTasks, '작은 범위의 실행 또는 사용자 테스트로 핵심 가정을 먼저 검증합니다.')}

> AI는 결론을 새로 만들지 않았으며, 팀이 남긴 평가와 투표 근거만 같은 형식으로 정리했습니다.`;
}

async function aiGenerateFinalSummary(evidence: DecisionReportEvidence): Promise<string> {
  const prompt = `
# 역할
당신은 의사결정의 심판이 아니라, 팀이 남긴 근거를 읽기 쉽게 정리하는 통역자입니다.
새로운 강점, 수치, 사실, 결론을 만들지 마세요. 사람의 의견을 평가하거나 승자를 다시 선정하지 마세요.

# 회의
- 주제: ${evidence.roomTitle}
- 최종 선정: ${evidence.winnerIdeas.join(', ')}

# 서버가 검증한 근거
[선정 이유]
${evidence.selectedReasons.map(item => `- ${item}`).join('\n')}

[주요 우려]
${evidence.majorConcerns.map(item => `- ${item}`).join('\n')}

[미확인 가정]
${evidence.unverifiedAssumptions.map(item => `- ${item}`).join('\n')}

[다음 검증 과제]
${evidence.nextValidationTasks.map(item => `- ${item}`).join('\n')}

# 출력 규칙
반드시 아래 네 제목을 그대로 사용한 한국어 마크다운만 출력하세요.
## 1. 선정 이유
## 2. 주요 우려
## 3. 미확인 가정
## 4. 다음 검증 과제

근거가 없는 항목에는 "현재 수집된 자료만으로는 확인할 수 없습니다."라고 적으세요.
개인 신원이나 말투를 추정하지 마세요.
`;

  // 1. Try Potens AI first if configured
  if (process.env.POTENS_API_KEY) {
    try {
      const text = await callPotensAI(prompt, 'gemini-2.5-flash');
      if (text && text.trim()) return text.trim();
    } catch (potensErr: any) {
      console.info('[AI Provider] Potens AI fallback to Gemini SDK:', potensErr?.message || potensErr);
    }
  } else {
    console.info('[AI Provider] Using Gemini SDK (@google/genai) as primary AI engine.');
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
  return renderDeterministicDecisionReport(evidence);
}


// ----------------------------------------------------------------
// API Endpoints
// ----------------------------------------------------------------

/**
 * ----------------------------------------------------------------
 * Secure User Account Management Endpoints (user_accounts)
 * ----------------------------------------------------------------
 */

// Check Login ID Availability
app.post('/api/auth/check-id', enforceAuthRateLimit, async (req, res) => {
  const { loginId } = req.body || {};
  const normalizedId = normalizeLoginId(loginId);
  if (!normalizedId) return res.status(400).json({ available: false });

  if (userAccountsMap.has(normalizedId)) {
    return res.json({ available: false });
  }

  try {
    const { data: existingSupa } = await supabase
      .from('user_accounts')
      .select('id')
      .eq('login_id', normalizedId)
      .maybeSingle();

    if (existingSupa) {
      return res.json({ available: false });
    }
  } catch (err) {}

  res.json({ available: true });
});

// Secure Sign Up Endpoint
app.post('/api/auth/signup', enforceAuthRateLimit, async (req, res) => {
  const { loginId, password, nickname } = req.body || {};
  const normalizedId = normalizeLoginId(loginId);
  const normalizedNickname = normalizeNickname(nickname);
  if (!normalizedId || !password || !normalizedNickname) {
    return res.status(400).json({ error: '로그인 아이디, 비밀번호, 닉네임은 필수 입력 항목입니다.' });
  }
  if (!isPasswordAcceptable(password)) {
    return res.status(400).json({ error: '비밀번호는 8~64자의 영문과 숫자 조합이어야 합니다.' });
  }

  if (userAccountsMap.has(normalizedId)) {
    return res.status(400).json({ error: '이미 사용 중인 로그인 아이디입니다.' });
  }

  try {
    const { data: existingSupa } = await supabase
      .from('user_accounts')
      .select('id')
      .eq('login_id', normalizedId)
      .maybeSingle();

    if (existingSupa) {
      return res.status(400).json({ error: '이미 사용 중인 로그인 아이디입니다.' });
    }
  } catch (err) {}

  const newUserId = crypto.randomUUID();
  const passwordHash = hashPassword(password);
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = hashOpaqueSecret(recoveryCode);
  const now = new Date().toISOString();

  const accountRecord: UserAccount = {
    id: newUserId,
    loginId: normalizedId,
    passwordHash,
    nickname: normalizedNickname,
    recoveryCodeHash,
    createdAt: now,
    updatedAt: now,
    status: 'ACTIVE',
    failedRecoveryAttempts: 0
  };

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('user_accounts').insert({
      id: newUserId,
      login_id: normalizedId,
      password_hash: passwordHash,
      nickname: normalizedNickname,
      recovery_code_hash: recoveryCodeHash,
      created_at: now,
      updated_at: now,
      status: 'ACTIVE',
      failed_recovery_attempts: 0
    });
    if (error) {
      return res.status(503).json({ error: '계정을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const { error: registrationError } = await supabase.from('user_registrations').insert({
      user_id: newUserId,
      login_id: normalizedId,
      nickname: normalizedNickname,
      registration_status: 'COMPLETED',
      registered_at: now
    });
    if (registrationError) {
      await supabase.from('user_accounts').delete().eq('id', newUserId);
      console.error('Signup registration audit insert failed:', registrationError.message);
      return res.status(503).json({ error: '회원가입 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  } else if (IS_PRODUCTION) {
    return res.status(503).json({ error: '계정 저장소가 준비되지 않았습니다.' });
  }

  userAccountsMap.set(normalizedId, accountRecord);
  try {
    await issueSession(accountRecord, res);
  } catch (error) {
    userAccountsMap.delete(normalizedId);
    if (SUPABASE_CONFIGURED) {
      await supabase.from('user_registrations').delete().eq('user_id', newUserId);
      await supabase.from('user_accounts').delete().eq('id', newUserId);
    }
    return res.status(503).json({ error: '로그인 세션을 안전하게 만들지 못했습니다.' });
  }

  res.status(201).json({
    ok: true,
    user: {
      id: newUserId,
      loginId: normalizedId,
      nickname: normalizedNickname
    },
    recoveryCode // Provided ONCE on signup
  });
});

// Alias for /api/auth/register
app.post('/api/auth/register', enforceAuthRateLimit, (req, res, next) => {
  req.url = '/api/auth/signup';
  app._router.handle(req, res, next);
});

// Secure Login Endpoint
app.post('/api/auth/login', enforceAuthRateLimit, async (req, res) => {
  const { loginId, password } = req.body || {};
  const normalizedId = normalizeLoginId(loginId);
  if (!normalizedId || typeof password !== 'string' || password.length > 64) {
    return res.status(400).json({ error: '로그인 아이디와 비밀번호를 입력해 주세요.' });
  }

  let account: UserAccount | undefined = userAccountsMap.get(normalizedId);

  if (!account) {
    try {
      const { data: supaAcc } = await supabase
        .from('user_accounts')
        .select('*')
        .eq('login_id', normalizedId)
        .maybeSingle();

      if (supaAcc) {
        account = {
          id: supaAcc.id,
          loginId: supaAcc.login_id,
          passwordHash: supaAcc.password_hash,
          nickname: supaAcc.nickname,
          recoveryCodeHash: supaAcc.recovery_code_hash,
          createdAt: supaAcc.created_at,
          updatedAt: supaAcc.updated_at,
          status: supaAcc.status || 'ACTIVE',
          failedRecoveryAttempts: supaAcc.failed_recovery_attempts || 0
        };
        userAccountsMap.set(normalizedId, account);
      }
    } catch (err) {}
  }

  if (!account) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  if (account.status !== 'ACTIVE') {
    return res.status(403).json({ error: '비활성화되거나 정지된 계정입니다.' });
  }

  const verification = verifyPassword(password, account.passwordHash);
  if (!verification.valid) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  if (verification.needsUpgrade) {
    const upgradedHash = hashPassword(password);
    account.passwordHash = upgradedHash;
    account.updatedAt = new Date().toISOString();
    if (SUPABASE_CONFIGURED) {
      const { error } = await supabase
        .from('user_accounts')
        .update({ password_hash: upgradedHash, updated_at: account.updatedAt })
        .eq('id', account.id);
      if (error) {
        return res.status(503).json({ error: '계정 보안을 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      }
    }
  }

  try {
    await issueSession(account, res);
  } catch {
    return res.status(503).json({ error: '로그인 세션을 안전하게 만들지 못했습니다.' });
  }

  res.json({
    ok: true,
    user: {
      id: account.id,
      loginId: account.loginId,
      nickname: account.nickname
    }
  });
});

// Secure Account Recovery Endpoint (Recovery Code -> Show ID & Reset Password)
app.post('/api/auth/recover', enforceAuthRateLimit, async (req, res) => {
  const { recoveryCode, newPassword } = req.body || {};
  if (
    typeof recoveryCode !== 'string' ||
    recoveryCode.length > 80 ||
    !/^RC-(?:[A-Fa-f0-9]{4}-){1,7}[A-Fa-f0-9]{4}$/.test(recoveryCode.trim()) ||
    !newPassword
  ) {
    return res.status(400).json({ error: '복구 코드와 새 비밀번호를 모두 입력해 주세요.' });
  }
  if (!isPasswordAcceptable(newPassword)) {
    return res.status(400).json({ error: '새 비밀번호는 8~64자의 영문과 숫자 조합이어야 합니다.' });
  }

  const normalizedRecoveryCode = recoveryCode.trim().toUpperCase();
  const enteredCodeHashes = [
    hashOpaqueSecret(normalizedRecoveryCode),
    legacyHashString(normalizedRecoveryCode)
  ];

  // Search across memory accounts first
  let foundAccount: UserAccount | undefined = Array.from(userAccountsMap.values()).find(
    acc => enteredCodeHashes.includes(acc.recoveryCodeHash)
  );

  if (!foundAccount) {
    try {
      const { data: supaAcc } = await supabase
        .from('user_accounts')
        .select('*')
        .in('recovery_code_hash', enteredCodeHashes)
        .maybeSingle();

      if (supaAcc) {
        foundAccount = {
          id: supaAcc.id,
          loginId: supaAcc.login_id,
          passwordHash: supaAcc.password_hash,
          nickname: supaAcc.nickname,
          recoveryCodeHash: supaAcc.recovery_code_hash,
          createdAt: supaAcc.created_at,
          updatedAt: supaAcc.updated_at,
          status: supaAcc.status || 'ACTIVE',
          failedRecoveryAttempts: supaAcc.failed_recovery_attempts || 0
        };
        userAccountsMap.set(supaAcc.login_id, foundAccount);
      }
    } catch (err) {}
  }

  if (!foundAccount) {
    return res.status(400).json({ error: '올바르지 않거나 이미 사용된 복구 코드입니다.' });
  }

  if (foundAccount.failedRecoveryAttempts >= 5) {
    return res.status(429).json({ error: '복구 코드 오류 시도 횟수를 초과(5회)했습니다. 관리자에게 문의해 주세요.' });
  }

  // Issue new password and void old recovery code with a NEW recovery code
  const newPasswordHash = hashPassword(newPassword);
  const newRecoveryCode = generateRecoveryCode();
  const newRecoveryCodeHash = hashOpaqueSecret(newRecoveryCode);
  const now = new Date().toISOString();

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('user_accounts').update({
      password_hash: newPasswordHash,
      recovery_code_hash: newRecoveryCodeHash,
      failed_recovery_attempts: 0,
      updated_at: now
    }).eq('id', foundAccount.id);
    if (error) {
      return res.status(503).json({ error: '계정 복구 결과를 안전하게 저장하지 못했습니다.' });
    }

    // A recovered account must invalidate every previous browser session.
    await supabase.from('user_sessions').delete().eq('user_id', foundAccount.id);
  }
  foundAccount.passwordHash = newPasswordHash;
  foundAccount.recoveryCodeHash = newRecoveryCodeHash;
  foundAccount.failedRecoveryAttempts = 0;
  foundAccount.updatedAt = now;
  userAccountsMap.set(foundAccount.loginId, foundAccount);
  for (const [tokenHash, session] of sessionStore.entries()) {
    if (session.userId === foundAccount.id) sessionStore.delete(tokenHash);
  }

  try {
    await issueSession(foundAccount, res);
  } catch {
    return res.status(503).json({ error: '복구 후 로그인 세션을 안전하게 만들지 못했습니다.' });
  }

  res.json({
    ok: true,
    message: '비밀번호가 안전하게 재설정되었습니다.',
    loginId: foundAccount.loginId,
    user: {
      id: foundAccount.id,
      loginId: foundAccount.loginId,
      nickname: foundAccount.nickname
    },
    newRecoveryCode // Show ONCE to user
  });
});

app.get('/api/auth/session', async (req, res) => {
  const session = await resolveSession(req);
  if (!session) {
    clearSessionCookie(res);
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    user: {
      id: session.userId,
      loginId: session.loginId,
      nickname: session.nickname
    }
  });
});

app.post('/api/auth/logout', async (req, res) => {
  const rawToken = parseCookies(req)[SESSION_COOKIE_NAME];
  if (rawToken) {
    const tokenHash = hashOpaqueSecret(rawToken);
    sessionStore.delete(tokenHash);
    if (SUPABASE_CONFIGURED) {
      await supabase.from('user_sessions').delete().eq('token_hash', tokenHash);
    }
  }
  clearSessionCookie(res);
  return res.json({ ok: true });
});

async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
  const inMemoryRoom = rooms.get(roomId);
  if (inMemoryRoom?.hostId === userId || participants.get(roomId)?.has(userId)) return true;
  if (!SUPABASE_CONFIGURED) return false;

  const [{ data: roomRow }, { data: participantRow }] = await Promise.all([
    supabase.from('rooms').select('host_id').eq('id', roomId).maybeSingle(),
    supabase
      .from('participants')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle()
  ]);
  return roomRow?.host_id === userId || Boolean(participantRow);
}

async function isRoomHost(roomId: string, userId: string): Promise<boolean> {
  const inMemoryRoom = rooms.get(roomId);
  if (inMemoryRoom) return inMemoryRoom.hostId === userId;
  if (!SUPABASE_CONFIGURED) return false;
  const { data } = await supabase.from('rooms').select('host_id').eq('id', roomId).maybeSingle();
  return data?.host_id === userId;
}

function isHostOnlyRoomMutation(req: Request): boolean {
  const suffix = req.path.split('/').slice(4).join('/');
  if (req.method === 'PATCH' && !suffix) return true;
  if (req.method === 'DELETE' && suffix === 'invites') return true;
  if (req.method !== 'POST') return false;
  return (
    suffix === 'invites' ||
    suffix === 'status' ||
    suffix === 'criteria/cluster' ||
    suffix === 'criteria/confirm' ||
    suffix === 'elimination/next' ||
    suffix === 'quick/start-vote' ||
    suffix === 'star-vote/resolve-tie' ||
    suffix === 'review/restart' ||
    suffix === 'close' ||
    suffix.startsWith('seed-')
  );
}

// Security boundary for every current and duplicate room route. The authenticated
// cookie is the only accepted identity; body/query identity fields are compatibility
// inputs only and can never change the actor.
app.use(async (req: AuthenticatedRequest, res, next) => {
  const isRoomApi = req.path === '/api/rooms' || req.path.startsWith('/api/rooms/');
  const isInviteMutation = req.path.startsWith('/api/invites/') && req.method !== 'GET';
  const isDemoApi = req.path.startsWith('/api/demo/');
  if (!isRoomApi && !isInviteMutation && !isDemoApi) return next();

  await requireAuth(req, res, async () => {
    const actorId = req.auth!.userId;
    const identityFields = ['userId', 'hostId', 'submitterId', 'evaluatorId', 'proposerId', 'createdBy'];
    req.body = req.body || {};
    for (const field of identityFields) {
      const supplied = req.body[field];
      if (supplied && supplied !== actorId) {
        return res.status(403).json({ error: '다른 사용자의 신원으로 요청할 수 없습니다.' });
      }
      req.body[field] = actorId;
    }
    (req.query as Record<string, unknown>).userId = actorId;

    if (isDemoApi) {
      if (IS_PRODUCTION) return res.status(404).json({ error: '존재하지 않는 기능입니다.' });
      return next();
    }

    if (!isRoomApi) return next();
    if (req.path === '/api/rooms') return next();
    if (req.path === '/api/rooms/purge-dead-rooms') {
      return res.status(404).json({ error: '운영에서 사용할 수 없는 기능입니다.' });
    }

    const match = req.path.match(/^\/api\/rooms\/([^/]+)(?:\/|$)/);
    const roomId = match?.[1];
    if (!roomId) return res.status(400).json({ error: '회의실 정보가 올바르지 않습니다.' });
    const roomSuffix = req.path.slice(`/api/rooms/${roomId}/`.length);
    if (roomSuffix.startsWith('seed-')) {
      return res.status(404).json({ error: '사용할 수 없는 기능입니다.' });
    }
    if (req.path === `/api/rooms/${roomId}/join`) {
      return res.status(403).json({ error: '유효한 초대 링크를 통해서만 참여할 수 있습니다.' });
    }
    if (!(await isRoomMember(roomId, actorId))) {
      return res.status(403).json({ error: '이 회의실에 접근할 권한이 없습니다.' });
    }
    if (isHostOnlyRoomMutation(req) && !(await isRoomHost(roomId, actorId))) {
      return res.status(403).json({ error: '방장만 실행할 수 있습니다.' });
    }
    next();
  });
});

function mapRoomRow(row: any): Room {
  const finalVoteStatus: FinalVoteStatus =
    row.final_vote_status === 'VOTING' ||
    row.final_vote_status === 'TIE_PENDING' ||
    row.final_vote_status === 'FINALIZED'
      ? row.final_vote_status
      : row.status === 'CLOSED'
        ? 'FINALIZED'
        : 'NOT_STARTED';
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    category: row.category || '기획',
    isPublic: false,
    maxParticipants: row.max_participants || 6,
    targetWinnerCount: row.target_winner_count || 1,
    isPinned: Boolean(row.is_pinned),
    hostId: row.host_id,
    status: row.status || 'IDEA_SUBMISSION',
    minResponseThreshold: row.min_response_threshold || 1,
    eliminationConfig: row.elimination_config || { countPerRound: 1, tieBreak: 'random' },
    deadlines: row.deadlines || {},
    createdAt: row.created_at || new Date().toISOString(),
    engineVersion: Number(row.engine_version || 1),
    decisionMode: row.decision_mode === 'QUICK' ? 'QUICK' : 'STRUCTURED',
    finalVoteStatus,
    tieCandidateIdeaIds: Array.isArray(row.tie_candidate_idea_ids) ? row.tie_candidate_idea_ids : [],
    tieSlots: Number(row.tie_slots || 0),
    currentRoundId: row.current_round_id || undefined,
    criteriaSetVersion: Math.max(1, Number(row.criteria_set_version || 1))
  };
}

async function hydrateRoomFromSupabase(roomId: string): Promise<Room | null> {
  const cached = rooms.get(roomId);
  if (cached) return cached;
  if (!SUPABASE_CONFIGURED) return null;

  const emptyRes = { data: null };
  const emptyArrRes = { data: [] };
  const [
    { data: roomRow },
    { data: ideaRows },
    { data: criterionRows },
    { data: proposalRows },
    { data: participantRows },
    { data: evaluationRows }
  ] = await withTimeout(
    Promise.all([
      supabase.from('rooms').select('*').eq('id', roomId).maybeSingle(),
      supabase.from('ideas').select('*').eq('room_id', roomId),
      supabase.from('criteria').select('*').eq('room_id', roomId),
      supabase.from('criterion_proposals').select('*').eq('room_id', roomId),
      supabase.from('participants').select('*').eq('room_id', roomId),
      supabase.from('evaluations').select('*').eq('room_id', roomId)
    ]),
    3500,
    [emptyRes, emptyArrRes, emptyArrRes, emptyArrRes, emptyArrRes, emptyArrRes]
  );
  if (!roomRow) return null;

  const room = mapRoomRow(roomRow);
  rooms.set(roomId, room);
  ideas.set(
    roomId,
    (ideaRows || []).map((row: any) => ({
      id: row.id,
      roomId: row.room_id,
      title: row.title,
      description: row.description || '',
      submitterId: row.submitter_id,
      submitterName: row.submitter_name || '익명 아이디어',
      attachmentUrl: row.attachment_url || undefined,
      pdfAttachmentUrl: row.pdf_attachment_url || undefined,
      tags: row.tags || [],
      status: row.status || 'ACTIVE',
      eliminatedRound: row.eliminated_round || undefined
    }))
  );
  criteria.set(
    roomId,
    (criterionRows || []).map((row: any) => ({
      id: row.id,
      roomId: row.room_id,
      name: row.name,
      description: row.description || '',
      sourceClusterId: row.source_cluster_id || undefined,
      confirmed: Boolean(row.confirmed)
    }))
  );
  criterionProposals.set(
    roomId,
    (proposalRows || []).map((row: any) => ({
      id: row.id,
      roomId: row.room_id,
      rawText: row.raw_text,
      proposerId: row.proposer_id || undefined,
      clusterId: row.cluster_id || undefined,
      isAiSuggested: Boolean(row.is_ai_suggested)
    }))
  );
  const participantMap = new Map<string, string>();
  (participantRows || []).forEach((row: any) => participantMap.set(row.user_id, row.nickname || '참여자'));
  participants.set(roomId, participantMap);
  evaluations.set(
    roomId,
    (evaluationRows || []).map((row: any) => ({
      id: row.id,
      roomId: row.room_id,
      ideaId: row.idea_id,
      evaluatorId: row.evaluator_id,
      decision: row.decision,
      excludedCriterionIds: row.excluded_criterion_ids || [],
      criteriaEvaluations: row.criteria_evaluations || {},
      reasonText: row.reason_text || '',
      reasonType: row.reason_type || 'PREFERENCE',
      round: row.round || 1,
      roundId: row.round_id || undefined
    }))
  );
  await loadDecisionRounds(roomId);

  if (SUPABASE_CONFIGURED) {
    const voteRound =
      getCurrentDecisionRound(room) ||
      [...(decisionRoundsMap.get(roomId) || [])].reverse()[0];
    if (voteRound) {
      const { data: voteRows } = await supabase
        .from('decision_votes')
        .select('user_id,selected_idea_ids')
        .eq('round_id', voteRound.id);
      if (voteRows) {
        starVotesMap.set(
          roomId,
          new Map(voteRows.map((row: any) => [
            String(row.user_id),
            Array.isArray(row.selected_idea_ids) ? row.selected_idea_ids.map(String) : []
          ]))
        );
      }
    }
  }
  return room;
}

/**
 * Toggle Room Pin
 */
app.post('/api/rooms/:id/pin', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const room = await hydrateRoomFromSupabase(id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });

  const nextPinned = !room.isPinned;
  if (nextPinned) {
    const currentPinned = Array.from(rooms.values()).filter(
      candidate => candidate.isPinned && candidate.hostId === req.auth!.userId && candidate.id !== id
    ).length;
    if (currentPinned >= 3) {
      return res.status(409).json({ error: '상단 고정은 최대 3개까지만 가능합니다.' });
    }
  }

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('rooms').update({ is_pinned: nextPinned }).eq('id', id);
    if (error) return res.status(503).json({ error: '고정 상태를 저장하지 못했습니다.' });
  }
  room.isPinned = nextPinned;
  res.json({ success: true, isPinned: room.isPinned });
});

app.post('/api/rooms/:id/hide', async (req: AuthenticatedRequest, res) => {
  const { error } = SUPABASE_CONFIGURED
    ? await supabase
        .from('participants')
        .update({ hidden_at: new Date().toISOString() })
        .eq('room_id', req.params.id)
        .eq('user_id', req.auth!.userId)
    : { error: null };
  if (error) return res.status(503).json({ error: '회의실 숨김 상태를 저장하지 못했습니다.' });
  return res.json({ success: true });
});

app.delete('/api/rooms/:id/hide', async (req: AuthenticatedRequest, res) => {
  const { error } = SUPABASE_CONFIGURED
    ? await supabase
        .from('participants')
        .update({ hidden_at: null })
        .eq('room_id', req.params.id)
        .eq('user_id', req.auth!.userId)
    : { error: null };
  if (error) return res.status(503).json({ error: '회의실 숨김 상태를 해제하지 못했습니다.' });
  return res.json({ success: true });
});

app.patch('/api/rooms/:id/me', async (req: AuthenticatedRequest, res) => {
  const nickname = String(req.body.nickname || '').trim().slice(0, 6);
  if (!nickname) return res.status(400).json({ error: '닉네임을 입력해 주세요.' });

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase
      .from('participants')
      .update({ nickname })
      .eq('room_id', req.params.id)
      .eq('user_id', req.auth!.userId);
    if (error) return res.status(503).json({ error: '닉네임을 저장하지 못했습니다.' });
  }
  participants.get(req.params.id)?.set(req.auth!.userId, nickname);
  return res.json({ success: true, nickname });
});

/**
 * Create / Refresh 3-Minute Room Invite Token
 */
app.post('/api/rooms/:id/invites', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  const room = await hydrateRoomFromSupabase(id);
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
  const inviteToken = `inv_${crypto.randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(now.getTime() + 3 * 60 * 1000).toISOString(); // EXACTLY 3 MINUTES

  const inviteRecord = {
    id: `invite-${crypto.randomUUID()}`,
    roomId: id,
    inviteToken,
    createdBy: userId || room?.hostId || 'host',
    expiresAt,
    isActive: true,
    createdAt: now.toISOString()
  };

  if (SUPABASE_CONFIGURED) {
    try {
      const { error } = await supabase.from('room_invites').insert({
        room_id: id,
        invite_token: null,
        invite_token_hash: hashOpaqueSecret(inviteToken),
        created_by: req.auth!.userId,
        expires_at: expiresAt,
        is_active: true
      });
      if (error) {
        console.warn('Supabase DB room_invites insert notice:', error.message);
      }
    } catch (err) {
      console.warn('Supabase DB room_invites exception notice:', err);
    }
  }
  roomInvites.set(inviteToken, inviteRecord);

  res.json({ success: true, invite: inviteRecord });
});

/**
 * Deactivate Room Invite Token
 */
app.delete('/api/rooms/:id/invites', async (req, res) => {
  const { id } = req.params;
  for (const [token, inv] of roomInvites.entries()) {
    if (inv.roomId === id && inv.isActive) {
      inv.isActive = false;
    }
  }
  if (SUPABASE_CONFIGURED) {
    try {
      const { error } = await supabase
        .from('room_invites')
        .update({ is_active: false })
        .eq('room_id', id)
        .eq('is_active', true);
      if (error) {
        console.warn('Supabase DB room_invites update notice:', error.message);
      }
    } catch (err) {
      console.warn('Supabase DB room_invites delete exception notice:', err);
    }
  }
  res.json({ success: true, message: '초대 링크가 비활성화되었습니다.' });
});

/**
 * Validate Invite Token & Fetch Room Landing Details (Strict 3-minute server clock check)
 */
app.get('/api/invites/:token', async (req, res) => {
  const { token } = req.params;
  let inv = roomInvites.get(token);

  if (!inv && SUPABASE_CONFIGURED) {
    const { data } = await supabase
      .from('room_invites')
      .select('*')
      .eq('invite_token_hash', hashOpaqueSecret(token))
      .maybeSingle();
    if (data) {
      inv = {
        id: data.id,
        roomId: data.room_id,
        inviteToken: token,
        createdBy: data.created_by,
        expiresAt: data.expires_at,
        isActive: Boolean(data.is_active),
        createdAt: data.created_at
      };
      roomInvites.set(token, inv);
    }
  }

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

  const room = await hydrateRoomFromSupabase(inv.roomId);

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
app.post('/api/invites/:token/join', async (req: AuthenticatedRequest, res) => {
  const { token } = req.params;
  const userId = req.auth!.userId;
  const nickname = req.auth!.nickname;

  if (!userId) {
    return res.status(400).json({ error: '사용자 ID가 필요합니다.' });
  }

  let inv = roomInvites.get(token);
  if (!inv && SUPABASE_CONFIGURED) {
    const { data } = await supabase
      .from('room_invites')
      .select('*')
      .eq('invite_token_hash', hashOpaqueSecret(token))
      .maybeSingle();
    if (data) {
      inv = {
        id: data.id,
        roomId: data.room_id,
        inviteToken: token,
        createdBy: data.created_by,
        expiresAt: data.expires_at,
        isActive: Boolean(data.is_active),
        createdAt: data.created_at
      };
      roomInvites.set(token, inv);
    }
  }
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

  const room = await hydrateRoomFromSupabase(inv.roomId) || (inv.roomId === 'room-gominhajo' ? {
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

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('participants').upsert(
      { room_id: inv.roomId, user_id: userId, nickname },
      { onConflict: 'room_id,user_id' }
    );
    if (error) return res.status(503).json({ error: '참여 정보를 안전하게 저장하지 못했습니다.' });
  }
  pMap.set(userId, nickname);

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
app.post('/api/rooms/:id/status', async (req, res) => {
  const { id } = req.params;
  const status = req.body.status as RoomStatus;
  const room = await hydrateRoomFromSupabase(id);
  if (room.status === status) {
    return res.json({ success: true, status: room.status, message: '이미 해당 단계로 이동해 있습니다.' });
  }

  const allowedNext: Partial<Record<RoomStatus, RoomStatus[]>> = {
    DRAFT: ['IDEA_SUBMISSION'],
    IDEA_SUBMISSION: ['CRITERIA_PROPOSAL'],
    CRITERIA_PROPOSAL: [],
    ELIMINATION: ['FINAL_VOTE', 'CLOSED', 'CRITERIA_PROPOSAL'],
    FINAL_VOTE: ['CLOSED'],
    EVALUATION_ROUND_2: ['CLOSED']
  };
  if (!status || !allowedNext[room.status]?.includes(status)) {
    return res.status(409).json({
      error: `현재 단계(${room.status})에서 요청한 단계(${status || '없음'})로 이동할 수 없습니다.`
    });
  }

  let transitionRound: DecisionRound | undefined;
  if (room.status === 'EVALUATION' && status === 'ELIMINATION') {
    transitionRound = await ensureDecisionRound(
      room,
      (ideas.get(id) || []).filter(idea => idea.status === 'ACTIVE')
    );
    const frozenEvaluators = await loadOrCreatePhaseParticipants(
      id,
      `EVALUATION:${transitionRound.id}`
    );
    const completedEvaluatorIds = new Set(
      (evaluations.get(id) || [])
        .filter(evaluation => evaluation.roundId === transitionRound!.id)
        .map(evaluation => evaluation.evaluatorId)
    );
    const missingEvaluatorCount = Array.from(frozenEvaluators)
      .filter(participantId => !completedEvaluatorIds.has(participantId)).length;
    if (missingEvaluatorCount > 0) {
      return res.status(409).json({
        error: `아직 ${missingEvaluatorCount}명의 평가가 완료되지 않았습니다. 중간 결과 없이 전원 평가가 끝난 뒤 최종 투표를 시작할 수 있습니다.`
      });
    }
    const activeCandidateCount = (ideas.get(id) || [])
      .filter(idea => idea.status === 'ACTIVE').length;
    if (activeCandidateCount < Math.max(2, room.targetWinnerCount || 1)) {
      return res.status(409).json({
        error: '최종 익명 투표를 시작하려면 선정 수보다 충분한 활성 후보가 필요합니다.'
      });
    }
  }

  // All transition guards run before the persistent write. A failed guard must
  // never leave Supabase one step ahead of the in-memory state.
  if (SUPABASE_CONFIGURED) {
    const roomUpdate: Record<string, unknown> = { status };
    if (status === 'ELIMINATION') {
      roomUpdate.final_vote_status = 'VOTING';
      roomUpdate.tie_candidate_idea_ids = [];
      roomUpdate.tie_slots = 0;
    }
    const { data: changedRows, error } = await supabase
      .from('rooms')
      .update(roomUpdate)
      .eq('id', id)
      .eq('status', room.status)
      .select('id');
    if (error) return res.status(503).json({ error: '단계 변경을 저장하지 못했습니다.' });
    if (!changedRows || changedRows.length !== 1) {
      // Re-query Supabase DB to check if the room status was already updated to the target status
      const { data: latestDbRoom } = await supabase.from('rooms').select('status').eq('id', id).maybeSingle();
      if (latestDbRoom && latestDbRoom.status === status) {
        room.status = status;
        rooms.set(id, room);
        return res.json({ success: true, status: room.status, message: '이미 해당 단계로 이동되어 있습니다.' });
      }
      return res.status(409).json({ error: '다른 참여자가 먼저 단계를 변경했거나 이미 변경되었습니다. 새로고침 후 다시 확인해 주세요.' });
    }
  }
  room.status = status;
  if (status === 'CRITERIA_PROPOSAL') {
    await loadOrCreatePhaseParticipants(id, criteriaPhase(room, 'CRITERIA_PROPOSAL'));
  }
  if (status === 'EVALUATION') {
    const round = await ensureDecisionRound(room, (ideas.get(id) || []).filter(idea => idea.status === 'ACTIVE'));
    await loadOrCreatePhaseParticipants(id, `EVALUATION:${round.id}`);
  }
  if (status === 'ELIMINATION') {
    const round = transitionRound || await ensureDecisionRound(
      room,
      (ideas.get(id) || []).filter(idea => idea.status === 'ACTIVE')
    );
    room.finalVoteStatus = 'VOTING';
    room.tieCandidateIdeaIds = [];
    room.tieSlots = 0;
    await loadOrCreatePhaseParticipants(id, `FINAL_VOTE:${round.id}`);
  }
  rooms.set(id, room);
  res.json({ success: true, status: room.status });
});

/**
 * 5. Submit an Idea (Public)
 */
app.post('/api/rooms/:id/ideas', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { title, description, attachmentUrl, pdfAttachmentUrl, tags } = req.body;
  const submitterId = req.auth!.userId;

  const room = await hydrateRoomFromSupabase(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'IDEA_SUBMISSION') {
    return res.status(400).json({ error: '현재 아이디어 등록 단계가 아닙니다.' });
  }

  if (typeof title !== 'string' || !title.trim() || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: '아이디어 제목과 설명은 필수입니다.' });
  }
  if (title.trim().length > 120 || description.trim().length > 10000) {
    return res.status(400).json({ error: '아이디어 제목 또는 설명이 허용 길이를 초과했습니다.' });
  }
  let safeAttachmentUrl: string | undefined;
  try {
    safeAttachmentUrl = normalizeOptionalHttpUrl(attachmentUrl);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : '참고 링크 형식이 올바르지 않습니다.' });
  }
  const safePdfName = typeof pdfAttachmentUrl === 'string' ? pdfAttachmentUrl.trim() : '';
  if (safePdfName.length > 255) {
    return res.status(400).json({ error: '참고 파일 이름이 너무 깁니다.' });
  }
  const safeTags = Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean).slice(0, 10)
    : [];
  if (safeTags.some(tag => tag.length > 40)) {
    return res.status(400).json({ error: '태그는 각각 40자 이하여야 합니다.' });
  }

  const roomIdeas = ideas.get(id) || [];
  if (roomIdeas.filter(idea => idea.submitterId === submitterId).length >= 5) {
    return res.status(400).json({ error: '아이디어는 참여자당 최대 5개까지 등록할 수 있습니다.' });
  }

  const newIdea: Idea = {
    id: `idea-${crypto.randomUUID()}`,
    roomId: id,
    title: title.trim(),
    description: description.trim(),
    submitterId,
    submitterName: `익명 아이디어 #${roomIdeas.length + 1}`,
    attachmentUrl: safeAttachmentUrl,
    pdfAttachmentUrl: safePdfName || undefined,
    tags: safeTags,
    status: 'ACTIVE',
  };

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('ideas').insert({
      id: newIdea.id,
      room_id: id,
      title: newIdea.title,
      description: newIdea.description,
      submitter_id: submitterId,
      submitter_name: newIdea.submitterName,
      attachment_url: newIdea.attachmentUrl || null,
      pdf_attachment_url: newIdea.pdfAttachmentUrl || null,
      tags: newIdea.tags || [],
      status: newIdea.status
    });
    if (error) return res.status(503).json({ error: '아이디어를 안전하게 저장하지 못했습니다.' });
  } else if (IS_PRODUCTION) {
    return res.status(503).json({ error: '아이디어 저장소가 준비되지 않았습니다.' });
  }

  roomIdeas.push(newIdea);
  
  ideas.set(id, roomIdeas);
  res.status(201).json(newIdea);
});

/**
 * Update an Idea (Public / Owner only)
 */
app.put('/api/rooms/:id/ideas/:ideaId', async (req: AuthenticatedRequest, res) => {
  const { id, ideaId } = req.params;
  const { title, description, attachmentUrl, pdfAttachmentUrl, tags } = req.body;
  const submitterId = req.auth!.userId;

  const room = await hydrateRoomFromSupabase(id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (room.status !== 'IDEA_SUBMISSION') {
    return res.status(409).json({ error: '아이디어 제출 단계에서만 수정할 수 있습니다.' });
  }

  const roomIdeas = ideas.get(id) || [];
  const existingIdeaIndex = roomIdeas.findIndex(i => i.id === ideaId);

  if (existingIdeaIndex === -1) {
    return res.status(404).json({ error: '아이디어를 찾을 수 없습니다.' });
  }

  const existingIdea = roomIdeas[existingIdeaIndex];
  if (existingIdea.submitterId !== submitterId) {
    return res.status(403).json({ error: '작성자 본인만 수정할 수 있습니다.' });
  }
  const nextTitle = typeof title === 'string' ? title.trim() : existingIdea.title;
  const nextDescription = typeof description === 'string' ? description.trim() : existingIdea.description;
  if (!nextTitle || !nextDescription || nextTitle.length > 120 || nextDescription.length > 10000) {
    return res.status(400).json({ error: '아이디어 제목과 설명을 허용 길이에 맞게 입력해 주세요.' });
  }
  let safeAttachmentUrl = existingIdea.attachmentUrl;
  if (attachmentUrl !== undefined) {
    try {
      safeAttachmentUrl = normalizeOptionalHttpUrl(attachmentUrl);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : '참고 링크 형식이 올바르지 않습니다.' });
    }
  }
  const safePdfName = pdfAttachmentUrl !== undefined
    ? (typeof pdfAttachmentUrl === 'string' ? pdfAttachmentUrl.trim() : '')
    : existingIdea.pdfAttachmentUrl;
  if ((safePdfName || '').length > 255) {
    return res.status(400).json({ error: '참고 파일 이름이 너무 깁니다.' });
  }
  const safeTags = tags === undefined
    ? existingIdea.tags
    : Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean).slice(0, 10)
      : [];
  if ((safeTags || []).some(tag => tag.length > 40)) {
    return res.status(400).json({ error: '태그는 각각 40자 이하여야 합니다.' });
  }

  const updatedIdea: Idea = {
    ...existingIdea,
    title: nextTitle,
    description: nextDescription,
    attachmentUrl: safeAttachmentUrl,
    pdfAttachmentUrl: safePdfName || undefined,
    tags: safeTags,
  };

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase
      .from('ideas')
      .update({
        title: updatedIdea.title,
        description: updatedIdea.description,
        attachment_url: updatedIdea.attachmentUrl || null,
        pdf_attachment_url: updatedIdea.pdfAttachmentUrl || null,
        tags: updatedIdea.tags || []
      })
      .eq('id', ideaId)
      .eq('room_id', id)
      .eq('submitter_id', submitterId);
    if (error) return res.status(503).json({ error: '아이디어 수정 내용을 안전하게 저장하지 못했습니다.' });
  }
  roomIdeas[existingIdeaIndex] = updatedIdea;
  ideas.set(id, roomIdeas);
  res.json(updatedIdea);
});

/**
 * Delete an Idea (Public / Owner only)
 */
app.delete('/api/rooms/:id/ideas/:ideaId', async (req: AuthenticatedRequest, res) => {
  const { id, ideaId } = req.params;
  const submitterId = req.auth!.userId;

  const room = await hydrateRoomFromSupabase(id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (room.status !== 'IDEA_SUBMISSION') {
    return res.status(409).json({ error: '아이디어 제출 단계에서만 삭제할 수 있습니다.' });
  }

  const roomIdeas = ideas.get(id) || [];
  const existingIdeaIndex = roomIdeas.findIndex(i => i.id === ideaId);

  if (existingIdeaIndex === -1) {
    return res.status(404).json({ error: '아이디어를 찾을 수 없습니다.' });
  }

  const existingIdea = roomIdeas[existingIdeaIndex];
  if (existingIdea.submitterId !== submitterId) {
    return res.status(403).json({ error: '작성자 본인만 삭제할 수 있습니다.' });
  }

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase
      .from('ideas')
      .delete()
      .eq('id', ideaId)
      .eq('room_id', id)
      .eq('submitter_id', submitterId);
    if (error) return res.status(503).json({ error: '아이디어를 안전하게 삭제하지 못했습니다.' });
  }
  roomIdeas.splice(existingIdeaIndex, 1);
  ideas.set(id, roomIdeas);
  res.json({ success: true, deletedId: ideaId });
});

/**
 * Mark 1단계 Idea Registration Step as Completed for a user
 */
app.post('/api/rooms/:id/ideas/complete', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const userId = req.auth!.userId;
  if (!ideaCompletedUsersMap.has(id)) {
    ideaCompletedUsersMap.set(id, new Set());
  }
  ideaCompletedUsersMap.get(id)!.add(userId);
  if (SUPABASE_CONFIGURED) {
    try {
      const { error } = await supabase.from('phase_completions').upsert(
        {
          room_id: id,
          phase: 'IDEA_SUBMISSION',
          user_id: userId,
          completed_at: new Date().toISOString()
        },
        { onConflict: 'room_id,phase,user_id' }
      );
      if (error) {
        console.warn('Supabase DB phase_completions upsert notice:', error.message);
      }
    } catch (err) {
      console.warn('Supabase DB phase_completions exception notice:', err);
    }
  }
  const count = ideaCompletedUsersMap.get(id)!.size;
  res.json({ success: true, count });
});

/**
 * Unmark 1단계 Idea Registration Step for a user (returning to registration)
 */
app.post('/api/rooms/:id/ideas/uncomplete', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const userId = req.auth!.userId;
  if (ideaCompletedUsersMap.has(id)) {
    ideaCompletedUsersMap.get(id)!.delete(userId);
  }
  if (SUPABASE_CONFIGURED) {
    try {
      const { error } = await supabase
        .from('phase_completions')
        .delete()
        .eq('room_id', id)
        .eq('phase', 'IDEA_SUBMISSION')
        .eq('user_id', userId);
      if (error) {
        console.warn('Supabase DB phase_completions delete notice:', error.message);
      }
    } catch (err) {
      console.warn('Supabase DB phase_completions delete exception notice:', err);
    }
  }
  const count = ideaCompletedUsersMap.get(id)?.size || 0;
  res.json({ success: true, count });
});

/**
 * Mark 2단계 criterion proposal entry as completed.
 * Other members' proposals stay hidden until every participant in the
 * phase snapshot has completed.
 */
app.post('/api/rooms/:id/criteria/complete', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const userId = req.auth!.userId;
  const room = await hydrateRoomFromSupabase(id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (room.status !== 'CRITERIA_PROPOSAL') {
    return res.status(409).json({ error: '현재 평가 기준 제안 단계가 아닙니다.' });
  }

  const phase = criteriaPhase(room, 'CRITERIA_PROPOSAL');
  const completionKey = criteriaCompletionCacheKey(room);
  const snapshot = await loadOrCreatePhaseParticipants(id, phase);
  if (!snapshot.has(userId)) {
    return res.status(403).json({ error: '이 단계의 참여 대상이 아닙니다.' });
  }

  let completed = criteriaCompletedUsersMap.get(completionKey);
  if (!completed) {
    completed = new Set<string>();
    criteriaCompletedUsersMap.set(completionKey, completed);
  }
  completed.add(userId);

  if (SUPABASE_CONFIGURED) {
    try {
      const { error } = await supabase.from('phase_completions').upsert(
        {
          room_id: id,
          phase,
          user_id: userId,
          completed_at: new Date().toISOString()
        },
        { onConflict: 'room_id,phase,user_id' }
      );
      if (error) {
        console.warn('Supabase DB phase_completions upsert notice:', error.message);
      }
    } catch (err) {
      console.warn('Supabase DB phase_completions exception notice:', err);
    }
  }

  const completedCount = Array.from(completed).filter(idValue => snapshot.has(idValue)).length;
  res.json({
    success: true,
    count: completedCount,
    expectedCount: snapshot.size,
    revealed: completedCount >= snapshot.size
  });
});

app.post('/api/rooms/:id/criteria/uncomplete', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const userId = req.auth!.userId;
  const room = await hydrateRoomFromSupabase(id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  const phase = criteriaPhase(room, 'CRITERIA_PROPOSAL');
  const completionKey = criteriaCompletionCacheKey(room);
  criteriaCompletedUsersMap.get(completionKey)?.delete(userId);
  if (SUPABASE_CONFIGURED) {
    try {
      const { error } = await supabase
        .from('phase_completions')
        .delete()
        .eq('room_id', id)
        .eq('phase', phase)
        .eq('user_id', userId);
      if (error) {
        console.warn('Supabase DB phase_completions delete notice:', error.message);
      }
    } catch (err) {
      console.warn('Supabase DB phase_completions exception notice:', err);
    }
  }
  res.json({ success: true, count: criteriaCompletedUsersMap.get(completionKey)?.size || 0 });
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
 * 1. Get room list (Summary representation - Filtered by authorization for user privacy)
 */
app.get('/api/rooms', async (req: AuthenticatedRequest, res) => {
  const reqUserId = req.auth!.userId;

  if (SUPABASE_CONFIGURED) {
    try {
      const { data: hostRows, error: hostError } = await supabase
        .from('rooms')
        .select('*')
        .eq('host_id', reqUserId);

      if (hostError) {
        console.error('Supabase host rooms query error:', hostError.message);
      }

      let memberRows: any[] | null = null;
      const { data: mRowsWithHide, error: memberHideError } = await supabase
        .from('participants')
        .select('room_id, hidden_at')
        .eq('user_id', reqUserId);

      if (memberHideError) {
        // Fallback: If hidden_at column doesn't exist yet in participants table, query room_id only
        const { data: mRowsOnly, error: mError } = await supabase
          .from('participants')
          .select('room_id')
          .eq('user_id', reqUserId);
        if (mError) {
          console.error('Supabase member participants query error:', mError.message);
        } else {
          memberRows = mRowsOnly;
        }
      } else {
        memberRows = mRowsWithHide;
      }

      const roomIds = Array.from(
        new Set([
          ...(hostRows || []).map((row: any) => row.id),
          ...(memberRows || []).map((row: any) => row.room_id)
        ])
      );

      let memberRoomRows: any[] = [];
      if (roomIds.length) {
        const { data: rRows, error: rError } = await supabase
          .from('rooms')
          .select('*')
          .in('id', roomIds);
        if (rError) {
          console.error('Supabase member rooms query error:', rError.message);
        } else if (rRows) {
          memberRoomRows = rRows;
        }
      }

      const hiddenByRoom = new Map((memberRows || []).map((row: any) => [row.room_id, row.hidden_at]));
      const counts = new Map<string, number>();
      if (roomIds.length) {
        const { data: participantRows } = await supabase.from('participants').select('room_id').in('room_id', roomIds);
        (participantRows || []).forEach((row: any) => counts.set(row.room_id, (counts.get(row.room_id) || 0) + 1));
      }

      return res.json(
        memberRoomRows.map((row: any) => ({
          id: row.id,
          title: row.title,
          description: row.description || '',
          category: row.category || '기획',
          isPublic: false,
          maxParticipants: row.max_participants || 6,
          targetWinnerCount: row.target_winner_count || 1,
          isPinned: Boolean(row.is_pinned),
          status: row.status || 'IDEA_SUBMISSION',
          decisionMode: row.decision_mode === 'QUICK' ? 'QUICK' : 'STRUCTURED',
          ideasCount: 0,
          evaluatorsCount: counts.get(row.id) || 1,
          minResponseThreshold: row.min_response_threshold || 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at || row.created_at,
          hostId: row.host_id,
          isHost: row.host_id === reqUserId,
          isJoined: true,
          myRole: row.host_id === reqUserId ? '방장' : '참여자',
          isHidden: Boolean(hiddenByRoom.get(row.id))
        }))
      );
    } catch (err) {
      console.error('Unexpected Supabase DB rooms query error:', err);
    }
  }

  const list = Array.from(rooms.values())
    .filter(r => r.hostId === reqUserId || participants.get(r.id)?.has(reqUserId))
    .map(r => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category || '기획',
      isPublic: false,
      maxParticipants: r.maxParticipants || 6,
      targetWinnerCount: r.targetWinnerCount || 1,
      isPinned: r.isPinned || false,
      status: r.status,
      decisionMode: r.decisionMode || 'STRUCTURED',
      ideasCount: (ideas.get(r.id) || []).length,
      evaluatorsCount: participants.get(r.id)?.size || 1,
      minResponseThreshold: r.minResponseThreshold,
      createdAt: r.createdAt,
      hostId: r.hostId,
      isHost: r.hostId === reqUserId,
      isJoined: true,
      myRole: r.hostId === reqUserId ? '방장' : '참여자',
      isHidden: false
    }));
  return res.json(list);
});

/**
 * 2. Create room
 */
app.post('/api/rooms', async (req: AuthenticatedRequest, res) => {
  const { title, description, hostId, minResponseThreshold, eliminationConfig, deadlines, category, maxParticipants, isPublic, targetWinnerCount, decisionMode } = req.body;
  
  if (!title) {
    return res.status(400).json({ error: '방 제목은 필수입니다.' });
  }

  const newId = `room-${Math.random().toString(36).substr(2, 9)}`;
  const newRoom: Room = {
    id: newId,
    title,
    description: description || '',
    category: category || '기획',
    isPublic: false,
    maxParticipants: Math.min(Math.max(Number(maxParticipants) || 4, 1), 6), // 최대 6명 제한
    targetWinnerCount: Math.min(Math.max(Number(targetWinnerCount) || 1, 1), 3), // 최소 1개 ~ 최대 3개
    isPinned: false,
    hostId: req.auth!.userId,
    status: 'IDEA_SUBMISSION', // Starts in IDEA_SUBMISSION state
    minResponseThreshold: minResponseThreshold !== undefined ? Number(minResponseThreshold) : Math.min(Number(maxParticipants) || 4, 6),
    eliminationConfig: {
      countPerRound: eliminationConfig?.countPerRound || 1,
      ratioPerRound: eliminationConfig?.ratioPerRound,
      tieBreak: eliminationConfig?.tieBreak || 'random',
    },
    deadlines: deadlines || {},
    createdAt: new Date().toISOString(),
    engineVersion: 2,
    decisionMode: (decisionMode || 'STRUCTURED') as DecisionMode
  };

  if (SUPABASE_CONFIGURED) {
    const { error: roomError } = await supabase.from('rooms').insert({
      id: newId,
      title: newRoom.title,
      description: newRoom.description,
      category: newRoom.category,
      is_public: false,
      max_participants: newRoom.maxParticipants,
      target_winner_count: newRoom.targetWinnerCount,
      is_pinned: false,
      host_id: newRoom.hostId,
      status: newRoom.status,
      min_response_threshold: newRoom.minResponseThreshold,
      elimination_config: newRoom.eliminationConfig,
      deadlines: newRoom.deadlines
    });
    if (roomError) {
      console.error('Supabase DB room insert error:', roomError.message);
      return res.status(503).json({ error: '회의실을 DB에 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const { error: participantError } = await supabase.from('participants').insert({
      room_id: newId,
      user_id: newRoom.hostId,
      nickname: req.auth!.nickname || '방장'
    });
    if (participantError) {
      console.error('Supabase DB host participant insert error:', participantError.message);
      await supabase.from('rooms').delete().eq('id', newId);
      return res.status(503).json({ error: '방장 참여자 정보를 저장하지 못해 회의실 생성을 취소했습니다.' });
    }
  } else if (IS_PRODUCTION) {
    return res.status(503).json({ error: '회의실 저장소가 준비되지 않았습니다.' });
  }

  rooms.set(newId, newRoom);
  ideas.set(newId, []);
  criterionProposals.set(newId, []);
  criteria.set(newId, []);
  evaluations.set(newId, []);
  eliminationRounds.set(newId, []);
  participants.set(newId, new Map([[newRoom.hostId, req.auth!.nickname || '방장']]));

  res.status(201).json(newRoom);
});

/**
 * On-Demand Seed Demo Data API (Executes seedData idempotently when requested by user)
 */
app.post('/api/demo/seed', (_req, res) => {
  res.status(404).json({ error: '사용할 수 없는 기능입니다.' });
});

/**
 * Update room settings (Host only)
 */
app.patch('/api/rooms/:id', async (req, res) => {
  const { id } = req.params;
  const room = await hydrateRoomFromSupabase(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  const { title, description, category, maxParticipants, targetWinnerCount, minResponseThreshold } = req.body;

  if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 120)) {
    return res.status(400).json({ error: '방 제목은 1~120자로 입력해 주세요.' });
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 5000)) {
    return res.status(400).json({ error: '방 설명은 5,000자 이내로 입력해 주세요.' });
  }

  if (title !== undefined) room.title = title;
  if (description !== undefined) room.description = description;
  if (category !== undefined) room.category = category;
  if (maxParticipants !== undefined) room.maxParticipants = Math.min(Math.max(Number(maxParticipants) || 4, 1), 6);
  if (targetWinnerCount !== undefined) room.targetWinnerCount = Math.min(Math.max(Number(targetWinnerCount) || 1, 1), 3);
  if (minResponseThreshold !== undefined) room.minResponseThreshold = Number(minResponseThreshold) || 3;

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('rooms').update({
      title: room.title,
      description: room.description,
      category: room.category,
      max_participants: room.maxParticipants,
      target_winner_count: room.targetWinnerCount,
      min_response_threshold: room.minResponseThreshold
    }).eq('id', id);
    if (error) return res.status(503).json({ error: '방 설정을 안전하게 저장하지 못했습니다.' });
  } else if (IS_PRODUCTION) {
    return res.status(503).json({ error: '방 설정 저장소를 사용할 수 없습니다.' });
  }

  rooms.set(id, room);
  res.json({ success: true, room });
});

/**
 * Automated Dead Rooms Batch Purge Endpoint
 * Deletes rooms from DB only when ALL participants have deleted/left for > 30 days
 */
app.post('/api/rooms/purge-dead-rooms', async (req, res) => {
  try {
    const { data: count, error } = await supabase.rpc('purge_dead_rooms');
    if (error && error.code !== 'PGRST202') throw error;
    res.json({ success: true, purgedCount: count || 0, message: `성공적으로 ${count || 0}개의 만료된 회의실 데이터를 정제했습니다.` });
  } catch (err: any) {
    console.warn('Purge dead rooms notice:', err?.message || err);
    res.json({ success: true, purgedCount: 0 });
  }
});

/**
 * 3. Fetch detailed room info with strict anonymity gate filters
 */
app.get('/api/rooms/:id', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const userId = req.auth!.userId;

  const room = await hydrateRoomFromSupabase(id);
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

  const allRoomEvals = evaluations.get(id) || [];
  const roomEvals = room.currentRoundId
    ? allRoomEvals.filter(evaluation => !evaluation.roundId || evaluation.roundId === room.currentRoundId)
    : allRoomEvals;
  const roomRounds = eliminationRounds.get(id) || [];
  const roomDecisionRounds = await loadDecisionRounds(id);
  const activeDecisionRound = getCurrentDecisionRound(room);

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

  // Calculate participants who have explicitly completed Stage 1 by entering gate
  const uniqueSubmitters = new Set(roomIdeas.map(i => i.submitterId || (i as any).participantId || (i as any).userId || (i as any).email || (i as any).createdBy).filter(Boolean));
  if (SUPABASE_CONFIGURED) {
    const { data: completionRows } = await supabase
      .from('phase_completions')
      .select('user_id')
      .eq('room_id', id)
      .eq('phase', 'IDEA_SUBMISSION');
    if (completionRows) {
      ideaCompletedUsersMap.set(id, new Set(completionRows.map((row: any) => row.user_id)));
    }
  }
  const ideaCompletedSet = ideaCompletedUsersMap.get(id) || new Set<string>();
  const completedParticipantsCount = ideaCompletedSet.size;
  const participantCount = Math.max(1, roomParticipants?.size || 1);
  const ideasRevealed =
    room.status !== 'IDEA_SUBMISSION' || completedParticipantsCount >= participantCount;
  const visibleIdeas = (ideasRevealed
    ? roomIdeas
    : roomIdeas.filter(idea => idea.submitterId === userId)
  ).map((idea, index) => {
    if (idea.submitterId === userId) {
      return { ...idea, submitterName: '내 아이디어' };
    }
    const { submitterId: _privateSubmitterId, ...publicIdea } = idea;
    return {
      ...publicIdea,
      submitterId: '',
      submitterName: `익명 아이디어 #${index + 1}`
    } as Idea;
  });

  if (SUPABASE_CONFIGURED) {
    const criteriaProposalPhase = criteriaPhase(room, 'CRITERIA_PROPOSAL');
    const { data: criteriaCompletionRows } = await supabase
      .from('phase_completions')
      .select('user_id')
      .eq('room_id', id)
      .eq('phase', criteriaProposalPhase);
    if (criteriaCompletionRows) {
      criteriaCompletedUsersMap.set(
        criteriaCompletionCacheKey(room),
        new Set(criteriaCompletionRows.map((row: any) => String(row.user_id)))
      );
    }
  }
  const criteriaParticipantSnapshot = room.status === 'IDEA_SUBMISSION'
    ? new Set(roomParticipants?.keys() || [])
    : await loadOrCreatePhaseParticipants(id, criteriaPhase(room, 'CRITERIA_PROPOSAL'));
  const criteriaCompletedSet =
    criteriaCompletedUsersMap.get(criteriaCompletionCacheKey(room)) || new Set<string>();
  const criteriaCompletedParticipantsCount = Array.from(criteriaCompletedSet)
    .filter(completedUserId => criteriaParticipantSnapshot.has(completedUserId)).length;
  const criteriaExpectedParticipantsCount = Math.max(1, criteriaParticipantSnapshot.size);
  const criteriaProposalsRevealed =
    room.status !== 'CRITERIA_PROPOSAL' ||
    criteriaCompletedParticipantsCount >= criteriaExpectedParticipantsCount;
  const visibleProposals = (criteriaProposalsRevealed
    ? roomProposals
    : roomProposals.filter(proposal => proposal.proposerId === userId)
  ).map(proposal => {
    if (proposal.proposerId === userId) return proposal;
    const { proposerId: _privateProposerId, ...anonymousProposal } = proposal;
    return anonymousProposal;
  });

  const approvalVotes = room.status === 'CRITERIA_REVIEW' || room.status === 'EVALUATION'
    ? await loadCriteriaApprovalVotes(id, getCriteriaSetVersion(room))
    : new Map<string, 'APPROVE' | 'REVISE'>();
  const approvalParticipants = room.status === 'CRITERIA_REVIEW' || room.status === 'EVALUATION'
    ? await loadOrCreatePhaseParticipants(id, criteriaPhase(room, 'CRITERIA_REVIEW'))
    : new Set(roomParticipants?.keys() || []);
  const eligibleApprovalCount = Math.max(1, approvalParticipants.size);
  const requiredApproveCount = Math.max(1, Math.ceil(eligibleApprovalCount * 0.8));
  const approveCount = Array.from(approvalVotes.values()).filter(vote => vote === 'APPROVE').length;
  const reviseCount = Array.from(approvalVotes.values()).filter(vote => vote === 'REVISE').length;

  const starVoteThreshold = Math.max(1, roomParticipants?.size || 1);
  let starVoteStatus: 'voting' | 'tie_pending' | 'finalized' = 'voting';
  if (room.finalVoteStatus === 'TIE_PENDING') {
    starVoteStatus = 'tie_pending';
  } else if (room.finalVoteStatus === 'FINALIZED' || (room.status === 'CLOSED' && !room.finalVoteStatus)) {
    starVoteStatus = 'finalized';
  }

  let finalSummary = aiFinalSummaries.get(id);
  if (room.status === 'CLOSED' && room.finalVoteStatus !== 'TIE_PENDING' && !finalSummary) {
    finalSummary = await generateFinalRoomReport(id, room, roomIdeas, roomRounds);
  }
  const finalResultsRevealed =
    room.finalVoteStatus === 'TIE_PENDING' ||
    room.finalVoteStatus === 'FINALIZED' ||
    (room.status === 'CLOSED' && !room.finalVoteStatus);

  const result: RoomDetails = {
    room,
    ideas: visibleIdeas,
    criteria: roomCriteria,
    proposals: visibleProposals,
    proposalsCount: visibleProposals.length,
    completedParticipantsCount,
    criteriaCompletedParticipantsCount,
    criteriaProposalsRevealed,
    criteriaApproval: {
      version: getCriteriaSetVersion(room),
      approveCount,
      reviseCount,
      eligibleCount: eligibleApprovalCount,
      requiredApproveCount,
      myVote: userId ? approvalVotes.get(userId) : undefined,
      approved: approveCount >= requiredApproveCount
    },
    rounds: roomRounds,
    decisionRounds: roomDecisionRounds,
    evaluatorsCount,
    myEvaluations,
    hasEvaluated,
    minResponseThresholdMet,
    scoreConfig: SCORE_CONFIG,
    aiFinalSummary: finalSummary,
    decisionReport: decisionReportsMap.get(id),
    // Never reveal another person's direction before everyone in the frozen
    // snapshot has completed the ballot.
    starVotes: finalResultsRevealed ? starVoteCounts : {},
    myStarVotes,
    isStarVoteSubmitted,
    starVoteCount: rStarVotes.size,
    starVoteStatus,
    tieCandidateIdeaIds: room.tieCandidateIdeaIds || [],
    tieSlots: room.tieSlots || 0,
    finalVoteExpectedCount: starVoteThreshold
  };

  // ---------------------------------------------------------------
  // SECURITY GATE
  // Evaluation aggregates and summarized comments are evidence for the final
  // report. They must not become an intermediate result that anchors the final
  // anonymous ballot. A participant can therefore receive them only after the
  // final ballot has ended, or in the legacy pre-ballot elimination screen.
  // ---------------------------------------------------------------
  const mayRevealEvaluationResults =
    room.status === 'CLOSED' ||
    room.finalVoteStatus === 'FINALIZED' ||
    room.finalVoteStatus === 'TIE_PENDING' ||
    (room.status === 'ELIMINATION' && room.finalVoteStatus === 'NOT_STARTED');

  if (mayRevealEvaluationResults) {
    // 1. Calculate aggregated scores for each idea with criteria compliance weighting
    const aggregatedScores: Record<string, {
      score: number;
      keepCount: number;
      neutralCount: number;
      excludeCount: number;
      objectiveExcludeCount: number;
      avgCriteriaComplianceRatio: number;
      criteriaMatchCounts: Record<string, number>;
      validResponseCount: number;
      unsureCount: number;
      unsureRate: number;
      criterionMetrics: Record<string, {
        criterionId: string;
        complianceRate: number;
        validResponseCount: number;
        unsureCount: number;
        unsureRate: number;
        metCount: number;
        partialCount: number;
        notMetCount: number;
      }>;
    }> = {};

    const totalCriteriaCount = Math.max(1, roomCriteria.length || roomProposals.length || 1);
    const useStructuredCriteria = (room.engineVersion || 1) >= 2 || room.status !== 'CLOSED';

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
        validResponseCount: 0,
        unsureCount: 0,
        unsureRate: 0,
        criterionMetrics: {},
      };
    });

    // Per-idea tracking for weighted calculation
    const weightedPointsMap: Record<string, number> = {};
    const complianceRatiosMap: Record<string, number[]> = {};

    roomIdeas.forEach(idea => {
      weightedPointsMap[idea.id] = 0;
      complianceRatiosMap[idea.id] = [];
    });

    // Populate from all evaluations. Existing completed engine-v1 rooms retain
    // their historic formula; active/new rooms use the transparent v2 metrics.
    roomEvals.forEach(ev => {
      const scoreObj = aggregatedScores[ev.ideaId];
      if (scoreObj) {
        if (useStructuredCriteria) {
          if (ev.decision === 'KEEP') scoreObj.keepCount += 1;
          if (ev.decision === 'NEUTRAL') scoreObj.neutralCount += 1;
          if (ev.decision === 'EXCLUDE') {
            scoreObj.excludeCount += 1;
            if (ev.reasonType === 'OBJECTIVE_CONSTRAINT') scoreObj.objectiveExcludeCount += 1;
          }
          Object.entries(ev.criteriaEvaluations || {}).forEach(([criterionId, value]) => {
            const metric = scoreObj.criterionMetrics[criterionId] || {
              criterionId,
              complianceRate: 0,
              validResponseCount: 0,
              unsureCount: 0,
              unsureRate: 0,
              metCount: 0,
              partialCount: 0,
              notMetCount: 0
            };
            if (value === 'UNSURE') metric.unsureCount += 1;
            if (value === 'MET') {
              metric.metCount += 1;
              metric.validResponseCount += 1;
            }
            if (value === 'PARTIAL') {
              metric.partialCount += 1;
              metric.validResponseCount += 1;
            }
            if (value === 'NOT_MET') {
              metric.notMetCount += 1;
              metric.validResponseCount += 1;
            }
            scoreObj.criterionMetrics[criterionId] = metric;
          });
          return;
        }

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

    // Calculate final metrics. UNSURE is visible but excluded from compliance.
    roomIdeas.forEach(idea => {
      const scoreObj = aggregatedScores[idea.id];
      if (scoreObj) {
        if (useStructuredCriteria) {
          const metrics = Object.values(scoreObj.criterionMetrics);
          metrics.forEach(metric => {
            const totalResponses = metric.validResponseCount + metric.unsureCount;
            metric.complianceRate = metric.validResponseCount > 0
              ? Math.round(((metric.metCount * 2 + metric.partialCount) / (metric.validResponseCount * 2)) * 1000) / 10
              : 0;
            metric.unsureRate = totalResponses > 0
              ? Math.round((metric.unsureCount / totalResponses) * 1000) / 10
              : 0;
          });
          const criterionRates = metrics.filter(metric => metric.validResponseCount > 0).map(metric => metric.complianceRate);
          scoreObj.avgCriteriaComplianceRatio = criterionRates.length > 0
            ? Math.round((criterionRates.reduce((sum, rate) => sum + rate, 0) / criterionRates.length) * 10) / 10
            : 0;
          const evaluatorIds = new Set(
            roomEvals.filter(evaluation => evaluation.ideaId === idea.id).map(evaluation => evaluation.evaluatorId)
          );
          scoreObj.validResponseCount = evaluatorIds.size;
          scoreObj.unsureCount = metrics.reduce((sum, metric) => sum + metric.unsureCount, 0);
          const allCriterionResponses = metrics.reduce(
            (sum, metric) => sum + metric.validResponseCount + metric.unsureCount,
            0
          );
          scoreObj.unsureRate = allCriterionResponses > 0
            ? Math.round((scoreObj.unsureCount / allCriterionResponses) * 1000) / 10
            : 0;
          // Compatibility only: old screens expect score. It mirrors criteria
          // compliance and is never mixed with recommendation counts.
          scoreObj.score = Math.round(scoreObj.avgCriteriaComplianceRatio);
          return;
        }

        const legacyValidEvaluatorCount = Math.max(
          1,
          new Set(roomEvals.filter(evaluation => evaluation.ideaId === idea.id).map(evaluation => evaluation.evaluatorId)).size
        );
        scoreObj.score = Math.min(
          100,
          Math.max(0, Math.round(weightedPointsMap[idea.id] / legacyValidEvaluatorCount))
        );

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
 * 5-0. Update Evaluation Re-edit status (Realtime re-editing synchronization)
 */
app.post('/api/rooms/:id/re-edit-status', (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const userId = req.auth!.userId;
  const isReEditing = req.body?.isReEditing === true;

  let set = reEditingEvaluatorsMap.get(id);
  if (!set) {
    set = new Set<string>();
    reEditingEvaluatorsMap.set(id, set);
  }

  if (isReEditing) {
    set.add(String(userId));
    // Re-editing is a UI state, not a destructive action. The previously
    // submitted evaluations stay intact until a complete replacement succeeds.
  } else {
    set.delete(String(userId));
  }

  res.json({ success: true, isReEditing: set.has(String(userId)), totalReEditingCount: set.size });
});

/**
 * 5-1. Submit Evaluations for 1차 투표 및 익명 평가
 */
app.post('/api/rooms/:id/evaluations', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const evaluatorId = req.auth!.userId;
  const { submissions } = req.body;

  const room = await hydrateRoomFromSupabase(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'EVALUATION') {
    return res.status(400).json({ error: '현재 평가 단계가 아닙니다.' });
  }
  if (!Array.isArray(submissions)) {
    return res.status(400).json({ error: 'submissions 배열이 필수입니다.' });
  }

  const activeIdeas = (ideas.get(id) || []).filter(idea => idea.status === 'ACTIVE');
  const decisionRound = { id: `round-${id}-1`, roundNumber: 1 };
  const activeIdeaIds = new Set(activeIdeas.map(idea => idea.id));
  const submittedIdeaIds = submissions.map((submission: any) => submission?.ideaId);
  if (
    submissions.length !== activeIdeas.length ||
    new Set(submittedIdeaIds).size !== activeIdeas.length ||
    submittedIdeaIds.some((ideaId: unknown) => typeof ideaId !== 'string' || !activeIdeaIds.has(ideaId))
  ) {
    return res.status(400).json({ error: '모든 활성 아이디어를 정확히 한 번씩 평가해야 합니다.' });
  }

  const allowedDecisions = new Set(['KEEP', 'NEUTRAL', 'EXCLUDE']);
  const allowedReasonTypes = new Set(['OBJECTIVE_CONSTRAINT', 'PREFERENCE']);
  const confirmedCriteria = (criteria.get(id) || []).filter(criterion => criterion.confirmed);
  const validCriteriaIds = new Set(confirmedCriteria.map(criterion => criterion.id));
  const allowedCriteriaValues = new Set<CriteriaEvaluationValue>(['MET', 'PARTIAL', 'NOT_MET', 'UNSURE']);
  const usesStructuredCriteria = true;
  for (const submission of submissions) {
    if (!allowedDecisions.has(submission.decision)) {
      return res.status(400).json({ error: '유효하지 않은 평가 선택입니다.' });
    }
    if (!Array.isArray(submission.excludedCriterionIds)) {
      return res.status(400).json({ error: '평가 기준 목록 형식이 올바르지 않습니다.' });
    }
    if (submission.excludedCriterionIds.some((criterionId: unknown) =>
      typeof criterionId !== 'string' || !validCriteriaIds.has(criterionId)
    )) {
      return res.status(400).json({ error: '해당 방에 속하지 않은 평가 기준이 포함되어 있습니다.' });
    }
    if (usesStructuredCriteria) {
      const criteriaEvaluations = submission.criteriaEvaluations;
      if (!criteriaEvaluations || typeof criteriaEvaluations !== 'object' || Array.isArray(criteriaEvaluations)) {
        return res.status(400).json({ error: '모든 평가 기준의 충족도를 선택해야 합니다.' });
      }
      const submittedCriterionIds = Object.keys(criteriaEvaluations);
      if (
        submittedCriterionIds.length !== validCriteriaIds.size ||
        submittedCriterionIds.some(criterionId => !validCriteriaIds.has(criterionId)) ||
        Array.from(validCriteriaIds).some(criterionId => !submittedCriterionIds.includes(criterionId))
      ) {
        return res.status(400).json({ error: '모든 확정 기준을 정확히 한 번씩 평가해야 합니다.' });
      }
      if (Object.values(criteriaEvaluations).some(value => !allowedCriteriaValues.has(value as CriteriaEvaluationValue))) {
        return res.status(400).json({ error: '유효하지 않은 기준 충족도 값이 포함되어 있습니다.' });
      }
    }
    if (!allowedReasonTypes.has(submission.reasonType || 'PREFERENCE')) {
      return res.status(400).json({ error: '유효하지 않은 사유 유형입니다.' });
    }
    if (typeof submission.reasonText !== 'string' || submission.reasonText.length > 5000) {
      return res.status(400).json({ error: '평가 사유는 5,000자 이내로 입력해 주세요.' });
    }
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
  const otherEvals = rEvals.filter(e =>
    String(e.evaluatorId) !== String(evaluatorId)
  );

  const newEvals: Evaluation[] = submissions.map((sub: any) => ({
    id: crypto.randomUUID(),
    roomId: id,
    ideaId: sub.ideaId,
    evaluatorId: String(evaluatorId),
    decision: sub.decision,
    excludedCriterionIds: sub.excludedCriterionIds,
    criteriaEvaluations: sub.criteriaEvaluations || {},
    reasonText: sub.reasonText,
    reasonType: sub.reasonType || 'PREFERENCE',
    round: decisionRound.roundNumber,
    roundId: decisionRound.id
  }));

  if (SUPABASE_CONFIGURED) {
    const { data: previousRows, error: previousError } = await supabase
      .from('evaluations')
      .select('*')
      .eq('room_id', id)
      .eq('evaluator_id', evaluatorId);
    if (previousError) {
      return res.status(503).json({ error: '기존 평가를 확인하지 못해 저장을 중단했습니다.' });
    }

    const { error: deleteError } = await supabase
      .from('evaluations')
      .delete()
      .eq('room_id', id)
      .eq('evaluator_id', evaluatorId);
    if (deleteError) {
      return res.status(503).json({ error: '기존 평가 교체를 시작하지 못했습니다.' });
    }

    const rows = newEvals.map(evaluation => ({
      id: evaluation.id,
      room_id: id,
      idea_id: evaluation.ideaId,
      evaluator_id: evaluatorId,
      decision: evaluation.decision,
      excluded_criterion_ids: evaluation.excludedCriterionIds,
      criteria_evaluations: evaluation.criteriaEvaluations || {},
      reason_text: evaluation.reasonText,
      reason_type: evaluation.reasonType,
      round: evaluation.round
    }));
    const { error: insertError } = await supabase.from('evaluations').insert(rows);
    if (insertError) {
      if (previousRows && previousRows.length > 0) {
        const { error: restoreError } = await supabase.from('evaluations').insert(previousRows);
        if (restoreError) {
          console.error('CRITICAL: evaluation restore failed after replacement error', restoreError.message);
        }
      }
      return res.status(503).json({ error: '평가 저장에 실패해 기존 평가를 복원했습니다.' });
    }
  } else if (IS_PRODUCTION) {
    return res.status(503).json({ error: '평가 저장소를 사용할 수 없습니다.' });
  }

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
 * AI Idea Development Helper Endpoint (IA 2.2: AI 아이디어 디벨롭 보조 기능)
 */
app.post('/api/rooms/:id/ideas/develop', async (req, res) => {
  const { title, description } = req.body;
  if (typeof title !== 'string' || typeof description !== 'string' || !title.trim() || !description.trim()) {
    return res.status(400).json({ error: '제목과 설명을 모두 입력해주세요.' });
  }
  if (title.length > 120 || description.length > 10000) {
    return res.status(400).json({ error: 'AI 보완 요청의 길이가 너무 깁니다.' });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.json({
      originalDescription: description,
      revisedDescription: description,
      enhancedDescription: description,
      reviewQuestions: [
        '이 의견이 해결하려는 사용자의 문제는 무엇인가요?',
        '기간·인력·예산 중 반드시 확인해야 할 제약은 무엇인가요?',
        '성공 여부를 어떤 결과로 확인할 수 있나요?'
      ],
      aiAvailable: false
    });
  }

  try {
    const prompt = `
당신은 팀 의사결정 서비스의 중립적인 문장 통역자입니다.
당신은 심판이 아니며 아이디어의 우열, 가능성, 점수, 채택 여부를 판단해서는 안 됩니다.
작성자가 말하고자 한 의미와 사실을 추가·삭제·과장하지 않은 채 다음 일만 수행하세요.
1. 서툰 표현을 이해하기 쉬운 문장으로 정리합니다.
2. 감정적이거나 단정적인 표현을 중립적으로 바꿉니다.
3. 원문에 없는 수치, 효과, 일정, 기술 또는 시장 사실을 만들지 않습니다.
4. 작성자가 스스로 보완할 수 있는 검토 질문을 최대 3개 제안합니다.

[원문 제목]
${title}

[원문 내용]
${description}

반드시 아래 JSON만 출력하세요.
{
  "revisedDescription": "원문의 의미를 보존한 중립적 정리문",
  "reviewQuestions": ["검토 질문 1", "검토 질문 2", "검토 질문 3"]
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const raw = (response.text || '').replace(/```json|```/g, '').trim();
    let revisedDescription = description;
    let reviewQuestions: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.revisedDescription === 'string' && parsed.revisedDescription.trim()) {
        revisedDescription = parsed.revisedDescription.trim();
      }
      if (Array.isArray(parsed.reviewQuestions)) {
        reviewQuestions = parsed.reviewQuestions
          .filter((question: unknown) => typeof question === 'string')
          .slice(0, 3);
      }
    } catch {
      // Invalid model output must never overwrite the author's text.
    }
    res.json({
      originalDescription: description,
      revisedDescription,
      enhancedDescription: revisedDescription,
      reviewQuestions,
      aiAvailable: true
    });
  } catch (err) {
    console.error('AI idea development failed:', err);
    res.json({
      originalDescription: description,
      revisedDescription: description,
      enhancedDescription: description,
      reviewQuestions: [],
      aiAvailable: false
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
app.post('/api/rooms/:id/criteria/propose', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { rawText, isAiSuggested } = req.body;
  const proposerId = req.auth!.userId;
  const isAi = Boolean(isAiSuggested);

  const room = await hydrateRoomFromSupabase(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'CRITERIA_PROPOSAL') {
    return res.status(400).json({ error: '현재 기준 제안 단계가 아닙니다.' });
  }

  if (typeof rawText !== 'string' || !rawText.trim()) {
    return res.status(400).json({ error: '제안 텍스트를 입력해 주세요.' });
  }
  if (rawText.trim().length > 2000) {
    return res.status(400).json({ error: '평가 기준 제안은 2,000자 이내로 입력해 주세요.' });
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

  const userProps = proposals.filter(p => p.proposerId === proposerId);
  const userAiCount = userProps.filter(p => p.isAiSuggested || p.id.startsWith('prop-ai-')).length;
  const userDirectCount = userProps.length - userAiCount;

  if (isAi && userAiCount >= 3) {
    return res.status(400).json({ error: 'AI 기반 평가 기준은 최대 3개까지만 등록할 수 있습니다.' });
  }
  if (!isAi && userDirectCount >= 3) {
    return res.status(400).json({ error: '직접 작성 평가 기준은 최대 3개까지만 등록할 수 있습니다.' });
  }

  const newProposal: CriterionProposal = {
    id: isAi ? `prop-ai-${crypto.randomUUID()}` : `prop-${crypto.randomUUID()}`,
    roomId: id,
    rawText: trimmedText,
    proposerId,
    isAiSuggested: isAi,
  };

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('criterion_proposals').insert({
      id: newProposal.id,
      room_id: id,
      raw_text: newProposal.rawText,
      proposer_id: proposerId,
      is_ai_suggested: isAi
    });
    if (error) return res.status(503).json({ error: '평가 기준 제안을 안전하게 저장하지 못했습니다.' });
  } else if (IS_PRODUCTION) {
    return res.status(503).json({ error: '평가 기준 저장소를 사용할 수 없습니다.' });
  }

  proposals.push(newProposal);
  criterionProposals.set(id, proposals);

  res.status(201).json(newProposal);
});

/**
 * 6-2. Edit a Criterion Proposal
 */
app.put('/api/rooms/:id/criteria/proposals/:proposalId', async (req: AuthenticatedRequest, res) => {
  const { id, proposalId } = req.params;
  const { rawText } = req.body;

  const proposals = criterionProposals.get(id) || [];
  const target = proposals.find(p => p.id === proposalId);
  if (!target) {
    return res.status(404).json({ error: '제안을 찾을 수 없습니다.' });
  }
  if (target.proposerId !== req.auth!.userId) {
    return res.status(403).json({ error: '자신이 작성한 제안만 수정할 수 있습니다.' });
  }

  if (typeof rawText !== 'string' || !rawText.trim() || rawText.trim().length > 2000) {
    return res.status(400).json({ error: '평가 기준 제안은 1~2,000자로 입력해 주세요.' });
  }
  const updatedText = rawText.trim();
  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase
      .from('criterion_proposals')
      .update({ raw_text: updatedText })
      .eq('id', proposalId)
      .eq('room_id', id)
      .eq('proposer_id', req.auth!.userId);
    if (error) return res.status(503).json({ error: '평가 기준 수정을 저장하지 못했습니다.' });
  }
  target.rawText = updatedText;

  res.json({ success: true, proposal: target });
});

/**
 * 6-3. Delete a Criterion Proposal
 */
app.delete('/api/rooms/:id/criteria/proposals/:proposalId', async (req: AuthenticatedRequest, res) => {
  const { id, proposalId } = req.params;

  let proposals = criterionProposals.get(id) || [];
  const target = proposals.find(proposal => proposal.id === proposalId);
  if (!target) return res.status(404).json({ error: '제안을 찾을 수 없습니다.' });
  if (target.proposerId !== req.auth!.userId) {
    return res.status(403).json({ error: '자신이 작성한 제안만 삭제할 수 있습니다.' });
  }
  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase
      .from('criterion_proposals')
      .delete()
      .eq('id', proposalId)
      .eq('room_id', id)
      .eq('proposer_id', req.auth!.userId);
    if (error) return res.status(503).json({ error: '평가 기준 삭제를 저장하지 못했습니다.' });
  }
  proposals = proposals.filter(p => p.id !== proposalId);
  criterionProposals.set(id, proposals);
  res.json({ success: true, deletedId: proposalId });

});

/**
 * 7. AI Cluster proposals (Transition to review)
 */
app.post('/api/rooms/:id/criteria/cluster', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;

  const room = rooms.get(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'CRITERIA_PROPOSAL') {
    return res.status(400).json({ error: '현재 기준 제안 수집 단계가 아닙니다.' });
  }

  const proposalSnapshot = await loadOrCreatePhaseParticipants(
    id,
    criteriaPhase(room, 'CRITERIA_PROPOSAL')
  );
  const completed =
    criteriaCompletedUsersMap.get(criteriaCompletionCacheKey(room)) || new Set<string>();
  const completedCount = Array.from(completed).filter(userId => proposalSnapshot.has(userId)).length;
  if (completedCount < proposalSnapshot.size) {
    return res.status(409).json({
      error: `모든 참여자의 기준 제안이 완료된 뒤 정리할 수 있습니다. (${completedCount}/${proposalSnapshot.size})`
    });
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
    id: `crit-candidate-${i}-${crypto.randomUUID()}`,
    roomId: id,
    name: c.name,
    description: c.description,
    confirmed: false,
  }));

  if (SUPABASE_CONFIGURED) {
    const { data: previousCriteria, error: readError } = await supabase
      .from('criteria')
      .select('*')
      .eq('room_id', id);
    if (readError) return res.status(503).json({ error: '기존 평가 기준을 확인하지 못했습니다.' });
    const { error: deleteError } = await supabase.from('criteria').delete().eq('room_id', id);
    if (deleteError) return res.status(503).json({ error: '기존 평가 기준을 갱신하지 못했습니다.' });
    const { error: insertError } = await supabase.from('criteria').insert(candidates.map(candidate => ({
      id: candidate.id,
      room_id: id,
      name: candidate.name,
      description: candidate.description,
      confirmed: false
    })));
    if (insertError) {
      if (previousCriteria && previousCriteria.length > 0) await supabase.from('criteria').insert(previousCriteria);
      return res.status(503).json({ error: 'AI 정리 기준을 저장하지 못해 기존 기준을 복원했습니다.' });
    }
    const { error: statusError } = await supabase
      .from('rooms')
      .update({ status: 'CRITERIA_REVIEW' })
      .eq('id', id)
      .eq('status', 'CRITERIA_PROPOSAL');
    if (statusError) return res.status(503).json({ error: '평가 기준 검토 단계로 이동하지 못했습니다.' });
  }

  criteria.set(id, candidates);
  room.status = 'CRITERIA_REVIEW';
  await loadOrCreatePhaseParticipants(id, criteriaPhase(room, 'CRITERIA_REVIEW'));

  res.json({ success: true, candidates });
});

/**
 * Every eligible participant independently approves the same criteria set.
 * Reaching 80% approval moves the room forward without giving the host a
 * stronger vote.
 */
app.post('/api/rooms/:id/criteria/approval', async (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const userId = req.auth!.userId;
  const vote = req.body?.vote;
  const room = await hydrateRoomFromSupabase(id);
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (room.status !== 'CRITERIA_REVIEW') {
    return res.status(409).json({ error: '현재 평가 기준 검토 단계가 아닙니다.' });
  }
  if (vote !== 'APPROVE' && vote !== 'REVISE') {
    return res.status(400).json({ error: 'APPROVE 또는 REVISE 중 하나를 선택해 주세요.' });
  }

  const approvalVersion = getCriteriaSetVersion(room);
  const snapshot = await loadOrCreatePhaseParticipants(
    id,
    criteriaPhase(room, 'CRITERIA_REVIEW')
  );
  if (!snapshot.has(userId)) {
    return res.status(403).json({ error: '이 기준 세트의 동의 대상이 아닙니다.' });
  }
  const votes = await loadCriteriaApprovalVotes(id, approvalVersion);
  votes.set(userId, vote);
  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('criterion_approvals').upsert(
      {
        room_id: id,
        criteria_set_version: approvalVersion,
        user_id: userId,
        vote,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'room_id,criteria_set_version,user_id' }
    );
    if (error && IS_PRODUCTION) {
      votes.delete(userId);
      return res.status(503).json({ error: '기준 동의 결과를 안전하게 저장하지 못했습니다.' });
    }
  }

  const eligibleCount = Math.max(1, snapshot.size);
  const requiredApproveCount = Math.max(1, Math.ceil(eligibleCount * 0.8));
  const approveCount = Array.from(votes.values()).filter(value => value === 'APPROVE').length;
  const reviseCount = Array.from(votes.values()).filter(value => value === 'REVISE').length;
  const approved = approveCount >= requiredApproveCount;
  const allEligibleParticipantsVoted =
    Array.from(snapshot).every(participantId => votes.has(participantId));

  if (approved) {
    const finalized = (criteria.get(id) || []).map(criterion => ({ ...criterion, confirmed: true }));
    if (finalized.length === 0) {
      return res.status(409).json({ error: '확정할 평가 기준이 없습니다.' });
    }
    if (SUPABASE_CONFIGURED) {
      const { error: criteriaError } = await supabase
        .from('criteria')
        .update({ confirmed: true })
        .eq('room_id', id);
      if (criteriaError) {
        votes.delete(userId);
        return res.status(503).json({ error: '기준 동의 결과를 저장하지 못했습니다.' });
      }
      const { error: roomError } = await supabase
        .from('rooms')
        .update({ status: 'EVALUATION' })
        .eq('id', id)
        .eq('status', 'CRITERIA_REVIEW');
      if (roomError) {
        votes.delete(userId);
        return res.status(503).json({ error: '평가 단계로 이동하지 못했습니다.' });
      }
    }
    criteria.set(id, finalized);
    room.status = 'EVALUATION';
  } else if (allEligibleParticipantsVoted) {
    const nextVersion = approvalVersion + 1;
    if (SUPABASE_CONFIGURED) {
      const { data: changedRows, error } = await supabase
        .from('rooms')
        .update({
          status: 'CRITERIA_PROPOSAL',
          criteria_set_version: nextVersion
        })
        .eq('id', id)
        .eq('status', 'CRITERIA_REVIEW')
        .eq('criteria_set_version', approvalVersion)
        .select('id');
      if (error) return res.status(503).json({ error: '기준 보완 단계로 이동하지 못했습니다.' });
    }
    room.criteriaSetVersion = nextVersion;
    room.status = 'CRITERIA_PROPOSAL';
    await loadOrCreatePhaseParticipants(id, criteriaPhase(room, 'CRITERIA_PROPOSAL'));
  }

  res.json({
    success: true,
    approval: {
      version: approvalVersion,
      approveCount,
      reviseCount,
      eligibleCount,
      requiredApproveCount,
      myVote: vote,
      approved,
      needsRevision: !approved && allEligibleParticipantsVoted
    },
    status: room.status
  });
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

async function persistFinalVoteRoomState(room: Room): Promise<void> {
  if (!SUPABASE_CONFIGURED) return;
  const { error } = await supabase
    .from('rooms')
    .update({
      status: room.status,
      final_vote_status: room.finalVoteStatus,
      tie_candidate_idea_ids: room.tieCandidateIdeaIds || [],
      tie_slots: room.tieSlots || 0,
      current_round_id: room.currentRoundId || null
    })
    .eq('id', room.id);
  if (error) throw new Error('최종 투표 상태를 저장하지 못했습니다.');
}

async function finalizeDecisionWinners(
  room: Room,
  roomIdeas: Idea[],
  winnerIdeaIds: string[],
  voteCounts: Record<string, number>
): Promise<void> {
  const winnerIds = new Set(winnerIdeaIds);
  roomIdeas.forEach(idea => {
    if (winnerIds.has(idea.id)) idea.status = 'WINNER';
    else if (idea.status === 'ACTIVE') idea.status = 'ELIMINATED';
  });
  room.status = 'CLOSED';
  room.finalVoteStatus = 'FINALIZED';
  room.tieCandidateIdeaIds = [];
  room.tieSlots = 0;

  if (SUPABASE_CONFIGURED) {
    for (const idea of roomIdeas) {
      const { error } = await supabase
        .from('ideas')
        .update({ status: idea.status })
        .eq('id', idea.id)
        .eq('room_id', room.id);
      if (error) throw new Error('최종 후보 상태를 저장하지 못했습니다.');
    }
  }
  await persistFinalVoteRoomState(room);
  rooms.set(room.id, room);
  ideas.set(room.id, roomIdeas);
  await completeDecisionRound(room, roomIdeas, {
    winnerIdeaIds,
    voteCounts,
    finalizedAt: new Date().toISOString()
  });
  aiCommentsCache.delete(room.id);
  await generateFinalRoomReport(room.id, room, roomIdeas, eliminationRounds.get(room.id) || []);
}

/**
 * Quick decisions keep the anonymity rule but skip criteria proposal/evaluation.
 * The host can start only after the Stage-1 simultaneous-reveal gate is complete.
 */
app.post('/api/rooms/:id/quick/start-vote', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const room = await hydrateRoomFromSupabase(id);
    if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    if (room.decisionMode !== 'QUICK') {
      return res.status(409).json({ error: '빠른 결정 방에서만 사용할 수 있습니다.' });
    }
    if (room.status !== 'IDEA_SUBMISSION') {
      return res.status(409).json({ error: '현재 단계에서는 익명 투표를 시작할 수 없습니다.' });
    }

    const roomIdeas = (ideas.get(id) || []).filter(idea => idea.status === 'ACTIVE');
    const targetWinnerCount = room.targetWinnerCount || 1;
    if (roomIdeas.length < Math.max(2, targetWinnerCount)) {
      return res.status(400).json({ error: '빠른 결정을 시작하려면 선택지가 최소 2개 필요합니다.' });
    }

    const eligible = await loadOrCreatePhaseParticipants(id, 'IDEA_SUBMISSION');
    const completed = ideaCompletedUsersMap.get(id) || new Set<string>();
    const completedEligibleCount = Array.from(completed).filter(userId => eligible.has(userId)).length;
    if (eligible.size === 0 || completedEligibleCount < eligible.size) {
      return res.status(409).json({
        error: `모든 참여자가 선택지 작성을 완료한 뒤 시작할 수 있습니다. (${completedEligibleCount}/${eligible.size}명 완료)`
      });
    }

    const round = await ensureDecisionRound(room, roomIdeas);
    await loadOrCreatePhaseParticipants(id, `FINAL_VOTE:${round.id}`);
    room.status = 'ELIMINATION';
    room.finalVoteStatus = 'VOTING';
    room.tieCandidateIdeaIds = [];
    room.tieSlots = 0;
    await persistFinalVoteRoomState(room);
    rooms.set(id, room);
    res.json({ success: true, status: room.status, finalVoteStatus: room.finalVoteStatus });
  } catch (error) {
    console.error('Quick vote start error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : '빠른 투표를 시작하지 못했습니다.' });
  }
});

// Check the frozen voter snapshot. Until everyone finishes, this function never
// returns aggregate counts, so neither a loud participant nor the host can lead others.
async function checkAndAutoTransitionStarVotes(roomId: string) {
  const room = await hydrateRoomFromSupabase(roomId);
  if (!room) return { status: 'CLOSED' as RoomStatus, starVoteStatus: 'finalized' as const, message: '' };
  const roomIdeas = ideas.get(roomId) || [];
  const activeIdeas = roomIdeas.filter(idea => idea.status === 'ACTIVE');
  const round = await ensureDecisionRound(room, activeIdeas);
  const eligibleVoters = await loadOrCreatePhaseParticipants(roomId, `FINAL_VOTE:${round.id}`);
  const rStarVotes = starVotesMap.get(roomId) || new Map<string, string[]>();
  const completedCount = Array.from(rStarVotes.keys()).filter(userId => eligibleVoters.has(userId)).length;

  if (completedCount < eligibleVoters.size) {
    return {
      status: room.status,
      starVoteStatus: 'voting' as const,
      message: `현재 투표 진행 중 (${completedCount}/${eligibleVoters.size}명 완료)`
    };
  }

  const voteCounts: Record<string, number> = Object.fromEntries(activeIdeas.map(idea => [idea.id, 0]));
  rStarVotes.forEach((selectedIdeaIds, userId) => {
    if (!eligibleVoters.has(userId)) return;
    selectedIdeaIds.forEach(ideaId => {
      if (ideaId in voteCounts) voteCounts[ideaId] += 1;
    });
  });

  const targetWinners = Math.min(room.targetWinnerCount || 1, activeIdeas.length);
  const sortedIdeas = [...activeIdeas].sort((a, b) => {
    const scoreDifference = (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0);
    return scoreDifference || a.id.localeCompare(b.id);
  });
  const boundaryScore = voteCounts[sortedIdeas[targetWinners - 1]?.id] || 0;
  const guaranteedWinners = sortedIdeas.filter(idea => (voteCounts[idea.id] || 0) > boundaryScore);
  const boundaryCandidates = sortedIdeas.filter(idea => (voteCounts[idea.id] || 0) === boundaryScore);
  const tieSlots = targetWinners - guaranteedWinners.length;

  if (boundaryCandidates.length > tieSlots) {
    room.status = 'CLOSED';
    room.finalVoteStatus = 'TIE_PENDING';
    room.tieCandidateIdeaIds = boundaryCandidates.map(idea => idea.id);
    room.tieSlots = tieSlots;
    await persistFinalVoteRoomState(room);
    rooms.set(roomId, room);
    return {
      status: room.status,
      starVoteStatus: 'tie_pending' as const,
      message: '모든 투표가 공개되었습니다. 최종 선정 경계의 동률만 무작위 추첨으로 결정해 주세요.'
    };
  }

  const winnerIdeaIds = sortedIdeas.slice(0, targetWinners).map(idea => idea.id);
  await finalizeDecisionWinners(room, roomIdeas, winnerIdeaIds, voteCounts);
  return {
    status: room.status,
    starVoteStatus: 'finalized' as const,
    message: '모든 참여자의 익명 투표가 완료되어 결과가 동시에 공개되었습니다.'
  };
}

/**
 * 10.2 Submit Star Vote (4단계 2차 투표 별 스티커 투표)
 */
app.post('/api/rooms/:id/star-vote', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { selectedIdeaIds } = req.body;
    const userId = req.auth!.userId;

    const room = await hydrateRoomFromSupabase(id);
    if (!room) {
      return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    }
    if (room.status !== 'ELIMINATION' || (room.finalVoteStatus && room.finalVoteStatus !== 'VOTING')) {
      return res.status(409).json({ error: '현재는 최종 익명 투표 단계가 아닙니다.' });
    }
    if (!room.finalVoteStatus) room.finalVoteStatus = 'VOTING';
    if (!Array.isArray(selectedIdeaIds)) {
      return res.status(400).json({ error: '올바르지 않은 투표 정보입니다.' });
    }

    const targetWinners = room.targetWinnerCount || 1;
    const uniqueSelectedIds = Array.from(new Set(selectedIdeaIds.map(String)));
    if (uniqueSelectedIds.length !== targetWinners) {
      return res.status(400).json({ error: `별 스티커 ${targetWinners}개를 모두 사용해 주세요.` });
    }
    const activeIdeaIds = new Set((ideas.get(id) || []).filter(idea => idea.status === 'ACTIVE').map(idea => idea.id));
    if (uniqueSelectedIds.some(ideaId => !activeIdeaIds.has(ideaId))) {
      return res.status(400).json({ error: '현재 투표 대상이 아닌 선택지가 포함되어 있습니다.' });
    }

    const round = await ensureDecisionRound(room, (ideas.get(id) || []).filter(idea => idea.status === 'ACTIVE'));
    const eligibleVoters = await loadOrCreatePhaseParticipants(id, `FINAL_VOTE:${round.id}`);
    if (!eligibleVoters.has(userId)) {
      return res.status(403).json({ error: '투표 시작 시 확정된 참여자만 투표할 수 있습니다.' });
    }

    let rStarVotes = starVotesMap.get(id);
    if (!rStarVotes) {
      rStarVotes = new Map<string, string[]>();
      starVotesMap.set(id, rStarVotes);
    }
    if (rStarVotes.has(userId)) {
      return res.status(409).json({ error: '이미 제출한 최종 투표는 다른 사람의 판단을 보호하기 위해 수정할 수 없습니다.' });
    }
    if (SUPABASE_CONFIGURED) {
      const { error } = await supabase.from('decision_votes').insert({
        id: `decision-vote-${crypto.randomUUID()}`,
        room_id: id,
        round_id: round.id,
        user_id: userId,
        selected_idea_ids: uniqueSelectedIds
      });
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: '이미 최종 투표를 제출했습니다.' });
        return res.status(503).json({ error: '최종 투표를 안전하게 저장하지 못했습니다.' });
      }
    }
    rStarVotes.set(userId, uniqueSelectedIds);

    const transitionResult = await checkAndAutoTransitionStarVotes(id);

    res.json({ success: true, count: uniqueSelectedIds.length, ...transitionResult });
  } catch (err: any) {
    console.error('Submit star-vote error:', err);
    res.status(500).json({ error: err?.message || '별 스티커 투표 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * Resolve only the tied boundary. The server uses cryptographically secure
 * randomness, so the host cannot secretly submit a preferred winner.
 */
app.post('/api/rooms/:id/star-vote/resolve-tie', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const room = await hydrateRoomFromSupabase(id);
    if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    if (room.finalVoteStatus !== 'TIE_PENDING' || room.status !== 'CLOSED') {
      return res.status(409).json({ error: '현재 해결해야 할 최종 동률이 없습니다.' });
    }

    const roomIdeas = ideas.get(id) || [];
    const tieCandidateIds = room.tieCandidateIdeaIds || [];
    const tieSlots = room.tieSlots || 0;
    if (tieCandidateIds.length < 2 || tieSlots < 1 || tieSlots >= tieCandidateIds.length) {
      return res.status(409).json({ error: '저장된 동률 후보 또는 선정 자리 수가 올바르지 않습니다.' });
    }

    const rStarVotes = starVotesMap.get(id) || new Map<string, string[]>();
    const voteCounts: Record<string, number> = Object.fromEntries(roomIdeas.map(idea => [idea.id, 0]));
    rStarVotes.forEach(selectedIdeaIds => {
      selectedIdeaIds.forEach(ideaId => {
        if (ideaId in voteCounts) voteCounts[ideaId] += 1;
      });
    });
    const boundaryScore = voteCounts[tieCandidateIds[0]] || 0;
    const guaranteedWinnerIds = roomIdeas
      .filter(idea => idea.status === 'ACTIVE' && (voteCounts[idea.id] || 0) > boundaryScore)
      .map(idea => idea.id);

    const pool = [...tieCandidateIds];
    const selectedTieWinnerIds: string[] = [];
    while (selectedTieWinnerIds.length < tieSlots && pool.length > 0) {
      const selectedIndex = crypto.randomInt(pool.length);
      selectedTieWinnerIds.push(pool.splice(selectedIndex, 1)[0]);
    }
    const winnerIdeaIds = [...guaranteedWinnerIds, ...selectedTieWinnerIds];
    await finalizeDecisionWinners(room, roomIdeas, winnerIdeaIds, voteCounts);

    res.json({
      success: true,
      winnerIdeaIds,
      randomlySelectedIdeaIds: selectedTieWinnerIds,
      message: '동률 후보 중 필요한 수만 무작위로 추첨하여 최종 결과를 확정했습니다.'
    });
  } catch (error) {
    console.error('Tie resolution error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : '동률 결과를 확정하지 못했습니다.' });
  }
});

/**
 * Start a new immutable review round with the same candidates and, for a
 * structured room, the already agreed criteria. Previous votes stay in history.
 */
app.post('/api/rooms/:id/review/restart', async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const room = await hydrateRoomFromSupabase(id);
    if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
    if (room.finalVoteStatus === 'TIE_PENDING') {
      return res.status(409).json({ error: '먼저 현재 회차의 동률 결정을 완료해 주세요.' });
    }
    if (room.status !== 'CLOSED' && room.status !== 'ELIMINATION') {
      return res.status(409).json({ error: '결과 확인 단계에서만 재검토를 시작할 수 있습니다.' });
    }

    const roomIdeas = ideas.get(id) || [];
    // Final-vote losers have no elimination round. Earlier-screened ideas do.
    const candidates = roomIdeas.filter(idea =>
      idea.status === 'ACTIVE' ||
      idea.status === 'WINNER' ||
      (idea.status === 'ELIMINATED' && idea.eliminatedRound === undefined)
    );
    if (candidates.length < 2) {
      return res.status(409).json({ error: '재검토할 생존 후보가 2개 이상 필요합니다.' });
    }

    const existingRound = getCurrentDecisionRound(room);
    if (existingRound) {
      await completeDecisionRound(room, roomIdeas, {
        outcome: 'REVIEW_REQUESTED',
        requestedAt: new Date().toISOString()
      });
    }
    room.currentRoundId = undefined;
    roomIdeas.forEach(idea => {
      if (candidates.some(candidate => candidate.id === idea.id)) idea.status = 'ACTIVE';
    });
    starVotesMap.set(id, new Map());
    // Only the in-memory pointer is cleared. The previous round report remains
    // immutable in ai_reports and can still be shown from the round history.
    decisionReportsMap.delete(id);
    aiFinalSummaries.delete(id);
    room.finalVoteStatus = room.decisionMode === 'QUICK' ? 'VOTING' : 'NOT_STARTED';
    room.tieCandidateIdeaIds = [];
    room.tieSlots = 0;

    const newRound = await ensureDecisionRound(room, candidates);
    if (room.decisionMode === 'QUICK') {
      room.status = 'ELIMINATION';
      await loadOrCreatePhaseParticipants(id, `FINAL_VOTE:${newRound.id}`);
    } else {
      room.status = 'EVALUATION';
      await loadOrCreatePhaseParticipants(id, `EVALUATION:${newRound.id}`);
    }

    if (SUPABASE_CONFIGURED) {
      for (const candidate of candidates) {
        const { error } = await supabase
          .from('ideas')
          .update({ status: 'ACTIVE' })
          .eq('id', candidate.id)
          .eq('room_id', id);
        if (error) throw new Error('재검토 후보 상태를 저장하지 못했습니다.');
      }
    }
    await persistFinalVoteRoomState(room);
    rooms.set(id, room);
    ideas.set(id, roomIdeas);
    res.json({
      success: true,
      status: room.status,
      roundId: newRound.id,
      roundNumber: newRound.roundNumber,
      message: '기존 결과는 보존하고 새 재검토 회차를 시작했습니다.'
    });
  } catch (error) {
    console.error('Review restart error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : '재검토 회차를 시작하지 못했습니다.' });
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
 * 11. Core Elimination Loop
 */
app.post('/api/rooms/:id/elimination/next', async (req, res) => {
  const { id } = req.params;
  const { eliminateIdeaIds } = req.body; // Specific array of idea ids to eliminate (useful for host selecting objective exclusions)

  const room = await hydrateRoomFromSupabase(id);
  if (!room) {
    return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  }

  if (room.status !== 'ELIMINATION') {
    return res.status(409).json({ error: '현재는 소거를 진행할 수 있는 단계가 아닙니다.' });
  }
  if (
    (room.engineVersion || 1) >= 3 &&
    (room.finalVoteStatus === 'VOTING' || room.finalVoteStatus === 'TIE_PENDING' || room.finalVoteStatus === 'FINALIZED')
  ) {
    return res.status(409).json({
      error: '익명 최종 투표가 시작된 뒤에는 방장이 후보를 수동으로 소거할 수 없습니다.'
    });
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
 * Helper to generate final room report
 */
async function generateFinalRoomReport(
  id: string,
  room: Room,
  roomIdeas: Idea[],
  roomRounds: EliminationRound[]
): Promise<string> {
  const memoryReport = decisionReportsMap.get(id);
  if (memoryReport) return memoryReport.reportText;

  const currentRound = getCurrentDecisionRound(room) ||
    [...(await loadDecisionRounds(id))].reverse()[0];
  if (SUPABASE_CONFIGURED) {
    let reportQuery = supabase
      .from('ai_reports')
      .select('*')
      .eq('room_id', id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (currentRound?.id) reportQuery = reportQuery.eq('round_id', currentRound.id);
    const { data: existingRows } = await reportQuery;
    const existing = existingRows?.[0];
    if (existing?.report_text) {
      const resultSnapshot = existing.result_snapshot || {};
      const report: DecisionReport = {
        reportText: existing.report_text,
        selectedReasons: resultSnapshot.selectedReasons || [],
        majorConcerns: resultSnapshot.majorConcerns || [],
        unverifiedAssumptions: resultSnapshot.unverifiedAssumptions || [],
        nextValidationTasks: resultSnapshot.nextValidationTasks || [],
        modelName: existing.model_name || 'unknown',
        promptVersion: existing.prompt_version || 'unknown',
        generatedAt: existing.created_at || new Date().toISOString()
      };
      decisionReportsMap.set(id, report);
      aiFinalSummaries.set(id, report.reportText);
      return report.reportText;
    }
  }

  const winnerIdeas = roomIdeas.filter(idea => idea.status === 'WINNER');
  const winnerIds = new Set(winnerIdeas.map(idea => idea.id));
  const allEvaluations = evaluations.get(id) || [];
  const roundEvaluations = currentRound
    ? allEvaluations.filter(evaluation => !evaluation.roundId || evaluation.roundId === currentRound.id)
    : allEvaluations;
  const roomCriteria = criteria.get(id) || [];
  const roomStarVotes = starVotesMap.get(id) || new Map<string, string[]>();
  const voteCounts: Record<string, number> = Object.fromEntries(roomIdeas.map(idea => [idea.id, 0]));
  roomStarVotes.forEach(selectedIdeaIds => {
    selectedIdeaIds.forEach(ideaId => {
      if (ideaId in voteCounts) voteCounts[ideaId] += 1;
    });
  });

  const selectedReasons: string[] = winnerIdeas.map(idea =>
    `"${idea.title}"은(는) 최종 익명 투표에서 ${voteCounts[idea.id] || 0}표를 받았습니다.`
  );
  const majorConcerns = Array.from(new Set(
    roundEvaluations
      .filter(evaluation => winnerIds.has(evaluation.ideaId) && evaluation.decision === 'EXCLUDE')
      .map(evaluation => evaluation.reasonText?.trim())
      .filter((reason): reason is string => Boolean(reason))
  )).slice(0, 5);

  const unverifiedAssumptions: string[] = [];
  for (const criterion of roomCriteria) {
    let validCount = 0;
    let unsureCount = 0;
    let points = 0;
    roundEvaluations
      .filter(evaluation => winnerIds.has(evaluation.ideaId))
      .forEach(evaluation => {
        const value = evaluation.criteriaEvaluations?.[criterion.id];
        if (value === 'UNSURE') unsureCount += 1;
        if (value === 'MET') {
          validCount += 1;
          points += 2;
        }
        if (value === 'PARTIAL') {
          validCount += 1;
          points += 1;
        }
        if (value === 'NOT_MET') validCount += 1;
      });
    if (validCount > 0) {
      const complianceRate = Math.round((points / (validCount * 2)) * 100);
      selectedReasons.push(`평가 기준 "${criterion.name}" 충족도는 유효 응답 ${validCount}건 기준 ${complianceRate}%였습니다.`);
    }
    if (unsureCount > 0 || validCount === 0) {
      unverifiedAssumptions.push(
        `"${criterion.name}"은(는) 잘 모르겠음 ${unsureCount}건, 유효 응답 ${validCount}건으로 추가 확인이 필요합니다.`
      );
    }
  }
  if (winnerIdeas.length === 0) {
    unverifiedAssumptions.push('최종 선정 아이디어가 확정되지 않아 결과 근거를 작성할 수 없습니다.');
  }

  const nextValidationTasks = Array.from(new Set([
    ...majorConcerns.map(concern => `다음 실행 전에 다음 우려를 작은 실험이나 자료로 확인합니다: ${concern}`),
    ...unverifiedAssumptions.map(assumption => `담당자와 확인 방법을 정해 다음 가정을 검증합니다: ${assumption}`)
  ])).slice(0, 6);
  const evidence: DecisionReportEvidence = {
    roomTitle: room.title,
    winnerIdeas: winnerIdeas.length > 0 ? winnerIdeas.map(idea => idea.title) : ['확정되지 않음'],
    selectedReasons,
    majorConcerns,
    unverifiedAssumptions,
    nextValidationTasks
  };
  const reportText = await aiGenerateFinalSummary(evidence);
  const generatedAt = new Date().toISOString();
  const report: DecisionReport = {
    reportText,
    selectedReasons,
    majorConcerns,
    unverifiedAssumptions,
    nextValidationTasks,
    modelName: process.env.POTENS_API_KEY
      ? 'potens:gemini-2.5-flash'
      : getGeminiClient()
        ? 'google:gemini-2.5-flash'
        : 'local-deterministic',
    promptVersion: 'decision-report-v3.0',
    generatedAt
  };

  if (SUPABASE_CONFIGURED) {
    const { error } = await supabase.from('ai_reports').insert({
      id: `ai-report-${crypto.randomUUID()}`,
      room_id: id,
      round_id: currentRound?.id || null,
      report_text: report.reportText,
      input_snapshot: {
        roomTitle: room.title,
        winnerIdeaIds: Array.from(winnerIds),
        voteCounts,
        criteriaIds: roomCriteria.map(criterion => criterion.id)
      },
      result_snapshot: {
        selectedReasons,
        majorConcerns,
        unverifiedAssumptions,
        nextValidationTasks
      },
      model_name: report.modelName,
      prompt_version: report.promptVersion,
      created_at: generatedAt
    });
    if (error) throw new Error('최종 근거 리포트 스냅샷을 저장하지 못했습니다.');
  }

  decisionReportsMap.set(id, report);
  aiFinalSummaries.set(id, reportText);
  return reportText;
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

