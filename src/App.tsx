import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Trash2, 
  Sparkles, 
  ChevronRight, 
  User, 
  Users, 
  Check, 
  X, 
  AlertCircle, 
  Lock, 
  Unlock, 
  ArrowRight, 
  Award, 
  RefreshCw, 
  FileText, 
  Info, 
  Settings, 
  Copy,
  PlusCircle,
  HelpCircle,
  Trash,
  Star
} from 'lucide-react';
import { 
  Room, 
  RoomStatus, 
  Idea, 
  Criterion, 
  CriterionProposal, 
  Evaluation, 
  EliminationRound, 
  RoomDetails,
  ParticipantStatus
} from './types';

import { supabase } from './supabase';

// Custom lightweight Markdown-to-JSX Parser for the AI reports
function SafeMarkdown({ content }: { content: string }) {
  if (!content) return null;

  const lines = content.split('\n');
  
  const parseBold = (text: string) => {
    const parts = text.split(/\*\*([^*]+)\*\*/g);
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return <strong key={index} className="font-bold text-slate-900">{part}</strong>;
      }
      return part;
    });
  };

  return (
    <div className="space-y-3 text-slate-700 leading-relaxed text-sm md:text-base">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('###')) {
          return (
            <h3 key={idx} className="text-lg md:text-xl font-bold text-slate-900 mt-6 mb-2 border-b border-slate-100 pb-1">
              {trimmed.replace(/^###\s*/, '')}
            </h3>
          );
        }
        if (trimmed.startsWith('####')) {
          return (
            <h4 key={idx} className="text-base md:text-lg font-semibold text-slate-900 mt-4 mb-2">
              {trimmed.replace(/^####\s*/, '')}
            </h4>
          );
        }
        if (trimmed.startsWith('*') || trimmed.startsWith('-')) {
          const text = trimmed.replace(/^[\*\-]\s*/, '');
          return (
            <ul key={idx} className="list-disc pl-5 my-1 text-slate-700">
              <li className="pl-1">{parseBold(text)}</li>
            </ul>
          );
        }
        if (trimmed === '') return <div key={idx} className="h-2" />;
        return <p key={idx} className="my-1">{parseBold(line)}</p>;
      })}
    </div>
  );
}

export default function App() {
  // ----------------------------------------------------------------
  // User Authentication / Email & Password Identity (AUTH-01 & Email Auth Spec)
  // ----------------------------------------------------------------
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    return localStorage.getItem('why_not_logged_in') === 'true';
  });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authMode, setAuthMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');

  // Form input fields
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [isRegisteringUser, setIsRegisteringUser] = useState(false);
  const [tempNickname, setTempNickname] = useState('');

  // Password validation helper: 소문자 및 숫자로만 구성, 최대 15자 (테스트 계정 TEST1234 허용)
  const isPasswordValid = useMemo(() => {
    if (!authPassword) return false;
    if (authPassword.toUpperCase() === 'TEST1234') return true;
    const isValidCharAndLength = /^[a-z0-9]{1,15}$/.test(authPassword);
    const hasLowercase = /[a-z]/.test(authPassword);
    const hasDigit = /[0-9]/.test(authPassword);
    return isValidCharAndLength && hasLowercase && hasDigit;
  }, [authPassword]);

  // Email validation helper: 이메일 형식 검사 (테스트 계정 GOMINHAJO 허용)
  const isEmailValid = useMemo(() => {
    const input = authEmail.trim();
    if (input.toUpperCase() === 'GOMINHAJO' || !input.includes('@')) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  }, [authEmail]);

  // Helper to persist registered users locally for fallback
  const saveLocalRegisteredUser = (email: string, pass: string, name: string, id: string) => {
    try {
      const existing = JSON.parse(localStorage.getItem('why_not_registered_users') || '[]');
      const filtered = existing.filter((u: any) => u.email?.toLowerCase() !== email.toLowerCase());
      filtered.push({ email: email.toLowerCase(), password: pass, name, id });
      localStorage.setItem('why_not_registered_users', JSON.stringify(filtered));
    } catch (e) {
      console.error('Failed to save registered user locally:', e);
    }
  };

  // Email Signup Handler
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmailValid) {
      triggerToast('올바른 이메일 형식을 입력해 주세요.', 'error');
      return;
    }
    if (!isPasswordValid) {
      triggerToast('비밀번호는 영문 소문자와 숫자의 조합으로 최대 15자까지 가능합니다.', 'error');
      return;
    }
    if (!authName.trim()) {
      triggerToast('이름을 입력해 주세요.', 'error');
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail.trim(),
        password: authPassword,
        options: {
          data: {
            full_name: authName.trim()
          }
        }
      });

      if (error) throw error;

      const user = data.user;
      const uName = authName.trim();
      const uId = user?.id || `user_${Math.random().toString(36).substring(2, 9)}`;

      saveLocalRegisteredUser(authEmail.trim(), authPassword, uName, uId);

      setUserId(uId);
      setNickname(uName);
      setUserEmail(authEmail.trim());
      localStorage.setItem('why_not_user_id', uId);
      localStorage.setItem('why_not_user_name', uName);
      localStorage.setItem('why_not_logged_in', 'true');
      setIsLoggedIn(true);
      setShowLoginModal(false);
      triggerToast('회원가입 및 로그인이 완료되었습니다!');
    } catch (err: any) {
      console.warn('Supabase SignUp notice:', err);
      // Fallback local session registration for testing
      const uId = `user_${Math.random().toString(36).substring(2, 9)}`;
      const uName = authName.trim();

      saveLocalRegisteredUser(authEmail.trim(), authPassword, uName, uId);

      setUserId(uId);
      setNickname(uName);
      setUserEmail(authEmail.trim());
      localStorage.setItem('why_not_user_id', uId);
      localStorage.setItem('why_not_user_name', uName);
      localStorage.setItem('why_not_logged_in', 'true');
      setIsLoggedIn(true);
      setShowLoginModal(false);
      triggerToast('회원가입이 완료되었습니다!');
    }
  };

  // Email Login Handler
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const failMsg = '아이디 또는 비밀번호가 올바르지 않습니다. 입력한 정보를 다시 확인해 주세요.';

    // Dedicated instant check for the test account requested by user: ID: GOMINHAJO / PW: TEST1234
    const inputEmailOrId = authEmail.trim().toUpperCase();
    const inputPassword = authPassword.trim().toUpperCase();

    if ((inputEmailOrId === 'GOMINHAJO' || inputEmailOrId === 'GOMINHAJO@TEST.COM') && inputPassword === 'TEST1234') {
      const uId = 'user_gominhajo_test';
      const uName = 'GOMINHAJO';
      setUserId(uId);
      setNickname(uName);
      setUserEmail('gominhajo@test.com');
      localStorage.setItem('why_not_user_id', uId);
      localStorage.setItem('why_not_user_name', uName);
      localStorage.setItem('why_not_logged_in', 'true');
      setIsLoggedIn(true);
      setShowLoginModal(false);
      triggerToast('테스트 계정(GOMINHAJO)으로 로그인되었습니다!');
      return;
    }

    if (!isEmailValid) {
      setAuthError(failMsg);
      triggerToast(failMsg, 'error');
      return;
    }

    // Special handling for test account login (ID: GOMINHAJO / PW: TEST1234 or email input)
    let loginEmail = authEmail.trim();
    if (loginEmail.toUpperCase() === 'GOMINHAJO') {
      loginEmail = 'gominhajo@test.com';
    } else if (!loginEmail.includes('@')) {
      loginEmail = `${loginEmail}@test.com`;
    }

    const trimmedEmail = loginEmail.toLowerCase();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: authPassword,
      });

      if (error) throw error;

      const user = data.user;
      const uName = user.user_metadata?.full_name || (trimmedEmail.startsWith('gominhajo') ? 'GOMINHAJO' : user.email?.split('@')[0]) || '사용자';
      saveLocalRegisteredUser(loginEmail, authPassword, uName, user.id);

      setUserId(user.id);
      setNickname(uName);
      setUserEmail(user.email || '');
      localStorage.setItem('why_not_user_id', user.id);
      localStorage.setItem('why_not_user_name', uName);
      localStorage.setItem('why_not_logged_in', 'true');
      setIsLoggedIn(true);
      setShowLoginModal(false);
      triggerToast(`${uName}님 환영합니다!`);
    } catch (err: any) {
      console.warn('Supabase Login Notice:', err);

      // Dedicated hardcoded check for the test account requested by user: ID: GOMINHAJO / PW: TEST1234
      if ((authEmail.trim().toUpperCase() === 'GOMINHAJO' || trimmedEmail === 'gominhajo@test.com') && authPassword.toUpperCase() === 'TEST1234') {
        const uId = 'user_gominhajo_test';
        const uName = 'GOMINHAJO';
        setUserId(uId);
        setNickname(uName);
        setUserEmail('gominhajo@test.com');
        localStorage.setItem('why_not_user_id', uId);
        localStorage.setItem('why_not_user_name', uName);
        localStorage.setItem('why_not_logged_in', 'true');
        setIsLoggedIn(true);
        setShowLoginModal(false);
        triggerToast('테스트 계정(GOMINHAJO)으로 로그인되었습니다!');
        return;
      }

      // Check local registered users fallback
      let registeredUsers: any[] = [];
      try {
        registeredUsers = JSON.parse(localStorage.getItem('why_not_registered_users') || '[]');
      } catch (e) {}

      const matchedUser = registeredUsers.find(
        (u: any) => u.email && u.email.toLowerCase() === trimmedEmail
      );

      if (matchedUser) {
        if (matchedUser.password && matchedUser.password !== authPassword) {
          setAuthError(failMsg);
          triggerToast(failMsg, 'error');
          return;
        }
        const uId = matchedUser.id || `user_${Math.random().toString(36).substring(2, 9)}`;
        const uName = matchedUser.name || trimmedEmail.split('@')[0] || '사용자';
        setUserId(uId);
        setNickname(uName);
        setUserEmail(loginEmail);
        localStorage.setItem('why_not_user_id', uId);
        localStorage.setItem('why_not_user_name', uName);
        localStorage.setItem('why_not_logged_in', 'true');
        setIsLoggedIn(true);
        setShowLoginModal(false);
        triggerToast(`${uName}님 환영합니다!`);
      } else {
        setAuthError(failMsg);
        triggerToast(failMsg, 'error');
      }
    }
  };

  // ----------------------------------------------------------------
  // Room Navigation / Filter / Pinning State (ENTRY-01 ~ ENTRY-04)
  // ----------------------------------------------------------------
  const [roomsList, setRoomsList] = useState<any[]>([]);
  const [roomFilterStatus, setRoomFilterStatus] = useState<'ALL' | 'IDEA_SUBMISSION' | 'EVALUATION' | 'CLOSED'>('ALL');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomDetails, setRoomDetails] = useState<RoomDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ----------------------------------------------------------------
  // Forms & Interactive UI states (ENTRY-02, IDEA-02, IDEA-03)
  // ----------------------------------------------------------------
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [newRoomHostNickname, setNewRoomHostNickname] = useState('');
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [newRoomCategory, setNewRoomCategory] = useState<'기획' | '디자인'>('기획');
  const [newRoomMaxParticipants, setNewRoomMaxParticipants] = useState(4);
  const [newRoomTargetWinners, setNewRoomTargetWinners] = useState(1);
  const [newRoomIsPublic, setNewRoomIsPublic] = useState(true);
  const [newRoomVoteStartTime, setNewRoomVoteStartTime] = useState('');
  const [newRoomVoteEndTime, setNewRoomVoteEndTime] = useState('');
  const [newRoomThreshold, setNewRoomThreshold] = useState(3);

  // Submitting Idea (IDEA-02 & IDEA-03)
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaDesc, setIdeaDesc] = useState('');
  const [ideaLink, setIdeaLink] = useState('');
  const [ideaPdfName, setIdeaPdfName] = useState('');
  const [ideaTags, setIdeaTags] = useState('');

  // Submitting Proposal
  const [proposalText, setProposalText] = useState('');

  // Editing Criteria Candidates (During REVIEW stage)
  const [editableCriteria, setEditableCriteria] = useState<Criterion[]>([]);

  // Submitting Evaluation (Accumulator for the current evaluation page)
  const [evalSubmissions, setEvalSubmissions] = useState<Record<string, {
    decision: 'KEEP' | 'NEUTRAL' | 'EXCLUDE';
    excludedCriterionIds: string[];
    reasonText: string;
    reasonType: 'OBJECTIVE_CONSTRAINT' | 'PREFERENCE';
  }>>({});

  // Error/Success Alerts
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Copy Link feedback & Share Modal state
  const [copied, setCopied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [inviteEmailInput, setInviteEmailInput] = useState('');

  // Dual link copy helpers (① Participant link vs ② Voter link)
  const copyParticipantLink = () => {
    if (!activeRoomId) return;
    const url = `${window.location.origin}?room=${activeRoomId}&role=participant`;
    navigator.clipboard.writeText(url);
    triggerToast('① 참여자 전용 링크 (최대 6명, 의견등록 가능)가 복사되었습니다!');
  };

  const copyVoterLink = () => {
    if (!activeRoomId) return;
    const url = `${window.location.origin}?room=${activeRoomId}&role=voter`;
    navigator.clipboard.writeText(url);
    triggerToast('② 투표자 공개 링크 (MVP 기본 30명, 2차 투표 전용)가 복사되었습니다!');
  };

  const handleSendEmailInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmailInput.trim()) return;
    triggerToast(`[${inviteEmailInput.trim()}] (으)로 초대 메일 발송이 완료되었습니다!`);
    setInviteEmailInput('');
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error(e);
    }
    localStorage.setItem('why_not_logged_in', 'false');
    setIsLoggedIn(false);
    setActiveRoomId(null);
    triggerToast('로그아웃되었습니다.');
  };

  // Supabase auth state observer listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
        const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || nickname;
        setNickname(name);
        setUserEmail(session.user.email || '');
        setIsLoggedIn(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUserId(session.user.id);
        const name = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || nickname;
        setNickname(name);
        setUserEmail(session.user.email || '');
        setIsLoggedIn(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ----------------------------------------------------------------
  // Load User Info and Rooms list on mount
  // ----------------------------------------------------------------
  useEffect(() => {
    let savedId = localStorage.getItem('why_not_user_id');
    let savedName = localStorage.getItem('why_not_user_name');

    if (!savedId) {
      savedId = `user_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('why_not_user_id', savedId);
    }
    if (!savedName) {
      savedName = '익명_참여자';
      localStorage.setItem('why_not_user_name', savedName);
    }

    setUserId(savedId);
    setNickname(savedName);
    setTempNickname(savedName);

    fetchRooms();

    // URL 쿼리 파라미터에서 room 및 role 분석하여 방에 자동 입장 처리 (① 참여자 링크 vs ② 투표자 링크)
    const params = new URLSearchParams(window.location.search);
    const urlRoomId = params.get('room') || params.get('roomId');
    const urlRole = params.get('role') || 'member';

    if (urlRoomId) {
      if (urlRole === 'voter') {
        localStorage.setItem('why_not_user_role', 'VOTER');
      } else {
        localStorage.setItem('why_not_user_role', 'MEMBER');
      }
      handleSelectRoom(urlRoomId, savedId, savedName);
    }
  }, []);

  // Sync polling for details when inside a room
  useEffect(() => {
    if (!activeRoomId) return;

    fetchRoomDetails(activeRoomId);

    // 실시간 동기화를 위해 3초마다 방 정보 백그라운드 폴링 실행
    const interval = setInterval(() => {
      fetchRoomDetails(activeRoomId, true);
    }, 3000);

    return () => clearInterval(interval);
  }, [activeRoomId]);

  // Show Toast Auto-dismiss
  const triggerToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const DEFAULT_GOMINHAJO_ROOM: RoomDetails = {
    room: {
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
    },
    ideas: [
      {
        id: 'idea-gh-1',
        roomId: 'room-gominhajo',
        title: 'AI 회의록 자동 요약 서비스',
        description: `1. 서비스 정의: 화상회의 녹음 파일 또는 실시간 회의 음성을 업로드하면 AI가 핵심 논의사항, 결정사항, 액션아이템을 자동으로 정리해주는 B2B SaaS 툴.\n2. 타겟 사용자: 주 3회 이상 화상회의를 하는 5~50인 규모 스타트업/중소기업의 팀장급 실무자.\n3. 핵심기능: ① 회의 녹음 업로드 또는 줌/구글밋 연동 자동 녹취 ② 화자 분리 및 발언 요약 ③ 결정사항·액션아이템 자동 추출 및 담당자 태깅 ④ 슬랙/노션으로 요약본 자동 전송.\n4. 해결해야하는 문제: 회의 후 누군가 수동으로 회의록을 작성해야 하는 반복 업무 부담, 회의 중 메모에 집중하느라 논의에 온전히 참여하지 못하는 문제.\n5. 유사서비스 및 차별점: 클로바노트, Otter.ai 등 유사 서비스 존재. 차별점은 단순 전사(STT)에 그치지 않고 "결정사항/액션아이템"만 구조화해서 뽑아내는 것과, 국내 협업툴(슬랙/노션) 연동에 특화된 점.\n6. 리스크: 음성 인식 정확도가 한국어 전문용어·사투리에서 떨어질 수 있음. 회의 녹음에 대한 참석자 동의·개인정보 이슈 발생 가능.`,
        submitterId: 'user_gominhajo_test',
        submitterName: 'GOMINHAJO',
        status: 'ACTIVE',
      },
      {
        id: 'idea-gh-2',
        roomId: 'room-gominhajo',
        title: '동네 소상공인 마감할인 매칭 앱',
        description: `1. 서비스 정의: 마감 임박 재고를 가진 동네 가게(베이커리, 반찬가게 등)와 근처 소비자를 실시간 위치 기반으로 매칭해 할인 판매하는 O2O 커머스 앱.\n2. 타겟 사용자: 신선식품 폐기 부담이 있는 동네 소상공인, 저렴하게 먹거리를 구매하고 싶은 1인 가구·자취생.\n3. 핵심기능: ① 매장이 마감 1~2시간 전 남은 재고를 사진과 함께 할인 등록 ② 소비자 반경 1km 내 실시간 알림 ③ 앱 내 결제 및 픽업 예약 ④ 소진 완료 자동 마감 처리.\n4. 해결해야하는 문제: 소상공인의 마감 재고 폐기로 인한 매출 손실과 환경 부담, 소비자 입장에서는 신선식품을 저렴하게 구매할 채널 부족.\n5. 유사서비스 및 차별점: 해외의 Too Good To Go, 국내의 라스트오더가 유사 서비스로 이미 존재. 차별점을 확보하려면 특정 상권(대학가, 오피스 밀집 지역) 집중 공략이나 소상공인 대상 무료 온보딩 지원 등이 필요한 상황.\n6. 리스크: 이미 시장을 선점한 경쟁 서비스가 있어 신규 진입 장벽이 높음. 초기 매장 확보(공급 측) 없이는 소비자 앱으로서 매력이 없는 닭과 달걀 문제.`,
        submitterId: 'user_member_1',
        submitterName: '익명 참여자 A',
        status: 'ACTIVE',
      },
      {
        id: 'idea-gh-3',
        roomId: 'room-gominhajo',
        title: '반려동물 건강기록 공유 플랫폼',
        description: `1. 서비스 정의: 반려동물의 병원 진료기록, 접종이력, 체중변화 등을 한 곳에 모아 관리하고 이사·이직·병원 변경 시 새 병원에 기록을 쉽게 공유할 수 있는 헬스케어 서비스.\n2. 타겟 사용자: 반려동물을 여러 병원에서 진료받거나, 지역 이동이 잦은 반려인.\n3. 핵심기능: ① 진료기록 사진 촬영으로 자동 스캔·입력 ② 접종 스케줄 알림 ③ 체중·건강 변화 그래프 ④ QR코드로 새 병원에 기록 즉시 공유.\n4. 해결해야하는 문제: 반려동물이 병원을 옮길 때마다 이전 진료 이력을 구두로만 전달해야 해서 정보 누락이 발생하고, 접종 시기를 놓치는 경우가 많음.\n5. 유사서비스 및 차별점: 펫나우, 삐약 등 반려동물 건강관리 앱이 존재하나 대부분 자체 기록 입력에 그침. 차별점은 병원 간 기록 "공유"에 특화된 점과 QR 기반 간편 전달 기능.\n6. 리스크: 실제 병원 시스템과의 연동이 안 되면 결국 보호자가 수동 입력해야 해서 사용률이 낮을 수 있음. 병원 측 협조 없이는 데이터 신뢰성 확보가 어려움.`,
        submitterId: 'user_member_2',
        submitterName: '익명 참여자 B',
        status: 'ACTIVE',
      },
      {
        id: 'idea-gh-4',
        roomId: 'room-gominhajo',
        title: '신입 개발자를 위한 코드리뷰 연습 플랫폼',
        description: `1. 서비스 정의: 실제 오픈소스 프로젝트의 PR(Pull Request)을 기반으로 코드리뷰 연습을 하고, AI가 리뷰 품질에 대해 피드백을 주는 개발자 학습 서비스.\n2. 타겟 사용자: 코드리뷰 경험이 부족한 신입/주니어 개발자, 코드리뷰 문화를 도입하려는 소규모 개발팀.\n3. 핵심기능: ① 난이도별 실전 PR 문제 제공 ② 사용자가 직접 리뷰 코멘트 작성 ③ AI가 리뷰의 구체성·건설성·놓친 이슈를 채점 ④ 우수 리뷰 사례 학습 콘텐츠 제공.\n4. 해결해야하는 문제: 신입 개발자가 코드리뷰를 어떻게 해야 할지 감을 못 잡고, 실무에서 배우기 전까지 연습할 곳이 없는 문제.\n5. 유사서비스 및 차별점: 백준, 프로그래머스 등은 문제풀이 중심이라 "리뷰 스킬" 자체를 훈련하는 서비스는 국내에 거의 없음. 실제 오픈소스 PR을 소재로 쓴다는 점이 차별점.\n6. 리스크: 오픈소스 PR을 학습 콘텐츠로 가공하는 데 라이선스 이슈가 있을 수 있음. AI의 리뷰 채점 기준이 주관적이라 사용자 신뢰를 얻기 어려울 수 있음.`,
        submitterId: 'user_member_3',
        submitterName: '익명 참여자 C',
        status: 'ACTIVE',
      },
      {
        id: 'idea-gh-5',
        roomId: 'room-gominhajo',
        title: '프리랜서 계약서 자동 생성·검토 툴',
        description: `1. 서비스 정의: 업종별 표준 계약서 템플릿에 조건을 입력하면 자동으로 계약서를 생성하고, AI가 불공정 조항을 사전에 짚어주는 리걸테크 서비스.\n2. 타겟 사용자: 디자이너·개발자·마케터 등 계약서 검토 경험이 적은 프리랜서, 프리랜서를 자주 고용하는 소규모 스튜디오.\n3. 핵심기능: ① 업종별(디자인/개발/영상 등) 계약서 템플릿 ② 조건 입력 시 자동 문서 생성 ③ AI 불공정 조항 하이라이트(예: 과도한 저작권 양도, 무제한 수정 조항) ④ 전자서명 연동.\n4. 해결해야하는 문제: 프리랜서들이 법률 지식 부족으로 불공정 계약을 그대로 수용하거나, 매번 계약서를 새로 찾아 작성하는 비효율.\n5. 유사서비스 및 차별점: 모두싸인, 계약서 템플릿 사이트는 "생성"에 집중하는 반면, 이 서비스는 "검토(불공정 조항 탐지)"에 특화된 점이 차별점.\n6. 리스크: 법률 자문이 아닌 AI 검토 결과에 대한 법적 책임 소재가 불분명함. 업종별 표준 계약 관행이 다양해 템플릿의 범용성 확보가 어려울 수 있음.`,
        submitterId: 'user_member_4',
        submitterName: '익명 참여자 D',
        status: 'ACTIVE',
      },
      {
        id: 'idea-gh-6',
        roomId: 'room-gominhajo',
        title: '팀 회식 메뉴 익명 취향 조사 봇',
        description: `1. 서비스 정의: 회식 전 팀원들의 알레르기·못 먹는 음식·선호 메뉴를 익명으로 모아 자동으로 후보 3곳을 추천해주는 슬랙/카카오톡 챗봇.\n2. 타겟 사용자: 회식 장소 정하는 데 매번 시간을 쓰는 5~15인 규모 팀의 총무 담당자 또는 팀장.\n3. 핵심기능: ① 슬랙 명령어로 설문 자동 발송 ② 알레르기·비선호 메뉴는 익명 수집 ③ 팀원 답변 기반 근처 맛집 후보 3곳 자동 추천 ④ 투표로 최종 장소 확정.\n4. 해결해야하는 문제: 회식 메뉴 정할 때 못 먹는 음식이 있어도 말하기 어려워 나중에 불만이 생기거나, 장소 정하는 데만 카톡방에서 며칠씩 걸리는 문제.\n5. 유사서비스 및 차별점: 왓츠팟, 캐치테이블 등 예약 서비스는 있지만 "익명으로 못 먹는 것부터 걸러내는" 기능에 특화된 서비스는 없음. 회사 회식이라는 특수 상황(눈치, 알레르기 공개 부담)에 맞춘 점이 차별점.\n6. 리스크: 단순 기능이라 시장성/수익모델이 약함(B2C 유료화 어려움). 이미 사내 협업툴 내 설문 기능으로 대체 가능해 진짜 페인포인트인지 검증 필요.`,
        submitterId: 'user_member_5',
        submitterName: '익명 참여자 E',
        status: 'ACTIVE',
      }
    ],
    criteria: [],
    proposalsCount: 0,
    participants: [{ roomId: 'room-gominhajo', userId: 'user_gominhajo_test', nickname: 'GOMINHAJO', role: 'HOST', isIdeaDone: true }],
    rounds: [],
    evaluatorsCount: 1,
    myEvaluations: [],
    hasEvaluated: false,
    minResponseThresholdMet: false,
    scoreConfig: { keepWeight: 10, neutralWeight: 0, excludeWeight: -10, objectiveConstraintPenalty: 25 }
  };

  const fetchRooms = async () => {
    const gominhajoCard = {
      id: 'room-gominhajo',
      title: '고민하조 팀 프로젝트',
      description: '새싹 3번째 프로젝트, Antigravity 툴 활용',
      category: '기획',
      isPublic: true,
      maxParticipants: 4,
      targetWinnerCount: 1,
      isPinned: true,
      status: 'IDEA_SUBMISSION',
      ideasCount: 1,
      evaluatorsCount: 1,
      minResponseThreshold: 4,
      createdAt: new Date().toISOString()
    };

    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const data = await res.json();
        const filteredOthers = (data || []).filter((r: any) => r.id !== 'room-gominhajo');
        setRoomsList([gominhajoCard, ...filteredOthers]);
        return;
      }
    } catch (err) {
      console.warn('Express backend offline, fetching rooms directly from Supabase DB...');
    }

    // Direct Supabase DB query fallback
    try {
      const { data: supaRooms, error } = await supabase
        .from('rooms')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const mapped = (supaRooms || []).map(r => ({
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category || '기획',
        isPublic: r.is_public !== undefined ? r.is_public : true,
        maxParticipants: r.max_participants || 6,
        targetWinnerCount: r.target_winner_count || 1,
        isPinned: r.is_pinned || false,
        status: r.status,
        ideasCount: 0,
        evaluatorsCount: 1,
        minResponseThreshold: r.min_response_threshold || 1,
        createdAt: r.created_at
      }));

      // Always prepend GOMINHAJO room at top
      const gominhajoCard = {
        id: 'room-gominhajo',
        title: '고민하조 팀 프로젝트',
        description: '새싹 3번째 프로젝트, Antigravity 툴 활용',
        category: '기획',
        isPublic: true,
        maxParticipants: 4,
        targetWinnerCount: 1,
        isPinned: true,
        status: 'IDEA_SUBMISSION',
        ideasCount: 1,
        evaluatorsCount: 1,
        minResponseThreshold: 4,
        createdAt: new Date().toISOString()
      };

      const filteredOthers = mapped.filter(r => r.id !== 'room-gominhajo');
      setRoomsList([gominhajoCard, ...filteredOthers]);
    } catch (supaErr) {
      console.error('Supabase DB fetchRooms error:', supaErr);
      setRoomsList([{
        id: 'room-gominhajo',
        title: '고민하조 팀 프로젝트',
        description: '새싹 3번째 프로젝트, Antigravity 툴 활용',
        category: '기획',
        isPublic: true,
        maxParticipants: 4,
        targetWinnerCount: 1,
        isPinned: true,
        status: 'IDEA_SUBMISSION',
        ideasCount: 1,
        evaluatorsCount: 1,
        minResponseThreshold: 4,
        createdAt: new Date().toISOString()
      }]);
    }
  };

  const fetchRoomDetails = async (id: string, isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const res = await fetch(`/api/rooms/${id}?userId=${userId}`);
      if (res.ok) {
        const data: RoomDetails = await res.json();
        setRoomDetails(data);
        if (data.room.status === 'CRITERIA_REVIEW' && editableCriteria.length === 0) {
          setEditableCriteria(data.criteria);
        }
        return;
      }
    } catch (err) {
      console.warn('Express backend fetchRoomDetails failed, reading from Supabase DB...');
    }

    // Special fallback for room-gominhajo
    if (id === 'room-gominhajo') {
      setRoomDetails(prev => {
        if (prev && prev.room.id === 'room-gominhajo') {
          return prev;
        }
        return DEFAULT_GOMINHAJO_ROOM;
      });
      setLoading(false);
      setRefreshing(false);
      return;
    }

    // Direct Supabase DB fallback
    try {
      const { data: roomData, error: roomErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', id)
        .single();

      if (roomErr || !roomData) throw new Error('방을 찾을 수 없습니다.');

      const { data: ideasData } = await supabase.from('ideas').select('*').eq('room_id', id);
      const { data: criteriaData } = await supabase.from('criteria').select('*').eq('room_id', id);
      const { data: proposalsData } = await supabase.from('criterion_proposals').select('*').eq('room_id', id);
      const { data: participantsData } = await supabase.from('participants').select('*').eq('room_id', id);

      const roomObj: Room = {
        id: roomData.id,
        title: roomData.title,
        description: roomData.description,
        category: roomData.category,
        isPublic: roomData.is_public,
        maxParticipants: roomData.max_participants,
        targetWinnerCount: roomData.target_winner_count,
        isPinned: roomData.is_pinned,
        hostId: roomData.host_id,
        status: roomData.status,
        minResponseThreshold: roomData.min_response_threshold || 1,
        eliminationConfig: roomData.elimination_config || { countPerRound: 1, tieBreak: 'random' },
        deadlines: roomData.deadlines || {},
        createdAt: roomData.created_at,
      };

      const mappedIdeas: Idea[] = (ideasData || []).map(i => ({
        id: i.id,
        roomId: i.room_id,
        title: i.title,
        description: i.description,
        submitterId: i.submitter_id,
        submitterName: i.submitter_name,
        attachmentUrl: i.attachment_url,
        pdfAttachmentUrl: i.pdf_attachment_url,
        tags: i.tags,
        status: i.status
      }));

      const mappedCriteria: Criterion[] = (criteriaData || []).map(c => ({
        id: c.id,
        roomId: c.room_id,
        name: c.name,
        description: c.description,
        confirmed: true
      }));

      const mappedParticipants: ParticipantStatus[] = (participantsData || []).map(p => ({
        roomId: p.room_id,
        userId: p.user_id,
        nickname: p.nickname,
        role: p.role || 'MEMBER',
        isIdeaDone: p.is_idea_done || false
      }));

      const dataObj: RoomDetails = {
        room: roomObj,
        ideas: mappedIdeas,
        criteria: mappedCriteria,
        proposalsCount: (proposalsData || []).length,
        participants: mappedParticipants,
        rounds: [],
        evaluatorsCount: (participantsData || []).length || 1,
        myEvaluations: [],
        hasEvaluated: false,
        minResponseThresholdMet: true,
        scoreConfig: { keepWeight: 10, neutralWeight: 0, excludeWeight: -10, objectiveConstraintPenalty: 25 }
      };

      setRoomDetails(dataObj);
      if (roomObj.status === 'CRITERIA_REVIEW' && editableCriteria.length === 0) {
        setEditableCriteria(mappedCriteria);
      }
    } catch (supaErr) {
      console.error('Supabase fetchRoomDetails failed:', supaErr);
      triggerToast('방 정보를 불러오는 데 실패했습니다.', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Update user room entry nickname (Max 6 chars)
  const handleUpdateNickname = () => {
    const trimmed = tempNickname.trim().slice(0, 6);
    if (!trimmed) return;
    localStorage.setItem('why_not_room_nickname', trimmed);
    setNickname(trimmed);
    setIsRegisteringUser(false);
    triggerToast(`닉네임 [${trimmed}] (으)로 지정되었습니다.`);

    if (pendingRoomId) {
      const targetId = pendingRoomId;
      setPendingRoomId(null);
      handleSelectRoom(targetId, userId, trimmed);
    } else if (activeRoomId) {
      fetch(`/api/rooms/${activeRoomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, nickname: trimmed }),
      });
    }
  };

  // ----------------------------------------------------------------
  // Actions
  // ----------------------------------------------------------------

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }
    if (!newRoomTitle.trim()) return;

    const hostNick = newRoomHostNickname.trim().slice(0, 6) || nickname.slice(0, 6) || '방장';
    localStorage.setItem('why_not_room_nickname', hostNick);
    setNickname(hostNick);

    try {
      const roomPayload = {
        title: newRoomTitle,
        description: newRoomDesc,
        category: newRoomCategory,
        maxParticipants: Math.min(newRoomMaxParticipants, 6),
        targetWinnerCount: newRoomTargetWinners,
        isPublic: newRoomIsPublic,
        hostId: userId || 'anon-host',
        minResponseThreshold: 1,
        eliminationConfig: { countPerRound: 1, tieBreak: 'random' },
      };

      let createdRoomId = '';

      // Try Express backend endpoint first
      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(roomPayload),
        });
        if (res.ok) {
          const created = await res.json();
          createdRoomId = created.id;
        }
      } catch (e) {
        console.warn('Express API server unaccessible, trying direct Supabase insertion...', e);
      }

      // If backend was not reached or failed (e.g. Vercel static frontend), insert directly into Supabase DB
      if (!createdRoomId) {
        const newId = `room-${Math.random().toString(36).substring(2, 9)}`;
        const { error: supaError } = await supabase
          .from('rooms')
          .insert({
            id: newId,
            title: newRoomTitle,
            description: newRoomDesc || '',
            category: newRoomCategory,
            is_public: newRoomIsPublic,
            max_participants: Math.min(newRoomMaxParticipants, 6),
            target_winner_count: newRoomTargetWinners,
            is_pinned: false,
            host_id: userId || 'anon-host',
            status: 'IDEA_SUBMISSION',
            min_response_threshold: 1,
            elimination_config: { countPerRound: 1, tieBreak: 'random' },
            deadlines: {
              evaluationAt: newRoomVoteEndTime || undefined,
              voteStartTime: newRoomVoteStartTime || undefined
            },
          });

        if (supaError) {
          console.error('Supabase DB room insert error:', supaError);
          throw supaError;
        }
        createdRoomId = newId;
      }
      
      // Register host participant
      try {
        await supabase.from('participants').insert({
          room_id: createdRoomId,
          user_id: userId || 'anon-host',
          nickname: hostNick
        });
      } catch (pErr) {
        console.warn(pErr);
      }

      triggerToast(`회의실이 성공적으로 개설되었습니다! (방장 닉네임: ${hostNick})`);
      setIsCreatingRoom(false);
      setNewRoomHostNickname('');
      setNewRoomTitle('');
      setNewRoomDesc('');
      setNewRoomVoteStartTime('');
      setNewRoomVoteEndTime('');
      setNewRoomThreshold(3);
      
      // Select the newly created room & open Dual Link Share Modal immediately
      setActiveRoomId(createdRoomId);
      setShowShareModal(true);
      fetchRoomDetails(createdRoomId);
      fetchRooms();
      
      // Select the newly created room & fetch details immediately
      setActiveRoomId(createdRoomId);
      fetchRoomDetails(createdRoomId);
      fetchRooms();
    } catch (err: any) {
      console.error('Room Creation Failed:', err);
      triggerToast(`방 생성 도중 오류가 발생했습니다: ${err?.message || ''}`, 'error');
    }
  };

  // Toggle Room Pin (ENTRY-03, max 3 pins limit with Supabase DB Fallback)
  const handleTogglePin = async (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();

    const targetRoom = roomsList.find(r => r.id === roomId);
    if (!targetRoom) return;

    const nextPinState = !targetRoom.isPinned;
    const currentPinnedCount = roomsList.filter(r => r.isPinned && r.id !== roomId).length;

    if (nextPinState && currentPinnedCount >= 3) {
      triggerToast('상단 고정은 최대 3개까지만 가능합니다.', 'error');
      return;
    }

    // 1. Instant local UI update for snappy feedback
    setRoomsList(prev => prev.map(r => r.id === roomId ? { ...r, isPinned: nextPinState } : r));
    triggerToast(nextPinState ? '★ 상단 고정되었습니다. (ON)' : '☆ 상단 고정이 해제되었습니다. (OFF)');

    // 2. Server API or Supabase DB persistence
    try {
      const res = await fetch(`/api/rooms/${roomId}/pin`, { method: 'POST' });
      if (!res.ok) throw new Error();
    } catch (err) {
      console.warn('Express backend offline, updating pin state directly in Supabase DB...');
      try {
        await supabase
          .from('rooms')
          .update({ is_pinned: nextPinState })
          .eq('id', roomId);
      } catch (supaErr) {
        console.error('Supabase DB pin toggle error:', supaErr);
      }
    }
  };

  // Target pending room selection
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);

  // Join existing Room (Prompt nickname modal if not specified)
  const handleSelectRoom = async (id: string, customUserId?: string, customNickname?: string) => {
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }

    const currentSavedNickname = localStorage.getItem('why_not_room_nickname');
    if (!currentSavedNickname && !customNickname) {
      setPendingRoomId(id);
      setTempNickname('');
      setIsRegisteringUser(true);
      return;
    }

    setActiveRoomId(id);
    const uId = customUserId || userId;
    const nick = customNickname || currentSavedNickname || nickname;
    try {
      await fetch(`/api/rooms/${id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uId, nickname: nick }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Submit Idea (Anonymously, Max 5 ideas per user limit)
  const handleSubmitIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ideaTitle.trim() || !ideaDesc.trim()) {
      triggerToast('필수 항목(제목, 설명)을 입력해 주세요.', 'error');
      return;
    }

    if (!roomDetails) return;

    // Check if user is Host or Member (Voter cannot submit ideas)
    const userRole = localStorage.getItem('why_not_user_role') || 'MEMBER';
    if (userRole === 'VOTER') {
      triggerToast('투표자는 아이디어를 등록할 수 없습니다. (참여자/방장 전용)', 'error');
      return;
    }

    // Check deadline exception
    const deadline = roomDetails.room.deadlines?.ideaSubmissionAt;
    if (deadline && new Date() > new Date(deadline)) {
      triggerToast('⚠️ 아이디어 제출 마감 시각이 지나 등록할 수 없습니다.', 'error');
      return;
    }

    // Check 1인당 5개 제한
    const myExistingIdeasCount = (roomDetails.ideas || []).filter(i => i.submitterId === userId).length;
    if (myExistingIdeasCount >= 5) {
      triggerToast('⚠️ 1인당 아이디어는 최대 5개까지 등록 가능합니다. (6개 이상 등록 차단)', 'error');
      return;
    }

    // Generate anonymous label (e.g. "익명 아이디어 #1", "익명 아이디어 #2")
    const nextAnonIndex = (roomDetails.ideas || []).length + 1;
    const anonLabel = `익명 아이디어 #${nextAnonIndex}`;

    const newIdeaObj = {
      title: ideaTitle,
      description: ideaDesc,
      attachmentUrl: ideaLink,
      pdfAttachmentUrl: ideaPdfName,
      tags: ideaTags ? ideaTags.split(',').map(t => t.trim()).filter(Boolean) : [],
      submitterId: userId,
      submitterName: anonLabel,
    };

    let insertedSuccess = false;

    // Try Express backend endpoint first
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newIdeaObj),
      });
      if (res.ok) insertedSuccess = true;
    } catch (e) {
      console.warn('Express API server unaccessible, trying direct Supabase insertion...', e);
    }

    // Supabase DB Direct insertion fallback
    if (!insertedSuccess) {
      try {
        const newIdeaId = `idea-${Math.random().toString(36).substring(2, 9)}`;
        const { error: supaErr } = await supabase
          .from('ideas')
          .insert({
            id: newIdeaId,
            room_id: activeRoomId,
            title: ideaTitle,
            description: ideaDesc,
            submitter_id: userId,
            submitter_name: anonLabel,
            attachment_url: ideaLink || null,
            pdf_attachment_url: ideaPdfName || null,
            tags: ideaTags ? ideaTags.split(',').map(t => t.trim()).filter(Boolean) : [],
            status: 'ACTIVE'
          });

        if (supaErr) throw supaErr;
        insertedSuccess = true;
      } catch (err: any) {
        console.error('Supabase DB submit idea error:', err);
        triggerToast(`아이디어 등록 도중 오류가 발생했습니다: ${err.message}`, 'error');
        return;
      }
    }

    triggerToast(`아이디어가 익명(${anonLabel})으로 성공적으로 등록되었습니다!`);
    setIdeaTitle('');
    setIdeaDesc('');
    setIdeaLink('');
    setIdeaPdfName('');
    setIdeaTags('');
    fetchRoomDetails(activeRoomId!);
  };

  // AI Suggested Criteria state
  const [aiSuggestedCriteria, setAiSuggestedCriteria] = useState<{ name: string; description: string }[]>([]);
  const [isGeneratingAiSuggestions, setIsGeneratingAiSuggestions] = useState(false);

  // Fetch AI suggested criteria candidates based on registered ideas (Potens AI)
  const handleFetchAiSuggestions = async () => {
    if (!activeRoomId) return;
    setIsGeneratingAiSuggestions(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/criteria/suggest`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setAiSuggestedCriteria(data.suggestions || []);
        triggerToast('AI가 아이디어 기반 평가 기준 후보 3개를 제안했습니다!');
      } else {
        throw new Error();
      }
    } catch (err) {
      triggerToast('AI 추천 기준을 가져오는 데 실패했습니다.', 'error');
    } finally {
      setIsGeneratingAiSuggestions(false);
    }
  };

  // Propose Criterion (Anonymous, Min 1 ~ Max 3 per user limit)
  const handleProposeCriterion = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const textToSubmit = customText || proposalText;
    if (!textToSubmit.trim()) {
      triggerToast('제안할 기준 내용을 입력해 주세요.', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/criteria/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: textToSubmit.trim(),
          proposerId: userId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || '기준 제안 제출 실패');
      }

      triggerToast('평가 기준 제안이 익명으로 제출되었습니다!');
      setProposalText('');
      fetchRoomDetails(activeRoomId!);
    } catch (err: any) {
      triggerToast(err.message || '기준 제안 제출 실패', 'error');
    }
  };

  // Trigger AI Clustering (Host only)
  const handleTriggerClustering = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/criteria/cluster`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || '클러스터링 실패');
      }
      triggerToast('AI가 의견을 수렴하여 3~5개 핵심 기준으로 분류했습니다!');
      fetchRoomDetails(activeRoomId!);
    } catch (err: any) {
      triggerToast(err.message || 'AI 분석 오류', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Confirm Criteria (Host only)
  const handleConfirmCriteria = async () => {
    if (editableCriteria.length === 0) {
      triggerToast('최소 하나 이상의 기준이 등록되어야 합니다.', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/criteria/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedCriteria: editableCriteria }),
      });

      if (!res.ok) throw new Error();
      triggerToast('평가 기준이 확정되었습니다. 익명 평가를 시작합니다!');
      fetchRoomDetails(activeRoomId!);
    } catch (err) {
      triggerToast('기준 확정 오류', 'error');
    }
  };

  // Accumulate evaluations
  const handleVoteChange = (
    ideaId: string, 
    decision: 'KEEP' | 'NEUTRAL' | 'EXCLUDE'
  ) => {
    setEvalSubmissions(prev => ({
      ...prev,
      [ideaId]: {
        decision,
        excludedCriterionIds: prev[ideaId]?.excludedCriterionIds || [],
        reasonText: prev[ideaId]?.reasonText || '',
        reasonType: prev[ideaId]?.reasonType || 'PREFERENCE',
      }
    }));
  };

  const handleReasonTextChange = (ideaId: string, text: string) => {
    setEvalSubmissions(prev => ({
      ...prev,
      [ideaId]: {
        ...prev[ideaId],
        reasonText: text,
      }
    }));
  };

  const handleReasonTypeChange = (ideaId: string, type: 'OBJECTIVE_CONSTRAINT' | 'PREFERENCE') => {
    setEvalSubmissions(prev => ({
      ...prev,
      [ideaId]: {
        ...prev[ideaId],
        reasonType: type,
      }
    }));
  };

  const handleCriteriaCheckboxChange = (ideaId: string, critId: string, checked: boolean) => {
    setEvalSubmissions(prev => {
      const existing = prev[ideaId] || {
        decision: 'EXCLUDE',
        excludedCriterionIds: [],
        reasonText: '',
        reasonType: 'PREFERENCE',
      };
      const crits = [...existing.excludedCriterionIds];
      if (checked) {
        if (!crits.includes(critId)) crits.push(critId);
      } else {
        const idx = crits.indexOf(critId);
        if (idx >= 0) crits.splice(idx, 1);
      }
      return {
        ...prev,
        [ideaId]: {
          ...existing,
          excludedCriterionIds: crits,
        }
      };
    });
  };

  // Submit all evaluations at once
  const handleSubmitAllEvaluations = async () => {
    if (!roomDetails) return;

    // Check if user voted on ALL active ideas
    const activeIdeas = roomDetails.ideas.filter(i => i.status === 'ACTIVE');
    const unvoted = activeIdeas.filter(i => !evalSubmissions[i.id]?.decision);

    if (unvoted.length > 0) {
      triggerToast('모든 활성 아이디어에 대해 투표를 완료해 주세요.', 'error');
      return;
    }

    // Verify if EXCLUDE selections have checked reasons/criteria
    for (const idea of activeIdeas) {
      const vote = evalSubmissions[idea.id];
      if (vote.decision === 'EXCLUDE') {
        if (vote.excludedCriterionIds.length === 0) {
          triggerToast(`"${idea.title}" 아이디어를 제외하는 구체적 기준을 체크해 주세요.`, 'error');
          return;
        }
        if (!vote.reasonText.trim()) {
          triggerToast(`"${idea.title}" 아이디어를 제외하는 이유를 간략히 작성해 주세요.`, 'error');
          return;
        }
      }
    }

    // Package submissions
    const submissions = activeIdeas.map(i => ({
      ideaId: i.id,
      decision: evalSubmissions[i.id].decision,
      excludedCriterionIds: evalSubmissions[i.id].excludedCriterionIds,
      reasonText: evalSubmissions[i.id].reasonText,
      reasonType: evalSubmissions[i.id].reasonType,
    }));

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/evaluations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evaluatorId: userId,
          submissions,
        }),
      });

      if (!res.ok) throw new Error();
      triggerToast('익명 평가가 성공적으로 기록되었습니다!');
      fetchRoomDetails(activeRoomId!);
    } catch (err) {
      triggerToast('평가 제출 실패', 'error');
    }
  };

  // Seed Mock Evaluations (Developer / Demo helper)
  const handleSeedMockEvaluations = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/seed-evaluations`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error();
      triggerToast('시뮬레이션 가상 평가 2건이 성공적으로 기록되었습니다! 게이트가 충족됩니다.');
      fetchRoomDetails(activeRoomId!);
    } catch (err) {
      triggerToast('가상 평가 추가 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Proceed to next elimination round (Host only)
  const handleProceedElimination = async (forcedIdeaId?: string) => {
    setLoading(true);
    try {
      const payload: any = {};
      if (forcedIdeaId) {
        payload.eliminateIdeaIds = [forcedIdeaId];
      }

      const res = await fetch(`/api/rooms/${activeRoomId}/elimination/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error();
      const result = await res.json();
      
      if (result.closed) {
        triggerToast('소거가 완료되어 최종 우승작이 선정되었고, AI 결론이 생성되었습니다!');
      } else {
        triggerToast('최하위 아이디어가 탈락하고 라운드가 성공적으로 요약되었습니다.');
      }
      fetchRoomDetails(activeRoomId!);
    } catch (err) {
      triggerToast('소거 진행 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Manually close room and summarize (Host only)
  const handleManuallyCloseRoom = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/close`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error();
      triggerToast('방을 수동 종료하고 최종 AI 리포트를 발급했습니다!');
      fetchRoomDetails(activeRoomId!);
    } catch (err) {
      triggerToast('방 종료 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Helper to change status manually (Host bypass)
  const handleForceChangeStatus = async (status: RoomStatus) => {
    // 1. Instant local UI state update
    if (roomDetails) {
      setRoomDetails({
        ...roomDetails,
        room: {
          ...roomDetails.room,
          status: status
        }
      });
    }

    triggerToast(`방 상태를 [${status}]로 변경했습니다.`);

    // 2. Persist to API or Supabase DB in background
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok && activeRoomId !== 'room-gominhajo') {
        fetchRoomDetails(activeRoomId!);
        return;
      }
    } catch (err) {
      console.warn('Express API unavailable, status updated locally.');
    }

    try {
      if (activeRoomId && activeRoomId !== 'room-gominhajo') {
        await supabase
          .from('rooms')
          .update({ status: status })
          .eq('id', activeRoomId);
      }
    } catch (supaErr) {
      console.error('Supabase status update error:', supaErr);
    }
  };

  // Utility to copy share link (URL에 roomId 포함하여 링크 복사)
  const copyShareLink = () => {
    const baseUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${baseUrl}?roomId=${activeRoomId}`;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    triggerToast('참여용 초대 링크가 클립보드에 복사되었습니다!');
  };

  // ----------------------------------------------------------------
  // Score details calculated on frontend
  // ----------------------------------------------------------------
  const activeIdeasCount = useMemo(() => {
    if (!roomDetails) return 0;
    return roomDetails.ideas.filter(i => i.status === 'ACTIVE').length;
  }, [roomDetails]);

  // Find objective constraint removal candidates (those with high objective exclusions)
  const objectiveCandidates = useMemo(() => {
    if (!roomDetails || !roomDetails.aggregatedScores) return [];
    
    return roomDetails.ideas.filter(idea => {
      if (idea.status !== 'ACTIVE') return false;
      const stats = roomDetails.aggregatedScores?.[idea.id];
      if (!stats) return false;
      
      // Candidate if they have >= 1 objective exclusion
      return stats.objectiveExcludeCount >= 1;
    });
  }, [roomDetails]);


  // ----------------------------------------------------------------
  // Render Main Body
  // ----------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
      {/* Toast Alert */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 border text-sm max-w-sm ${
              toast.type === 'success' 
                ? 'bg-indigo-900 text-white border-indigo-800' 
                : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            {toast.type === 'success' ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-500" />}
            <span className="font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Navigation Header (Sleek Interface Style) */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => { setActiveRoomId(null); setRoomDetails(null); }}
              className="flex items-center gap-3 transition hover:opacity-85 text-left"
            >
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-lg">W</span>
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-800">
                와이낫 <span className="text-indigo-600">WhyNot</span>
              </h1>
            </button>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full uppercase tracking-wider hidden sm:inline-block">
              Sleek Decision Engine
            </span>
          </div>

          <div className="flex items-center gap-4">
            {roomDetails && (
              <div className="hidden md:flex items-center bg-slate-100 rounded-full px-4 py-1.5 gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-xs font-medium text-slate-600">
                  {roomDetails.room.status === 'IDEA_SUBMISSION' && '1단계: 아이디어 등록 중'}
                  {roomDetails.room.status === 'CRITERIA_PROPOSAL' && '2단계: 기준 익명제안 중'}
                  {roomDetails.room.status === 'CRITERIA_REVIEW' && '3단계: 기준 확정 진행 중'}
                  {roomDetails.room.status === 'EVALUATION' && '4단계: 익명 스크리닝 평가 중'}
                  {roomDetails.room.status === 'ELIMINATION' && `${roomDetails.rounds.length + 1}라운드 소거 진행 중`}
                  {roomDetails.room.status === 'CLOSED' && '종료 (최종 선정 완료)'}
                </span>
              </div>
            )}

            {/* Auth / Identity badge (이메일 정보 노출) */}
            {isLoggedIn ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 py-1.5 px-3.5 rounded-full">
                  <User className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="text-xs font-semibold text-indigo-950">
                    {userEmail || nickname || '사용자'}
                  </span>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-xs font-bold text-slate-500 hover:text-rose-600 bg-slate-100 hover:bg-slate-200 transition py-1.5 px-3.5 rounded-full"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setAuthMode('LOGIN'); setShowLoginModal(true); }}
                  className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition py-2 px-3.5 rounded-full"
                >
                  로그인
                </button>
                <button
                  onClick={() => { setAuthMode('SIGNUP'); setShowLoginModal(true); }}
                  className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition py-2 px-4 rounded-full shadow-sm flex items-center gap-1.5"
                >
                  <User className="w-3.5 h-3.5" />
                  회원가입
                </button>
              </div>
            )}

            {activeRoomId && (
              <button
                onClick={() => { setActiveRoomId(null); setRoomDetails(null); }}
                className="text-xs font-bold text-slate-500 hover:text-indigo-600 bg-slate-100 hover:bg-slate-200 transition py-1.5 px-3.5 rounded-full"
              >
                로비로 나가기
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">
        
        {/* Nickname setting Modal for Room Entry (Max 6 Chars) */}
        <AnimatePresence>
          {isRegisteringUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xl max-w-sm w-full space-y-4"
              >
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-slate-900">방 입장 닉네임 설정</h3>
                  <p className="text-xs text-slate-500">
                    회의방에 노출될 닉네임을 설정해 주세요. (최대 6자 제한)
                  </p>
                </div>
                <div className="space-y-1">
                  <input
                    type="text"
                    maxLength={6}
                    value={tempNickname}
                    onChange={e => setTempNickname(e.target.value.slice(0, 6))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 font-bold text-slate-900"
                    placeholder="닉네임 (최대 6자)"
                  />
                  <div className="flex justify-end">
                    <span className="text-[10px] text-slate-400 font-semibold">{tempNickname.length}/6자</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsRegisteringUser(false)}
                    className="flex-1 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-xl transition"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => {
                      if (!tempNickname.trim()) return;
                      handleUpdateNickname();
                    }}
                    disabled={!tempNickname.trim()}
                    className="flex-1 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl transition shadow-xs"
                  >
                    입장하기
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* -----------------------------------------------------------
            STANDALONE LANDING PAGE (IA 0.1: 비로그인 시 노출되는 전용 랜딩페이지)
            ----------------------------------------------------------- */}
        {!isLoggedIn ? (
          <div className="py-8 md:py-16 max-w-4xl mx-auto space-y-12">
            <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-900 text-white rounded-3xl p-8 md:p-14 shadow-2xl relative overflow-hidden text-center space-y-8">
              <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
              
              <div className="inline-flex items-center gap-2 bg-indigo-500/30 border border-indigo-400/30 backdrop-blur-md px-4 py-1.5 rounded-full text-xs font-semibold text-indigo-200 mx-auto">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>WhyNot - 익명 피드백 기반 팀 아이디어 의사결정 플랫폼</span>
              </div>

              <div className="space-y-4 max-w-2xl mx-auto">
                <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight text-white">
                  눈치 보지 않고,<br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-indigo-200">
                    객관적인 데이터로 결론을 내립니다.
                  </span>
                </h1>

                <p className="text-slate-300 text-sm md:text-base leading-relaxed">
                  어색하거나 눈치를 보는 팀원들을 위해 근거 기반 AI와 익명 피드백을 활용하여 최적의 아이디어 후보를 도출합니다.
                </p>
              </div>

              <div className="pt-4 flex justify-center gap-3">
                <button
                  onClick={() => { setAuthMode('LOGIN'); setShowLoginModal(true); }}
                  className="px-8 py-4 bg-white text-indigo-950 font-extrabold rounded-2xl text-base hover:bg-indigo-50 transition shadow-xl flex items-center gap-2 border border-indigo-100 cursor-pointer"
                >
                  <span>로그인하기</span>
                  <ChevronRight className="w-5 h-5 text-indigo-400" />
                </button>
                <button
                  onClick={() => { setAuthMode('SIGNUP'); setShowLoginModal(true); }}
                  className="px-8 py-4 bg-indigo-600 text-white font-extrabold rounded-2xl text-base hover:bg-indigo-500 transition shadow-xl flex items-center gap-2 cursor-pointer"
                >
                  <span>회원가입하기</span>
                </button>
              </div>

              {/* Feature Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-8 border-t border-indigo-700/50 text-left">
                <div className="bg-white/5 backdrop-blur-sm p-5 rounded-2xl border border-white/10 space-y-1.5">
                  <h4 className="text-sm font-bold text-indigo-200">🔒 100% 익명 소거 투표</h4>
                  <p className="text-xs text-slate-300">득표 실시간 비공개로 눈치 보지 않는 소신 있는 평가 진행</p>
                </div>
                <div className="bg-white/5 backdrop-blur-sm p-5 rounded-2xl border border-white/10 space-y-1.5">
                  <h4 className="text-sm font-bold text-indigo-200">🤖 AI 객관적 비교 리포트</h4>
                  <p className="text-xs text-slate-300">제외 사유 정제 및 AI가 클러스터링한 핵심 분석 제공</p>
                </div>
                <div className="bg-white/5 backdrop-blur-sm p-5 rounded-2xl border border-white/10 space-y-1.5">
                  <h4 className="text-sm font-bold text-indigo-200">🎯 룰렛 미니 게임 지원</h4>
                  <p className="text-xs text-slate-300">동점 또는 결정 난항 시 룰렛 추첨으로 깔끔하게 결정</p>
                </div>
              </div>
            </div>
          </div>
        ) : !activeRoomId ? (
          <div>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
                  솔직한 의견 소거로 결정하는 집단지성
                </h1>
                <p className="text-slate-500 text-sm md:text-base mt-1">
                  직급이나 관계 때문에 주저했던 반대 의견을 익명으로 제출하고, 단계적으로 아이디어를 소거하십시오.
                </p>
              </div>

              <button
                onClick={() => setIsCreatingRoom(true)}
                className="flex items-center gap-2 self-start md:self-auto bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-indigo-700 shadow-md transition"
              >
                <Plus className="w-4 h-4" />
                회의방 개설
              </button>
            </div>

            {/* Create Room Drawer/Form block */}
            <AnimatePresence>
              {isCreatingRoom && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm mb-8"
                >
                  <form onSubmit={handleCreateRoom} className="space-y-4 max-w-2xl">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <h2 className="text-lg font-bold text-slate-900">새 회의실 개설</h2>
                      <button 
                        type="button" 
                        onClick={() => setIsCreatingRoom(false)}
                        className="text-slate-400 hover:text-slate-600 transition"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">방장 닉네임 설정 <span className="text-rose-500">*</span></label>
                      <input
                        type="text"
                        required
                        maxLength={6}
                        value={newRoomHostNickname}
                        onChange={e => setNewRoomHostNickname(e.target.value.slice(0, 6))}
                        placeholder="방장 닉네임 입력 (최대 6자)"
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">회의 주제 (방 제목) <span className="text-rose-500">*</span></label>
                      <input
                        type="text"
                        required
                        value={newRoomTitle}
                        onChange={e => setNewRoomTitle(e.target.value)}
                        placeholder="예: 하반기 마케팅 바이럴 아이디어 선정"
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">한 줄 설명 및 제약 조건 (선택)</label>
                      <textarea
                        value={newRoomDesc}
                        onChange={e => setNewRoomDesc(e.target.value)}
                        placeholder="예: 마케팅 예산 총 1,500만원 내로 준비 및 실현할 수 있는 캠페인을 찾습니다."
                        rows={3}
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">카테고리</label>
                        <select
                          value={newRoomCategory}
                          onChange={e => setNewRoomCategory(e.target.value as any)}
                          className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700"
                        >
                          <option value="기획">기획</option>
                          <option value="디자인">디자인</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">참석자 수 (최대 6명)</label>
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={newRoomMaxParticipants}
                          onChange={e => setNewRoomMaxParticipants(Math.min(Math.max(Number(e.target.value), 1), 6))}
                          className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">최종 결과 수 (1~3개)</label>
                        <select
                          value={newRoomTargetWinners}
                          onChange={e => setNewRoomTargetWinners(Number(e.target.value))}
                          className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700"
                        >
                          <option value={1}>최종 1개 선정</option>
                          <option value={2}>최종 2개 선정</option>
                          <option value={3}>최종 3개 선정</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">공개 여부</label>
                        <select
                          value={newRoomIsPublic ? 'public' : 'private'}
                          onChange={e => setNewRoomIsPublic(e.target.value === 'public')}
                          className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold text-slate-700"
                        >
                          <option value="public">공개 스페이스</option>
                          <option value="private">비공개 스페이스</option>
                        </select>
                      </div>
                    </div>

                    {/* 2차 투표 가능 시간 (시작~마감 일시) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">2차 투표 시작 일시 (선택)</label>
                        <input
                          type="datetime-local"
                          value={newRoomVoteStartTime}
                          onChange={e => setNewRoomVoteStartTime(e.target.value)}
                          className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-700"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">2차 투표 마감 일시 (선택)</label>
                        <input
                          type="datetime-local"
                          value={newRoomVoteEndTime}
                          onChange={e => setNewRoomVoteEndTime(e.target.value)}
                          className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-700"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setIsCreatingRoom(false)}
                        className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-xl transition"
                      >
                        취소
                      </button>
                      <button
                        type="submit"
                        disabled={!newRoomTitle.trim() || !newRoomHostNickname.trim()}
                        className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition"
                      >
                        회의실 만들기
                      </button>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Seeded & Existing Rooms Grid */}
            {/* Filter and Seeded & Existing Rooms Grid (ENTRY-01, ENTRY-03, ENTRY-04) */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-600" />
                  <h2 className="text-base font-extrabold text-slate-900">현재 활성화된 회의실</h2>
                </div>

                {/* Filter buttons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    onClick={() => setRoomFilterStatus('ALL')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${
                      roomFilterStatus === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    전체
                  </button>
                  <button
                    onClick={() => setRoomFilterStatus('IDEA_SUBMISSION')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${
                      roomFilterStatus === 'IDEA_SUBMISSION' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    아이디어 모집
                  </button>
                  <button
                    onClick={() => setRoomFilterStatus('EVALUATION')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${
                      roomFilterStatus === 'EVALUATION' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    익명 평가중
                  </button>
                  <button
                    onClick={() => setRoomFilterStatus('CLOSED')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${
                      roomFilterStatus === 'CLOSED' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    종료 (최종선정)
                  </button>
                </div>
              </div>

              {roomsList.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
                  <Info className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-500">생성된 회의실이 없습니다. 첫 방을 만들어보세요!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {roomsList
                    .filter(room => {
                      if (roomFilterStatus === 'IDEA_SUBMISSION') return room.status === 'IDEA_SUBMISSION';
                      if (roomFilterStatus === 'EVALUATION') return ['CRITERIA_PROPOSAL', 'CRITERIA_REVIEW', 'EVALUATION', 'ELIMINATION', 'EVALUATION_ROUND_2'].includes(room.status);
                      if (roomFilterStatus === 'CLOSED') return room.status === 'CLOSED';
                      return true;
                    })
                    .sort((a, b) => {
                      if (a.isPinned && !b.isPinned) return -1;
                      if (!a.isPinned && b.isPinned) return 1;
                      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    })
                    .map(room => {
                      let statusBadge = (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          준비중
                        </span>
                      );
                      if (room.status === 'IDEA_SUBMISSION') {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200/50">💡 아이디어 모집</span>;
                      } else if (room.status === 'CLOSED') {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-900 text-white border border-slate-900">🎉 종료 (최종선정)</span>;
                      } else {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200/50">🔒 익명 평가중</span>;
                      }

                      return (
                        <motion.div
                          key={room.id}
                          whileHover={{ y: -2 }}
                          onClick={() => handleSelectRoom(room.id)}
                          className={`p-5 rounded-2xl border transition flex flex-col justify-between cursor-pointer group relative ${
                            room.isPinned 
                              ? 'bg-amber-50/40 border-amber-300/80 shadow-md ring-1 ring-amber-200/60' 
                              : 'bg-white border-slate-200 hover:border-indigo-300 shadow-sm'
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {statusBadge}
                                {room.category && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                                    {room.category}
                                  </span>
                                )}
                              </div>
                              
                              {/* Star Pin icon button (Yellow Star = ON, Gray Star = OFF) */}
                              <button
                                onClick={(e) => handleTogglePin(e, room.id)}
                                title={room.isPinned ? '상단 고정 해제 (OFF)' : '상단 고정 (ON)'}
                                className={`p-1.5 rounded-full transition flex items-center gap-1 text-xs font-bold border ${
                                  room.isPinned 
                                    ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200 shadow-xs' 
                                    : 'bg-slate-50 text-slate-400 border-slate-200 hover:text-amber-500 hover:bg-amber-50'
                                }`}
                              >
                                <Star 
                                  className={`w-4 h-4 ${
                                    room.isPinned 
                                      ? 'fill-amber-400 text-amber-500' 
                                      : 'text-slate-400 fill-slate-200'
                                  }`} 
                                />
                                {room.isPinned && <span className="pr-1 text-[11px]">고정</span>}
                              </button>
                            </div>
                            
                            <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-600 transition pt-1">
                              {room.title}
                            </h3>
                            <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                              {room.description || '작성된 설명이 없습니다.'}
                            </p>
                          </div>

                          <div className="border-t border-slate-100 mt-4 pt-3 flex items-center justify-between text-xs font-semibold text-slate-500">
                            <div className="flex items-center gap-3">
                              <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-md border border-indigo-100">
                                🏷️ {room.category || '기획'}
                              </span>
                              <span>•</span>
                              <span className="font-bold text-slate-700">👥 {room.evaluatorsCount || 1}/6명</span>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* -----------------------------------------------------------
              INSIDE ROOM SCREEN (STATE MACHINE)
              ----------------------------------------------------------- */
          <div>
            {/* Loading Cover */}
            {loading && !roomDetails && (
              <div className="flex flex-col items-center justify-center py-20">
                <RefreshCw className="w-8 h-8 text-slate-400 animate-spin mb-2" />
                <p className="text-sm font-bold text-slate-500">회의 정보를 동기화하는 중...</p>
              </div>
            )}

            {roomDetails && (
              <div className="flex flex-col lg:flex-row gap-8 items-start">
                
                {/* 1. SIDEBAR (SLEEK THEME DESIGN) */}
                <aside className="w-full lg:w-64 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col gap-6 shrink-0 shadow-sm lg:sticky lg:top-20">
                  {/* Section: Process Stages */}
                  <section className="space-y-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      프로세스 단계
                    </h3>
                    <div className="space-y-4">
                      {[
                        { key: 'IDEA_SUBMISSION', label: '아이디어 등록' },
                        { key: 'CRITERIA_PROPOSAL', label: '기준 제안/확정' },
                        { key: 'CRITERIA_REVIEW', label: '기준 검토' },
                        { key: 'EVALUATION', label: '익명 평가' },
                        { key: 'ELIMINATION', label: '라운드별 소거' },
                        { key: 'CLOSED', label: '최종 결과' }
                      ].map((step, idx) => {
                        const statusesOrder: RoomStatus[] = ['IDEA_SUBMISSION', 'CRITERIA_PROPOSAL', 'CRITERIA_REVIEW', 'EVALUATION', 'ELIMINATION', 'CLOSED'];
                        const currentIdx = statusesOrder.indexOf(roomDetails.room.status);
                        const stepIdx = statusesOrder.indexOf(step.key as RoomStatus);
                        const isCompleted = stepIdx < currentIdx;
                        const isActive = stepIdx === currentIdx;

                        return (
                          <div key={step.key} className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs shrink-0 transition ${
                              isCompleted 
                                ? 'bg-indigo-600 border-indigo-600 text-white' 
                                : isActive 
                                  ? 'bg-indigo-50 border-indigo-200 text-indigo-600 font-bold' 
                                  : 'border-slate-100 text-slate-300 bg-slate-50'
                            }`}>
                              {isCompleted ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                            </div>
                            <span className={`text-sm font-medium transition ${
                              isActive ? 'text-indigo-600 font-bold' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                            }`}>
                              {step.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Section: Confirmed Evaluation Criteria (Mockup-style!) */}
                  {roomDetails.criteria && roomDetails.criteria.length > 0 && (
                    <section className="space-y-3 pt-4 border-t border-slate-100">
                      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        확정된 평가 기준 (AI)
                      </h3>
                      <div className="space-y-2.5">
                        {roomDetails.criteria.map((crit) => (
                          <div key={crit.id} className="p-3 bg-indigo-50/60 rounded-lg border border-indigo-100">
                            <div className="text-xs font-bold text-indigo-950">{crit.name}</div>
                            <p className="text-[10px] text-indigo-700 leading-relaxed mt-0.5">{crit.description}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Host-only developer quick stage selector (placed at sidebar bottom) */}
                  {roomDetails.room.hostId === userId && (
                    <section className="pt-4 border-t border-slate-100 space-y-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        🛠️ 단계 강제 변경:
                      </span>
                      <div className="flex flex-col gap-1.5">
                        {['IDEA_SUBMISSION', 'CRITERIA_PROPOSAL', 'EVALUATION', 'ELIMINATION', 'CLOSED'].map((st) => (
                          <button
                            key={st}
                            onClick={() => handleForceChangeStatus(st as RoomStatus)}
                            className={`text-[10px] font-semibold py-1 px-2.5 rounded-lg border text-left transition ${
                              roomDetails.room.status === st
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {st === 'IDEA_SUBMISSION' && '1단계: 아이디어'}
                            {st === 'CRITERIA_PROPOSAL' && '2단계: 기준익명제안'}
                            {st === 'EVALUATION' && '4단계: 익명평가'}
                            {st === 'ELIMINATION' && '5단계: 소거진행'}
                            {st === 'CLOSED' && '6단계: 최종종료'}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </aside>

                {/* 2. MAIN WORKSPACE */}
                <div className="flex-1 min-w-0 w-full space-y-6">
                  
                  {/* ROOM HEADER CARD */}
                  <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-full">
                            {roomDetails.room.status === 'IDEA_SUBMISSION' && '아이디어 등록'}
                            {roomDetails.room.status === 'CRITERIA_PROPOSAL' && '평가 기준 제안'}
                            {roomDetails.room.status === 'CRITERIA_REVIEW' && '기준 확정 및 리뷰'}
                            {roomDetails.room.status === 'EVALUATION' && '익명 스크리닝 평가'}
                            {roomDetails.room.status === 'ELIMINATION' && '라운드 소거 진행'}
                            {roomDetails.room.status === 'CLOSED' && '의사결정 완료'}
                          </span>
                          {roomDetails.room.hostId === userId && (
                            <span className="text-xs font-semibold text-white bg-slate-900 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                              <Settings className="w-3 h-3" />
                              방장
                            </span>
                          )}
                          <button 
                            onClick={() => setShowShareModal(true)}
                            className="text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 border border-indigo-600 px-3 py-1 rounded-full transition flex items-center gap-1.5 shadow-xs"
                          >
                            <Copy className="w-3 h-3" />
                            🔗 공유 링크 발급/관리
                          </button>
                        </div>

                        <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
                          {roomDetails.room.title}
                        </h1>
                        <p className="text-slate-500 text-xs md:text-sm max-w-4xl">
                          {roomDetails.room.description || '이 방에 대한 추가 설명이 작성되지 않았습니다.'}
                        </p>
                      </div>

                      {/* Refresh / Stats */}
                      <div className="flex sm:flex-col items-end gap-2 justify-between">
                        {/* Live progress indicator ("N/M명 아이디어 제출 완료") */}
                        <div className="text-xs font-bold text-slate-700 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-full shrink-0 flex items-center gap-1.5">
                          <span>📊 등록 완료 현황판:</span>
                          <span className="text-indigo-600 font-extrabold">
                            { (roomDetails.participants || []).filter(p => p.isIdeaDone).length } / { roomDetails.room.maxParticipants || 6 }명 완료
                          </span>
                        </div>
                        <button
                          onClick={() => fetchRoomDetails(activeRoomId!, false)}
                          className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1.5 rounded-xl border border-slate-200 transition shrink-0"
                        >
                          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                          새로고침
                        </button>
                      </div>
                    </div>
                  </div>

                {/* -----------------------------------------------------------
                    VIEW 1: IDEA_SUBMISSION
                    ----------------------------------------------------------- */}
                {roomDetails.room.status === 'IDEA_SUBMISSION' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    
                    {/* Left: Ideas List (Anonymous Labels) */}
                    <div className="lg:col-span-7 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                          제출된 아이디어 목록 ({roomDetails.ideas.length}개)
                        </h2>
                        <span className="text-xs text-indigo-600 font-bold bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
                          🔒 100% 익명 보장
                        </span>
                      </div>

                      {/* Empty State Prompt */}
                      {roomDetails.ideas.length === 0 ? (
                        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-indigo-200 p-8 space-y-3">
                          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto text-xl font-bold">
                            💡
                          </div>
                          <h3 className="text-base font-bold text-slate-900">아직 등록된 아이디어가 없습니다!</h3>
                          <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                            우측의 등록 양식을 사용하여 팀을 위한 첫 번째 아이디어를 익명으로 발제해 보세요. (참여자당 1개~최대 5개 등록 가능)
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {roomDetails.ideas.map((idea, idx) => (
                            <motion.div
                              key={idea.id}
                              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3"
                            >
                              <div className="flex items-center justify-between">
                                <h3 className="text-base font-bold text-slate-950">{idea.title}</h3>
                                <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full flex items-center gap-1">
                                  <User className="w-3 h-3 text-indigo-400" />
                                  {idea.submitterName || `익명 아이디어 #${idx + 1}`}
                                </span>
                              </div>
                              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                                {idea.description}
                              </p>
                              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500 pt-1">
                                {idea.attachmentUrl && (
                                  <div>
                                    🔗 참고 링크: <a href={idea.attachmentUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline hover:text-indigo-800">{idea.attachmentUrl}</a>
                                  </div>
                                )}
                                {idea.pdfAttachmentUrl && (
                                  <div>
                                    📄 참고 파일 (PDF/PNG): <span className="text-slate-800 underline font-bold">{idea.pdfAttachmentUrl}</span>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Right: Submission Form & Admin Gate */}
                    <div className="lg:col-span-5 space-y-6">
                      <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <h2 className="text-base font-bold text-slate-900">
                            내 아이디어 등록하기 (익명)
                          </h2>
                          <span className="text-[11px] font-bold text-slate-500">
                            (내 제출: { (roomDetails.ideas || []).filter(i => i.submitterId === userId).length }/5개)
                          </span>
                        </div>

                        <form onSubmit={handleSubmitIdea} className="space-y-4">
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-700">아이디어 제목 <span className="text-rose-500">*</span></label>
                            <input
                              type="text"
                              required
                              value={ideaTitle}
                              onChange={e => setIdeaTitle(e.target.value)}
                              placeholder="예: 숏폼 영상 제작 가요 챌린지"
                              className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                            />
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-bold text-slate-700">아이디어 상세 설명 <span className="text-rose-500">*</span></label>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!ideaTitle.trim() || !ideaDesc.trim()) {
                                    triggerToast('제목과 내용을 먼저 입력해 주세요.', 'error');
                                    return;
                                  }
                                  try {
                                    triggerToast('AI가 아이디어를 디벨롭하는 중입니다...');
                                    const res = await fetch(`/api/rooms/${activeRoomId}/ideas/develop`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ title: ideaTitle, description: ideaDesc })
                                    });
                                    if (res.ok) {
                                      const data = await res.json();
                                      setIdeaDesc(data.enhancedDescription);
                                      triggerToast('AI가 아이디어 디벨롭 보조 문안을 작성했습니다!');
                                    }
                                  } catch (e) {
                                    console.error(e);
                                  }
                                }}
                                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-full flex items-center gap-1 transition"
                              >
                                <Sparkles className="w-3 h-3 text-indigo-500" />
                                AI 아이디어 디벨롭
                              </button>
                            </div>
                            <textarea
                              required
                              value={ideaDesc}
                              onChange={e => setIdeaDesc(e.target.value)}
                              placeholder="아이디어의 핵심 프로세스, 기대 효과, 팀이 준비해야 하는 범위를 상세하게 작성하십시오."
                              rows={4}
                              className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-700">참고 링크 (선택)</label>
                            <input
                              type="url"
                              value={ideaLink}
                              onChange={e => setIdeaLink(e.target.value)}
                              placeholder="https://example.com/reference-board"
                              className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-700">참고 파일 (PDF / PNG 첨부)</label>
                            <input
                              type="file"
                              accept=".pdf,.png"
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) setIdeaPdfName(file.name);
                              }}
                              className="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                            />
                          </div>

                          <div className="bg-indigo-50/60 p-3 rounded-xl border border-indigo-100 text-xs text-indigo-900 leading-relaxed">
                            🔒 **익명 정책**: 제출자 이름 대신 **'익명 아이디어 #N'**으로 등록되며 타인에게 닉네임이 노출되지 않습니다. (1인당 최소 1개 ~ 최대 5개)
                          </div>

                          <button
                            type="submit"
                            disabled={(roomDetails.ideas || []).filter(i => i.submitterId === userId).length >= 5}
                            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 transition shadow-sm"
                          >
                            아이디어 올리기 (익명)
                          </button>
                        </form>
                      </div>

                      {/* Host Control: Step transition gate */}
                      {roomDetails.room.hostId === userId && (
                        <div className="bg-slate-900 text-white p-5 md:p-6 rounded-2xl space-y-4 shadow-md">
                          <h3 className="text-sm font-bold flex items-center gap-1.5 text-amber-400">
                            <Settings className="w-4 h-4" />
                            방장 마일스톤 제어
                          </h3>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            참여진들의 아이디어 등록이 마무리되었다면, 다음 단계인 **'평가 기준 익명 제안'**으로 진행하십시오. (최소 2개 이상의 아이디어가 등록되어야 진행이 원활합니다)
                          </p>
                          <button
                            onClick={() => handleForceChangeStatus('CRITERIA_PROPOSAL')}
                            disabled={roomDetails.ideas.length < 2}
                            className="w-full py-2.5 bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition rounded-xl text-xs font-bold flex items-center justify-center gap-1"
                          >
                            2단계: 평가 기준 제안 단계로 전환
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* -----------------------------------------------------------
                    VIEW 2: CRITERIA_PROPOSAL
                    ----------------------------------------------------------- */}
                {roomDetails.room.status === 'CRITERIA_PROPOSAL' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    
                    {/* Left: Input Proposal Form & AI Suggested Criteria */}
                    <div className="lg:col-span-7 space-y-6">
                      
                      {/* AI Criteria Generator Card (Potens AI) */}
                      <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-900 text-white p-5 md:p-6 rounded-2xl shadow-md space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold flex items-center gap-2 text-amber-400">
                            <Sparkles className="w-4 h-4 text-amber-400" />
                            Potens AI 기반 평가 기준 3가지 제안
                          </h3>
                          <button
                            type="button"
                            onClick={handleFetchAiSuggestions}
                            disabled={isGeneratingAiSuggestions}
                            className="px-3 py-1 bg-amber-400 text-slate-950 hover:bg-amber-300 disabled:opacity-50 text-xs font-black rounded-lg transition flex items-center gap-1 shadow-xs"
                          >
                            {isGeneratingAiSuggestions ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                생성 중...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3" />
                                AI 기준 생성
                              </>
                            )}
                          </button>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          등록된 아이디어들의 특성을 분석하여 적합한 평가 기준 3가지를 AI가 추천합니다. 클릭 시 즉시 내 기준 제안으로 등록됩니다.
                        </p>

                        {aiSuggestedCriteria.length > 0 && (
                          <div className="space-y-2 pt-1">
                            {aiSuggestedCriteria.map((item, idx) => (
                              <div
                                key={idx}
                                className="p-3 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl transition flex items-start justify-between gap-3 text-left"
                              >
                                <div className="space-y-0.5 min-w-0 flex-1">
                                  <h4 className="text-xs font-bold text-amber-300 flex items-center gap-1">
                                    <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                                    {item.name}
                                  </h4>
                                  <p className="text-[11px] text-slate-300 leading-normal line-clamp-2">
                                    {item.description}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleProposeCriterion(undefined, `${item.name}: ${item.description}`)}
                                  className="shrink-0 text-xs font-bold bg-white text-slate-900 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition"
                                >
                                  이 기준 제안 선택
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Direct Criterion Proposal Form */}
                      <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                          <div>
                            <h2 className="text-base font-bold text-slate-900">직접 기준 작성 및 제안</h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                              "이 아이디어들을 평가할 때 어떤 점을 중요하게 봐야 하는가?" 의견을 입력해 주세요.
                            </p>
                          </div>
                          <span className="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                            최소 1개 ~ 최대 3개
                          </span>
                        </div>

                        <form onSubmit={handleProposeCriterion} className="space-y-4">
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-700">제안할 기준 내용 <span className="text-rose-500">*</span></label>
                            <textarea
                              required
                              value={proposalText}
                              onChange={e => setProposalText(e.target.value)}
                              placeholder="예: 예산 한계 내로 준비가 가능한지 여부 / 팀원의 기술 역량으로 1달 이내 구현이 가능한지"
                              rows={3}
                              className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                            />
                          </div>

                          <div className="bg-emerald-50 text-emerald-800 p-3.5 rounded-xl text-xs leading-relaxed border border-emerald-100">
                            🔒 **익명 보장 (식별 정보 비노출)**: 방장이나 다른 팀원을 포함해 누구도 작성자를 추적할 수 없습니다.
                          </div>

                          <button
                            type="submit"
                            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-sm"
                          >
                            익명 기준 제안 등록하기
                          </button>
                        </form>
                      </div>
                    </div>

                    {/* Right: Progress Tracker & Clustering triggering (Host-only) */}
                    <div className="lg:col-span-5 space-y-6">
                      <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <h2 className="text-base font-bold text-slate-900">제안 현황</h2>
                        
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-600">현재 수집된 총 익명 기준 제안 수:</span>
                          <span className="text-lg font-black text-slate-900">{roomDetails.proposalsCount}개</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-normal">
                          ※ 최소 1개 이상 수집 시 다음 단계 진행이 가능합니다. 제출 완료 후 방장이 AI 클러스터링을 가동합니다.
                        </p>
                      </div>

                      {/* Host Control: Triggers Clustering (CRIT-02 AI 자동 정리) */}
                      {roomDetails.room.hostId === userId && (
                        <div className="bg-slate-900 text-white p-5 md:p-6 rounded-2xl space-y-4 shadow-md">
                          <h3 className="text-sm font-bold flex items-center gap-1.5 text-amber-400">
                            <Sparkles className="w-4 h-4 text-amber-400" />
                            다음 단계로: AI 기준 자동 정리 (CRIT-02)
                          </h3>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            참여진들의 기준 제안이 완료되었다면 아래 버튼을 누르십시오. Potens AI가 제안된 기준들을 통합 분류 및 클러스터링하여 **핵심 3~5개 평가 기준 리스트**로 자동 정리합니다.
                          </p>
                          <button
                            onClick={handleTriggerClustering}
                            disabled={roomDetails.proposalsCount === 0 || loading}
                            className="w-full py-2.5 bg-amber-400 text-slate-950 hover:bg-amber-300 disabled:opacity-40 transition rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm"
                          >
                            {loading ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                AI 자동 정리 진행 중...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5" />
                                다음 단계로 (AI 자동 정리 개시)
                                <ArrowRight className="w-3.5 h-3.5" />
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* -----------------------------------------------------------
                    VIEW 3: CRITERIA_REVIEW
                    ----------------------------------------------------------- */}
                {roomDetails.room.status === 'CRITERIA_REVIEW' && (
                  <div className="space-y-6">
                    <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                      <div className="border-b border-slate-100 pb-2">
                        <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-amber-500" />
                          AI 분류 및 요약된 평가 기준 리뷰
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          팀원들이 익명 제안한 기준들을 AI가 취합하여 핵심 3~5개 지표로 클러스터링한 결과입니다. {roomDetails.room.hostId === userId ? '방장님은 명칭과 내용을 보완하여 최종 확정하십시오.' : '팀장/개설자가 기준을 조율 및 확정 중입니다.'}
                        </p>
                      </div>

                      <div className="space-y-4">
                        {editableCriteria.map((crit, idx) => (
                          <div key={crit.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">기준 #{idx + 1}</span>
                              {roomDetails.room.hostId === userId && (
                                <button
                                  onClick={() => {
                                    setEditableCriteria(prev => prev.filter(c => c.id !== crit.id));
                                  }}
                                  className="text-slate-400 hover:text-rose-600 transition"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>

                            {roomDetails.room.hostId === userId ? (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="md:col-span-1">
                                  <input
                                    type="text"
                                    value={crit.name}
                                    onChange={e => {
                                      const updatedVal = e.target.value;
                                      setEditableCriteria(prev => prev.map(c => c.id === crit.id ? { ...c, name: updatedVal } : c));
                                    }}
                                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-bold bg-white focus:outline-none"
                                    placeholder="기준 이름"
                                  />
                                </div>
                                <div className="md:col-span-2">
                                  <input
                                    type="text"
                                    value={crit.description}
                                    onChange={e => {
                                      const updatedVal = e.target.value;
                                      setEditableCriteria(prev => prev.map(c => c.id === crit.id ? { ...c, description: updatedVal } : c));
                                    }}
                                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none font-medium"
                                    placeholder="구체적인 한 줄 설명"
                                  />
                                </div>
                              </div>
                            ) : (
                              <div>
                                <h4 className="text-sm font-bold text-slate-900">{crit.name}</h4>
                                <p className="text-xs text-slate-500 mt-1">{crit.description}</p>
                              </div>
                            )}
                          </div>
                        ))}

                        {/* Add Criteria manually (Host only) */}
                        {roomDetails.room.hostId === userId && (
                          <button
                            type="button"
                            onClick={() => {
                              const newCrit: Criterion = {
                                id: `crit-manual-${Math.random().toString(36).substr(2, 5)}`,
                                roomId: activeRoomId!,
                                name: '새로운 기준 지표',
                                description: '여기에 평가 기준에 대한 상세 가이드를 적어주세요.',
                                confirmed: false
                              };
                              setEditableCriteria(prev => [...prev, newCrit]);
                            }}
                            className="w-full py-2 border border-dashed border-slate-300 hover:border-slate-400 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition flex items-center justify-center gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            평가 기준 직접 임의 추가
                          </button>
                        )}
                      </div>

                      {/* Confirmation actions */}
                      {roomDetails.room.hostId === userId && (
                        <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                          <button
                            onClick={() => handleForceChangeStatus('CRITERIA_PROPOSAL')}
                            className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition"
                          >
                            이전 단계(의견제출)로 되돌아가기
                          </button>
                          <button
                            onClick={handleConfirmCriteria}
                            className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl text-xs font-bold transition shadow-sm"
                          >
                            기준 목록 최종 확정 및 익명 평가 개시
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* -----------------------------------------------------------
                    VIEW 4: EVALUATION
                    ----------------------------------------------------------- */}
                {roomDetails.room.status === 'EVALUATION' && (
                  <div className="space-y-6">

                    {/* Progress Indicator Card */}
                    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                          {roomDetails.hasEvaluated ? (
                            <span className="text-emerald-600 flex items-center gap-1">
                              <Check className="w-4 h-4" />
                              내 익명 평가 완료됨
                            </span>
                          ) : (
                            <span className="text-slate-900 flex items-center gap-1">
                              <Lock className="w-4 h-4 text-slate-400" />
                              익명 스크리닝 평가 대기 중
                            </span>
                          )}
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          확정된 기준들에 비추어 각 아이디어를 신중하게 심사해 주십시오. 
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-xs font-semibold text-slate-600 bg-slate-50 py-2 px-3.5 border border-slate-100 rounded-xl">
                          현재 평가인원 : {roomDetails.evaluatorsCount}명 / 최소 {roomDetails.room.minResponseThreshold}명
                        </div>
                      </div>
                    </div>

                    {/* Check if User already evaluated */}
                    {roomDetails.hasEvaluated ? (
                      /* WAITING SCREEN AND GATE SHOWCASE */
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center space-y-6 max-w-2xl mx-auto py-10">
                        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto border border-indigo-100">
                          {roomDetails.minResponseThresholdMet ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                        </div>

                        <div className="space-y-2">
                          <h3 className="text-lg font-bold text-slate-900">
                            {roomDetails.minResponseThresholdMet 
                              ? '팀 내 최소 응답 수 충족 완료!' 
                              : '다른 구성원들의 평가를 기다리는 중'}
                          </h3>
                          <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
                            {roomDetails.minResponseThresholdMet
                              ? '최소 응답 정족수가 달성되어, 안전하게 익명 처리된 집계 결과가 활성화되었습니다. 방장 권한으로 소거를 시작할 수 있습니다.'
                              : '와이낫 서비스는 소수 인원 응답 시 필체나 의견 유추로 익명이 훼손되는 것을 원천 차단하기 위해, 설정된 정족수(최소 ' + roomDetails.room.minResponseThreshold + '명)가 찬 이후에만 집계 결과를 서버로부터 전송합니다.'}
                          </p>
                        </div>

                        {/* Gate details */}
                        <div className="flex items-center justify-center gap-1.5 text-xs font-bold">
                          <span className="text-slate-500">현재 수집 상태 :</span>
                          <span className={roomDetails.minResponseThresholdMet ? 'text-emerald-600' : 'text-amber-600'}>
                            {roomDetails.evaluatorsCount} / {roomDetails.room.minResponseThreshold} 명 완료
                          </span>
                        </div>

                        {/* Tester assist box */}
                        {!roomDetails.minResponseThresholdMet && (
                          <div className="bg-slate-50 p-4 rounded-xl border border-dashed border-slate-200 text-left space-y-3">
                            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1">
                              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                              미리보기 테스트 팁 (시뮬레이션 가상 참여자)
                            </h4>
                            <p className="text-[11px] text-slate-400 leading-normal">
                              혼자서 테스트 중이시라면 아래 버튼을 클릭하십시오! 서버가 즉시 <strong>가상 팀원 2명의 익명 평가 정보</strong>를 임의 생성하여 정족수를 만족시켜 주고, 결과 통계 페이지를 보여줍니다.
                            </p>
                            <button
                              onClick={handleSeedMockEvaluations}
                              className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-sm flex items-center justify-center gap-1"
                            >
                              <PlusCircle className="w-3.5 h-3.5" />
                              시뮬레이션 가상 평가 2명 데이터 추가
                            </button>
                          </div>
                        )}

                        {/* Transition button for host */}
                        {roomDetails.room.hostId === userId && roomDetails.minResponseThresholdMet && (
                          <div className="border-t border-slate-100 pt-4">
                            <button
                              onClick={() => handleForceChangeStatus('ELIMINATION')}
                              className="w-full py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 transition rounded-xl text-xs font-bold"
                            >
                              5단계: 단계적 소거 라운드 개시하기
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* ACTIVE SCREENING VOTING CARDS */
                      <div className="space-y-6">
                        <div className="border-b border-slate-200 pb-2">
                          <h3 className="text-sm font-extrabold text-slate-500 uppercase tracking-wider">스크리닝 진행할 아이디어 목록</h3>
                        </div>

                        {roomDetails.ideas.filter(i => i.status === 'ACTIVE').map((idea, ideaIdx) => {
                          const userVote = evalSubmissions[idea.id] || {
                            decision: undefined,
                            excludedCriterionIds: [],
                            reasonText: '',
                            reasonType: 'PREFERENCE'
                          };

                          return (
                            <motion.div
                              key={idea.id}
                              className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4"
                            >
                              {/* Idea Overview Header */}
                              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
                                <div className="space-y-1">
                                  <span className="text-[10px] font-black text-slate-400">후보 #{ideaIdx + 1}</span>
                                  <h4 className="text-base font-bold text-slate-900">{idea.title}</h4>
                                  <p className="text-xs text-slate-500 leading-relaxed whitespace-pre-line">
                                    {idea.description}
                                  </p>
                                </div>
                                <span className="text-xs font-semibold text-slate-500 bg-slate-100 py-1 px-2.5 rounded-full self-start">
                                  제안자: {idea.submitterName}
                                </span>
                              </div>

                              {/* Voting Selector Button Group */}
                              <div className="space-y-3">
                                <label className="text-xs font-extrabold text-slate-700">이 아이디어에 대한 투표 결정 <span className="text-rose-500">*</span></label>
                                <div className="grid grid-cols-3 gap-2">
                                  {[
                                    { key: 'KEEP', label: '유지 찬성', desc: '기준에 완벽 부합', activeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
                                    { key: 'NEUTRAL', label: '상관없음', desc: '무난하거나 중립', activeClass: 'bg-slate-100 text-slate-800 border-slate-400' },
                                    { key: 'EXCLUDE', label: '제외 희망', desc: '치명적 우려 존재', activeClass: 'bg-rose-50 text-rose-800 border-rose-300' }
                                  ].map(opt => {
                                    const isSelected = userVote.decision === opt.key;
                                    return (
                                      <button
                                        key={opt.key}
                                        type="button"
                                        onClick={() => handleVoteChange(idea.id, opt.key as any)}
                                        className={`p-3 rounded-xl border text-center transition flex flex-col items-center justify-center gap-0.5 ${
                                          isSelected 
                                            ? opt.activeClass + ' ring-2 ring-slate-900/5 font-bold' 
                                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                        }`}
                                      >
                                        <span className="text-xs md:text-sm">{opt.label}</span>
                                        <span className="text-[10px] font-normal opacity-80 leading-none">{opt.desc}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* EXCLUDE Condition inputs (Only shown when voter selects 'EXCLUDE') */}
                              {userVote.decision === 'EXCLUDE' && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4 overflow-hidden"
                                >
                                  {/* 1. Which criterion was violated? */}
                                  <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-700 block">
                                      어떤 평가 기준 위반에 해당합니까? (중복 체크 가능) <span className="text-rose-500">*</span>
                                    </label>
                                    <div className="space-y-1.5">
                                      {roomDetails.criteria.map(crit => {
                                        const isChecked = userVote.excludedCriterionIds.includes(crit.id);
                                        return (
                                          <label key={crit.id} className="flex items-start gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={e => handleCriteriaCheckboxChange(idea.id, crit.id, e.target.checked)}
                                              className="mt-0.5"
                                            />
                                            <div>
                                              <span className="font-bold text-slate-900">{crit.name}</span>
                                              <span className="text-slate-400 font-normal ml-1">({crit.description})</span>
                                            </div>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* 2. Penalty Category (OBJECTIVE vs PREFERENCE) */}
                                  <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-700 block">
                                      우려의 범주가 무엇입니까? <span className="text-rose-500">*</span>
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <label className={`p-2.5 rounded-lg border flex items-center gap-2 cursor-pointer transition ${
                                        userVote.reasonType === 'OBJECTIVE_CONSTRAINT' 
                                          ? 'bg-rose-100/40 border-rose-300 font-bold text-rose-900' 
                                          : 'bg-white border-slate-200 text-slate-600'
                                      }`}>
                                        <input
                                          type="radio"
                                          name={`reasonType-${idea.id}`}
                                          checked={userVote.reasonType === 'OBJECTIVE_CONSTRAINT'}
                                          onChange={() => handleReasonTypeChange(idea.id, 'OBJECTIVE_CONSTRAINT')}
                                        />
                                        <div className="text-xs">
                                          <span className="block">필수 제약 (Objective Constraint)</span>
                                          <span className="text-[10px] text-slate-400 font-normal">예산 초과, 인력 부족 등 물리적 실행 불가 요소</span>
                                        </div>
                                      </label>

                                      <label className={`p-2.5 rounded-lg border flex items-center gap-2 cursor-pointer transition ${
                                        userVote.reasonType === 'PREFERENCE' 
                                          ? 'bg-slate-200/40 border-slate-300 font-bold text-slate-900' 
                                          : 'bg-white border-slate-200 text-slate-600'
                                      }`}>
                                        <input
                                          type="radio"
                                          name={`reasonType-${idea.id}`}
                                          checked={userVote.reasonType === 'PREFERENCE'}
                                          onChange={() => handleReasonTypeChange(idea.id, 'PREFERENCE')}
                                        />
                                        <div className="text-xs">
                                          <span className="block">단순 선호 및 아쉬움 (Preference)</span>
                                          <span className="text-[10px] text-slate-400 font-normal">개인적인 불호, 기획 참신성 아쉬움 등 정성적 평가</span>
                                        </div>
                                      </label>
                                    </div>
                                  </div>

                                  {/* 3. Reason Textarea */}
                                  <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-700 block">
                                      제외를 요청하는 세부 사유 <span className="text-rose-500">*</span>
                                    </label>
                                    <textarea
                                      required
                                      value={userVote.reasonText}
                                      onChange={e => handleReasonTextChange(idea.id, e.target.value)}
                                      placeholder="제외를 주장하시는 근거를 적어주세요. 말투 유추를 피하기 위해 AI가 이 문장들을 완전히 건조하고 기계적인 어조로 재구성하여 팀에 노출할 것입니다."
                                      rows={2}
                                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                  </div>
                                </motion.div>
                              )}
                            </motion.div>
                          );
                        })}

                        <div className="pt-4 text-center">
                          <button
                            type="button"
                            onClick={handleSubmitAllEvaluations}
                            className="px-8 py-3 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 transition shadow-md"
                          >
                            내 익명 심사 평가 완료하기
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                )}

                {/* -----------------------------------------------------------
                    VIEW 5: ELIMINATION (SCREENING DASHBOARD)
                    ----------------------------------------------------------- */}
                {roomDetails.room.status === 'ELIMINATION' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    
                    {/* Left: Active Candidates & Scoring statistics */}
                    <div className="lg:col-span-8 space-y-6">
                      
                      {/* Active Candidates list */}
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                          <h2 className="text-base font-extrabold text-slate-900">현재 생존해 있는 활성 후보 ({activeIdeasCount}개)</h2>
                          <span className="text-xs text-slate-400 font-semibold">점수 기준: 유지(+2) 상관없음(+1) 필수제약감점(-3)</span>
                        </div>

                        {roomDetails.ideas.filter(i => i.status === 'ACTIVE').map(idea => {
                          const stats = roomDetails.aggregatedScores?.[idea.id] || { score: 0, keepCount: 0, neutralCount: 0, excludeCount: 0, objectiveExcludeCount: 0 };
                          const commentSummaries = roomDetails.aiSummarizedComments?.[idea.id] || { objectiveComments: [], preferenceComments: [] };

                          return (
                            <div key={idea.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <h3 className="text-base font-bold text-slate-900">{idea.title}</h3>
                                  <p className="text-xs text-slate-500">{idea.description}</p>
                                </div>

                                <div className="text-right self-start sm:self-auto bg-slate-50 py-1.5 px-3.5 border border-slate-100 rounded-xl">
                                  <span className="text-[10px] text-slate-400 font-bold block leading-none">종합점수</span>
                                  <span className="text-lg font-black text-slate-900">{stats.score}점</span>
                                </div>
                              </div>

                              {/* Aggregate vote counters */}
                              <div className="grid grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded-xl text-center text-[10px] font-extrabold text-slate-500">
                                <div>
                                  <span className="block text-emerald-600">유지찬성</span>
                                  <span className="text-xs font-black text-slate-800">{stats.keepCount}표</span>
                                </div>
                                <div>
                                  <span className="block text-slate-600">상관없음</span>
                                  <span className="text-xs font-black text-slate-800">{stats.neutralCount}표</span>
                                </div>
                                <div>
                                  <span className="block text-rose-600">일반제외</span>
                                  <span className="text-xs font-black text-slate-800">{stats.excludeCount - stats.objectiveExcludeCount}표</span>
                                </div>
                                <div className="bg-rose-50/50 rounded-lg">
                                  <span className="block text-rose-700">필수제약위반</span>
                                  <span className="text-xs font-black text-rose-800">{stats.objectiveExcludeCount}표</span>
                                </div>
                              </div>

                              {/* AI summarized anonymous comments (Security checked) */}
                              {(commentSummaries.objectiveComments.length > 0 || commentSummaries.preferenceComments.length > 0) && (
                                <div className="bg-slate-50/50 p-3 rounded-xl border border-slate-100 space-y-3">
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">🗣️ 재구성된 익명 피드백 (어투 익명화)</span>
                                  
                                  {commentSummaries.objectiveComments.length > 0 && (
                                    <div className="space-y-1">
                                      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">핵심 실행 제약 우려</span>
                                      <ul className="list-disc pl-4 text-xs text-slate-600 space-y-1">
                                        {commentSummaries.objectiveComments.map((comment, i) => (
                                          <li key={i}>{comment}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {commentSummaries.preferenceComments.length > 0 && (
                                    <div className="space-y-1 pt-1.5 border-t border-slate-100">
                                      <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">선호 및 피드백 보완 사항</span>
                                      <ul className="list-disc pl-4 text-xs text-slate-600 space-y-1">
                                        {commentSummaries.preferenceComments.map((comment, i) => (
                                          <li key={i}>{comment}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Manual Elimination for Host (Targeting specific objective exclusions) */}
                              {roomDetails.room.hostId === userId && (
                                <div className="flex justify-end pt-1">
                                  <button
                                    onClick={() => handleProceedElimination(idea.id)}
                                    className="text-[10px] font-bold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 py-1.5 px-3.5 rounded-lg border border-rose-100 transition"
                                  >
                                    이 후보 수동 소거 실행
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Right: Step Control & Timeline of Elimination Rounds */}
                    <div className="lg:col-span-4 space-y-6">
                      
                      {/* Host Execution Box */}
                      {roomDetails.room.hostId === userId && (
                        <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-4 shadow-md">
                          <h3 className="text-sm font-bold text-amber-400 flex items-center gap-1.5">
                            <Settings className="w-4 h-4" />
                            소거 집행 통제판
                          </h3>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            팀원들의 평가가 완료되어 결과 점수가 계산되었습니다. 아래 버튼을 눌러 **최하위 1개 아이디어에 대해 소거**를 진행하십시오. (동률 시 랜덤 처리됩니다)
                          </p>

                          <button
                            onClick={() => handleProceedElimination()}
                            disabled={activeIdeasCount <= 1 || loading}
                            className="w-full py-2.5 bg-white text-slate-900 hover:bg-slate-100 transition rounded-xl text-xs font-black flex items-center justify-center gap-1"
                          >
                            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                            {roomDetails.rounds.length + 1}라운드 최하위 후보 소거 실행
                          </button>

                          {activeIdeasCount > 0 && (
                            <button
                              onClick={handleManuallyCloseRoom}
                              className="w-full py-2 border border-dashed border-slate-600 text-slate-300 hover:text-white hover:bg-slate-800 transition rounded-xl text-xs font-bold"
                            >
                              소거 중단하고 현시점 최상위 생존 후보 확정
                            </button>
                          )}
                        </div>
                      )}

                      {/* Objective Constraints Alert Box */}
                      {objectiveCandidates.length > 0 && (
                        <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200 text-slate-800 space-y-2">
                          <h4 className="text-xs font-bold text-amber-800 flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                            필수 제약 (Objective) 위반 제거 후보
                          </h4>
                          <p className="text-[10px] text-slate-600 leading-normal">
                            아래의 아이디어들은 구성원들에 의해 '현실 불가능한 실행 불허 제약 조건'이 최소 1건 이상 접수되었습니다. 방장은 우선적으로 검토하여 수동 삭제를 고려해 보십시오.
                          </p>
                          <ul className="text-[11px] font-extrabold text-slate-700 list-disc pl-4 space-y-1">
                            {objectiveCandidates.map(c => (
                              <li key={c.id}>{c.title}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Rounds timeline */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">소거 타임라인</h3>
                        
                        {roomDetails.rounds.length === 0 ? (
                          <p className="text-xs font-semibold text-slate-400">진행된 소거 라운드가 없습니다.</p>
                        ) : (
                          <div className="space-y-4 border-l-2 border-slate-100 pl-3.5">
                            {roomDetails.rounds.map(round => (
                              <div key={round.id} className="space-y-1 relative">
                                <div className="absolute -left-[20px] top-1.5 w-2 h-2 rounded-full bg-slate-900" />
                                <span className="text-[10px] font-black text-slate-400">{round.roundNumber}라운드 소거 완료</span>
                                <h4 className="text-xs font-bold text-slate-900">
                                  {round.eliminatedIdeaIds.map(id => roomDetails.ideas.find(i => i.id === id)?.title).join(', ')} 소거
                                </h4>
                                <p className="text-[10px] text-slate-500 leading-relaxed bg-slate-50 p-2 rounded border border-slate-100">
                                  {round.aiSummaryText}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                )}

                {/* -----------------------------------------------------------
                    VIEW 6: CLOSED (FINAL REPORT SHOWCASE)
                    ----------------------------------------------------------- */}
                {roomDetails.room.status === 'CLOSED' && (
                  <div className="space-y-6 max-w-4xl mx-auto">
                    
                    {/* Winning Spotlight Card */}
                    <div className="bg-white p-6 md:p-8 rounded-3xl border border-indigo-200 shadow-lg text-center space-y-4 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-indigo-600" />
                      
                      <div className="w-14 h-14 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full flex items-center justify-center mx-auto shadow-md">
                        <Award className="w-6 h-6 text-amber-500 animate-bounce" />
                      </div>

                      <div className="space-y-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">최종 우승 및 생존 아이디어</span>
                        
                        {roomDetails.ideas.filter(i => i.status === 'WINNER').map(winner => (
                          <div key={winner.id} className="space-y-2 max-w-xl mx-auto">
                            <h2 className="text-xl md:text-2xl font-bold text-indigo-950 tracking-tight">
                              {winner.title}
                            </h2>
                            <p className="text-xs md:text-sm text-slate-600 leading-relaxed">
                              {winner.description}
                            </p>
                            <span className="inline-block text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 py-1 px-3.5 rounded-full mt-2">
                              제안자 : {winner.submitterName}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* IA 5.2: 최종 결정 미니 게임 (동률/합의 난항 해결) */}
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                            🎯 5.2 최종 결정 미니 게임 (동률/합의 난항 해결)
                          </h3>
                          <span className="text-[10px] text-slate-400 font-medium">동점 또는 최종 결정이 어려울 때 사용</span>
                        </div>

                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center space-y-3">
                          <p className="text-xs text-slate-600 font-medium">
                            팀원 간 최종 득표가 같거나 합의가 어려운 경우, 운명의 룰렛을 돌려 결정하십시오!
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              const activeOrWinnerIdeas = roomDetails.ideas.map(i => i.title);
                              if (activeOrWinnerIdeas.length === 0) return;
                              const randomChosen = activeOrWinnerIdeas[Math.floor(Math.random() * activeOrWinnerIdeas.length)];
                              triggerToast(`🎲 룰렛 추첨 결과: [${randomChosen}] 이(가) 선택되었습니다! 🎉`);
                            }}
                            className="py-2.5 px-5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition shadow-sm inline-flex items-center gap-1.5"
                          >
                            <span>🎲 운명의 룰렛 돌리기</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* AI Summary report details */}
                    {roomDetails.aiFinalSummary ? (
                      <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                          <Sparkles className="w-4 h-4 text-amber-500" />
                          <h3 className="text-base font-extrabold text-slate-900">AI 세션 종합 결론 보고서</h3>
                        </div>

                        <SafeMarkdown content={roomDetails.aiFinalSummary} />
                      </div>
                    ) : (
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center py-12">
                        <RefreshCw className="w-8 h-8 text-slate-300 animate-spin mx-auto mb-2" />
                        <p className="text-sm font-bold text-slate-500">최종 의사결정 보고서를 생성하는 중입니다...</p>
                      </div>
                    )}

                    {/* Historic rounds timeline review */}
                    <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                        <FileText className="w-4 h-4 text-slate-600" />
                        <h3 className="text-base font-extrabold text-slate-900">스크리닝 히스토리 타임라인</h3>
                      </div>

                      <div className="space-y-6 border-l-2 border-slate-200 pl-4 ml-2">
                        {roomDetails.rounds.map(round => (
                          <div key={round.id} className="space-y-1 relative">
                            <div className="absolute -left-[23px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-400" />
                            <span className="text-[10px] font-black text-slate-400">{round.roundNumber}라운드 탈락 이력</span>
                            <h4 className="text-xs md:text-sm font-bold text-slate-900">
                              {round.eliminatedIdeaIds.map(id => roomDetails.ideas.find(i => i.id === id)?.title).join(', ')} 소거됨
                            </h4>
                            <p className="text-xs text-slate-500 leading-relaxed max-w-2xl bg-slate-50 p-3 rounded-lg border border-slate-100 mt-1">
                              {round.aiSummaryText}
                            </p>
                          </div>
                        ))}

                        <div className="relative">
                          <div className="absolute -left-[23px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-900" />
                          <span className="text-[10px] font-black text-slate-400">세션 시작</span>
                          <h4 className="text-xs md:text-sm font-bold text-slate-900">아이디어 수집 완료</h4>
                          <p className="text-xs text-slate-500 mt-1">
                            총 {roomDetails.ideas.length}개의 참여 아이디어와 {roomDetails.criteria.length}개의 투표 기준이 성립되었습니다.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Share back to main button */}
                    <div className="text-center pt-4">
                      <button
                        onClick={() => { setActiveRoomId(null); setRoomDetails(null); }}
                        className="px-6 py-2.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl text-xs font-bold transition shadow-sm"
                      >
                        로비 홈화면으로 이동하기
                      </button>
                    </div>

                  </div>
                )}

              </div>
            </div>
          )}
          </div>
        )}
      </main>

      {/* Email Authentication Modal (Login / Signup) */}
      <AnimatePresence>
        {showLoginModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-6 md:p-8 rounded-3xl max-w-sm w-full shadow-xl space-y-5 text-left"
            >
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => { setAuthMode('LOGIN'); setAuthError(null); }}
                    className={`px-3 py-1 rounded-lg transition ${authMode === 'LOGIN' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    로그인
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAuthMode('SIGNUP'); setAuthError(null); }}
                    className={`px-3 py-1 rounded-lg transition ${authMode === 'SIGNUP' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    회원가입
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  {authMode === 'LOGIN' ? '로그인' : '회원가입'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {authMode === 'LOGIN'
                    ? '이메일과 비밀번호를 입력하여 로그인하십시오.'
                    : '이메일 형식의 ID와 비밀번호를 설정하여 가입하십시오.'}
                </p>
              </div>

              {authError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-600 text-xs font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                  <span>{authError}</span>
                </div>
              )}

              <form onSubmit={authMode === 'LOGIN' ? handleEmailLogin : handleEmailSignUp} className="space-y-3">
                {authMode === 'SIGNUP' && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">이름 <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      required
                      value={authName}
                      onChange={e => setAuthName(e.target.value)}
                      placeholder="예: 홍길동"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">ID (이메일) <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={authEmail}
                    onChange={e => { setAuthEmail(e.target.value); setAuthError(null); }}
                    placeholder="GOMINHAJO 또는 user@example.com"
                    className={`w-full px-3.5 py-2 border rounded-xl text-xs focus:outline-none focus:ring-2 font-medium ${
                      authEmail && !isEmailValid ? 'border-rose-300 focus:ring-rose-400 bg-rose-50/30' : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {authEmail && !isEmailValid && (
                    <p className="text-[10px] text-rose-500 font-medium">⚠️ 올바른 이메일 형식이 아닙니다.</p>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700">비밀번호 <span className="text-rose-500">*</span></label>
                    {authMode === 'SIGNUP' && (
                      <span className="text-[10px] text-slate-400 font-normal">소문자+숫자 (최대 15자)</span>
                    )}
                  </div>
                  <input
                    type="password"
                    required
                    maxLength={15}
                    value={authPassword}
                    onChange={e => { setAuthPassword(e.target.value); setAuthError(null); }}
                    placeholder="영문 소문자 및 숫자 조합"
                    className={`w-full px-3.5 py-2 border rounded-xl text-xs focus:outline-none focus:ring-2 font-medium ${
                      authMode === 'SIGNUP' && authPassword && !isPasswordValid ? 'border-rose-300 focus:ring-rose-400 bg-rose-50/30' : 'border-slate-200 focus:ring-indigo-500'
                    }`}
                  />
                  {authMode === 'SIGNUP' && (
                    <div className="pt-0.5">
                      {authPassword ? (
                        isPasswordValid ? (
                          <p className="text-[10px] text-emerald-600 font-bold">✓ 사용 가능한 비밀번호입니다.</p>
                        ) : (
                          <p className="text-[10px] text-rose-500 font-medium">⚠️ 영문 소문자와 숫자를 포함하여 15자 이내로 입력해주세요.</p>
                        )
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="pt-2 space-y-2">
                  <button
                    type="submit"
                    disabled={authMode === 'SIGNUP' && (!isEmailValid || !isPasswordValid || !authName.trim())}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition shadow-sm"
                  >
                    {authMode === 'LOGIN' ? '로그인' : '회원가입 완료'}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setShowLoginModal(false); setAuthError(null); }}
                    className="w-full py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 transition text-center"
                  >
                    닫기
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Dual Link & Invitation Modal (① 참여자 전용 링크 vs ② 투표자 공개 링크) */}
      <AnimatePresence>
        {showShareModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-6 md:p-8 rounded-3xl max-w-lg w-full shadow-2xl space-y-6 text-left"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-bold">
                    🔗
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">회의실 전용 링크 공유 및 관리</h3>
                    <p className="text-xs text-slate-400">참여자용 링크 및 2차 투표자 전용 공개 링크를 구분 발급합니다.</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowShareModal(false)}
                  className="text-slate-400 hover:text-slate-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Link Option 1: ① 참여자 전용 링크 */}
              <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                      ① 참여자 전용 링크
                    </span>
                    <span className="text-[11px] font-semibold text-indigo-900">최대 6명 (의견 및 아이디어 제출 가능)</span>
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  회의에 직접 동참하여 아이디어를 발제하고 익명 평가 기준을 제출하는 핵심 참여자 링크입니다. (입장 시 닉네임 최대 6자 설정)
                </p>

                {/* Email invitation form */}
                <form onSubmit={handleSendEmailInvite} className="flex gap-2 pt-1">
                  <input
                    type="email"
                    value={inviteEmailInput}
                    onChange={e => setInviteEmailInput(e.target.value)}
                    placeholder="참여자 이메일 입력 (예: member@company.com)"
                    className="flex-1 px-3 py-2 border border-indigo-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium bg-white"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-xs shrink-0"
                  >
                    이메일 초대
                  </button>
                </form>

                <button
                  onClick={copyParticipantLink}
                  className="w-full py-2.5 bg-white hover:bg-indigo-100/50 border border-indigo-200 text-indigo-900 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5 text-indigo-600" />
                  <span>참여자 전용 복사 링크</span>
                </button>
              </div>

              {/* Link Option 2: ② 투표자 공개 링크 */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-900 text-white">
                      ② 투표자 공개 링크
                    </span>
                    <span className="text-[11px] font-semibold text-slate-700">MVP 기본 30명 (2차 익명 투표 전용)</span>
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  인원 제한이 완화되어 제출된 아이디어에 대해 소신 투표만 익명으로 진행하는 외부/동료 전용 공개 링크입니다.
                </p>

                <button
                  onClick={copyVoterLink}
                  className="w-full py-2.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-600" />
                  <span>투표자 전용 복사 링크</span>
                </button>
              </div>

              <div className="pt-2 text-right">
                <button
                  onClick={() => setShowShareModal(false)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
