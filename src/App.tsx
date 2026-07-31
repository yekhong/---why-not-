import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  Trash2,
  Sparkles,
  ChevronRight,
  User,
  Users,
  Check,
  CheckCircle,
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
  Star,
  Edit2,
  Edit,
  Download,
  ChevronDown,
  ChevronUp,
  Clock,
  Share2
} from 'lucide-react';
import {
  Room,
  RoomStatus,
  Idea,
  Criterion,
  CriterionProposal,
  Evaluation,
  CriteriaEvaluationValue,
  EliminationRound,
  DecisionMode,
  RoomDetails,
  Participant,
  InviteDetailsResponse
} from './types';


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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSessionChecked, setIsSessionChecked] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [authMode, setAuthMode] = useState<'LOGIN' | 'SIGNUP' | 'RECOVER'>('LOGIN');

  // Form input fields
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  // Recovery code states
  const [recoveryCodeOutput, setRecoveryCodeOutput] = useState<string | null>(null);
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveredAccountResult, setRecoveredAccountResult] = useState<{ loginId: string; newRecoveryCode: string } | null>(null);
  const [isRecoveringAccount, setIsRecoveringAccount] = useState(false);

  const [userId, setUserId] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [isRegisteringUser, setIsRegisteringUser] = useState(false);
  const [tempNickname, setTempNickname] = useState('');
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);

  // Password validation helper: 8~64자의 영문과 숫자 조합
  const isPasswordValid = useMemo(() => {
    if (!authPassword) return false;
    const isValidLength = authPassword.length >= 8 && authPassword.length <= 64;
    const hasLetter = /[A-Za-z]/.test(authPassword);
    const hasDigit = /[0-9]/.test(authPassword);
    return isValidLength && hasLetter && hasDigit;
  }, [authPassword]);

  // Email validation helper: 이메일 또는 서비스 로그인 ID
  const isEmailValid = useMemo(() => {
    const input = authEmail.trim();
    if (!input) return false;
    if (input.toUpperCase() === 'GOMINHAJO' || !input.includes('@')) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  }, [authEmail]);

  // Secure Email/ID Signup Handler (/api/auth/signup)
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmailValid) {
      triggerToast('올바른 로그인 아이디/이메일 형식을 입력해 주세요.', 'error');
      return;
    }
    if (!isPasswordValid) {
      triggerToast('비밀번호는 8~64자의 영문과 숫자 조합이어야 합니다.', 'error');
      return;
    }
    if (!authName.trim()) {
      triggerToast('이름(닉네임)을 입력해 주세요.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginId: authEmail.trim(),
          password: authPassword,
          nickname: authName.trim()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '회원가입 처리 중 오류가 발생했습니다.');
      }

      const uId = data.user.id;
      const uName = data.user.nickname;
      const uEmail = data.user.loginId;

      setUserId(uId);
      setNickname(uName);
      setUserEmail(uEmail);
      setIsLoggedIn(true);

      if (data.recoveryCode) {
        setRecoveryCodeOutput(data.recoveryCode);
      } else {
        setShowLoginModal(false);
      }
      triggerToast('회원가입이 완료되었습니다! 발급된 복구 코드를 반드시 보관하세요.');
    } catch (err: any) {
      const message = err?.message || '회원가입 처리 중 오류가 발생했습니다.';
      setAuthError(message);
      triggerToast(message, 'error');
    }
  };

  // Secure Email/ID Login Handler (/api/auth/login)
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const failMsg = '아이디 또는 비밀번호가 올바르지 않습니다. 입력한 정보를 다시 확인해 주세요.';

    const inputEmailOrId = authEmail.trim();

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginId: inputEmailOrId,
          password: authPassword
        })
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        const uId = data.user.id;
        const uName = data.user.nickname;
        const uEmail = data.user.loginId;

        setUserId(uId);
        setNickname(uName);
        setUserEmail(uEmail);
        setIsLoggedIn(true);
        setShowLoginModal(false);
        triggerToast(`${uName}님 환영합니다!`);
        return;
      }
    } catch (err) {
      console.warn('Backend Auth Login error:', err);
    }

    setAuthError(failMsg);
    triggerToast(failMsg, 'error');
  };

  // Secure Account Recovery Handler (/api/auth/recover)
  const handleAccountRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryCodeInput.trim()) {
      triggerToast('발급받으셨던 복구 코드를 입력해 주세요.', 'error');
      return;
    }
    if (!recoveryNewPassword) {
      triggerToast('새로 변경할 비밀번호를 입력해 주세요.', 'error');
      return;
    }

    setIsRecoveringAccount(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recoveryCode: recoveryCodeInput.trim(),
          newPassword: recoveryNewPassword
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '계정 복구 실패. 복구 코드를 다시 확인해 주세요.');
      }

      setRecoveredAccountResult({
        loginId: data.loginId,
        newRecoveryCode: data.newRecoveryCode
      });

      if (data.user) {
        setUserId(data.user.id);
        setNickname(data.user.nickname);
        setUserEmail(data.loginId);
        setIsLoggedIn(true);
      }

      triggerToast('비밀번호가 재설정되었습니다! 새 복구 코드를 반드시 보관하세요.');
    } catch (err: any) {
      setAuthError(err.message || '복구 코드 검증 실패');
      triggerToast(err.message || '복구 코드 검증 실패', 'error');
    } finally {
      setIsRecoveringAccount(false);
    }
  };

  // ----------------------------------------------------------------
  // Room Navigation / Filter / Pinning State (ENTRY-01 ~ ENTRY-04)
  // ----------------------------------------------------------------
  const [roomsList, setRoomsList] = useState<any[]>([]);
  const [roomFilterStatus, setRoomFilterStatus] = useState<'ALL' | 'ACTIVE' | 'CLOSED'>('ACTIVE');
  const [roomOwnershipFilter, setRoomOwnershipFilter] = useState<'ALL' | 'CREATED_BY_ME' | 'JOINED_BY_ME'>('ALL');
  const [showHiddenRooms, setShowHiddenRooms] = useState<boolean>(false);
  const [isFetchRoomsLoading, setIsFetchRoomsLoading] = useState<boolean>(false);
  const [fetchRoomsError, setFetchRoomsError] = useState<boolean>(false);
  const [isJoinCodeModalOpen, setIsJoinCodeModalOpen] = useState(false);
  const [inputJoinCode, setInputJoinCode] = useState('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomDetails, setRoomDetails] = useState<RoomDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchRoomError, setFetchRoomError] = useState(false);
  const [showIdeaSubmissionGate, setShowIdeaSubmissionGate] = useState(false);

  // ----------------------------------------------------------------
  // 3-Minute Expiring Invite Token & Landing Card States
  // ----------------------------------------------------------------
  const [activeInviteToken, setActiveInviteToken] = useState<string | null>(null);
  const [inviteTokenExpiresAt, setInviteTokenExpiresAt] = useState<string | null>(null);
  const [inviteSecondsLeft, setInviteSecondsLeft] = useState<number>(180);

  const [landingInviteToken, setLandingInviteToken] = useState<string | null>(null);
  const [landingInviteData, setLandingInviteData] = useState<InviteDetailsResponse | null>(null);
  const [landingLoading, setLandingLoading] = useState<boolean>(false);
  const [landingNicknameInput, setLandingNicknameInput] = useState<string>('');
  const [joiningInvite, setJoiningInvite] = useState<boolean>(false);

  // ----------------------------------------------------------------
  // Forms & Interactive UI states (ENTRY-02, IDEA-02, IDEA-03)
  // ----------------------------------------------------------------
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [newRoomHostNickname, setNewRoomHostNickname] = useState('');
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [newRoomCategory, setNewRoomCategory] = useState<'기획' | '디자인'>('기획');
  const [newRoomMaxParticipants, setNewRoomMaxParticipants] = useState(2);
  const [newRoomTargetWinners, setNewRoomTargetWinners] = useState(1);
  const [newRoomDecisionMode, setNewRoomDecisionMode] = useState<DecisionMode>('STRUCTURED');
  const [newRoomVoteStartTime, setNewRoomVoteStartTime] = useState('');
  const [newRoomVoteEndTime, setNewRoomVoteEndTime] = useState('');
  const [newRoomThreshold, setNewRoomThreshold] = useState(3);

  // Submitting Idea (IDEA-02 & IDEA-03)
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaDesc, setIdeaDesc] = useState('');
  const [ideaLink, setIdeaLink] = useState('');
  const [ideaPdfName, setIdeaPdfName] = useState('');
  const [ideaTags, setIdeaTags] = useState('');
  const [isDevelopingIdea, setIsDevelopingIdea] = useState(false);
  const [ideaAiSuggestion, setIdeaAiSuggestion] = useState<null | {
    originalDescription: string;
    revisedDescription: string;
    reviewQuestions: string[];
    aiAvailable: boolean;
  }>(null);

  // Expanded Ideas state for accordion toggle
  const [expandedIdeaIds, setExpandedIdeaIds] = useState<Record<string, boolean>>({});
  const toggleIdeaExpanded = (ideaId: string) => {
    setExpandedIdeaIds(prev => ({ ...prev, [ideaId]: !prev[ideaId] }));
  };

  // Editing Idea state
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null);
  const [editIdeaTitle, setEditIdeaTitle] = useState('');
  const [editIdeaDesc, setEditIdeaDesc] = useState('');
  const [editIdeaLink, setEditIdeaLink] = useState('');
  const [editIdeaPdfName, setEditIdeaPdfName] = useState('');



  // Submitting Proposal
  const [proposalText, setProposalText] = useState('');

  // Editing Criteria Candidates (During REVIEW stage)
  const [editableCriteria, setEditableCriteria] = useState<Criterion[]>([]);

  // Submitting Evaluation (Accumulator for the current evaluation page)
  const [evalSubmissions, setEvalSubmissions] = useState<Record<string, {
    decision: 'KEEP' | 'NEUTRAL' | 'EXCLUDE';
    excludedCriterionIds: string[];
    criteriaEvaluations: Record<string, CriteriaEvaluationValue>;
    reasonText: string;
    reasonType: 'OBJECTIVE_CONSTRAINT' | 'PREFERENCE';
  }>>({});
  const [isReEditingEvaluation, setIsReEditingEvaluation] = useState(false);

  const handleStartReEditingEvaluation = async () => {
    if (roomDetails?.myEvaluations && roomDetails.myEvaluations.length > 0) {
      const prefilled: Record<string, any> = {};
      roomDetails.myEvaluations.forEach(ev => {
        prefilled[ev.ideaId] = {
          decision: ev.decision,
          excludedCriterionIds: ev.excludedCriterionIds || [],
          criteriaEvaluations: ev.criteriaEvaluations || {},
          reasonText: ev.reasonText || '',
          reasonType: ev.reasonType || 'PREFERENCE'
        };
      });
      setEvalSubmissions(prefilled);
    }
    setIsReEditingEvaluation(true);

    if (activeRoomId && userId) {
      try {
        await fetch(`/api/rooms/${activeRoomId}/re-edit-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isReEditing: true })
        });
      } catch (err) {
        console.warn('Re-edit status update error:', err);
      }

      fetchRoomDetails(activeRoomId, true);
    }
  };

  const handleCancelReEditingEvaluation = async () => {
    setIsReEditingEvaluation(false);
    if (activeRoomId && userId) {
      const activeIdeas = roomDetails?.ideas.filter(i => i.status === 'ACTIVE') || [];
      const hasAllSubmissions = activeIdeas.every(i => evalSubmissions[i.id]?.decision);

      if (hasAllSubmissions && activeIdeas.length > 0) {
        const submissions = activeIdeas.map(i => ({
          ideaId: i.id,
          decision: evalSubmissions[i.id].decision,
          excludedCriterionIds: evalSubmissions[i.id].excludedCriterionIds || [],
          reasonText: evalSubmissions[i.id].reasonText || '',
          reasonType: evalSubmissions[i.id].reasonType || 'PREFERENCE',
        }));

        try {
          const response = await fetch(`/api/rooms/${activeRoomId}/evaluations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submissions })
          });
          const data = await response.json().catch(() => null);
          if (!response.ok) throw new Error(data?.error || '평가를 복원하지 못했습니다.');
        } catch (err) {
          console.warn('Cancel re-edit re-submission error:', err);
          triggerToast(err instanceof Error ? err.message : '평가를 복원하지 못했습니다.', 'error');
        }
      } else {
        try {
          await fetch(`/api/rooms/${activeRoomId}/re-edit-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isReEditing: false })
          });
        } catch (err) {
          console.warn('Cancel re-edit status update error:', err);
        }
      }

      fetchRoomDetails(activeRoomId, true);
    }
  };

  // 4단계 2차 투표 별 스티커 투표 로컬 상태 (선택 중인 아이디어 ID 목록)
  const [mySelectedStarIdeaIds, setMySelectedStarIdeaIds] = useState<string[]>([]);
  const [isSubmittingStarVote, setIsSubmittingStarVote] = useState(false);

  const handleStartFinalVote = async () => {
    const allIdeas = roomDetails?.ideas || [];
    const activeIdeas = allIdeas.filter(i => i.status === 'ACTIVE' || i.status !== 'ELIMINATED');
    if (activeIdeas.length > 0 && !selectedFinalIdeaId) {
      setSelectedFinalIdeaId(activeIdeas[0].id);
    }
    setShowWinnerModal(false);
    setShowFinalVoteModal(true);

    if (activeRoomId) {
      try {
        await fetch(`/api/rooms/${activeRoomId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'FINAL_VOTE' })
        });
      } catch (err) {
        console.warn('Status update API error:', err);
      }

      fetchRoomDetails(activeRoomId, true);
    }
  };

  // Automatically open 4단계 2차 별 스티커 투표 modal for all participants when room.status === 'FINAL_VOTE'
  useEffect(() => {
    if (roomDetails?.room?.status === 'FINAL_VOTE' && !roomDetails.isStarVoteSubmitted) {
      setShowFinalVoteModal(true);
    }
  }, [roomDetails?.room?.status, roomDetails?.isStarVoteSubmitted]);

  // 4단계 수동 소거 확인 팝업 modal state
  const [pendingEliminationIdea, setPendingEliminationIdea] = useState<Idea | null>(null);
  const [isEliminatingIdea, setIsEliminatingIdea] = useState(false);

  // Error/Success Alerts
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Copy Link feedback & Share Modal state
  const [copied, setCopied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const hasShownWinnerModalRef = useRef<Set<string>>(new Set());
  const [showFinalVoteModal, setShowFinalVoteModal] = useState(false);
  const [selectedFinalIdeaId, setSelectedFinalIdeaId] = useState('');
  const [isSubmittingFinalVote, setIsSubmittingFinalVote] = useState(false);
  const [inviteEmailInput, setInviteEmailInput] = useState('');
  // Roulette Preview Modal States (Test & Demo mode)
  const [showRouletteModal, setShowRouletteModal] = useState(false);
  const [isSpinningRoulette, setIsSpinningRoulette] = useState(false);
  const [rouletteWinnerResult, setRouletteWinnerResult] = useState<string | null>(null);
  const [rouletteRotation, setRouletteRotation] = useState(0);
  const [roulettePurpose, setRoulettePurpose] = useState<'PREVIEW' | 'TIE_RESOLUTION'>('PREVIEW');

  // Room Settings Edit Modal States (Host only)
  const [showRoomSettingsModal, setShowRoomSettingsModal] = useState(false);
  const [editRoomTitle, setEditRoomTitle] = useState('');
  const [editRoomDesc, setEditRoomDesc] = useState('');
  const [editRoomCategory, setEditRoomCategory] = useState('기획');
  const [editRoomMaxParticipants, setEditRoomMaxParticipants] = useState(4);
  const [editRoomTargetWinnerCount, setEditRoomTargetWinnerCount] = useState(1);
  const [editRoomMinThreshold, setEditRoomMinThreshold] = useState(3);
  const [isUpdatingRoomSettings, setIsUpdatingRoomSettings] = useState(false);
  // On-Demand Demo Seed Data Handler
  const [isGeneratingDemo, setIsGeneratingDemo] = useState(false);

  const handleLoadDemoData = async () => {
    setIsGeneratingDemo(true);
    try {
      const res = await fetch('/api/demo/seed', { method: 'POST' });
      if (res.ok) {
        triggerToast('🚀 데모 샘플 방(고민하조 팀 프로젝트)이 1초 만에 생성되었습니다!', 'success');
        await fetchRooms();
      } else {
        triggerToast('데모 데이터 생성을 완료할 수 없습니다.', 'error');
      }
    } catch (e) {
      console.error(e);
      triggerToast('데모 데이터 생성 중 오류가 발생했습니다.', 'error');
    } finally {
      setIsGeneratingDemo(false);
    }
  };

  const openRoomSettingsModal = () => {
    if (!roomDetails?.room) return;
    setEditRoomTitle(roomDetails.room.title || '');
    setEditRoomDesc(roomDetails.room.description || '');
    setEditRoomCategory(roomDetails.room.category || '기획');
    setEditRoomMaxParticipants(roomDetails.room.maxParticipants || 4);
    setEditRoomTargetWinnerCount(roomDetails.room.targetWinnerCount || 1);
    setEditRoomMinThreshold(roomDetails.room.minResponseThreshold || 3);
    setShowRoomSettingsModal(true);
  };

  const handleUpdateRoomSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoomId || !roomDetails?.room) return;
    if (!editRoomTitle.trim()) {
      triggerToast('방 제목을 입력해주세요.', 'error');
      return;
    }

    setIsUpdatingRoomSettings(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId: userId,
          title: editRoomTitle.trim(),
          description: editRoomDesc.trim(),
          category: editRoomCategory,
          maxParticipants: editRoomMaxParticipants,
          targetWinnerCount: editRoomTargetWinnerCount,
          minResponseThreshold: editRoomMinThreshold
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '방 정보 수정에 실패했습니다.');
    } catch (err) {
      const message = err instanceof Error ? err.message : '방 정보 수정에 실패했습니다.';
      triggerToast(message, 'error');
      setIsUpdatingRoomSettings(false);
      return;
    }

    triggerToast('방 정보가 성공적으로 수정되었습니다!');
    setShowRoomSettingsModal(false);
    setIsUpdatingRoomSettings(false);
    fetchRoomDetails(activeRoomId, false);
  };

  // Dual link copy helpers (① Participant link vs ② Voter link)
  const copyParticipantLink = () => {
    if (!activeRoomId) return;
    const url = `${window.location.origin}?room=${activeRoomId}&role=participant`;
    navigator.clipboard.writeText(url);
    triggerToast('① 참여자 전용 링크 (최대 6명, 의견등록 가능)가 복사되었습니다!');
  };

  const handleSendEmailInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmailInput.trim()) return;
    triggerToast(`[${inviteEmailInput.trim()}] (으)로 초대 메일 발송이 완료되었습니다!`);
    setInviteEmailInput('');
  };

  // Return to Lobby (Clean active room ID, role, local state, and URL query params)
  const handleLeaveRoom = () => {
    setActiveRoomId(null);
    setRoomDetails(null);
    setFetchRoomError(false);
    setShowIdeaSubmissionGate(false);
    setIsReEditingEvaluation(false);
    if (activeRoomId) {
      localStorage.removeItem(`why_not_idea_step_gate_${activeRoomId}`);
    }
    localStorage.removeItem('why_not_active_room_id');
    localStorage.removeItem('why_not_user_role');
    if (window.location.search || window.location.pathname.startsWith('/invite')) {
      window.history.replaceState({}, '', '/');
    }
  };

  // Stage 1 Gate helper functions
  const handleEnterIdeaGate = async () => {
    setShowIdeaSubmissionGate(true);
    if (activeRoomId) {
      localStorage.setItem(`why_not_idea_step_gate_${activeRoomId}`, 'true');
      try {
        await fetch(`/api/rooms/${activeRoomId}/ideas/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        fetchRoomDetails(activeRoomId, false);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleExitIdeaGate = async () => {
    setShowIdeaSubmissionGate(false);
    if (activeRoomId) {
      localStorage.removeItem(`why_not_idea_step_gate_${activeRoomId}`);
      try {
        await fetch(`/api/rooms/${activeRoomId}/ideas/uncomplete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        fetchRoomDetails(activeRoomId, false);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleConfirmIdeaGateToStage2 = async () => {
    if (!activeRoomId || !roomDetails) return;
    setShowIdeaSubmissionGate(false);
    localStorage.removeItem(`why_not_idea_step_gate_${activeRoomId}`);
    if (roomDetails.room.decisionMode === 'QUICK') {
      try {
        const response = await fetch(`/api/rooms/${activeRoomId}/quick/start-vote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '빠른 익명 투표를 시작하지 못했습니다.');
        triggerToast('다른 사람의 선택은 보이지 않는 상태로 익명 투표를 시작합니다.');
        await fetchRoomDetails(activeRoomId);
      } catch (error: any) {
        setShowIdeaSubmissionGate(true);
        triggerToast(error.message || '빠른 익명 투표를 시작하지 못했습니다.', 'error');
      }
      return;
    }
    await handleForceChangeStatus('CRITERIA_PROPOSAL');
  };

  const handleRestartStage2WithSurvivingIdeas = async () => {
    if (activeIdeasCount < 2) {
      triggerToast('최소 2개 이상의 생존 아이디어가 있어야 2단계로 재진행할 수 있습니다.', 'error');
      return;
    }
    if (!window.confirm(`기존 결과를 보존하고 ${activeIdeasCount}개의 생존 아이디어로 새 재검토 회차를 시작하시겠습니까?`)) {
      return;
    }
    if (!activeRoomId) return;
    try {
      const response = await fetch(`/api/rooms/${activeRoomId}/review/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '재검토 회차를 시작하지 못했습니다.');
      triggerToast(`기존 결과를 보존하고 ${data.roundNumber || '새'}회차 재검토를 시작했습니다.`);
      await fetchRoomDetails(activeRoomId);
    } catch (error: any) {
      triggerToast(error.message || '재검토 회차를 시작하지 못했습니다.', 'error');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.error(e);
    }
    [
      'why_not_registered_users',
      'why_not_logged_in',
      'why_not_user_id',
      'why_not_user_name',
      'why_not_user_email'
    ].forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem('why_not_active_room_id');
    setIsLoggedIn(false);
    setUserId('');
    setNickname('');
    setUserEmail('');
    setActiveRoomId(null);
    triggerToast('로그아웃되었습니다.');
  };

  // The browser never decides who the user is. The HttpOnly server session does.
  useEffect(() => {
    let cancelled = false;

    const restoreServerSession = async () => {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (cancelled) return;

        if (response.ok && data?.authenticated && data?.user) {
          setUserId(data.user.id);
          setNickname(data.user.nickname || '');
          setTempNickname(data.user.nickname || '');
          setUserEmail(data.user.loginId || '');
          setIsLoggedIn(true);
        } else {
          setUserId('');
          setNickname('');
          setUserEmail('');
          setIsLoggedIn(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Session restore failed:', error);
          setIsLoggedIn(false);
        }
      } font-bold
        if (!cancelled) setIsSessionChecked(true);
      }
    };

    restoreServerSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Invite landing data is public only for an unexpired, unrevoked token.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteMatch = window.location.pathname.match(/\/invite\/([a-zA-Z0-9_-]+)/);
    const tokenFromUrl = inviteMatch ? inviteMatch[1] : params.get('inviteToken');
    if (tokenFromUrl) {
      setLandingInviteToken(tokenFromUrl);
      fetchInviteLandingDetails(tokenFromUrl);
    }
  }, []);

  // Load private room data only after the server has authenticated the session.
  useEffect(() => {
    if (!isSessionChecked || !isLoggedIn || !userId) return;

    fetchRooms();
    const params = new URLSearchParams(window.location.search);
    const urlRoomId = params.get('room') || params.get('roomId');
    const urlRole = params.get('role') || 'member';
    const savedRoomId = localStorage.getItem('why_not_active_room_id');
    const targetRoomId = urlRoomId || savedRoomId;

    if (targetRoomId) {
      if (urlRole === 'voter') {
        localStorage.setItem('why_not_user_role', 'VOTER');
      } else {
        localStorage.setItem('why_not_user_role', 'MEMBER');
      }
      handleSelectRoom(targetRoomId, userId, nickname);
    }
  }, [isSessionChecked, isLoggedIn, userId]);

  // Auto-Redirect to target room when user logs in with URL query params or pendingRoomId
  useEffect(() => {
    if (!isLoggedIn) return;

    const params = new URLSearchParams(window.location.search);
    const urlRoomId = params.get('room') || params.get('roomId');
    const urlRole = params.get('role') || 'member';
    const savedPendingRoomId = localStorage.getItem('why_not_pending_room_id');
    const targetRoomId = pendingRoomId || savedPendingRoomId || urlRoomId;

    if (targetRoomId && !activeRoomId) {
      if (urlRole === 'voter') {
        localStorage.setItem('why_not_user_role', 'VOTER');
      } else {
        localStorage.setItem('why_not_user_role', 'MEMBER');
      }
      console.log('[AUTO-REDIRECT] Login successful, auto-entering room:', targetRoomId);
      setActiveRoomId(targetRoomId);
      localStorage.setItem('why_not_active_room_id', targetRoomId);
      localStorage.removeItem('why_not_pending_room_id');
      setPendingRoomId(null);
      setShowLoginModal(false);
      fetchRoomDetails(targetRoomId);
    }
  }, [isLoggedIn, pendingRoomId, activeRoomId]);

  // 3-Minute Live Expiration Timer
  useEffect(() => {
    const targetTimeStr = landingInviteData?.expiresAt || inviteTokenExpiresAt;
    if (!targetTimeStr) return;

    const updateTimer = () => {
      const now = new Date().getTime();
      const exp = new Date(targetTimeStr).getTime();
      const diff = Math.max(0, Math.floor((exp - now) / 1000));
      setInviteSecondsLeft(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [inviteTokenExpiresAt, landingInviteData?.expiresAt]);

  // Private room synchronization goes through the authenticated BFF.
  // Browser-side Supabase Realtime is intentionally not used here.
  useEffect(() => {
    if (!activeRoomId || !isLoggedIn) return;

    setAiSuggestedCriteria([]);
    fetchRoomDetails(activeRoomId);

    const interval = setInterval(() => {
      fetchRoomDetails(activeRoomId, true);
    }, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [activeRoomId, isLoggedIn]);

  // Generate or Refresh 3-Minute Invite Token
  const handleGenerateNewInviteToken = async (roomId: string) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const apiData = await res.json();
      if (res.ok && apiData.success && apiData.invite) {
        setActiveInviteToken(apiData.invite.inviteToken);
        setInviteTokenExpiresAt(apiData.invite.expiresAt);
        triggerToast('3분 초대 링크가 클립보드용으로 준비되었습니다. (3분간 유효)');
        return apiData.invite.inviteToken;
      }
      throw new Error(apiData?.error || '초대 링크를 생성할 수 없습니다.');
    } catch (err: any) {
      console.error('Failed to create invite token:', err);
      triggerToast('초대 링크 생성 중 오류가 발생했습니다.', 'error');
    }
    return null;
  };

  // Deactivate active invite token for room
  const handleDeactivateInviteToken = async (roomId: string) => {
    try {
      const response = await fetch(`/api/rooms/${roomId}/invites`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || '초대 링크를 비활성화할 수 없습니다.');
      }
      setActiveInviteToken(null);
      setInviteTokenExpiresAt(null);
      triggerToast('초대 링크가 비활성화되었습니다.');
    } catch (err: any) {
      console.error('Failed to deactivate invite token:', err);
    }
  };

  // Fetch Invite Landing Details
  const fetchInviteLandingDetails = async (token: string) => {
    setLandingLoading(true);
    if (nickname) setLandingNicknameInput(nickname);

    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
        cache: 'no-store'
      });
      const data: InviteDetailsResponse = await response.json();
      setLandingInviteData(data);
      if (data.secondsRemaining !== undefined) {
        setInviteSecondsLeft(data.secondsRemaining);
      }
    } catch (err: any) {
      console.error('Failed to fetch invite details:', err);
      setLandingInviteData({
        isValid: false,
        errorCode: 'ERROR',
        errorMessage: '초대 링크 정보를 확인하는 중 오류가 발생했습니다.'
      });
    } finally {
      setLandingLoading(false);
    }
  };

  // Atomic Join Room via Invite Token
  const handleJoinRoomViaInvite = async (token: string) => {
    if (joiningInvite) return;
    setJoiningInvite(true);

    const nameToUse = landingNicknameInput.trim() || nickname || '참여자';
    setNickname(nameToUse);

    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nameToUse })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) setShowLoginModal(true);
        throw new Error(data?.error || '참가에 실패했습니다.');
      }

      const targetRoomId = data.roomId;
      localStorage.setItem('why_not_active_room_id', targetRoomId);
      setActiveRoomId(targetRoomId);
      setLandingInviteToken(null);
      setLandingInviteData(null);
      setInviteTokenExpiresAt(null);
      window.history.replaceState({}, '', '/');
      triggerToast('회의실 참가가 완료되었습니다!');
      handleSelectRoom(targetRoomId, userId, nameToUse);
    } catch (err: any) {
      console.error('Join room error:', err);
      triggerToast(err.message || '참가에 실패했습니다.', 'error');
      fetchInviteLandingDetails(token);
    } font-bold {
      setJoiningInvite(false);
    }
  };

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
    proposals: [],
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
    if (!isLoggedIn || !userId) {
      setRoomsList([]);
      setIsFetchRoomsLoading(false);
      setFetchRoomsError(false);
      return;
    }

    setIsFetchRoomsLoading(true);
    setFetchRoomsError(false);

    try {
      const response = await fetch('/api/rooms', { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) setIsLoggedIn(false);
        throw new Error(data?.error || '회의실 목록을 불러오지 못했습니다.');
      }

      setRoomsList(Array.isArray(data) ? data : (data?.rooms || []));
      setFetchRoomsError(false);
    } catch (error) {
      console.error('BFF fetchRooms error:', error);
      setFetchRoomsError(true);
    } finally {
      setIsFetchRoomsLoading(false);
    }
  };

  const fetchRoomDetails = async (id: string, isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setFetchRoomError(false);

    console.log(`[SYNC] 회의 정보 조회 시작 (roomId: ${id})`);

    // 10-second timeout controller to prevent infinite loading
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let isFetched = false;

    try {
      const res = await fetch(`/api/rooms/${id}`, {
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data: RoomDetails = await res.json();
        console.log(`[SYNC] 회의 정보 조회 완료. 현재 단계: ${data?.room?.status}, 아이디어 수: ${data?.ideas?.length}`);
        console.log(`[SYNC] 고유 참여자 계산 완료. 제출 완료 참여자 수: ${data?.completedParticipantsCount}`);

        setRoomDetails(prev => {
          const incomingProposals = data.proposals || [];
          const existingProposals = (prev && prev.room.id === data.room.id) ? (prev.proposals || []) : [];
          
          // Preserve only very recent local optimistic creations (< 3 seconds old) that haven't hit server yet
          const now = Date.now();
          const pendingUnsynced = existingProposals.filter(ep => {
            if (!ep.createdAt) return false;
            const age = now - new Date(ep.createdAt).getTime();
            return age < 3000 && ep.proposerId === userId;
          });

          const combined = [...incomingProposals];
          pendingUnsynced.forEach(ep => {
            if (!combined.some(cp => cp.id === ep.id || (cp.rawText && ep.rawText && cp.rawText.trim() === ep.rawText.trim()))) {
              combined.push(ep);
            }
          });

          // If previous roomDetails exists and incoming status is invalid/missing, preserve previous valid status
          if (prev && prev.room.id === data.room.id && (!data.room || !data.room.status)) {
            return {
              ...data,
              proposals: combined,
              proposalsCount: combined.length,
              room: {
                ...data.room,
                status: prev.room.status
              }
            };
          }
          return {
            ...data,
            proposals: combined,
            proposalsCount: combined.length
          };
        });

        if (data?.room?.status === 'CRITERIA_REVIEW') {
          setEditableCriteria(data.criteria || []);
        }
        const isWinnerState = data?.room?.status === 'CLOSED';
        if (isWinnerState && !hasShownWinnerModalRef.current.has(data.room.id)) {
          hasShownWinnerModalRef.current.add(data.room.id);
          setShowWinnerModal(true);
        }
        console.log('[SYNC] 현재 단계 적용 완료');
        isFetched = true;
      } else {
        console.warn(`[SYNC ERROR] Express backend responded with status: ${res.status}`);
        if (res.status === 401) {
          setIsLoggedIn(false);
          setShowLoginModal(true);
        }
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error('[SYNC ERROR] 10초 데이터 조회 타임아웃 발생');
      } else {
        console.warn('[SYNC ERROR] Express backend fetchRoomDetails failed, reading from Supabase DB...', err);
      }
    }

    if (isFetched) {
      console.log('[SYNC] 초기 로딩 종료 (Express 성공)');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setFetchRoomError(true);
    setLoading(false);
    setRefreshing(false);
    triggerToast('방 정보를 불러오는 데 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
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
      fetch(`/api/rooms/${activeRoomId}/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: trimmed }),
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

    if (!userId) {
      triggerToast('로그인 세션이 유효하지 않습니다. 다시 로그인해 주세요.', 'error');
      setShowLoginModal(true);
      return;
    }

    const hostNick = newRoomHostNickname.trim().slice(0, 6) || nickname.slice(0, 6) || '방장';
    localStorage.setItem('why_not_room_nickname', hostNick);
    setNickname(hostNick);

    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newRoomTitle.trim(),
          description: newRoomDesc,
          category: newRoomCategory,
          maxParticipants: Math.min(newRoomMaxParticipants, 6),
          targetWinnerCount: newRoomTargetWinners,
          decisionMode: newRoomDecisionMode,
          isPublic: false,
          minResponseThreshold: 1,
          eliminationConfig: { countPerRound: 1, tieBreak: 'random' },
          deadlines: {
            evaluationAt: newRoomVoteEndTime || undefined,
            voteStartTime: newRoomVoteStartTime || undefined
          }
        })
      });
      const createdRoom = await response.json().catch(() => null);
      if (!response.ok || !createdRoom?.id) {
        throw new Error(createdRoom?.error || '회의실을 저장하지 못했습니다.');
      }
      const createdRoomId = createdRoom.id;

      triggerToast(`회의실이 성공적으로 생성되었습니다! (방장 닉네임: ${hostNick})`);
      setIsCreatingRoom(false);
      setNewRoomHostNickname('');
      setNewRoomTitle('');
      setNewRoomDesc('');
      setNewRoomDecisionMode('STRUCTURED');
      setNewRoomVoteStartTime('');
      setNewRoomVoteEndTime('');

      // Select newly created room, open share modal and refresh dashboard list
      setActiveRoomId(createdRoomId);
      setShowShareModal(true);
      await handleGenerateNewInviteToken(createdRoomId);
      await fetchRoomDetails(createdRoomId);
      await fetchRooms();
    } catch (err: any) {
      console.error('Room Creation Failed:', err);
      triggerToast(err.message || '회의실 생성 도중 오류가 발생했습니다.', 'error');
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

    try {
      const res = await fetch(`/api/rooms/${roomId}/pin`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '고정 상태를 저장하지 못했습니다.');
    } catch (err) {
      setRoomsList(prev => prev.map(r => r.id === roomId ? { ...r, isPinned: !nextPinState } : r));
      triggerToast(err instanceof Error ? err.message : '고정 상태를 저장하지 못했습니다.', 'error');
    }
  };

  // Hide Room from My Dashboard (Only affects active user, preserves room & other participants)
  const handleHideRoom = async (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    if (!userId) return;

    setRoomsList(prev => prev.map(r => r.id === roomId ? { ...r, isHidden: true } : r));
    triggerToast('회의실이 내 목록에서 숨겨졌습니다.');

    try {
      const response = await fetch(`/api/rooms/${roomId}/hide`, { method: 'POST' });
      if (!response.ok) throw new Error('회의실 숨김 상태를 저장하지 못했습니다.');
    } catch (err) {
      setRoomsList(prev => prev.map(r => r.id === roomId ? { ...r, isHidden: false } : r));
      triggerToast('회의실 숨김 상태를 저장하지 못했습니다.', 'error');
    }
  };

  // Restore Room to My Dashboard
  const handleRestoreRoom = async (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    if (!userId) return;

    setRoomsList(prev => prev.map(r => r.id === roomId ? { ...r, isHidden: false } : r));
    triggerToast('회의실이 다시 로비 목록에 복원되었습니다.');

    try {
      const response = await fetch(`/api/rooms/${roomId}/hide`, { method: 'DELETE' });
      if (!response.ok) throw new Error('회의실 숨김 상태를 해제하지 못했습니다.');
    } catch (err) {
      setRoomsList(prev => prev.map(r => r.id === roomId ? { ...r, isHidden: true } : r));
      triggerToast('회의실 숨김 상태를 해제하지 못했습니다.', 'error');
    }
  };

  // Advance a room only through the server-validated milestone transition.
  const handleForceChangeStatus = async (nextStatus: RoomStatus) => {
    if (!activeRoomId) return;

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || '단계를 변경하지 못했습니다.');
      }
      await fetchRoomDetails(activeRoomId, true);
      triggerToast(`단계가 '${nextStatus}'(으)로 변경되었습니다.`);
    } catch (error) {
      console.error('Room status transition failed:', error);
      triggerToast(error instanceof Error ? error.message : '단계를 변경하지 못했습니다.', 'error');
    }
  };

  // Target pending room selection

  // Join existing Room (Prompt nickname modal if not specified)
  const handleSelectRoom = async (id: string, customUserId?: string, customNickname?: string) => {
    if (!isLoggedIn) {
      setPendingRoomId(id);
      localStorage.setItem('why_not_pending_room_id', id);
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
    setLoading(true);
    setFetchRoomError(false);
    setIsReEditingEvaluation(false);
    setShowIdeaSubmissionGate(false);
    localStorage.setItem('why_not_active_room_id', id);
    const nick = customNickname || currentSavedNickname || nickname;
    if (nick && nick !== nickname) setNickname(nick);
    await fetchRoomDetails(id);
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

    // Check duplicate idea title or description
    const existingIdeas = roomDetails.ideas || [];
    const trimmedTitle = ideaTitle.trim();
    const trimmedDesc = ideaDesc.trim();
    const isDupTitle = existingIdeas.some(i => i.title && i.title.trim() === trimmedTitle);
    const isDupDesc = trimmedDesc && existingIdeas.some(i => i.description && i.description.trim() === trimmedDesc);
    if (isDupTitle || isDupDesc) {
      triggerToast('⚠️ 동일한 내용의 아이디어가 등록되어 있습니다.', 'error');
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
    };

    try {
      const response = await fetch(`/api/rooms/${activeRoomId}/ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newIdeaObj),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || '아이디어를 등록하지 못했습니다.');
      }
    } catch (error) {
      console.error('Idea submission failed:', error);
      triggerToast(error instanceof Error ? error.message : '아이디어를 등록하지 못했습니다.', 'error');
      return;
    }

    triggerToast(`아이디어가 익명(${anonLabel})으로 성공적으로 등록되었습니다!`);
    setIdeaTitle('');
    setIdeaDesc('');
    setIdeaLink('');
    setIdeaPdfName('');
    setIdeaTags('');
    fetchRoomDetails(activeRoomId!);
  };

  // Update Idea Handler
  const handleUpdateIdea = async (ideaId: string) => {
    if (!editIdeaTitle.trim()) {
      triggerToast('아이디어 제목을 입력해 주세요.', 'error');
      return;
    }
    if (!editIdeaDesc.trim()) {
      triggerToast('아이디어 상세 설명을 입력해 주세요.', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/ideas/${ideaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editIdeaTitle.trim(),
          description: editIdeaDesc.trim(),
          attachmentUrl: editIdeaLink.trim(),
          pdfAttachmentUrl: editIdeaPdfName.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '아이디어를 수정하지 못했습니다.');
    } catch (error) {
      console.error('Idea update failed:', error);
      triggerToast(error instanceof Error ? error.message : '아이디어를 수정하지 못했습니다.', 'error');
      return;
    }

    // Update local roomDetails state if gominhajo or direct state match
    setRoomDetails(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ideas: prev.ideas.map(i => i.id === ideaId ? {
          ...i,
          title: editIdeaTitle.trim(),
          description: editIdeaDesc.trim(),
          attachmentUrl: editIdeaLink.trim(),
          pdfAttachmentUrl: editIdeaPdfName.trim(),
        } : i)
      };
    });

    triggerToast('아이디어가 성공적으로 수정되었습니다.');
    setEditingIdeaId(null);
    if (activeRoomId) fetchRoomDetails(activeRoomId, true);
  };

  // Delete Idea Handler
  const handleDeleteIdea = async (ideaId: string) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) {
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/ideas/${ideaId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '아이디어를 삭제하지 못했습니다.');
    } catch (error) {
      console.error('Idea deletion failed:', error);
      triggerToast(error instanceof Error ? error.message : '아이디어를 삭제하지 못했습니다.', 'error');
      return;
    }

    // Update local roomDetails state
    setRoomDetails(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ideas: prev.ideas.filter(i => i.id !== ideaId)
      };
    });

    triggerToast('아이디어가 삭제되었습니다.');
    if (editingIdeaId === ideaId) setEditingIdeaId(null);
    if (activeRoomId) fetchRoomDetails(activeRoomId, true);
  };


  // AI Suggested Criteria state
  const [aiSuggestedCriteria, setAiSuggestedCriteria] = useState<{ name: string; description: string }[]>([]);
  const [isGeneratingAiSuggestions, setIsGeneratingAiSuggestions] = useState(false);
  const [isClusteringLoading, setIsClusteringLoading] = useState(false);

  const autoRegisterAiProposals = async (suggestions: any[]) => {
    if (!suggestions || suggestions.length === 0 || !activeRoomId) return;

    // Deduplicate suggestions internally
    const seenInputs = new Set<string>();
    const uniqueSuggestions = suggestions.filter((item: any) => {
      const text = typeof item === 'string' ? item : (item.name ? `${item.name}${item.description ? `: ${item.description}` : ''}` : '');
      if (!text || seenInputs.has(text.trim())) return false;
      seenInputs.add(text.trim());
      return true;
    });

    setRoomDetails(prev => {
      if (!prev) return prev;
      const existing = prev.proposals || [];
      const existingTexts = new Set(existing.map(p => p.rawText?.trim()));

      const newProposals = uniqueSuggestions.map((item: any, idx: number) => {
        const text = typeof item === 'string' ? item : (item.name ? `${item.name}${item.description ? `: ${item.description}` : ''}` : '');
        return {
          id: `prop-ai-${idx}-${Math.random().toString(36).substring(2, 7)}`,
          roomId: activeRoomId,
          rawText: text,
          proposerId: 'gemini-ai',
          isAiSuggested: true,
          createdAt: new Date().toISOString()
        };
      }).filter((p: any) => p.rawText && !existingTexts.has(p.rawText.trim()));

      if (newProposals.length === 0) return prev;
      const updated = [...existing, ...newProposals];
      return {
        ...prev,
        proposals: updated,
        proposalsCount: updated.length
      };
    });

    // Persist only through the authenticated backend. The browser never writes
    // directly to Supabase and never impersonates a synthetic "gemini-ai" user.
    for (let idx = 0; idx < uniqueSuggestions.length; idx++) {
      const item = uniqueSuggestions[idx];
      const text = typeof item === 'string' ? item : (item.name ? `${item.name}${item.description ? `: ${item.description}` : ''}` : '');
      if (!text) continue;

      try {
        const res = await fetch(`/api/rooms/${activeRoomId}/criteria/propose`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText: text, isAiSuggested: true })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || 'AI 추천 기준 저장에 실패했습니다.');
        }
      } catch (error) {
        console.warn('AI recommendation persistence failed:', error);
      }
    }
  };

  // Fetch AI suggested criteria candidates based on registered ideas (Potens AI dynamically analyzing registered ideas)
  const handleFetchAiSuggestions = async () => {
    setIsGeneratingAiSuggestions(true);

    const currentIdeas = (roomDetails?.ideas || []).filter(i => i.status !== 'ELIMINATED');

    // 1. First, attempt Express Gemini AI Server Endpoint (/api/rooms/:id/criteria/suggest)
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/criteria/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideas: currentIdeas.map(i => ({ title: i.title, description: i.description }))
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.suggestions && data.suggestions.length > 0) {
          setAiSuggestedCriteria(data.suggestions);
          triggerToast('Potens AI가 3가지 평가 기준을 생성했습니다. 아래에서 원하는 기준을 제안하세요!');
          setIsGeneratingAiSuggestions(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Express server API unreachable, running dynamic frontend idea analyzer...');
    }

    // 2. Dynamic Frontend Idea Analyzer based on current room ideas
    const titles = currentIdeas.map(i => i.title).join(', ');

    setTimeout(async () => {
      let dynamicSuggestions: any[] = [];

      if (titles.includes('회의록') || titles.includes('마감할인') || titles.includes('건강기록')) {
        dynamicSuggestions = [
          {
            name: `B2B/O2O 실시간 데이터 처리 가능성`,
            description: `등록된 '${currentIdeas[0]?.title || 'AI 회의록'}' 및 '${currentIdeas[1]?.title || '마감할인 앱'}'과 같이 음성 인식이나 위치 기반 알림 등 실시간 연동/데이터 처리를 1달 내 MVP로 구현 가능한지 평가`
          },
          {
            name: `초기 공급자(소상공인/병원/팀장) 온보딩 용이성`,
            description: `서비스 활성화를 위해 필수적인 초기 데이터 공급층(B2B 기업 실무자, 동네 소상공인 등)을 수월하게 확보하고 사용 장벽을 낮출 수 있는가`
          },
          {
            name: `개인정보 및 보안/법적 리스크 적정성`,
            description: `회의 녹음 음성 데이터, 진료 기록, 위치 정보 등 민감한 유저 데이터 취급 시 보안/법적 부작용 리스크가 제어 가능한 범위인지`
          }
        ];
      } else {
        dynamicSuggestions = [
          {
            name: `핵심 기능 타겟 페인포인트 해소력`,
            description: `현재 등록된 ${currentIdeas.length}개 아이디어가 타겟 사용자층의 명확한 문제점(반복 업무 부담, 비용 손실 등)을 혁신적으로 해결하는가`
          },
          {
            name: `MVP 단기 개발 및 서비스 출시 가능성`,
            description: `팀 내부의 개발/디자인 기술 역량 및 가용한 개발 리소스로 주어진 스케줄 내에 안정적으로 MVP 구축이 가능한지 여부`
          },
          {
            name: `기존 유사 서비스 대비 뚜렷한 차별성`,
            description: `해외 및 국내 기존 유관 플랫폼 대비 경쟁 우위를 점할 수 있는 독자적 기능이나 운영 포인트가 존재하는가`
          }
        ];
      }

      setAiSuggestedCriteria(dynamicSuggestions);
      triggerToast('Potens AI가 3가지 평가 기준을 생성했습니다. 아래에서 원하는 기준을 제안하세요!');
      setIsGeneratingAiSuggestions(false);
    }, 600);
  };

  // Propose Criterion (Anonymous, Min 1 ~ Max 3 per user limit with instant fallback)
  const handleProposeCriterion = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const textToSubmit = customText || proposalText;
    if (!textToSubmit.trim()) {
      triggerToast('제안할 기준 내용을 입력해 주세요.', 'error');
      return;
    }

    if (!roomDetails) return;

    // Check user limits (AI max 3, Direct max 3, Total max 6)
    const existingProposals = roomDetails.proposals || [];
    const isAi = !!customText;

    // Check duplicate content
    const trimmedInput = textToSubmit.trim();
    const isDuplicate = existingProposals.some(p => p.rawText && p.rawText.trim() === trimmedInput);
    if (isDuplicate) {
      triggerToast('⚠️ 동일한 내용의 기준이 등록되어 있습니다.', 'error');
      return;
    }

    const myProps = existingProposals.filter(p => p && p.proposerId === userId);
    if (myProps.length >= 6) {
      triggerToast('⚠️ 총 평가 기준 목록은 최대 6개까지만 등록이 가능합니다.', 'error');
      return;
    }

    const myAiCount = myProps.filter(p => p && (p.isAiSuggested || (typeof p.id === 'string' && p.id.startsWith('prop-ai-')))).length;
    const myDirectCount = Math.max(0, myProps.length - myAiCount);

    if (isAi && myAiCount >= 3) {
      triggerToast('⚠️ AI 기반 평가 기준은 최대 3개까지만 등록할 수 있습니다.', 'error');
      return;
    }
    if (!isAi && myDirectCount >= 3) {
      triggerToast('⚠️ 직접 작성 평가 기준은 최대 3개까지만 등록할 수 있습니다.', 'error');
      return;
    }

    const newProposalObj = {
      id: isAi ? `prop-ai-${Math.random().toString(36).substring(2, 9)}` : `prop-${Math.random().toString(36).substring(2, 9)}`,
      roomId: activeRoomId!,
      rawText: textToSubmit.trim(),
      proposerId: userId,
      isAiSuggested: isAi,
      createdAt: new Date().toISOString()
    };

    // Update local state immediately
    setRoomDetails(prev => {
      if (!prev) return prev;
      const updatedProposals = [...(prev.proposals || []), newProposalObj];
      return {
        ...prev,
        proposals: updatedProposals,
        proposalsCount: updatedProposals.length
      };
    });

    triggerToast('평가 기준 제안이 익명으로 등록되었습니다!');
    setProposalText('');

    // Persist through the authenticated backend only.
    try {
      const response = await fetch(`/api/rooms/${activeRoomId}/criteria/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newProposalObj.id,
          rawText: textToSubmit.trim(),
          isAiSuggested: isAi,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || '평가 기준 제안을 저장하지 못했습니다.');
    } catch (err) {
      const message = err instanceof Error ? err.message : '평가 기준 제안을 저장하지 못했습니다.';
      triggerToast(message, 'error');
    }

    fetchRoomDetails(activeRoomId!, true);
  };

  // State for Editing Proposal
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [editingProposalText, setEditingProposalText] = useState<string>('');
  const [deletingProposalId, setDeletingProposalId] = useState<string | null>(null);

  // Save edited proposal
  const handleSaveProposal = async (proposalId: string) => {
    const updatedText = editingProposalText.trim();
    if (!updatedText) {
      triggerToast('평가 기준 내용을 입력해 주세요.', 'error');
      return;
    }

    setEditingProposalId(null);
    setEditingProposalText('');

    // 1. Update local React state immediately
    setRoomDetails(prev => {
      if (!prev) return prev;
      const updated = (prev.proposals || []).map(p => p.id === proposalId ? { ...p, rawText: updatedText } : p);
      return {
        ...prev,
        proposals: updated,
        proposalsCount: updated.length
      };
    });

    triggerToast('제안된 평가 기준이 수정되었습니다.');

    // Persist through the authenticated backend only.
    try {
      const response = await fetch(`/api/rooms/${activeRoomId}/criteria/proposals/${proposalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: updatedText })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || '평가 기준 수정에 실패했습니다.');
    } catch (e) {
      const message = e instanceof Error ? e.message : '평가 기준 수정에 실패했습니다.';
      triggerToast(message, 'error');
    }

    if (activeRoomId) fetchRoomDetails(activeRoomId, true);
  };

  // Direct Delete proposal
  const handleDeleteProposalDirect = async (proposalId: string) => {
    if (!activeRoomId || !proposalId) return;

    // 1. Update local React state immediately
    setRoomDetails(prev => {
      if (!prev) return prev;
      const updated = (prev.proposals || []).filter(p => p.id !== proposalId);
      return {
        ...prev,
        proposals: updated,
        proposalsCount: updated.length
      };
    });

    triggerToast('제안된 평가 기준이 삭제되었습니다.');

    // Persist through the authenticated backend only.
    try {
      const response = await fetch(`/api/rooms/${activeRoomId}/criteria/proposals/${proposalId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || '평가 기준 삭제에 실패했습니다.');
    } catch (e) {
      const message = e instanceof Error ? e.message : '평가 기준 삭제에 실패했습니다.';
      triggerToast(message, 'error');
    }

    if (activeRoomId) fetchRoomDetails(activeRoomId, true);
  };

  const handleConfirmDeleteProposal = async () => {
    if (!deletingProposalId) return;
    const targetId = deletingProposalId;
    setDeletingProposalId(null);
    await handleDeleteProposalDirect(targetId);
  };

  const handleDevelopIdea = async () => {
    if (!activeRoomId || !ideaTitle.trim() || !ideaDesc.trim()) {
      triggerToast('제목과 내용을 먼저 입력해 주세요.', 'error');
      return;
    }
    setIsDevelopingIdea(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/ideas/develop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: ideaTitle, description: ideaDesc })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'AI 보완안을 만들지 못했습니다.');
      setIdeaAiSuggestion({
        originalDescription: data.originalDescription || ideaDesc,
        revisedDescription: data.revisedDescription || data.enhancedDescription || ideaDesc,
        reviewQuestions: Array.isArray(data.reviewQuestions) ? data.reviewQuestions.slice(0, 3) : [],
        aiAvailable: data.aiAvailable !== false
      });
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : 'AI 보완안을 만들지 못했습니다.', 'error');
    } finally {
      setIsDevelopingIdea(false);
    }
  };

  const handleCompleteCriteriaProposal = async () => {
    if (!activeRoomId) return;
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/criteria/complete`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '기준 제안 완료 처리에 실패했습니다.');
      triggerToast(
        data.revealed
          ? '모든 참여자의 기준 제안이 완료되어 동시에 공개되었습니다.'
          : `내 기준 제안을 완료했습니다. (${data.count}/${data.expectedCount})`
      );
      await fetchRoomDetails(activeRoomId, true);
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : '기준 제안 완료 처리에 실패했습니다.', 'error');
    }
  };

  const handleCriteriaApproval = async (vote: 'APPROVE' | 'REVISE') => {
    if (!activeRoomId) return;
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/criteria/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '기준 동의 제출에 실패했습니다.');
      triggerToast(
        data.approval?.approved
          ? '팀 동의 기준을 충족하여 익명 평가 단계로 이동했습니다.'
          : data.approval?.needsRevision
            ? '팀 동의 기준에 미달하여 새 보완 회차를 시작합니다. 이전 의견과 투표는 기록으로 보존됩니다.'
          : vote === 'APPROVE'
            ? '이 기준으로 평가 진행에 동의했습니다.'
            : '보완이 필요하다는 의견을 익명으로 제출했습니다.'
      );
      await fetchRoomDetails(activeRoomId, true);
    } catch (error) {
      triggerToast(error instanceof Error ? error.message : '기준 동의 제출에 실패했습니다.', 'error');
    }
  };

  // Trigger AI Clustering (Host only)
  const handleTriggerClustering = async () => {
    setIsClusteringLoading(true);

    const proposals = roomDetails?.proposals || [];

    // Default clustered criteria dynamically mapping ALL submitted proposals
    const defaultClusteredCriteria: Criterion[] = proposals.length > 0
      ? proposals.map((p, i) => {
        const parts = (p.rawText || '').split(':');
        const namePart = parts[0]?.trim() || `제안 기준 #${i + 1}`;
        const descPart = parts[1]?.trim() || p.rawText || '제안 의견을 반영한 평가 기준';
        return {
          id: `crit-clustered-${i + 1}-${Math.random().toString(36).substr(2, 5)}`,
          roomId: activeRoomId!,
          name: namePart.slice(0, 15),
          description: `제안된 '${descPart.slice(0, 35)}...' 반영 평가 기준`,
          confirmed: true
        };
      })
      : [
        {
          id: `crit-clustered-1`,
          roomId: activeRoomId!,
          name: '기술적 구현 가능성 및 난이도',
          description: '가용한 팀 리소스 및 스케줄 내에서 1달 이내 MVP 구축이 가능한가',
          confirmed: true
        },
        {
          id: `crit-clustered-2`,
          roomId: activeRoomId!,
          name: '타겟 사용자 체감 가치 및 차별성',
          description: '기존 서비스 대비 뚜렷한 해결 효용을 제공하고 핵심 문제를 해소하는가',
          confirmed: true
        },
        {
          id: `crit-clustered-3`,
          roomId: activeRoomId!,
          name: '비용 및 운영 리스크 적정성',
          description: '초기 예산 범위 내 유지보수가 가능하며 법적/보안 리스크가 제어 가능한가',
          confirmed: true
        }
      ];

    let finalCriteria = defaultClusteredCriteria;

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/criteria/cluster`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.candidates && data.candidates.length > 0) {
          finalCriteria = data.candidates;
        }
      }
    } catch (err) {
      console.warn('Express API unavailable, criteria clustering updated locally.');
    }

    // Update local UI state
    setRoomDetails(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        criteria: finalCriteria,
        room: {
          ...prev.room,
          status: 'CRITERIA_REVIEW'
        }
      };
    });
    setEditableCriteria(finalCriteria);
    triggerToast('Potens AI가 수집된 의견을 수렴하여 3개 핵심 평가 기준을 정립했습니다!');

    setIsClusteringLoading(false);
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
        criteriaEvaluations: prev[ideaId]?.criteriaEvaluations || {},
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
        criteriaEvaluations: {},
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

  const handleCriteriaEvaluationChange = (
    ideaId: string,
    criterionId: string,
    value: CriteriaEvaluationValue
  ) => {
    setEvalSubmissions(prev => {
      const existing = prev[ideaId] || {
        decision: 'NEUTRAL' as const,
        excludedCriterionIds: [],
        criteriaEvaluations: {},
        reasonText: '',
        reasonType: 'PREFERENCE' as const
      };
      return {
        ...prev,
        [ideaId]: {
          ...existing,
          criteriaEvaluations: {
            ...(existing.criteriaEvaluations || {}),
            [criterionId]: value
          }
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

    const confirmedCriteria = roomDetails.criteria || [];

    // Verify all criteria and narrative reasons before sending one atomic batch.
    for (const idea of activeIdeas) {
      const vote = evalSubmissions[idea.id];
      const missingCriterion = confirmedCriteria.find(
        criterion => !vote.criteriaEvaluations?.[criterion.id]
      );
      if (missingCriterion) {
        triggerToast(`"${idea.title}"의 "${missingCriterion.name}" 충족도를 선택해 주세요.`, 'error');
        return;
      }
      if (vote.decision === 'KEEP' || vote.decision === 'EXCLUDE') {
        if (!vote.reasonText || !vote.reasonText.trim()) {
          const stanceLabel = vote.decision === 'KEEP' ? '유지 찬성' : '제외 희망';
          triggerToast(`"${idea.title}" 아이디어의 ${stanceLabel} 세부 사유를 작성해 주세요.`, 'error');
          return;
        }
      }
    }

    // Package submissions
    const submissions = activeIdeas.map(i => ({
      ideaId: i.id,
      decision: evalSubmissions[i.id].decision,
      excludedCriterionIds: evalSubmissions[i.id].excludedCriterionIds,
      criteriaEvaluations: evalSubmissions[i.id].criteriaEvaluations,
      reasonText: evalSubmissions[i.id].reasonText,
      reasonType: evalSubmissions[i.id].reasonType,
    }));

    setIsReEditingEvaluation(false);

    // Mark only this user's completion locally. The server controls phase changes.
    setRoomDetails(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        hasEvaluated: true,
        evaluatorsCount: (prev.evaluatorsCount || 0) + 1,
        minResponseThresholdMet: false,
        aggregatedScores: undefined
      };
    });

    triggerToast('익명 1차 투표 및 평가가 성공적으로 완료되었습니다!');

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/evaluations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evaluatorId: userId,
          submissions,
        }),
      });
      if (res.ok) {
        fetchRoomDetails(activeRoomId!);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '평가 제출에 실패했습니다.');
    } catch (err) {
      const message = err instanceof Error ? err.message : '평가 제출에 실패했습니다.';
      triggerToast(message, 'error');
      setRoomDetails(prev => prev ? { ...prev, hasEvaluated: false } : prev);
      fetchRoomDetails(activeRoomId!, true);
    }
  };

  // Seed Mock Evaluations (Developer / Demo helper)
  const handleSeedMockEvaluations = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/seed-evaluations`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '오류 발생');
      triggerToast(data.message || '시뮬레이션 가상 평가가 성공적으로 기록되었습니다! 정족수가 충족됩니다.');
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

      if (result.closed || result.finished) {
        triggerToast(result.message || '소거가 완료되어 최종 우승작이 선정되었습니다!');
        setShowWinnerModal(true);
      } else {
        triggerToast(result.message || '하위 후보가 소거되었습니다.');
      }
      fetchRoomDetails(activeRoomId!);
    } catch (err) {
      triggerToast('소거 진행 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  // 4단계 별 스티커 클릭 토글 함수
  const handleToggleStarIdea = (ideaId: string) => {
    if (!roomDetails) return;

    const targetWinners = roomDetails.room.targetWinnerCount || 1;
    const activeIdeaIds = (roomDetails.ideas || []).filter(i => i.status === 'ACTIVE' || i.status !== 'ELIMINATED').map(i => i.id);
    const validMyStarVotes = (roomDetails.myStarVotes || []).filter(id => activeIdeaIds.includes(id));
    const isSubmittedByMe = Boolean(
      (roomDetails.isStarVoteSubmitted || validMyStarVotes.length > 0) &&
      validMyStarVotes.length >= targetWinners
    );

    if (isSubmittedByMe) {
      triggerToast('이미 4단계 2차 투표를 제출하셨습니다.', 'error');
      return;
    }

    setMySelectedStarIdeaIds(prev => {
      if (prev.includes(ideaId)) {
        return prev.filter(id => id !== ideaId);
      } else {
        if (prev.length >= targetWinners) {
          triggerToast(`⭐ 별 스티커는 최대 ${targetWinners}개까지만 선택할 수 있습니다.`, 'error');
          return prev;
        }
        return [...prev, ideaId];
      }
    });
  };

  // 4단계 별 스티커 투표 제출 함수
  const handleSubmitStarVote = async () => {
    if (!activeRoomId || !roomDetails) return;
    const targetWinners = roomDetails.room.targetWinnerCount || 1;

    if (mySelectedStarIdeaIds.length !== targetWinners) {
      triggerToast(`⭐ 별 스티커 ${targetWinners}개를 모두 사용하셔야 투표를 제출할 수 있습니다.`, 'error');
      return;
    }

    setIsSubmittingStarVote(true);

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/star-vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedIdeaIds: mySelectedStarIdeaIds
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '투표를 저장하지 못했습니다.');
      triggerToast(data.message || '익명 투표가 안전하게 제출되었습니다.');
      await fetchRoomDetails(activeRoomId);
    } catch (err: any) {
      triggerToast(err.message || '투표를 저장하지 못했습니다. 다시 시도해 주세요.', 'error');
    } finally {
      setIsSubmittingStarVote(false);
    }
  };

  // 4단계 수동 소거 팝업 확정 처리 함수
  const handleConfirmManualElimination = async () => {
    if (!pendingEliminationIdea || !activeRoomId) return;
    const ideaIdToEliminate = pendingEliminationIdea.id;
    setIsEliminatingIdea(true);
    try {
      await handleProceedElimination(ideaIdToEliminate);
      setPendingEliminationIdea(null);
    } finally {
      setIsEliminatingIdea(false);
    }
  };

  // 4단계 정족수 달성용 가상 시뮬레이션 별 스티커 투표 생성 함수
  const handleSeedMockStarVotes = async () => {
    if (!activeRoomId || !roomDetails) return;

    // Check if active candidates exist
    const activeCandidates = (roomDetails.ideas || []).filter(i => i && i.status === 'ACTIVE');
    if (activeCandidates.length === 0) {
      triggerToast('2차 투표를 진행할 후보가 없습니다.', 'error');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/seed-star-votes`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || '가상 투표 생성 중 문제가 발생했습니다.');
      }

      triggerToast(data?.message || '가상 참여자 별 스티커 투표 데이터가 성공적으로 생성되었습니다!');
      await fetchRoomDetails(activeRoomId);
    } catch (err: any) {
      console.error('2차 투표 시뮬레이션 오류:', err);
      triggerToast(err?.message || '가상 투표 추가 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Submit Final Vote for remaining 2 candidates
  const handleSubmitFinalVote = async () => {
    if (!activeRoomId) return;
    if (!selectedFinalIdeaId) {
      triggerToast('투표하실 최종 후보 아이디어를 선택해 주세요.', 'error');
      return;
    }
    setIsSubmittingFinalVote(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/final-vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerIdeaId: selectedFinalIdeaId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '오류 발생');

      triggerToast(data.message || '최종 후보 투표가 완료되었습니다!');
      setShowFinalVoteModal(false);
      await fetchRoomDetails(activeRoomId);
      setShowWinnerModal(true);
    } catch (err: any) {
      triggerToast(err?.message || '최종 후보 투표 실패', 'error');
    } finally {
      setIsSubmittingFinalVote(false);
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
    if (!roomDetails || !Array.isArray(roomDetails.ideas)) return 0;
    return roomDetails.ideas.filter(i => i && i.status === 'ACTIVE').length;
  }, [roomDetails]);

  // Find objective constraint removal candidates (those with high objective exclusions)
  const objectiveCandidates = useMemo(() => {
    if (!roomDetails || !Array.isArray(roomDetails.ideas) || !roomDetails.aggregatedScores) return [];

    return roomDetails.ideas.filter(idea => {
      if (!idea || idea.status !== 'ACTIVE') return false;
      const stats = roomDetails.aggregatedScores?.[idea.id];
      if (!stats) return false;

      // Candidate if they have >= 1 objective exclusion
      return stats.objectiveExcludeCount >= 1;
    });
  }, [roomDetails]);

  // Find controversial / split-opinion ideas (high keep & exclude counts or close competition)
  const controversialIdeas = useMemo(() => {
    if (!roomDetails || !Array.isArray(roomDetails.ideas)) return [];

    const starVoteCounts = roomDetails.starVotes || {};
    return roomDetails.ideas.filter(idea => {
      if (!idea) return false;
      const stats = roomDetails.aggregatedScores?.[idea.id];
      const starCount = starVoteCounts[idea.id] || 0;
      if (stats) {
        // Idea with both keep and exclude votes or high discussion
        if (stats.keepCount >= 1 && stats.excludeCount >= 1) return true;
      }
      // Or idea that reached final stage with star votes > 0
      return starCount > 0 && idea.status !== 'WINNER';
    }).slice(0, 3);
  }, [roomDetails]);

  // Download Final Report PDF handler (uses native clean print dialog)
  const handleDownloadPDF = () => {
    triggerToast('📄 최종 결과 리포트 PDF 인쇄/다운로드 창을 불러옵니다.');
    setTimeout(() => {
      window.print();
    }, 500);
  };

  // Determine candidate ideas for Roulette Preview / Tie-breaker
  const rouletteCandidateIdeas = useMemo(() => {
    if (!roomDetails || !Array.isArray(roomDetails.ideas)) return [];

    if (roulettePurpose === 'TIE_RESOLUTION' && (roomDetails.tieCandidateIdeaIds || []).length > 0) {
      const tieIds = new Set(roomDetails.tieCandidateIdeaIds);
      return roomDetails.ideas.filter(idea => tieIds.has(idea.id));
    }

    const starVoteCounts = roomDetails.starVotes || {};
    const activeOrWinnerIdeas = roomDetails.ideas.filter(i => i && (i.status === 'ACTIVE' || i.status === 'WINNER'));

    // Sort by star votes desc
    const sorted = [...activeOrWinnerIdeas].sort((a, b) => (starVoteCounts[b.id] || 0) - (starVoteCounts[a.id] || 0));

    if (sorted.length >= 2) {
      return sorted.slice(0, 4); // top 2 to 4 candidates
    }

    // Fallback: if only 1 idea in list, add any other idea from room to ensure at least 2 candidates
    if (roomDetails.ideas.length >= 2) {
      return roomDetails.ideas.slice(0, 2);
    }

    // Fallback mock candidates if room only has 1 idea total
    return [
      sorted[0] || { id: 'mock-1', title: 'AI 회의록 자동 요약 서비스', description: '', submitterId: '', submitterName: 'GOMINHAJO', status: 'ACTIVE' },
      { id: 'mock-2', title: '동네 소상공인 마감할인 매칭 앱', description: '', submitterId: '', submitterName: '익명 참여자 A', status: 'ACTIVE' }
    ];
  }, [roomDetails, roulettePurpose]);

  // Roulette spin handler
  const handleSpinRoulette = async () => {
    if (isSpinningRoulette || rouletteCandidateIdeas.length === 0) return;
    setIsSpinningRoulette(true);
    setRouletteWinnerResult(null);

    const N = rouletteCandidateIdeas.length;
    const sliceAngle = 360 / N;

    let randomIndex = Math.floor(Math.random() * N);
    let chosenIdea = rouletteCandidateIdeas[randomIndex];
    if (roulettePurpose === 'TIE_RESOLUTION') {
      if (!activeRoomId) {
        setIsSpinningRoulette(false);
        return;
      }
      try {
        const response = await fetch(`/api/rooms/${activeRoomId}/star-vote/resolve-tie`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '동률 추첨 결과를 저장하지 못했습니다.');
        const selectedId = data.randomlySelectedIdeaIds?.[0] || data.winnerIdeaIds?.[0];
        const selectedIndex = rouletteCandidateIdeas.findIndex(idea => idea.id === selectedId);
        if (selectedIndex < 0) throw new Error('서버가 확정한 동률 후보를 화면에서 찾지 못했습니다.');
        randomIndex = selectedIndex;
        chosenIdea = rouletteCandidateIdeas[selectedIndex];
      } catch (error: any) {
        setIsSpinningRoulette(false);
        triggerToast(error.message || '동률 추첨에 실패했습니다.', 'error');
        return;
      }
    }

    // Compute center angle of the chosen candidate sector
    const sliceCenterAngle = randomIndex * sliceAngle + sliceAngle / 2;

    // Add safe random jitter strictly inside sector (keeping >= 20% margin from borders)
    const marginRatio = 0.20; // 20% margin from left and right borders of sector
    const safeHalfWidth = (sliceAngle / 2) * (1 - 2 * marginRatio);
    const randomJitter = (Math.random() - 0.5) * 2 * safeHalfWidth;

    // Target stopping angle relative to top pointer (12 o'clock = 0 deg)
    const targetSectorStopAngle = sliceCenterAngle + randomJitter;

    // SVG -rotate-90 offset adjustment: SVG start angle 0 is at 3 o'clock (-90 deg offset)
    const svgPointerStopAngle = (targetSectorStopAngle - 90 + 360) % 360;

    // Calculate base rotation to align target angle to top pointer (360 - svgPointerStopAngle)
    const normalizedStopAngle = (360 - svgPointerStopAngle + 360) % 360;

    // Calculate next cumulative rotation (minimum 5 full extra spins = 1800 deg)
    const currentRot = rouletteRotation;
    const currentMod = currentRot % 360;
    const additionalFullSpins = 360 * 5;

    let deltaAngle = (normalizedStopAngle - currentMod + 360) % 360;
    if (deltaAngle < 180) deltaAngle += 360; // Ensure minimum spin distance for visual feedback

    const newTargetRotation = currentRot + additionalFullSpins + deltaAngle;

    setRouletteRotation(newTargetRotation);

    setTimeout(async () => {
      setIsSpinningRoulette(false);
      setRouletteWinnerResult(chosenIdea.title);
      triggerToast(
        roulettePurpose === 'TIE_RESOLUTION'
          ? `동률 추첨 결과 [${chosenIdea.title}]이(가) 최종 확정되었습니다.`
          : `🎲 룰렛 미리보기 결과: [${chosenIdea.title}]`
      );
      if (roulettePurpose === 'TIE_RESOLUTION' && activeRoomId) {
        await fetchRoomDetails(activeRoomId);
      }
    }, 3600);
  };


  const myProposals = (roomDetails?.proposals || []).filter(p => p && p.proposerId === userId);
  const myAiProposalsCount = myProposals.filter(p => p && (p.isAiSuggested || (typeof p.id === 'string' && p.id.startsWith('prop-ai-')))).length;
  const myDirectProposalsCount = Math.max(0, myProposals.length - myAiProposalsCount);
  const myProposalsCount = myProposals.length;
  const totalProposalsCount = roomDetails?.proposalsCount || (roomDetails?.proposals || []).length;

  // ----------------------------------------------------------------
  // Render Main Body
  // ----------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
      {/* 4단계 수동 소거 확인 팝업 (Modal) */}
      <AnimatePresence>
        {pendingEliminationIdea && (
          <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white p-6 rounded-3xl max-w-md w-full shadow-2xl space-y-5 text-left border border-slate-200 relative overflow-hidden"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center font-bold border border-rose-100 shrink-0">
                  <AlertCircle className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">후보를 소거하시겠습니까?</h3>
                  <p className="text-xs font-semibold text-rose-600">[{pendingEliminationIdea.title}]</p>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs text-slate-600 space-y-1.5 leading-relaxed">
                <p className="font-bold text-slate-800">선택한 후보가 현재 활성 후보 목록에서 제외됩니다.</p>
                <p>정말 소거하시겠습니까?</p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingEliminationIdea(null)}
                  disabled={isEliminatingIdea}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleConfirmManualElimination}
                  disabled={isEliminatingIdea}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isEliminatingIdea ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      소거 처리 중...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      소거하기
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Alert */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 border text-sm max-w-sm ${toast.type === 'success'
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
              onClick={handleLeaveRoom}
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
                  {roomDetails.room.status === 'ELIMINATION' && `${(roomDetails.rounds?.length || 0) + 1}라운드 소거 진행 중`}
                  {roomDetails.room.status === 'CLOSED' && '종료 (최종 선정 완료)'}
                </span>
              </div>
            )}

            {/* Auth / Identity badge (이메일 정보 노출) */}
            {isLoggedIn ? (
              <div className="flex items-center gap-3">
                <div
                  onClick={() => {
                    const currentLoginId = userEmail || nickname || '알 수 없음';
                    navigator.clipboard.writeText(currentLoginId);
                    triggerToast(`✨ 로그인 이메일 ID: ${currentLoginId} (복사되었습니다!)`, 'success');
                  }}
                  className="group flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 py-1.5 px-3.5 rounded-full transition-all duration-200 cursor-pointer shadow-xs"
                >
                  <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  
                  {/* 평소: 닉네임 노출 */}
                  <span className="text-xs font-bold text-indigo-950 transition-all duration-200 group-hover:hidden">
                    {nickname || '사용자'}
                  </span>

                  {/* 마우스를 닉네임에 대면(Hover): 이메일 ID로 텍스트 인라인 전환 */}
                  <span className="text-xs font-bold text-indigo-700 font-mono transition-all duration-200 hidden group-hover:inline-block">
                    {userEmail || '이메일 정보 없음'}
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
                onClick={handleLeaveRoom}
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
            INVITE LINK LANDING CARD (3-Minute Expiring Token Landing)
            ----------------------------------------------------------- */}
        {(landingInviteToken && !activeRoomId) ? (
          <div className="py-12 max-w-lg mx-auto">
            {landingLoading ? (
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl text-center space-y-4">
                <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
                <p className="text-sm font-bold text-slate-600">초대 링크 유효성을 검증하고 있습니다...</p>
              </div>
            ) : !landingInviteData?.isValid ? (
              <div className="bg-white p-8 rounded-3xl border border-rose-200 shadow-xl text-center space-y-5">
                <div className="w-14 h-14 bg-rose-50 border border-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto shadow-sm">
                  <AlertCircle className="w-7 h-7 text-rose-500" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-xl font-extrabold text-slate-900">
                    {landingInviteData?.errorCode === 'EXPIRED' ? '생성된 지 3분이 지나 만료된 초대 링크입니다' :
                     landingInviteData?.errorCode === 'DEACTIVATED' ? '방장에 의해 비활성화된 초대 링크입니다' :
                     landingInviteData?.errorCode === 'CAPACITY_FULL' ? '최대 참가 가능 인원이 초과된 회의실입니다' :
                     landingInviteData?.errorCode === 'ROOM_CLOSED' ? '이미 종료된 회의실입니다' :
                     landingInviteData?.errorCode === 'ROOM_DELETED' ? '삭제된 회의실입니다' :
                     '유효하지 않은 초대 링크입니다'}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    {landingInviteData?.errorMessage || '유효하지 않거나 만료된 초대 링크입니다. 방장에게 새로운 3분 초대 링크를 요청해 주세요.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLandingInviteToken(null);
                    setLandingInviteData(null);
                    window.history.replaceState({}, '', '/');
                  }}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
                >
                  메인 로비로 이동하기
                </button>
              </div>
            ) : (
              <div className="bg-white p-8 rounded-3xl border border-indigo-100 shadow-2xl space-y-6 text-left relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-600 via-amber-400 to-indigo-600" />

                <div className="flex items-center justify-between">
                  <span className={`text-xs font-extrabold px-3 py-1 rounded-full ${
                    landingInviteData.room?.isPublic ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  }`}>
                    {landingInviteData.room?.isPublic ? '🌐 공개 회의실' : '🔒 비공개 회의실'}
                  </span>

                  {/* 3-Minute Live Countdown Badge */}
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border ${
                    inviteSecondsLeft <= 30
                      ? 'bg-rose-50 text-rose-600 border-rose-200 animate-pulse'
                      : 'bg-amber-50 text-amber-900 border-amber-200'
                  }`}>
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    <span>
                      {inviteSecondsLeft > 0
                        ? `⏱️ 만료까지 ${Math.floor(inviteSecondsLeft / 60)}분 ${inviteSecondsLeft % 60}초`
                        : '⏱️ 만료됨 (3분 초과)'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-1 border-b border-slate-100 pb-5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block">회의실 전용 초대장</span>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-snug">
                    {landingInviteData.room?.title}
                  </h2>
                  <p className="text-xs text-slate-500 leading-relaxed font-medium">
                    {landingInviteData.room?.description || '작성된 설명이 없습니다.'}
                  </p>
                </div>

                {/* Meta details grid */}
                <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs">
                  <div className="space-y-1">
                    <span className="text-slate-400 font-bold block">👑 방장 닉네임</span>
                    <span className="font-extrabold text-slate-900">{landingInviteData.hostNickname}</span>
                  </div>
                  <div className="space-y-1">
                    <span className="text-slate-400 font-bold block">👥 현재 참가 인원</span>
                    <span className="font-extrabold text-indigo-600">
                      {landingInviteData.participantCount} / {landingInviteData.maxParticipants}명 (최대 6명)
                    </span>
                  </div>
                </div>

                {/* Nickname Input for joining */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">입장 시 사용할 닉네임 설정 <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    maxLength={6}
                    value={landingNicknameInput}
                    onChange={e => setLandingNicknameInput(e.target.value.slice(0, 6))}
                    placeholder={nickname || '닉네임 입력 (최대 6자)'}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-900"
                  />
                </div>

                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    onClick={() => handleJoinRoomViaInvite(landingInviteToken)}
                    disabled={joiningInvite || inviteSecondsLeft <= 0 || (landingInviteData.participantCount || 0) >= (landingInviteData.maxParticipants || 6)}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl text-xs font-black transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {joiningInvite ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>회의실에 참가하는 중...</span>
                      </>
                    ) : inviteSecondsLeft <= 0 ? (
                      <span>⚠️ 생성 후 3분이 지나 만료되었습니다</span>
                    ) : (landingInviteData.participantCount || 0) >= (landingInviteData.maxParticipants || 6) ? (
                      <span>⚠️ 정원이 가득 찬 회의실입니다</span>
                    ) : (
                      <>
                        <Users className="w-4 h-4" />
                        <span>회의실 참가하기</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setLandingInviteToken(null);
                      setLandingInviteData(null);
                      window.history.replaceState({}, '', '/');
                    }}
                    className="w-full py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 transition text-center"
                  >
                    취소하고 메인 로비로 이동
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : !isLoggedIn ? (
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
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-indigo-200 whitespace-nowrap">
                    객관적인 데이터로 결론을 내립니다.
                  </span>
                </h1>

                <p className="text-slate-300 text-sm md:text-base leading-relaxed">
                  어색하거나 눈치가 보여 망설이는 팀원들을 위해, <br />
                  각자 평가 기준을 제시하고 익명 피드백으로 근거 있는 최적의 아이디어를 찾아드립니다.
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
            {/* Personal Dashboard Header (내 회의실) */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-extrabold mb-2 shadow-2xs">
                  <Lock className="w-3.5 h-3.5 text-indigo-600" />
                  <span>팀 보안 대시보드 - 허가된 멤버 전용 비공개 공간</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
                  내 회의실
                </h1>
                <p className="text-slate-500 text-xs md:text-sm mt-1">
                  내가 개설했거나 초대 코드로 참여 중인 팀 전용 회의실 대시보드입니다. (외부 타인에게 방 목록이 노출되지 않습니다)
                </p>
              </div>

              <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
                <button
                  onClick={() => setIsJoinCodeModalOpen(true)}
                  className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 px-4 py-2.5 rounded-xl font-bold text-xs shadow-xs transition cursor-pointer"
                >
                  <Share2 className="w-4 h-4 text-indigo-600" />
                  <span>초대 코드로 참여하기</span>
                </button>

                <button
                  onClick={() => setIsCreatingRoom(true)}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-indigo-700 shadow-md transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>새 회의실 만들기</span>
                </button>
              </div>
            </div>

            {/* Join Code Modal */}
            <AnimatePresence>
              {isJoinCodeModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="bg-white p-6 md:p-8 rounded-3xl max-w-sm w-full shadow-2xl space-y-5 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                        <Share2 className="w-5 h-5" />
                      </div>
                      <button
                        onClick={() => setIsJoinCodeModalOpen(false)}
                        className="text-slate-400 hover:text-slate-600 transition"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-slate-900">초대 코드로 회의실 참여</h3>
                      <p className="text-xs text-slate-500 mt-1">
                        방장이나 팀 동료가 전달해 준 회의실 코드(예: room-xxxxxx)를 입력해 주세요.
                      </p>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!inputJoinCode.trim()) {
                          triggerToast('초대 코드를 입력해 주세요.', 'error');
                          return;
                        }
                        const targetId = inputJoinCode.trim().replace('http://', '').replace('https://', '').split('/').pop() || inputJoinCode.trim();
                        handleSelectRoom(targetId);
                        setIsJoinCodeModalOpen(false);
                        setInputJoinCode('');
                      }}
                      className="space-y-4"
                    >
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">초대 코드 / 링크 <span className="text-rose-500">*</span></label>
                        <input
                          type="text"
                          required
                          value={inputJoinCode}
                          onChange={e => setInputJoinCode(e.target.value)}
                          placeholder="room-xxxxxx 또는 초대 링크"
                          className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setIsJoinCodeModalOpen(false)}
                          className="w-1/2 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 rounded-xl transition"
                        >
                          취소
                        </button>
                        <button
                          type="submit"
                          disabled={!inputJoinCode.trim()}
                          className="w-1/2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition shadow-md cursor-pointer"
                        >
                          입장하기
                        </button>
                      </div>
                    </form>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

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

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700">의사결정 방식</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setNewRoomDecisionMode('STRUCTURED')}
                          className={`p-3 rounded-xl border text-left transition ${newRoomDecisionMode === 'STRUCTURED'
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-950'
                            : 'border-slate-200 bg-white text-slate-600'
                            }`}
                        >
                          <span className="block text-xs font-extrabold">근거 기반 결정</span>
                          <span className="block text-[10px] mt-1">기준 합의와 4단계 평가를 거쳐 결정합니다.</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewRoomDecisionMode('QUICK')}
                          className={`p-3 rounded-xl border text-left transition ${newRoomDecisionMode === 'QUICK'
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-950'
                            : 'border-slate-200 bg-white text-slate-600'
                            }`}
                        >
                          <span className="block text-xs font-extrabold">빠른 결정</span>
                          <span className="block text-[10px] mt-1">선택지 작성 후 서로의 선택을 보지 않고 투표합니다.</span>
                        </button>
                      </div>
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
                        <label className="text-xs font-bold text-slate-700">참석자 수 (2~6명)</label>
                        <input
                          type="number"
                          min={2}
                          max={6}
                          value={newRoomMaxParticipants}
                          onChange={e => setNewRoomMaxParticipants(Math.min(Math.max(Number(e.target.value), 2), 6))}
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
                        <div className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 bg-slate-50">
                          비공개 팀 공간
                        </div>
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

            {/* Dashboard Rooms Grid & Filter Tabs */}
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                {/* Ownership Filter Tabs: 전체 | 내가 만든 방 | 초대받은 방 | 🙈 숨긴 회의실 */}
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold self-start">
                  <button
                    onClick={() => { setRoomOwnershipFilter('ALL'); setShowHiddenRooms(false); }}
                    className={`px-3 py-1.5 rounded-lg transition ${roomOwnershipFilter === 'ALL' && !showHiddenRooms ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    전체
                  </button>
                  <button
                    onClick={() => { setRoomOwnershipFilter('CREATED_BY_ME'); setShowHiddenRooms(false); }}
                    className={`px-3 py-1.5 rounded-lg transition ${roomOwnershipFilter === 'CREATED_BY_ME' && !showHiddenRooms ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    👑 내가 만든 방
                  </button>
                  <button
                    onClick={() => { setRoomOwnershipFilter('JOINED_BY_ME'); setShowHiddenRooms(false); }}
                    className={`px-3 py-1.5 rounded-lg transition ${roomOwnershipFilter === 'JOINED_BY_ME' && !showHiddenRooms ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    🙋 초대받은 방
                  </button>
                  <button
                    onClick={() => setShowHiddenRooms(prev => !prev)}
                    className={`px-3 py-1.5 rounded-lg transition ${showHiddenRooms ? 'bg-amber-500 text-slate-950 font-extrabold shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    🗑️ 삭제/숨긴 회의실
                  </button>
                </div>

                {/* Status Filter buttons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold text-slate-500 mr-1">진행 상태:</span>
                  <button
                    onClick={() => setRoomFilterStatus('ALL')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${roomFilterStatus === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                  >
                    전체
                  </button>
                  <button
                    onClick={() => setRoomFilterStatus('IDEA_SUBMISSION')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${roomFilterStatus === 'IDEA_SUBMISSION' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                  >
                    아이디어 모집
                  </button>
                  <button
                    onClick={() => setRoomFilterStatus('EVALUATION')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${roomFilterStatus === 'EVALUATION' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                  >
                    평가 중
                  </button>
                  <button
                    onClick={() => setRoomFilterStatus('CLOSED')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${roomFilterStatus === 'CLOSED' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                  >
                    최종 선정
                  </button>
                </div>
              </div>

              {/* Dashboard Content: Loading / Error / Empty / Grid */}
              {isFetchRoomsLoading ? (
                /* Loading State UI */
                <div className="text-center py-16 bg-white rounded-3xl border border-slate-200 space-y-4 max-w-lg mx-auto shadow-sm my-6">
                  <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-900">내 회의실 목록을 불러오는 중입니다...</h3>
                    <p className="text-xs text-slate-400">Supabase 데이터베이스에서 최신 상태를 동기화하고 있습니다.</p>
                  </div>
                </div>
              ) : fetchRoomsError ? (
                /* Error State UI */
                <div className="text-center py-16 bg-white rounded-3xl border border-rose-200 space-y-4 max-w-lg mx-auto shadow-sm my-6">
                  <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto border border-rose-200">
                    <AlertCircle className="w-6 h-6 text-rose-600" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-900">회의실 목록을 불러오지 못했습니다. 다시 시도해 주세요.</h3>
                    <p className="text-xs text-slate-500 leading-relaxed px-4">네트워크 연결 또는 데이터베이스 조회를 다시 확인해 주세요.</p>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={() => fetchRooms()}
                      className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition shadow-md inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>다시 시도</span>
                    </button>
                  </div>
                </div>
              ) : roomsList.length === 0 ? (
                /* Empty State UI */
                <div className="text-center py-16 bg-white rounded-3xl border border-slate-200 space-y-4 max-w-lg mx-auto shadow-sm my-6">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto border border-indigo-100">
                    <Lock className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-900">아직 생성하거나 참여한 회의실이 없습니다.</h3>
                    <p className="text-xs text-slate-500 leading-relaxed px-6">
                      새로운 회의실을 만들거나 초대 코드로 참여해 보세요.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      onClick={() => setIsJoinCodeModalOpen(true)}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Share2 className="w-4 h-4 text-indigo-600" />
                      <span>초대 코드로 참여하기</span>
                    </button>

                    <button
                      onClick={() => setIsCreatingRoom(true)}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition shadow-md flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>새 회의실 만들기</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Room Cards Grid */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {roomsList
                    .filter(room => {
                      // Hide filter: If showHiddenRooms is false, exclude hidden rooms. If true, show only hidden rooms.
                      if (!showHiddenRooms && room.isHidden) return false;
                      if (showHiddenRooms && !room.isHidden) return false;

                      // Ownership Filter
                      const curUserId = userId;
                      if (roomOwnershipFilter === 'CREATED_BY_ME') {
                        if (room.hostId !== curUserId && !room.isHost) return false;
                      } else if (roomOwnershipFilter === 'JOINED_BY_ME') {
                        if (room.hostId === curUserId || room.isHost) return false;
                      }

                      // Status Filter
                      if (roomFilterStatus === 'IDEA_SUBMISSION') return room.status === 'IDEA_SUBMISSION' || room.status === 'SETUP';
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
                          ⚙️ 설정 중
                        </span>
                      );
                      if (room.status === 'IDEA_SUBMISSION') {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200/50">💡 아이디어 모집</span>;
                      } else if (room.status === 'CLOSED') {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-900 text-white border border-slate-900">🎉 최종 선정</span>;
                      } else {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200/50">🔒 평가 중</span>;
                      }

                      const myRoleBadge = (room.isHost || room.hostId === userId)
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">👑 방장</span>
                        : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">👤 참여자</span>;

                      const formattedDate = new Date(room.updatedAt || room.createdAt).toLocaleDateString('ko-KR', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      });

                      return (
                        <motion.div
                          key={room.id}
                          whileHover={{ y: -2 }}
                          onClick={() => handleSelectRoom(room.id)}
                          className={`p-5 rounded-2xl border transition flex flex-col justify-between cursor-pointer group relative ${room.isPinned
                            ? 'bg-amber-50/40 border-amber-300/80 shadow-md ring-1 ring-amber-200/60'
                            : 'bg-white border-slate-200 hover:border-indigo-300 shadow-sm'
                            }`}
                        >
                          <div className="space-y-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {myRoleBadge}
                                {statusBadge}
                              </div>

                              <div className="flex items-center gap-1">
                                {/* Hide / Restore icon button */}
                                {room.isHidden ? (
                                  <button
                                    onClick={(e) => handleRestoreRoom(e, room.id)}
                                    title="로비 목록으로 복원하기"
                                    className="p-1.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 transition flex items-center text-[10px] font-bold border border-amber-300 gap-0.5 px-2"
                                  >
                                    <span>👁️ 복원</span>
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (window.confirm('이 회의실을 내 목록에서 삭제하시겠습니까?\n(다른 참여자의 회의 내용 및 데이터는 보호됩니다)')) {
                                        handleHideRoom(e, room.id);
                                      }
                                    }}
                                    title="내 목록에서 삭제 (참여자 회의 내용 보존)"
                                    className="p-1.5 rounded-full bg-slate-50 text-slate-400 border border-slate-200 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-rose-500 hover:text-rose-700" />
                                  </button>
                                )}

                                {/* Star Pin icon button */}
                                <button
                                  onClick={(e) => handleTogglePin(e, room.id)}
                                  title={room.isPinned ? '상단 고정 해제' : '상단 고정'}
                                  className={`p-1.5 rounded-full transition flex items-center gap-1 text-xs font-bold border ${room.isPinned
                                    ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200 shadow-xs'
                                    : 'bg-slate-50 text-slate-400 border-slate-200 hover:text-amber-500 hover:bg-amber-50'
                                    }`}
                                >
                                  <Star
                                    className={`w-3.5 h-3.5 ${room.isPinned
                                      ? 'fill-amber-400 text-amber-500'
                                      : 'text-slate-400 fill-slate-200'
                                      }`}
                                  />
                                </button>
                              </div>
                            </div>

                            <h3 className="text-base font-bold text-slate-900 group-hover:text-indigo-600 transition pt-1 leading-snug">
                              {room.title}
                            </h3>
                            <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                              {room.description || '작성된 설명이 없습니다.'}
                            </p>
                          </div>

                          <div className="border-t border-slate-100 mt-4 pt-3 space-y-3">
                            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                              <span className="font-bold text-slate-700">👥 {room.evaluatorsCount || 1}명 참여 중</span>
                              <span className="text-[11px] text-slate-400">{formattedDate}</span>
                            </div>

                            <button
                              onClick={() => handleSelectRoom(room.id)}
                              className={`w-full py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${room.status === 'CLOSED'
                                ? 'bg-slate-900 hover:bg-slate-800 text-white shadow-xs'
                                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/60'
                                }`}
                            >
                              <span>{room.status === 'CLOSED' ? '결과 보기' : '계속하기'}</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
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

            {/* Error Fallback Box when fetch fails */}
            {!loading && !roomDetails && fetchRoomError && (
              <div className="bg-white p-8 rounded-3xl border border-rose-200 shadow-md max-w-md mx-auto text-center space-y-4 my-12">
                <div className="w-12 h-12 bg-rose-50 border border-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-extrabold text-slate-900">회의 정보를 불러오지 못했습니다.</h3>
                  <p className="text-xs text-slate-500">기존 데이터는 유지되어 있습니다. 다시 시도해 주세요.</p>
                </div>
                <button
                  type="button"
                  onClick={() => activeRoomId && fetchRoomDetails(activeRoomId)}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>다시 시도</span>
                </button>
              </div>
            )}

            {roomDetails && roomDetails.room && (
              <div className="flex flex-col lg:flex-row gap-8 items-start">

                {/* 1. SIDEBAR (SLEEK THEME DESIGN) */}
                <aside className="w-full lg:w-64 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col gap-6 shrink-0 shadow-sm lg:sticky lg:top-20">
                  {/* Section: Process Stages */}
                  <section className="space-y-4">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      프로세스 단계
                    </h3>
                    <div className="space-y-4">
                      {(roomDetails.room.decisionMode === 'QUICK'
                        ? [
                            { key: 'IDEA_SUBMISSION', label: '1단계 : 선택지 작성' },
                            { key: 'ELIMINATION', label: '2단계 : 익명 투표' },
                            { key: 'CLOSED', label: '3단계 : 결과와 근거' }
                          ]
                        : [
                            { key: 'IDEA_SUBMISSION', label: '1단계 : 아이디어' },
                            { key: 'CRITERIA_PROPOSAL', label: '2단계 : 평가 기준 설정' },
                            { key: 'EVALUATION', label: '3단계 : 1차 투표 및 익명 평가' },
                            { key: 'ELIMINATION', label: '4단계 : 2차 투표' },
                            { key: 'CLOSED', label: '5단계 : 최종 결과' }
                          ]
                      ).map((step, idx) => {
                        const statusesOrder: RoomStatus[] = roomDetails.room.decisionMode === 'QUICK'
                          ? ['IDEA_SUBMISSION', 'ELIMINATION', 'CLOSED']
                          : ['IDEA_SUBMISSION', 'CRITERIA_PROPOSAL', 'EVALUATION', 'ELIMINATION', 'CLOSED'];
                        const roomSt = roomDetails.room?.status || 'IDEA_SUBMISSION';
                        const currentIdx = statusesOrder.indexOf(roomSt === 'CRITERIA_REVIEW' ? 'CRITERIA_PROPOSAL' : roomSt);
                        const stepIdx = statusesOrder.indexOf(step.key as RoomStatus);
                        const isCompleted = stepIdx < currentIdx;
                        const isActive = stepIdx === currentIdx;

                        return (
                          <div key={step.key} className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs shrink-0 transition ${isCompleted
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : isActive
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-600 font-bold'
                                : 'border-slate-100 text-slate-300 bg-slate-50'
                              }`}>
                              {isCompleted ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                            </div>
                            <span className={`text-sm font-medium transition ${isActive ? 'text-indigo-600 font-bold' : isCompleted ? 'text-slate-700' : 'text-slate-400'
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
                        {(roomDetails.criteria || []).map((crit) => (
                          <div key={crit.id} className="p-3 bg-indigo-50/60 rounded-lg border border-indigo-100">
                            <div className="text-xs font-bold text-indigo-950">{crit.name}</div>
                            <p className="text-[10px] text-indigo-700 leading-relaxed mt-0.5">{crit.description}</p>
                          </div>
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
                            {roomDetails.room.decisionMode === 'QUICK' ? (
                              <>
                                {roomDetails.room?.status === 'IDEA_SUBMISSION' && '1단계 : 선택지 작성'}
                                {roomDetails.room?.status === 'ELIMINATION' && '2단계 : 익명 투표'}
                                {roomDetails.room?.status === 'CLOSED' && '3단계 : 결과와 근거'}
                              </>
                            ) : (
                              <>
                                {roomDetails.room?.status === 'IDEA_SUBMISSION' && '1단계 : 아이디어'}
                                {(roomDetails.room?.status === 'CRITERIA_PROPOSAL' || roomDetails.room?.status === 'CRITERIA_REVIEW') && '2단계 : 평가 기준 설정'}
                                {roomDetails.room?.status === 'EVALUATION' && '3단계 : 1차 투표 및 익명 평가'}
                                {roomDetails.room?.status === 'ELIMINATION' && '4단계 : 2차 투표'}
                                {roomDetails.room?.status === 'CLOSED' && '5단계 : 최종 결과'}
                              </>
                            )}
                          </span>
                          {roomDetails.room?.hostId === userId && (
                            <>
                              <span className="text-xs font-semibold text-white bg-slate-900 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                <Settings className="w-3 h-3" />
                                방장
                              </span>
                              <button
                                type="button"
                                onClick={openRoomSettingsModal}
                                className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 px-3 py-1 rounded-full transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                                title="방 정보 및 설정 수정"
                              >
                                <Settings className="w-3 h-3 text-slate-600" />
                                ⚙️ 방 설정 수정
                              </button>
                            </>
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
                          {roomDetails.room?.title}
                        </h1>
                        <p className="text-slate-500 text-xs md:text-sm max-w-4xl">
                          {roomDetails.room?.description || '이 방에 대한 추가 설명이 작성되지 않았습니다.'}
                        </p>
                      </div>

                      {/* Refresh / Stats */}
                      <div className="flex sm:flex-col items-end gap-2 justify-between">
                        {/* Live progress indicator ("N/M명 아이디어 제출 완료") */}
                        <div className="text-xs font-bold text-slate-700 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-full shrink-0 flex items-center gap-1.5">
                          <span>📊 등록 완료 현황판:</span>
                          <span className="text-indigo-600 font-extrabold">
                            {roomDetails.completedParticipantsCount !== undefined
                              ? roomDetails.completedParticipantsCount
                              : new Set((roomDetails.ideas || []).map(i => i.submitterId).filter(Boolean)).size} / {roomDetails.room?.maxParticipants || 6}명 완료
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
                  {roomDetails.room?.status === 'IDEA_SUBMISSION' && (
                    (showIdeaSubmissionGate || Boolean(activeRoomId && localStorage.getItem(`why_not_idea_step_gate_${activeRoomId}`) === 'true')) ? (
                      /* ANONYMITY QUORUM GATE VIEW MATCHING IMAGES 2 & 3 */
                      <div className="space-y-6">

                        {/* 2. Images 2 & 3 Equivalent: Anonymity Quorum Gate Waiting & Completion Card */}
                        {(() => {
                          const ideaCompletedCount = roomDetails.completedParticipantsCount !== undefined
                            ? roomDetails.completedParticipantsCount
                            : (showIdeaSubmissionGate ? 1 : 0);

                          const targetMinThreshold = Math.min(
                            roomDetails.room.minResponseThreshold || 3,
                            roomDetails.room.maxParticipants || 6
                          );

                          const targetTotalCount = Math.max(
                            roomDetails.room.maxParticipants || 2,
                            targetMinThreshold,
                            ideaCompletedCount,
                            (roomDetails.participants || []).length || 1
                          );

                          const isIdeaGateMinMet = (roomDetails.ideas || []).length >= 2 && ideaCompletedCount >= Math.min(targetMinThreshold, (roomDetails.participants || []).length || 1);

                          return (
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center space-y-6 max-w-2xl mx-auto py-8">
                              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto border border-indigo-100">
                                {isIdeaGateMinMet ? (
                                  <Unlock className="w-5 h-5 text-indigo-600" />
                                ) : (
                                  <Lock className="w-5 h-5 text-indigo-600" />
                                )}
                              </div>

                              <div className="space-y-2">
                                <h3 className="text-lg font-bold text-slate-900">
                                  {isIdeaGateMinMet
                                    ? '팀 내 최소 응답 수 충족 완료!'
                                    : '다른 구성원들의 참가를 기다리는 중'}
                                </h3>
                                <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
                                  {isIdeaGateMinMet
                                    ? roomDetails.room.decisionMode === 'QUICK'
                                      ? '선택지가 모두 모였습니다. 다른 사람의 선택을 보지 않는 익명 투표를 시작할 수 있습니다.'
                                      : '최소 응답 정족수가 달성되어, 안전하게 2단계 평가 기준 설정 단계로 진입할 준비가 완료되었습니다.'
                                    : '와이낫 서비스는 소수 인원 응답 시 필체나 의견 유추로 익명이 훼손되는 것을 원천 차단하기 위해, 설정된 정족수(최소 ' + targetMinThreshold + '명)가 찬 이후에만 다음 단계로 진행할 수 있습니다.'}
                                </p>
                              </div>

                              {/* Gate details */}
                              <div className="flex items-center justify-center gap-1.5 text-xs font-bold">
                                <span className="text-slate-500">현재 수집 상태 :</span>
                                <span className={isIdeaGateMinMet ? 'text-emerald-600 font-extrabold' : 'text-amber-600 font-extrabold'}>
                                  {ideaCompletedCount} / {targetTotalCount} 명 완료
                                </span>
                              </div>

                              {/* Action Controls matching Images 1, 2, 3 */}
                              <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-100">
                                <button
                                  type="button"
                                  onClick={handleExitIdeaGate}
                                  className="px-4.5 py-2.5 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-2xl text-xs font-bold transition cursor-pointer shadow-xs"
                                >
                                  이전 단계(아이디어 등록)로 되돌아가기
                                </button>

                                {isIdeaGateMinMet && roomDetails.room.hostId === userId && (
                                  <button
                                    type="button"
                                    onClick={handleConfirmIdeaGateToStage2}
                                    className="px-5 py-2.5 bg-amber-400 text-slate-950 hover:bg-amber-300 rounded-2xl text-xs font-black transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <Sparkles className="w-4 h-4 text-slate-950" />
                                    <span>
                                      {roomDetails.room.decisionMode === 'QUICK'
                                        ? '2단계: 익명 투표 시작하기'
                                        : '2단계: 평가 기준 설정하러 가기'}
                                    </span>
                                    <ArrowRight className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                      {/* Left: Ideas List (Anonymous Labels) */}
                      <div className="lg:col-span-7 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                            제출된 아이디어 목록 ({(roomDetails.ideas || []).length}개)
                          </h2>
                          <span className="text-xs text-indigo-600 font-bold bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
                            🔒 100% 익명 보장
                          </span>
                        </div>

                        {/* Empty State Prompt */}
                        {(roomDetails.ideas || []).length === 0 ? (
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
                            {roomDetails.ideas.map((idea, idx) => {
                              const isMyIdea = Boolean(idea.submitterId && userId && idea.submitterId === userId);
                              const isEditingThis = editingIdeaId === idea.id;

                              if (isEditingThis) {
                                return (
                                  <motion.div
                                    key={idea.id}
                                    className="bg-white p-5 rounded-xl border border-indigo-200 shadow-md space-y-4"
                                  >
                                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                      <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-1.5">
                                        <Edit className="w-4 h-4 text-indigo-600" />
                                        아이디어 수정하기
                                      </h3>
                                      <button
                                        type="button"
                                        onClick={() => setEditingIdeaId(null)}
                                        className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                                      >
                                        취소
                                      </button>
                                    </div>

                                    <div className="space-y-3">
                                      <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-700">아이디어 제목 <span className="text-rose-500">*</span></label>
                                        <input
                                          type="text"
                                          value={editIdeaTitle}
                                          onChange={e => setEditIdeaTitle(e.target.value)}
                                          className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                                        />
                                      </div>

                                      <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-700">아이디어 상세 설명 <span className="text-rose-500">*</span></label>
                                        <textarea
                                          value={editIdeaDesc}
                                          onChange={e => setEditIdeaDesc(e.target.value)}
                                          rows={4}
                                          className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                                        />
                                      </div>

                                      <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-700">참고 링크 (선택)</label>
                                        <input
                                          type="url"
                                          value={editIdeaLink}
                                          onChange={e => setEditIdeaLink(e.target.value)}
                                          className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                                        />
                                      </div>

                                      <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-700">참고 파일 (PDF / PNG 첨부)</label>
                                        <input
                                          type="file"
                                          accept=".pdf,.png"
                                          onChange={e => {
                                            const file = e.target.files?.[0];
                                            if (file) setEditIdeaPdfName(file.name);
                                          }}
                                          className="w-full text-xs text-slate-500 file:mr-3 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                        />
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                                      <button
                                        type="button"
                                        onClick={() => setEditingIdeaId(null)}
                                        className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-200 transition"
                                      >
                                        취소
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateIdea(idea.id)}
                                        className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition shadow-sm"
                                      >
                                        저장
                                      </button>
                                    </div>
                                  </motion.div>
                                );
                              }

                              return (
                                <motion.div
                                  key={idea.id}
                                  className={`bg-white p-5 rounded-xl border transition shadow-sm space-y-3 ${isMyIdea ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200'
                                    }`}
                                >
                                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                                      <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${isMyIdea
                                        ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                        : 'bg-slate-100 text-slate-700 border border-slate-200'
                                        }`}>
                                        <User className="w-3 h-3 text-indigo-400" />
                                        {isMyIdea ? '내 아이디어' : `아이디어 ${String.fromCharCode(65 + (idx % 26))}`}
                                      </span>
                                      <h3 className="text-sm font-bold text-slate-900 truncate">{idea.title}</h3>
                                    </div>

                                    {isMyIdea && (
                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingIdeaId(idea.id);
                                            setEditIdeaTitle(idea.title || '');
                                            setEditIdeaDesc(idea.description || '');
                                            setEditIdeaLink(idea.attachmentUrl || '');
                                            setEditIdeaPdfName(idea.pdfAttachmentUrl || '');
                                          }}
                                          className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 rounded-lg border border-slate-200 flex items-center gap-1 transition"
                                          title="수정"
                                        >
                                          <Edit2 className="w-3 h-3" />
                                          수정
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteIdea(idea.id)}
                                          className="px-2 py-1 text-xs font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-100 flex items-center gap-1 transition"
                                          title="삭제"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                          삭제
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {/* Idea description accordion toggle for stage 1 */}
                                  {(() => {
                                    const isDescExpanded = !!expandedIdeaIds[`stage1_${idea.id}`];
                                    return (
                                      <div className="pt-0.5">
                                        {isDescExpanded ? (
                                          <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-1">
                                            {idea.description}
                                          </p>
                                        ) : (
                                          <p className="text-xs text-slate-500 line-clamp-1">
                                            {idea.description}
                                          </p>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => toggleIdeaExpanded(`stage1_${idea.id}`)}
                                          className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5 mt-1 transition"
                                        >
                                          <span>{isDescExpanded ? '설명 접기' : '상세 설명 더보기'}</span>
                                          {isDescExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                        </button>
                                      </div>
                                    );
                                  })()}

                                  {(idea.attachmentUrl || idea.pdfAttachmentUrl) && (
                                    <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500 pt-1 border-t border-slate-100">
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
                                  )}
                                </motion.div>
                              );
                            })}
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
                              (내 제출: {(roomDetails.ideas || []).filter(i => i.submitterId === userId).length}/5개)
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
                                  onClick={handleDevelopIdea}
                                  disabled={isDevelopingIdea}
                                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-full flex items-center gap-1 transition"
                                >
                                  <Sparkles className={`w-3 h-3 text-indigo-500 ${isDevelopingIdea ? 'animate-spin' : ''}`} />
                                  {isDevelopingIdea ? 'AI 정리 중' : 'AI 표현 보완'}
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
                              {ideaAiSuggestion && (
                                <div className="mt-3 p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-3">
                                  <div>
                                    <p className="text-xs font-extrabold text-slate-900">원문과 AI 표현 보완안 비교</p>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                      AI는 판단하지 않고 표현만 정리합니다. 아래 보완안은 승인하기 전까지 원문에 반영되지 않습니다.
                                    </p>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div className="bg-white p-3 rounded-lg border border-slate-200">
                                      <span className="text-[10px] font-black text-slate-500">내 원문</span>
                                      <p className="text-xs text-slate-700 whitespace-pre-line mt-1">{ideaAiSuggestion.originalDescription}</p>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-indigo-200">
                                      <span className="text-[10px] font-black text-indigo-600">AI 표현 보완안</span>
                                      <p className="text-xs text-slate-700 whitespace-pre-line mt-1">{ideaAiSuggestion.revisedDescription}</p>
                                    </div>
                                  </div>
                                  {ideaAiSuggestion.reviewQuestions.length > 0 && (
                                    <div className="bg-white p-3 rounded-lg border border-amber-200">
                                      <p className="text-[10px] font-black text-amber-700">주장을 보완하기 위한 검토 질문</p>
                                      <ul className="mt-1 space-y-1">
                                        {ideaAiSuggestion.reviewQuestions.map((question, index) => (
                                          <li key={`${question}-${index}`} className="text-xs text-slate-700">
                                            {index + 1}. {question}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setIdeaAiSuggestion(null)}
                                      className="px-3 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg"
                                    >
                                      원문 유지
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIdeaDesc(ideaAiSuggestion.revisedDescription);
                                        setIdeaAiSuggestion(null);
                                        triggerToast('작성자가 승인한 AI 보완안을 적용했습니다.');
                                      }}
                                      className="px-3 py-2 text-xs font-bold text-white bg-indigo-600 rounded-lg"
                                    >
                                      승인하고 적용
                                    </button>
                                  </div>
                                </div>
                              )}
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

                            {(roomDetails.ideas || []).length >= 1 && (
                              <div className="pt-2 border-t border-slate-100 mt-2">
                                <button
                                  type="button"
                                  onClick={handleEnterIdeaGate}
                                  className="w-full py-2.5 bg-amber-400 text-slate-950 hover:bg-amber-300 rounded-xl text-xs font-black transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Sparkles className="w-4 h-4 text-slate-950" />
                                  <span>아이디어 등록 완료 & 제출 목록/게이트 보기</span>
                                  <ArrowRight className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </form>
                        </div>
                      </div>

                    </div>
                  )
                )}

                  {/* -----------------------------------------------------------
                    VIEW 2: CRITERIA_PROPOSAL
                    ----------------------------------------------------------- */}
                  {roomDetails.room?.status === 'CRITERIA_PROPOSAL' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                      {/* Left: Input Proposal Form & AI Suggested Criteria */}
                      <div className="lg:col-span-7 space-y-6">

                        {/* AI Criteria Generator Card (Potens AI) */}
                        <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-900 text-white p-5 md:p-6 rounded-2xl shadow-md space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold flex items-center gap-2 text-amber-400">
                              <Sparkles className="w-4 h-4 text-amber-400" />
                              AI 기반 평가 기준 3가지 제안
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
                            등록된 아이디어들의 특성을 분석하여 적합한 평가 기준 3가지를 AI가 추천합니다. 마음에 드는 기준을 선택하여 제안 목록에 추가할 수 있습니다.
                          </p>

                          {aiSuggestedCriteria.length > 0 && (
                            <div className="space-y-2 pt-1">
                              {aiSuggestedCriteria.map((item, idx) => {
                                if (!item || !item.name) return null;
                                const itemName = item.name || '';
                                const itemDesc = item.description || '';
                                const text = `${itemName}${itemDesc ? `: ${itemDesc}` : ''}`;
                                const existingProposals = roomDetails?.proposals || [];
                                const isAlreadyAdded = existingProposals.some(p => p?.rawText && (p.rawText.trim() === text.trim() || p.rawText.trim() === itemName.trim()));
                                const isAiMaxLimitReached = myAiProposalsCount >= 3 || myProposalsCount >= 6 || totalProposalsCount >= 21;

                                return (
                                  <div
                                    key={idx}
                                    className="p-3 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl transition text-left flex items-center justify-between gap-3"
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
                                      disabled={isAlreadyAdded || isAiMaxLimitReached}
                                      onClick={() => handleProposeCriterion(undefined, text)}
                                      className="shrink-0 px-3 py-1.5 bg-amber-400 text-slate-950 hover:bg-amber-300 disabled:opacity-40 disabled:bg-slate-700 disabled:text-slate-400 text-xs font-bold rounded-lg transition shadow-xs flex items-center gap-1"
                                    >
                                      {isAlreadyAdded ? (
                                        <>
                                          <Check className="w-3 h-3" />
                                          제안 완료
                                        </>
                                      ) : (
                                        <>
                                          <Plus className="w-3 h-3" />
                                          제안하기
                                        </>
                                      )}
                                    </button>
                                  </div>
                                );
                              })}
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
                              직접 제안 ({myDirectProposalsCount}/3개) · 회의실 전체 ({totalProposalsCount}/21개)
                            </span>
                          </div>

                          {totalProposalsCount >= 21 ? (
                            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs font-bold flex items-center gap-2">
                              <span>⚠️</span>
                              평가 기준은 최대 21개까지 등록할 수 있습니다.
                            </div>
                          ) : myDirectProposalsCount >= 3 && (
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs font-semibold flex items-center gap-2">
                              <span>⚠️</span>
                              직접 작성 제안이 최대 제한인 3개까지 제출되었습니다. (AI 추천 제안으로 등록 가능)
                            </div>
                          )}

                          <form onSubmit={handleProposeCriterion} className="space-y-4">
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-slate-700">제안할 기준 내용 <span className="text-rose-500">*</span></label>
                              <textarea
                                required={myProposalsCount === 0}
                                disabled={totalProposalsCount >= 21}
                                value={proposalText}
                                onChange={e => setProposalText(e.target.value)}
                                placeholder={
                                  totalProposalsCount >= 21
                                    ? "평가 기준은 최대 21개까지 등록할 수 있습니다."
                                    : myDirectProposalsCount >= 3
                                      ? "직접 작성 3개 제안이 작성 완료되었습니다."
                                      : "예: 예산 한계 내로 준비가 가능한지 여부 / 팀원의 기술 역량으로 1달 이내 구현이 가능한지"
                                }
                                rows={3}
                                className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400 font-medium"
                              />
                            </div>

                            <div className="bg-emerald-50 text-emerald-800 p-3.5 rounded-xl text-xs leading-relaxed border border-emerald-100">
                              🔒 **익명 보장 (식별 정보 비노출)**: 방장이나 다른 팀원을 포함해 누구도 작성자를 추적할 수 없습니다.
                            </div>

                            <button
                              type="submit"
                              disabled={totalProposalsCount >= 21}
                              className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
                            >
                              익명 기준 제안 등록하기
                            </button>
                          </form>
                        </div>
                      </div>

                      {/* Right: Progress Tracker & Submitted Proposals List */}
                      <div className="lg:col-span-5 space-y-6">
                        <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <h2 className="text-base font-bold text-slate-900">제안된 평가 기준 목록</h2>
                            <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
                              {totalProposalsCount} / 21개 제출됨
                            </span>
                          </div>

                          {/* Submitted Proposals List */}
                          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                            {(roomDetails.proposals || []).length === 0 ? (
                              <div className="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-1">
                                <p className="text-xs font-bold text-slate-600">아직 제출된 제안이 없습니다.</p>
                                <p className="text-[11px] text-slate-400">상단 'AI 기준 생성' 버튼을 누르거나 직접 입력해 주세요. (최소 1개 필수)</p>
                              </div>
                            ) : (
                              (roomDetails.proposals || []).map((p: any, idx: number) => {
                                const isHost = roomDetails.room.hostId === userId;
                                const isAi = Boolean(p.isAiSuggested || (p.id && p.id.startsWith('prop-ai-')) || p.proposerId === 'gemini-ai' || p.sourceType === 'ai');
                                const isAuthor = p.proposerId === userId && !isAi;
                                const canEditOrDelete = isAuthor;
                                const isEditing = editingProposalId === p.id;

                                return (
                                  <div key={p.id || idx} className={`p-3 rounded-xl space-y-2 text-left transition ${isAi ? 'bg-amber-50/90 border border-amber-300' : 'bg-slate-50 border border-slate-200'}`}>
                                    <div className="flex items-center justify-between">
                                      <span className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-md font-mono ${isAi ? 'text-amber-900 bg-amber-100/90 border border-amber-300/80' : 'text-indigo-600 bg-indigo-50 border border-indigo-100'}`}>
                                        기준 #{idx + 1}
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <span className={`text-[10px] ${isAi ? 'text-amber-800/80 font-bold' : 'text-slate-400'}`}>
                                          {isAi ? '✨ AI 추천' : '🔒 작성자 익명 보장'}
                                        </span>

                                        {/* Edit / Delete Buttons (Host or Author only) */}
                                        {canEditOrDelete && !isEditing && (
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setEditingProposalId(p.id);
                                                setEditingProposalText(p.rawText);
                                              }}
                                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition cursor-pointer"
                                              title="수정"
                                            >
                                              <Edit2 className="w-3 h-3" />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setDeletingProposalId(p.id)}
                                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition cursor-pointer"
                                              title="삭제"
                                            >
                                              <Trash2 className="w-3 h-3" />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {isEditing ? (
                                      <div className="space-y-2 pt-1">
                                        <textarea
                                          value={editingProposalText}
                                          onChange={(e) => setEditingProposalText(e.target.value)}
                                          className="w-full text-xs p-2.5 bg-white border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800"
                                          rows={2}
                                        />
                                        <div className="flex items-center justify-end gap-1.5">
                                          <button
                                            onClick={() => {
                                              setEditingProposalId(null);
                                              setEditingProposalText('');
                                            }}
                                            className="px-2.5 py-1 text-[11px] font-bold text-slate-600 bg-slate-200 hover:bg-slate-300 rounded-md transition"
                                          >
                                            취소
                                          </button>
                                          <button
                                            onClick={() => handleSaveProposal(p.id)}
                                            className="px-2.5 py-1 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition"
                                          >
                                            저장
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-xs text-slate-800 font-medium leading-relaxed">
                                        {p.rawText}
                                      </p>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>

                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-extrabold text-slate-900">내 기준 제안 완료</p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                다른 사람의 제안은 전원이 완료할 때까지 보이지 않습니다.
                              </p>
                            </div>
                            <span className="text-xs font-bold text-indigo-600">
                              {roomDetails.criteriaCompletedParticipantsCount || 0}명 완료
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleCompleteCriteriaProposal}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold transition"
                          >
                            기준 제안 완료하기
                          </button>
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
                              disabled={!roomDetails.criteriaProposalsRevealed || roomDetails.proposalsCount === 0 || isClusteringLoading}
                              className="w-full py-2.5 bg-amber-400 text-slate-950 hover:bg-amber-300 disabled:opacity-40 transition rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:cursor-not-allowed"
                            >
                              {isClusteringLoading ? (
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
                            {!roomDetails.criteriaProposalsRevealed && (
                              <p className="text-[11px] text-amber-300">
                                모든 참여자가 제안을 완료하면 익명 제안이 동시에 공개되고 AI 정리를 시작할 수 있습니다.
                              </p>
                            )}
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
                            총 취합된 핵심 평가 기준 목록 확인
                          </h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            참여진들이 제안한 의견들을 바탕으로 AI가 정리한 최종 핵심 평가 기준 리스트입니다. 내용을 확인하신 후 익명 평가를 진행해 주세요.
                          </p>
                        </div>

                        <div className="space-y-4">
                          {editableCriteria.map((crit, idx) => (
                            <div key={crit.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                              <div className="flex items-center justify-between gap-4">
                                <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 uppercase tracking-wider">
                                  기준 #{idx + 1}
                                </span>
                              </div>

                              <div>
                                <h4 className="text-sm font-bold text-slate-900">{crit.name}</h4>
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{crit.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="pt-4 border-t border-slate-100 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-bold text-slate-700">
                              팀 동의 현황: {roomDetails.criteriaApproval?.approveCount || 0}
                              /{roomDetails.criteriaApproval?.requiredApproveCount || 1}명 동의 필요
                            </p>
                            {roomDetails.criteriaApproval?.myVote && (
                              <span className="text-[11px] font-bold text-indigo-600">
                                내 선택: {roomDetails.criteriaApproval.myVote === 'APPROVE' ? '이 기준으로 진행' : '보완 필요'}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500">
                            방장도 다른 참여자와 같은 한 표만 가집니다. 참여 대상의 80%가 동의하면 자동으로 익명 평가를 시작합니다.
                          </p>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleCriteriaApproval('REVISE')}
                              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition"
                            >
                              보완 필요
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCriteriaApproval('APPROVE')}
                              className="px-5 py-2.5 bg-amber-400 text-slate-950 hover:bg-amber-300 rounded-xl text-xs font-black transition shadow-sm flex items-center gap-1.5"
                            >
                              <Check className="w-3.5 h-3.5" />
                              이 기준으로 평가 진행
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* -----------------------------------------------------------
                    VIEW 4: EVALUATION
                    ----------------------------------------------------------- */}
                  {roomDetails.room.status === 'EVALUATION' && (() => {
                    const currentEvaluatorsCount = Math.max(0, (roomDetails.evaluatorsCount || 0) - (isReEditingEvaluation ? 1 : 0));
                    const minThreshold = roomDetails.room.minResponseThreshold || 1;
                    const isMinMet = currentEvaluatorsCount >= minThreshold;

                    return (
                      <div className="space-y-6">

                        {/* Progress Indicator Card */}
                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div>
                            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                              {(roomDetails.hasEvaluated && !isReEditingEvaluation) ? (
                                <span className="text-emerald-600 flex items-center gap-1">
                                  <Check className="w-4 h-4" />
                                  내 익명 평가 완료됨
                                </span>
                              ) : (
                                <span className="text-slate-900 flex items-center gap-1">
                                  <Lock className="w-4 h-4 text-slate-400" />
                                  익명 스크리닝 평가 진행 중
                                </span>
                              )}
                            </h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                              확정된 기준들에 비추어 각 아이디어를 신중하게 심사해 주십시오.
                            </p>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-xs font-semibold text-slate-600 bg-slate-50 py-2 px-3.5 border border-slate-100 rounded-xl">
                              현재 평가인원 : {currentEvaluatorsCount}명 / 최소 {minThreshold}명
                            </div>
                          </div>
                        </div>

                        {/* Check if User already evaluated */}
                        {(roomDetails.hasEvaluated && !isReEditingEvaluation) ? (
                          /* WAITING SCREEN AND GATE SHOWCASE */
                          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center space-y-6 max-w-2xl mx-auto py-10">
                            <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto border border-indigo-100">
                              {isMinMet ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                            </div>

                            <div className="space-y-2">
                              <h3 className="text-lg font-bold text-slate-900">
                                {isMinMet
                                  ? '팀 내 최소 응답 수 충족 완료!'
                                  : '다른 구성원들의 평가를 기다리는 중'}
                              </h3>
                              <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
                                {isMinMet
                                  ? '최소 응답 정족수가 달성되어, 안전하게 익명 처리된 집계 결과가 활성화되었습니다. 방장 권한으로 소거를 시작할 수 있습니다.'
                                  : '와이낫 서비스는 소수 인원 응답 시 필체나 의견 유추로 익명이 훼손되는 것을 원천 차단하기 위해, 설정된 정족수(최소 ' + minThreshold + '명)가 찬 이후에만 집계 결과를 서버로부터 전송합니다.'}
                              </p>
                            </div>

                            {/* Gate details */}
                            <div className="flex items-center justify-center gap-1.5 text-xs font-bold">
                              <span className="text-slate-500">현재 수집 상태 :</span>
                              <span className={isMinMet ? 'text-emerald-600' : 'text-amber-600'}>
                                {currentEvaluatorsCount} / {minThreshold} 명 완료
                              </span>
                            </div>

                            {/* Controls for evaluation re-editing and host transition matching Image 1 */}
                            <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-100">
                              <button
                                type="button"
                                onClick={handleStartReEditingEvaluation}
                                className="px-4.5 py-2.5 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-2xl text-xs font-bold transition cursor-pointer shadow-xs"
                              >
                                이전 단계(익명 평가)로 되돌아가기
                              </button>

                              {roomDetails.room.hostId === userId && (
                                <button
                                  type="button"
                                  onClick={() => handleForceChangeStatus('ELIMINATION')}
                                  className="px-5 py-2.5 bg-amber-400 text-slate-950 hover:bg-amber-300 rounded-2xl text-xs font-black transition shadow-sm flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Sparkles className="w-4 h-4 text-slate-950" />
                                  <span>피드백 보러가기 & 2차 투표 하러가기</span>
                                  <ArrowRight className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* ACTIVE SCREENING VOTING CARDS */
                          <div className="space-y-6">
                            {isReEditingEvaluation && (
                              <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-center justify-between gap-3 text-left shadow-xs">
                                <div className="space-y-0.5">
                                  <span className="text-xs font-extrabold text-amber-900 flex items-center gap-1.5">
                                    <Edit2 className="w-3.5 h-3.5 text-amber-600" />
                                    이전 평가 내용 재작성 및 수정 모드
                                  </span>
                                  <p className="text-[11px] text-amber-800 font-medium">
                                    이전에 제출했던 평가 내용이 입력창에 복원되었습니다. 수정 완료 후 하단의 [4단계 2차 투표로 이동] 버튼을 클릭해 주세요.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={handleCancelReEditingEvaluation}
                                  className="px-3 py-1.5 bg-white hover:bg-amber-100 text-slate-700 rounded-xl text-xs font-bold border border-amber-200 transition shrink-0 cursor-pointer"
                                >
                                  수정 취소
                                </button>
                              </div>
                            )}

                            <div className="border-b border-slate-200 pb-2">
                              <h3 className="text-sm font-extrabold text-slate-500 uppercase tracking-wider">스크리닝 진행할 아이디어 목록</h3>
                            </div>

                            {(roomDetails.ideas || []).filter(i => i && i.status === 'ACTIVE').map((idea, ideaIdx) => {
                              const userVote = evalSubmissions[idea.id] || {
                                decision: undefined,
                                excludedCriterionIds: [],
                                criteriaEvaluations: {},
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
                                    <div className="space-y-1 flex-1 min-w-0">
                                      <span className="text-[10px] font-black text-slate-400">후보 #{ideaIdx + 1}</span>
                                      <h4 className="text-base font-bold text-slate-900">{idea.title}</h4>

                                      {/* Idea description accordion toggle for stage 3 */}
                                      {(() => {
                                        const isDescExpanded = !!expandedIdeaIds[`stage3_${idea.id}`];
                                        return (
                                          <div className="pt-0.5">
                                            {isDescExpanded ? (
                                              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-1">
                                                {idea.description}
                                              </p>
                                            ) : (
                                              <p className="text-xs text-slate-500 line-clamp-1">
                                                {idea.description}
                                              </p>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => toggleIdeaExpanded(`stage3_${idea.id}`)}
                                              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5 mt-1 transition"
                                            >
                                              <span>{isDescExpanded ? '설명 접기' : '상세 설명 더보기'}</span>
                                              {isDescExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                            </button>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                    {(() => {
                                      const isMyIdea = idea.submitterId === userId;
                                      return (
                                        <span className={`text-xs font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1 self-start shrink-0 ${isMyIdea
                                          ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                                          }`}>
                                          <User className="w-3 h-3 text-indigo-400" />
                                          {isMyIdea ? '내 아이디어' : `아이디어 ${String.fromCharCode(65 + (ideaIdx % 26))}`}
                                        </span>
                                      );
                                    })()}
                                  </div>

                                  {/* Voting Selector Button Group ([유지 찬성] / [제외 희망]) */}
                                  <div className="space-y-3">
                                    <label className="text-xs font-extrabold text-slate-700">이 아이디어에 대한 익명 스탠스 선택 <span className="text-rose-500">*</span></label>
                                    <div className="grid grid-cols-2 gap-3">
                                      {[
                                        { key: 'KEEP', label: '유지 찬성', desc: '기준에 부합하며 채택 추천', activeClass: 'bg-emerald-50 text-emerald-800 border-emerald-400 font-extrabold ring-2 ring-emerald-500/20' },
                                        { key: 'EXCLUDE', label: '제외 희망', desc: '치명적 리스크/우려 존재', activeClass: 'bg-rose-50 text-rose-800 border-rose-400 font-extrabold ring-2 ring-rose-500/20' }
                                      ].map(opt => {
                                        const isSelected = userVote.decision === opt.key;
                                        return (
                                          <button
                                            key={opt.key}
                                            type="button"
                                            onClick={() => handleVoteChange(idea.id, opt.key as any)}
                                            className={`p-3.5 rounded-xl border text-center transition flex flex-col items-center justify-center gap-1 ${isSelected
                                              ? opt.activeClass
                                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                              }`}
                                          >
                                            <span className="text-sm font-bold">{opt.label}</span>
                                            <span className="text-[10px] font-normal opacity-80">{opt.desc}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Criteria Checklist & Dynamic Reason Inputs (Required when KEEP or EXCLUDE is selected) */}
                                  {(userVote.decision === 'KEEP' || userVote.decision === 'EXCLUDE') && (
                                    <motion.div
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: 'auto' }}
                                      className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4 overflow-hidden text-left"
                                    >
                                      {/* 1. Evaluate every criterion independently */}
                                      <div className="space-y-2">
                                        <label className="text-xs font-bold text-slate-800 block">
                                          공통 기준 충족도 평가 (모든 기준 필수) <span className="text-rose-500">*</span>
                                        </label>
                                        <div className="space-y-2 bg-white p-3 rounded-xl border border-slate-200">
                                          {(() => {
                                            const availableCriteria = (roomDetails.criteria && roomDetails.criteria.length > 0)
                                              ? roomDetails.criteria.map(c => ({ id: c.id, name: c.name, description: c.description }))
                                              : (roomDetails.proposals || []).map((p, idx) => {
                                                const rawText = p?.rawText || '';
                                                const parts = rawText.split(': ');
                                                return {
                                                  id: p?.id || `prop-${idx}`,
                                                  name: parts[0] || `기준 #${idx + 1}`,
                                                  description: parts.length > 1 ? parts.slice(1).join(': ') : rawText
                                                };
                                              });

                                            if (availableCriteria.length === 0) {
                                              return <p className="text-xs text-slate-400">등록된 평가 기준이 없습니다. (2단계에서 평가 기준이 제안되어야 합니다)</p>;
                                            }

                                            return availableCriteria.map(crit => (
                                              <div key={crit.id} className="p-2 rounded-lg border border-slate-100 space-y-2">
                                                <div>
                                                  <span className="font-bold text-xs text-slate-900 block">{crit.name}</span>
                                                  <span className="text-[11px] text-slate-500 block">{crit.description}</span>
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                                                  {[
                                                    { key: 'MET', label: '충족' },
                                                    { key: 'PARTIAL', label: '일부 충족' },
                                                    { key: 'NOT_MET', label: '미충족' },
                                                    { key: 'UNSURE', label: '잘 모르겠음' }
                                                  ].map(option => {
                                                    const selected = userVote.criteriaEvaluations?.[crit.id] === option.key;
                                                    return (
                                                      <button
                                                        key={option.key}
                                                        type="button"
                                                        onClick={() => handleCriteriaEvaluationChange(
                                                          idea.id,
                                                          crit.id,
                                                          option.key as CriteriaEvaluationValue
                                                        )}
                                                        className={`px-2 py-2 rounded-lg border text-[10px] font-bold transition ${
                                                          selected
                                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                                        }`}
                                                      >
                                                        {option.label}
                                                      </button>
                                                    );
                                                  })}
                                                </div>
                                              </div>
                                            ));
                                          })()}
                                        </div>
                                        <p className="text-[10px] text-slate-500">
                                          ‘잘 모르겠음’은 숨기지 않고 비율로 표시하되, 기준 충족도 계산의 분모에서는 제외합니다.
                                        </p>
                                      </div>

                                      {/* 2. Dynamic Reason Textarea */}
                                      <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-800 block">
                                          {userVote.decision === 'KEEP' ? '유지를 지지하는 세부 사유' : '제외를 요청하는 세부 사유'} <span className="text-rose-500">*</span>
                                        </label>
                                        <textarea
                                          required
                                          value={userVote.reasonText}
                                          onChange={e => handleReasonTextChange(idea.id, e.target.value)}
                                          placeholder={userVote.decision === 'KEEP' ? "이 아이디어의 유지를 지지하는 솔직한 근거를 적어주세요. (AI가 기계적인 어조로 재구성하여 문체 유추를 방지합니다)" : "이 아이디어의 제외를 지지하는 솔직한 우려사항을 적어주세요. (AI가 기계적인 어조로 재구성하여 문체 유추를 방지합니다)"}
                                          rows={3}
                                          className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-medium bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <p className="text-[10px] text-emerald-700 font-medium">
                                          🔒 **익명 보호**: 입력하신 의견 원문은 건조하고 기계적인 AI 문체로 재구성되어 팀에 공유됩니다.
                                        </p>
                                      </div>
                                    </motion.div>
                                  )}
                                </motion.div>
                              );
                            })}

                            {/* Centered Voting Transition Button under the last candidate idea */}
                            {(() => {
                              const activeIdeas = roomDetails.ideas.filter(i => i.status === 'ACTIVE');
                              const isAllEvaluated = activeIdeas.length > 0 && activeIdeas.every(idea => {
                                const vote = evalSubmissions[idea.id];
                                if (!vote || !vote.decision) return false;
                                if (!vote.reasonText || !vote.reasonText.trim()) return false;
                                const availableCriteria = roomDetails.criteria || [];
                                if (availableCriteria.some(criterion => !vote.criteriaEvaluations?.[criterion.id])) return false;
                                return true;
                              });

                              return (
                                <div className="pt-6 pb-4 flex flex-col items-center justify-center space-y-3">
                                  {!isAllEvaluated && (
                                    <p className="text-xs text-amber-600 font-bold bg-amber-50 px-4 py-2 rounded-xl border border-amber-200 text-center">
                                      ⚠️ 모든 후보 아이디어에 대해 [익명 스탠스], [모든 공통 기준의 충족도], [세부 사유]를 작성해야 제출할 수 있습니다.
                                    </p>
                                  )}
                                  <button
                                    type="button"
                                    onClick={handleSubmitAllEvaluations}
                                    disabled={!isAllEvaluated}
                                    className={`w-full max-w-md py-4 rounded-2xl text-sm font-black transition flex items-center justify-center gap-2 shadow-lg ${isAllEvaluated
                                      ? 'bg-gradient-to-r from-amber-400 via-amber-400 to-amber-500 text-slate-950 hover:from-amber-300 hover:to-amber-400 border border-amber-300 ring-4 ring-amber-400/20 cursor-pointer'
                                      : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300 opacity-80'
                                      }`}
                                  >
                                    <Sparkles className="w-4 h-4" />
                                    {isAllEvaluated ? '4단계 2차 투표로 이동 (투표하기)' : '투표하기 (모든 아이디어 평가 작성 시 활성화)'}
                                    <ArrowRight className="w-4 h-4" />
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* -----------------------------------------------------------
                    VIEW 5: ELIMINATION (SCREENING DASHBOARD)
                    ----------------------------------------------------------- */}
                  {(roomDetails.room.status === 'ELIMINATION' || roomDetails.room.status === 'FINAL_VOTE') && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                      {/* Top Banner when 2차 별 스티커 투표가 진행 중일 때 */}
                      {(roomDetails.room.finalVoteStatus === 'VOTING' || roomDetails.room.finalVoteStatus === 'TIE_PENDING') && (
                        <div className="lg:col-span-12 p-4 bg-gradient-to-r from-amber-400 via-amber-500 to-indigo-600 rounded-slate-950 text-slate-950 shadow-md flex items-center justify-between gap-3 font-bold border border-amber-300">
                          <div className="flex items-center gap-2 text-xs md:text-sm text-slate-950">
                            <Sparkles className="w-5 h-5 text-slate-950 animate-bounce" />
                            <span>
                              {roomDetails.room.finalVoteStatus === 'TIE_PENDING'
                                ? '모든 투표가 끝났고 최종 채택 경계에서 동률이 발생했습니다.'
                                : '다른 사람의 선택과 중간 집계는 모두 숨겨져 있습니다. 생존 후보 중 최종 결과로 채택할 아이디어를 선택해 주세요.'}
                            </span>
                          </div>
                          {roomDetails.room.finalVoteStatus === 'VOTING' && (
                            <button
                              type="button"
                              onClick={() => setShowFinalVoteModal(true)}
                              className="px-4.5 py-2.5 bg-slate-950 text-amber-300 hover:bg-slate-900 rounded-xl text-xs font-black transition shrink-0 cursor-pointer shadow-sm flex items-center gap-1.5"
                            >
                              <span>⭐ 익명 최종 투표하기</span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* Left: Active Candidates & Scoring statistics */}
                      <div className="lg:col-span-8 space-y-6">

                        {/* Active Candidates list */}
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                            <h2 className="text-base font-extrabold text-slate-900">현재 생존해 있는 활성 후보 ({activeIdeasCount}개)</h2>
                            <span className="text-xs text-slate-400 font-semibold">
                              {roomDetails.room.finalVoteStatus === 'VOTING'
                                ? '중간 집계 비공개'
                                : roomDetails.room.finalVoteStatus === 'TIE_PENDING'
                                  ? '최종 집계 완료 · 동률 확정 대기'
                                  : '투표 결과: 유지 찬성 / 제외 희망'}
                            </span>
                          </div>

                          {(roomDetails.ideas || []).filter(i => i && i.status === 'ACTIVE').map(idea => {
                            const stats = roomDetails.aggregatedScores?.[idea.id] || { score: 0, keepCount: 0, neutralCount: 0, excludeCount: 0, objectiveExcludeCount: 0 };
                            const commentSummaries = roomDetails.aiSummarizedComments?.[idea.id] || { objectiveComments: [], preferenceComments: [] };
                            const isDescExpanded = !!expandedIdeaIds[`stage4_${idea.id}`];

                            return (
                              <div key={idea.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                                  <div className="space-y-1 flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      {(() => {
                                        const isMyIdea = idea.submitterId === userId;
                                        return (
                                          <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${isMyIdea
                                            ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                                            }`}>
                                            <User className="w-3 h-3 text-indigo-400" />
                                            {isMyIdea ? '내 아이디어' : `아이디어 ${String.fromCharCode(65 + ((roomDetails.ideas || []).findIndex(i => i.id === idea.id) % 26))}`}
                                          </span>
                                        );
                                      })()}
                                      <h3 className="text-base font-bold text-slate-900">{idea.title}</h3>
                                    </div>

                                    {/* Idea description accordion toggle */}
                                    <div className="pt-0.5">
                                      {isDescExpanded ? (
                                        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line bg-slate-50 p-2.5 rounded-xl border border-slate-100 mt-1">
                                          {idea.description}
                                        </p>
                                      ) : (
                                        <p className="text-xs text-slate-500 line-clamp-1">
                                          {idea.description}
                                        </p>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => toggleIdeaExpanded(`stage4_${idea.id}`)}
                                        className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5 mt-1 transition"
                                      >
                                        <span>{isDescExpanded ? '설명 접기' : '상세 설명 더보기'}</span>
                                        {isDescExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                      </button>
                                    </div>
                                  </div>

                                  {roomDetails.room.finalVoteStatus !== 'VOTING' && roomDetails.room.finalVoteStatus !== 'TIE_PENDING' && (
                                    <div className="text-right self-start sm:self-auto bg-slate-50 py-1.5 px-3.5 border border-slate-100 rounded-xl shrink-0">
                                      <span className="text-[10px] text-slate-400 font-bold block leading-none">기준 충족도</span>
                                      <span className="text-lg font-black text-slate-900">{stats.avgCriteriaComplianceRatio ?? stats.score}%</span>
                                      {stats.validResponseCount !== undefined && (
                                        <span className="text-[10px] text-slate-500 block mt-1">
                                          유효 {stats.validResponseCount}명 · 잘 모르겠음 {stats.unsureRate || 0}%
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Aggregate vote counters (2 options: 유지 찬성 / 제외 희망) */}
                                {roomDetails.room.finalVoteStatus !== 'VOTING' && roomDetails.room.finalVoteStatus !== 'TIE_PENDING' && (
                                <div className="grid grid-cols-2 gap-3 bg-slate-50 p-2.5 rounded-xl text-center text-xs font-extrabold text-slate-500">
                                  <div className="bg-emerald-50/70 p-2.5 rounded-xl border border-emerald-100/80 flex items-center justify-between px-4">
                                    <span className="text-emerald-700 font-bold">유지 찬성</span>
                                    <span className="text-sm font-black text-emerald-800">{stats.keepCount}표</span>
                                  </div>
                                  <div className="bg-rose-50/70 p-2.5 rounded-xl border border-rose-100/80 flex items-center justify-between px-4">
                                    <span className="text-rose-700 font-bold">제외 희망</span>
                                    <span className="text-sm font-black text-rose-800">{stats.excludeCount}표</span>
                                  </div>
                                </div>
                                )}

                                {/* AI summarized anonymous comments (Security checked) */}
                                {roomDetails.room.finalVoteStatus !== 'VOTING' && roomDetails.room.finalVoteStatus !== 'TIE_PENDING' &&
                                  (commentSummaries.objectiveComments.length > 0 || commentSummaries.preferenceComments.length > 0) && (
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
                                {roomDetails.room.hostId === userId &&
                                  roomDetails.room.finalVoteStatus !== 'VOTING' &&
                                  roomDetails.room.finalVoteStatus !== 'TIE_PENDING' && (
                                  <div className="flex justify-end pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setPendingEliminationIdea(idea)}
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

                        {/* Step Control Box for Host & Invited Participants */}
                        {roomDetails.room.finalVoteStatus === 'VOTING' ? (
                          <div className="bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-slate-950 p-5 rounded-2xl space-y-3 shadow-md border border-amber-300">
                            <h3 className="text-sm font-extrabold text-slate-950 flex items-center gap-1.5">
                              <Sparkles className="w-4 h-4 text-slate-950" />
                              익명 최종 투표
                            </h3>
                            <p className="text-xs font-bold text-slate-950 leading-relaxed">
                              투표가 끝날 때까지 다른 사람의 선택과 중간 집계는 공개되지 않습니다.
                            </p>
                            <p className="text-[11px] font-bold text-slate-800">
                              제출 현황 {roomDetails.starVoteSubmittedCount || 0} / {roomDetails.finalVoteExpectedCount || 0}명
                            </p>
                            <button
                              type="button"
                              onClick={() => setShowFinalVoteModal(true)}
                              className="w-full py-3 bg-slate-950 text-amber-300 hover:bg-slate-900 transition rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-md cursor-pointer border border-amber-400 active:scale-95"
                            >
                              <Sparkles className="w-4 h-4 text-amber-400" />
                              <span>⭐ 익명 최종 투표하기</span>
                            </button>
                          </div>
                        ) : roomDetails.room.finalVoteStatus === 'TIE_PENDING' ? (
                          <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-4 shadow-md">
                            <h3 className="text-sm font-bold text-amber-400">최종 채택 경계 동률</h3>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              모든 표는 동시에 공개되었습니다. 동률 후보 안에서만 서버 추첨으로 남은 자리를 확정합니다.
                            </p>
                            {roomDetails.room.hostId === userId ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setRoulettePurpose('TIE_RESOLUTION');
                                  setRouletteWinnerResult(null);
                                  setShowRouletteModal(true);
                                }}
                                className="w-full py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-black"
                              >
                                동률 결과 안전하게 확정하기
                              </button>
                            ) : (
                              <p className="text-xs font-bold text-amber-300">방장이 동률 결과를 확정하고 있습니다.</p>
                            )}
                          </div>
                        ) : roomDetails.room.hostId === userId ? (
                          <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-4 shadow-md">
                            <h3 className="text-sm font-bold text-amber-400 flex items-center gap-1.5">
                              <Settings className="w-4 h-4" />
                              소거 집행 통제판
                            </h3>
                            {(() => {
                              const targetWinners = roomDetails.room.targetWinnerCount || 1;
                              const isFinalTwoChoice = activeIdeasCount === 2;

                              if (isFinalTwoChoice) {
                                return (
                                  <div className="space-y-2">
                                    <p className="text-xs text-amber-300 font-bold leading-relaxed">
                                      ✨ 최종 {targetWinners}개 결과 선정을 위해 남은 2개 후보 아이디어 중 우승작을 직접 투표해 주십시오.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={handleStartFinalVote}
                                      className="w-full py-3 bg-gradient-to-r from-amber-400 via-amber-400 to-amber-500 text-slate-950 hover:from-amber-300 hover:to-amber-400 transition rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-md cursor-pointer border border-amber-300 ring-2 ring-amber-400/20 active:scale-95"
                                    >
                                      <Sparkles className="w-4 h-4 text-slate-950" />
                                      <span>최종 후보 투표하기</span>
                                    </button>
                                  </div>
                                );
                              }

                              return (
                                <>
                                  <p className="text-xs text-slate-300 leading-relaxed">
                                    팀원들의 평가가 완료되었습니다. [유지 찬성] 및 [제외 희망] 투표 결과 기반으로 <strong>상위 60% 후보를 보존하고 하위 후보 소거</strong>를 진행합니다.
                                  </p>

                                  <button
                                    onClick={() => handleProceedElimination()}
                                    disabled={activeIdeasCount <= 1 || loading}
                                    className="w-full py-2.5 bg-white text-slate-900 hover:bg-slate-100 transition rounded-xl text-xs font-black flex items-center justify-center gap-1"
                                  >
                                    {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                                    {(roomDetails.rounds?.length || 0) + 1}라운드 하위 후보 소거 진행
                                  </button>

                                  <button
                                    onClick={handleStartFinalVote}
                                    className="w-full py-2 border border-dashed border-slate-600 text-slate-300 hover:text-white hover:bg-slate-800 transition rounded-xl text-xs font-bold cursor-pointer"
                                  >
                                    소거 중단하고 현시점 최상위 생존 후보 확정
                                  </button>
                                </>
                              );
                            })()}
                          </div>
                        ) : (
                          /* Participant (Invited User) Voting Action Box */
                          <div className="bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 text-slate-950 p-5 rounded-2xl space-y-3 shadow-md border border-amber-300">
                            <h3 className="text-sm font-extrabold text-slate-950 flex items-center gap-1.5">
                              <Sparkles className="w-4 h-4 text-slate-950" />
                              4단계 2차 별 스티커 투표
                            </h3>
                            <p className="text-xs font-bold text-slate-950 leading-relaxed">
                              생존 후보 중 최종 우승작으로 채택할 아이디어에 별 스티커를 붙여주세요.
                            </p>
                            <button
                              type="button"
                              onClick={() => setShowFinalVoteModal(true)}
                              className="w-full py-3 bg-slate-950 text-amber-300 hover:bg-slate-900 transition rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-md cursor-pointer border border-amber-400 active:scale-95"
                            >
                              <Sparkles className="w-4 h-4 text-amber-400" />
                              <span>⭐ 4단계 2차 별 스티커 투표하기</span>
                            </button>
                          </div>
                        )}

                        {/* Objective Constraints Alert Box */}
                        {roomDetails.room.finalVoteStatus !== 'VOTING' &&
                          roomDetails.room.finalVoteStatus !== 'TIE_PENDING' &&
                          objectiveCandidates.length > 0 && (
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

                        {/* Host Option: Restart Stage 2 with Surviving Ideas */}
                        {roomDetails.room.hostId === userId &&
                          roomDetails.room.finalVoteStatus !== 'VOTING' &&
                          roomDetails.room.finalVoteStatus !== 'TIE_PENDING' && (
                          <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-3 shadow-md border border-slate-800">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="text-sm font-bold text-amber-400 flex items-center gap-1.5">
                                <Sparkles className="w-4 h-4 text-amber-400" />
                                생존 아이디어 2단계 재설정
                              </h3>
                              <span className="text-[10px] font-extrabold bg-slate-800 text-indigo-200 px-2.5 py-0.5 rounded-full border border-slate-700">
                                생존 {activeIdeasCount}개
                              </span>
                            </div>
                          <p className="text-xs text-slate-300 leading-relaxed">
                              현재 소거되지 않은 아이디어로 새 검토 회차를 시작합니다. 이전 회차의 평가와 결과는 덮어쓰지 않고 보존됩니다.
                            </p>
                            <button
                              type="button"
                              onClick={handleRestartStage2WithSurvivingIdeas}
                              disabled={activeIdeasCount < 2}
                              className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 rounded-xl text-xs font-black transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-slate-950" />
                              <span>새 재검토 회차 시작</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {/* Rounds timeline */}
                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                          <h3 className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">소거 타임라인</h3>

                          {(!roomDetails.rounds || roomDetails.rounds.length === 0) ? (
                            <p className="text-xs font-semibold text-slate-400">진행된 소거 라운드가 없습니다.</p>
                          ) : (
                            <div className="space-y-4 border-l-2 border-slate-100 pl-3.5">
                              {(roomDetails.rounds || []).map(round => (
                                <div key={round.id} className="space-y-1 relative">
                                  <div className="absolute -left-[20px] top-1.5 w-2 h-2 rounded-full bg-slate-900" />
                                  <span className="text-[10px] font-black text-slate-400">{round.roundNumber}라운드 소거 완료</span>
                                  <h4 className="text-xs font-bold text-slate-900">
                                    {round.eliminatedIdeaIds.map(id => (roomDetails.ideas || []).find(i => i.id === id)?.title).join(', ')} 소거
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
                    VIEW 6: CLOSED (FINAL REPORT SHOWCASE - UX IMPROVED)
                    ----------------------------------------------------------- */}
                  {roomDetails.room.status === 'CLOSED' && (
                    <div className="space-y-6 max-w-4xl mx-auto text-left">

                      {/* ① 최종 결과 헤더 & PDF 저장 버튼 */}
                      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 md:p-8 rounded-3xl text-white shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-slate-800">
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest bg-amber-500/10 border border-amber-400/30 px-2.5 py-0.5 rounded-full">
                            최종 결과 보고서
                          </span>
                          <h1 className="text-xl md:text-2xl font-black tracking-tight text-white">
                            {roomDetails.room.title}
                          </h1>
                          <p className="text-xs text-slate-300 font-medium">
                            {roomDetails.room.decisionMode === 'QUICK'
                              ? '다른 사람의 선택을 보지 않고 진행한 익명 투표와 최종 결정 근거입니다.'
                              : '익명 아이디어 제안, 공통 기준 평가 및 최종 익명 투표를 종합한 결과입니다.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleDownloadPDF}
                          className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-xl text-xs font-black transition shadow-md flex items-center gap-2 cursor-pointer shrink-0 border border-amber-500 active:scale-95"
                        >
                          <Download className="w-4 h-4 text-slate-950" />
                          <span>최종 결과 리포트 PDF 저장</span>
                        </button>
                      </div>

                      {/* ② 동률 여부 확인 & 룰렛 섹션 (운영 정책: 동률 발생 시만 표시) */}
                      {roomDetails.starVoteStatus === 'tie_pending' && (
                        <div className="bg-amber-50 border-2 border-amber-400 p-6 rounded-3xl text-center space-y-4 shadow-md">
                          <div className="inline-flex items-center gap-1.5 bg-amber-200 text-amber-950 font-black text-xs px-3.5 py-1 rounded-full border border-amber-300">
                            <AlertCircle className="w-4 h-4 text-amber-800" />
                            <span>⚠️ 최종 후보가 동률입니다</span>
                          </div>
                          <p className="text-xs text-amber-900 font-bold max-w-lg mx-auto">
                            최종 채택 경계에서 동점이 발생했습니다. 운명의 룰렛을 돌려 우승 아이디어를 확정해주십시오!
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setRoulettePurpose('TIE_RESOLUTION');
                              setRouletteWinnerResult(null);
                              setShowRouletteModal(true);
                            }}
                            disabled={isSpinningRoulette}
                            className="py-3 px-6 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-2xl shadow-lg transition border border-amber-600 inline-flex items-center gap-2 cursor-pointer active:scale-95"
                          >
                            <Sparkles className="w-4 h-4 text-slate-950" />
                            <span>[ 운명의 룰렛 돌리기 ]</span>
                          </button>
                        </div>
                      )}

                      {/* 테스트 환경 전용 룰렛 미리보기 카드 */}
                      <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
                        <div className="space-y-1 text-center sm:text-left">
                          <span className="text-xs font-black text-slate-800 flex items-center gap-1.5 justify-center sm:justify-start">
                            <Sparkles className="w-4 h-4 text-amber-500" />
                            🧪 테스트용 룰렛 미리보기
                          </span>
                          <p className="text-[11px] text-slate-500 font-medium">
                            실제 최종 결과 및 DB 데이터에 영향을 주지 않으며, 룰렛 UI 및 회전 기능을 시연할 수 있습니다.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setRoulettePurpose('PREVIEW');
                            setRouletteWinnerResult(null);
                            setShowRouletteModal(true);
                          }}
                          className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs rounded-xl transition shadow-xs shrink-0 border border-amber-500 flex items-center gap-1.5 cursor-pointer active:scale-95"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>룰렛 돌리기 (미리보기)</span>
                        </button>
                      </div>

                      {/* ③ 최종 선정 아이디어 카드 (Spotlight) */}
                      <div className="bg-white p-6 md:p-8 rounded-3xl border border-indigo-200 shadow-lg space-y-5 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-600 via-amber-400 to-indigo-600" />

                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                            <Award className="w-5 h-5 text-amber-500" />
                            🏆 최종 선정 아이디어
                          </h2>
                          <button
                            type="button"
                            onClick={() => setShowWinnerModal(true)}
                            className="text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-xl hover:bg-indigo-100 transition"
                          >
                            축하 팝업 열기
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-4 pt-1">
                          {(!roomDetails?.ideas || roomDetails.ideas.filter(i => i && i.status === 'WINNER').length === 0) ? (
                            <div className="text-center py-6 text-slate-500 text-xs font-medium bg-slate-50 rounded-2xl border border-slate-100">
                              최종 확정된 우승 아이디어를 불러오는 중입니다.
                            </div>
                          ) : (
                            roomDetails.ideas.filter(i => i && i.status === 'WINNER').map(winner => (
                              <div key={winner.id} className="p-5 bg-gradient-to-br from-indigo-50/50 to-amber-50/30 rounded-2xl border border-indigo-100 space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <h3 className="text-lg font-black text-indigo-950 tracking-tight">
                                    {winner.title}
                                  </h3>
                                  <span className="text-[11px] font-extrabold text-amber-900 bg-amber-200/90 border border-amber-300 px-2.5 py-0.5 rounded-full shrink-0">
                                    최종 채택
                                  </span>
                                </div>
                                <p className="text-xs md:text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                                  {winner.description}
                                </p>

                                <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-200/60">
                                  <span className="font-bold text-slate-800">
                                    제안자: {winner.submitterName || '익명 참여자'}
                                  </span>
                                  {winner.attachmentUrl && (
                                    <a
                                      href={winner.attachmentUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-indigo-600 hover:underline font-bold text-xs"
                                    >
                                      📎 참고 자료 링크 보기
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* ④ AI 종합 분석 보고서 및 논의 내역 카드 (Markdown Rendered) */}
                      <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                          <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-indigo-600" />
                            Potens AI 종합 의사결정 리포트
                          </h2>
                          <span className="text-xs font-bold text-slate-400">자동 생성 및 검증 완료</span>
                        </div>

                        {roomDetails.room.finalReportText ? (
                          <div className="prose prose-slate max-w-none">
                            <SafeMarkdown content={roomDetails.room.finalReportText} />
                          </div>
                        ) : (
                          <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-2">
                            <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin mx-auto" />
                            <p className="text-xs font-bold text-slate-600">AI 종합 분석 리포트를 생성하고 있습니다...</p>
                          </div>
                        )}
                      </div>

                      {/* ⑤ 찬반/갈등 아이디어 논의 요약 섹션 */}
                      {controversialIdeas.length > 0 && (
                        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                          <div className="border-b border-slate-100 pb-2">
                            <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                              <Info className="w-4 h-4 text-amber-500" />
                              주요 쟁점 및 찬반 대립 아이디어 복기
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              유지 찬성과 제외 요청표가 팽팽하게 대립했던 후보들의 핵심 논점 요약입니다.
                            </p>
                          </div>

                          <div className="space-y-3">
                            {controversialIdeas.map(idea => {
                              const stats = roomDetails.aggregatedScores?.[idea.id];
                              return (
                                <div key={idea.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs">
                                  <div className="flex items-center justify-between font-bold">
                                    <span className="text-slate-900 text-sm font-black">{idea.title}</span>
                                    {stats && (
                                      <span className="text-slate-600 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                                        👍 찬성 {stats.keepCount}표 vs 👎 제외 {stats.excludeCount}표
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-slate-600 leading-relaxed">{idea.description}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Email Authentication & Account Recovery Modal (user_accounts) */}
      <AnimatePresence>
        {showLoginModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-6 md:p-8 rounded-3xl max-w-sm w-full shadow-xl space-y-5 text-left"
            >
              {/* 1. Show newly generated Recovery Code right after Sign Up */}
              {recoveryCodeOutput ? (
                <div className="space-y-4 text-center py-2">
                  <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto border border-amber-200">
                    <Lock className="w-6 h-6 text-amber-600" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-extrabold text-slate-900">계정 복구 코드가 발급되었습니다!</h3>
                    <p className="text-xs text-slate-500 leading-relaxed px-1">
                      비밀번호를 잊으셨을 때 계정을 찾고 재설정할 수 있는 **유일한 복구 수단**입니다. 단방향 해시로 안전하게 관리되므로 복사하여 안전한 곳에 보관하세요.
                    </p>
                  </div>

                  <div className="p-3.5 bg-amber-50/90 border border-amber-300 rounded-2xl flex items-center justify-between gap-2 shadow-xs">
                    <span className="font-mono font-extrabold text-sm text-slate-900 tracking-wider">
                      {recoveryCodeOutput}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(recoveryCodeOutput);
                        triggerToast('복구 코드가 클립보드에 복사되었습니다!', 'success');
                      }}
                      className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs rounded-xl transition shadow-xs cursor-pointer"
                    >
                      복사
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      setRecoveryCodeOutput(null);
                      setShowLoginModal(false);
                    }}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold transition shadow-md cursor-pointer"
                  >
                    확인 완료 및 시작하기
                  </button>
                </div>
              ) : recoveredAccountResult ? (
                /* 2. Show Recovered Account & New Password Result */
                <div className="space-y-4 text-center py-2">
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto border border-emerald-200">
                    <CheckCircle className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-extrabold text-slate-900">계정 복구 성공!</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      로그인 아이디가 확인되었으며, 비밀번호가 안전하게 재설정되었습니다.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-left text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 font-bold">🔑 로그인 아이디:</span>
                      <span className="font-mono font-extrabold text-indigo-600">{recoveredAccountResult.loginId}</span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-slate-200/80">
                      <span className="text-slate-500 font-bold">🔐 새 복구 코드:</span>
                      <span className="font-mono font-extrabold text-amber-600">{recoveredAccountResult.newRecoveryCode}</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-amber-700 font-medium bg-amber-50 p-2.5 rounded-xl border border-amber-200 text-left">
                    ⚠️ 이전 복구 코드는 즉시 폐기되었습니다. 새로 발급된 복구 코드를 안전하게 보관하세요!
                  </p>

                  <button
                    onClick={() => {
                      setRecoveredAccountResult(null);
                      setShowLoginModal(false);
                    }}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold transition shadow-md cursor-pointer"
                  >
                    로그인 상태로 서비스 이용하기
                  </button>
                </div>
              ) : (
                /* 3. Standard 3-Tab Form (Login / Signup / Recover) */
                <>
                  <div className="flex items-center justify-between">
                    <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center">
                      <Lock className="w-5 h-5" />
                    </div>
                    <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold gap-0.5">
                      <button
                        type="button"
                        onClick={() => { setAuthMode('LOGIN'); setAuthError(null); }}
                        className={`px-2.5 py-1 rounded-lg transition ${authMode === 'LOGIN' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        로그인
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAuthMode('SIGNUP'); setAuthError(null); }}
                        className={`px-2.5 py-1 rounded-lg transition ${authMode === 'SIGNUP' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        회원가입
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAuthMode('RECOVER'); setAuthError(null); }}
                        className={`px-2 py-1 rounded-lg transition ${authMode === 'RECOVER' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        🔑 계정 복구
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xl font-bold text-slate-900">
                      {authMode === 'LOGIN' && '로그인'}
                      {authMode === 'SIGNUP' && '회원가입 (계정 생성)'}
                      {authMode === 'RECOVER' && '복구 코드로 계정 찾기'}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      {authMode === 'LOGIN' && '아이디와 비밀번호를 입력하여 로그인하십시오.'}
                      {authMode === 'SIGNUP' && '아이디와 비밀번호, 이름을 설정하여 계정을 생성하십시오.'}
                      {authMode === 'RECOVER' && '발급받으셨던 복구 코드로 아이디를 확인하고 비밀번호를 재설정합니다.'}
                    </p>
                  </div>

                  {authError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-600 text-xs font-medium">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                      <span>{authError}</span>
                    </div>
                  )}

                  {authMode === 'RECOVER' ? (
                    /* Recover Form */
                    <form onSubmit={handleAccountRecovery} className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">복구 코드 <span className="text-rose-500">*</span></label>
                        <input
                          type="text"
                          required
                          value={recoveryCodeInput}
                          onChange={e => setRecoveryCodeInput(e.target.value)}
                          placeholder="예: RC-A8F2-7K9M"
                          className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">새 비밀번호 설정 <span className="text-rose-500">*</span></label>
                        <input
                          type="password"
                          required
                          maxLength={15}
                          value={recoveryNewPassword}
                          onChange={e => setRecoveryNewPassword(e.target.value)}
                          placeholder="영문 소문자 및 숫자 조합"
                          className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                        />
                      </div>

                      <div className="pt-2 space-y-2">
                        <button
                          type="submit"
                          disabled={isRecoveringAccount || !recoveryCodeInput.trim() || !recoveryNewPassword}
                          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition shadow-sm cursor-pointer"
                        >
                          {isRecoveringAccount ? '복구 및 검증 중...' : '계정 찾기 & 비밀번호 재설정'}
                        </button>

                        <button
                          type="button"
                          onClick={() => { setShowLoginModal(false); setAuthError(null); }}
                          className="w-full py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 transition text-center cursor-pointer"
                        >
                          닫기
                        </button>
                      </div>
                    </form>
                  ) : (
                    /* Login / Signup Form */
                    <form onSubmit={authMode === 'LOGIN' ? handleEmailLogin : handleEmailSignUp} className="space-y-3">
                      {authMode === 'SIGNUP' && (
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-700">이름 (닉네임) <span className="text-rose-500">*</span></label>
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
                        <label className="text-xs font-bold text-slate-700">로그인 ID (이메일) <span className="text-rose-500">*</span></label>
                        <input
                          type="text"
                          required
                          value={authEmail}
                          onChange={e => { setAuthEmail(e.target.value); setAuthError(null); }}
                          placeholder="GOMINHAJO 또는 user@example.com"
                          className={`w-full px-3.5 py-2 border rounded-xl text-xs focus:outline-none focus:ring-2 font-medium ${authEmail && !isEmailValid ? 'border-rose-300 focus:ring-rose-400 bg-rose-50/30' : 'border-slate-200 focus:ring-indigo-500'
                            }`}
                        />
                        {authEmail && !isEmailValid && (
                          <p className="text-[10px] text-rose-500 font-medium">⚠️ 올바른 이메일/ID 형식이 아닙니다.</p>
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
                          className={`w-full px-3.5 py-2 border rounded-xl text-xs focus:outline-none focus:ring-2 font-medium ${authMode === 'SIGNUP' && authPassword && !isPasswordValid ? 'border-rose-300 focus:ring-rose-400 bg-rose-50/30' : 'border-slate-200 focus:ring-indigo-500'
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
                          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition shadow-sm cursor-pointer"
                        >
                          {authMode === 'LOGIN' ? '로그인' : '회원가입 완료 및 복구코드 발급'}
                        </button>

                        <button
                          type="button"
                          onClick={() => { setShowLoginModal(false); setAuthError(null); }}
                          className="w-full py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 transition text-center cursor-pointer"
                        >
                          닫기
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Roulette Preview Modal (Test & Demo mode) */}
      <AnimatePresence>
        {showRouletteModal && (
          <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white p-6 md:p-8 rounded-3xl max-w-md w-full shadow-2xl space-y-5 text-center border border-indigo-100 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-400 via-indigo-600 to-amber-500" />

              <button
                type="button"
                onClick={() => setShowRouletteModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-1">
                <div className="inline-flex items-center gap-1 bg-amber-100 border border-amber-300 text-amber-900 text-[11px] font-black px-3 py-0.5 rounded-full mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span>
                    {roulettePurpose === 'TIE_RESOLUTION'
                      ? '🔐 동률 결과 안전 확정'
                      : '🧪 테스트용 룰렛 미리보기'}
                  </span>
                </div>
                <h3 className="text-lg font-black text-slate-900">🎲 운명의 룰렛 돌리기</h3>
                <p className={`text-xs font-bold p-2 rounded-xl border ${
                  roulettePurpose === 'TIE_RESOLUTION'
                    ? 'text-indigo-700 bg-indigo-50 border-indigo-100'
                    : 'text-rose-600 bg-rose-50 border-rose-100'
                }`}>
                  {roulettePurpose === 'TIE_RESOLUTION'
                    ? '서버가 동률 후보 안에서 암호학적 난수로 추첨하고, 그 결과를 최종 기록으로 저장합니다. 한 번 확정하면 다시 돌릴 수 없습니다.'
                    : '⚠️ 이 결과는 실제 최종 선정 결과에 반영되지 않는 미리보기 테스트입니다.'}
                </p>
              </div>

              {/* Roulette Graphical Wheel */}
              <div className="relative w-60 h-60 mx-auto my-4 flex items-center justify-center">
                {/* Top Pointer Arrow (Points to 12 o'clock = 0 deg) */}
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-30 w-0 h-0 border-l-[14px] border-l-transparent border-r-[14px] border-r-transparent border-t-[22px] border-t-rose-600 drop-shadow-lg" />

                {/* Spinning Wheel Disk */}
                <div
                  className="w-full h-full rounded-full border-4 border-slate-900 shadow-xl overflow-hidden relative transition-transform ease-out"
                  style={{
                    transform: `rotate(${rouletteRotation}deg)`,
                    transitionDuration: isSpinningRoulette ? '3.5s' : '0s'
                  }}
                >
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    {(() => {
                      const total = rouletteCandidateIdeas.length;
                      const sliceAngle = 360 / total;
                      const colorPalette = [
                        '#4f46e5', // indigo-600
                        '#fbbf24', // amber-400
                        '#059669', // emerald-600
                        '#e11d48', // rose-600
                        '#8b5cf6', // violet-600
                        '#0284c7'  // sky-600
                      ];

                      return rouletteCandidateIdeas.map((candidate, idx) => {
                        const startAngle = idx * sliceAngle;
                        const endAngle = (idx + 1) * sliceAngle;
                        const midAngle = startAngle + sliceAngle / 2;

                        // Calculate SVG Arc coordinates (radius = 50, center = 50, 50)
                        const startRad = (Math.PI * startAngle) / 180;
                        const endRad = (Math.PI * endAngle) / 180;
                        const midRad = (Math.PI * midAngle) / 180;

                        const x1 = 50 + 50 * Math.cos(startRad);
                        const y1 = 50 + 50 * Math.sin(startRad);
                        const x2 = 50 + 50 * Math.cos(endRad);
                        const y2 = 50 + 50 * Math.sin(endRad);

                        const largeArcFlag = sliceAngle > 180 ? 1 : 0;
                        const pathData = total === 1
                          ? 'M 50,50 m -50,0 a 50,50 0 1,0 100,0 a 50,50 0 1,0 -100,0'
                          : `M 50 50 L ${x1} ${y1} A 50 50 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

                        // Text position at 68% radius
                        const textX = 50 + 32 * Math.cos(midRad);
                        const textY = 50 + 32 * Math.sin(midRad);

                        return (
                          <g key={candidate.id || idx}>
                            <path
                              d={pathData}
                              fill={colorPalette[idx % colorPalette.length]}
                              stroke="#ffffff"
                              strokeWidth="1.5"
                            />
                            <text
                              x={textX}
                              y={textY}
                              fill="#ffffff"
                              fontSize={total > 4 ? "4.5" : "5.5"}
                              fontWeight="900"
                              textAnchor="middle"
                              dominantBaseline="central"
                              transform={`rotate(${midAngle + 90}, ${textX}, ${textY})`}
                              className="select-none font-sans drop-shadow-xs"
                            >
                              {candidate.title.length > 8 ? candidate.title.slice(0, 7) + '..' : candidate.title}
                            </text>
                          </g>
                        );
                      });
                    })()}
                  </svg>
                </div>

                {/* Center Hub Button */}
                <div className="absolute w-12 h-12 bg-slate-900 text-white rounded-full border-2 border-white shadow-md flex items-center justify-center font-black text-xs z-20 pointer-events-none">
                  🎯
                </div>
              </div>

              {/* Result Indicator */}
              {rouletteWinnerResult && (
                <div className="bg-amber-50 border border-amber-300 p-3 rounded-2xl space-y-1 animate-fade-in">
                  <span className="text-[10px] font-bold text-amber-800">
                    {roulettePurpose === 'TIE_RESOLUTION'
                      ? '🎉 최종 확정 후보'
                      : '🎉 룰렛 미리보기 당첨 후보'}
                  </span>
                  <p className="text-sm font-black text-indigo-950">[{rouletteWinnerResult}]</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRouletteModal(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={handleSpinRoulette}
                  disabled={isSpinningRoulette || (roulettePurpose === 'TIE_RESOLUTION' && Boolean(rouletteWinnerResult))}
                  className="flex-1 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 border border-amber-500 rounded-xl text-xs font-black transition shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isSpinningRoulette ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      회전 중...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-slate-950" />
                      <span>
                        {roulettePurpose === 'TIE_RESOLUTION' && rouletteWinnerResult
                          ? '최종 확정 완료'
                          : rouletteWinnerResult
                            ? '다시 돌리기'
                            : roulettePurpose === 'TIE_RESOLUTION'
                              ? '동률 결과 확정하기'
                              : '룰렛 돌리기'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Private participant invitation modal */}
      <AnimatePresence>
        {showShareModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-6 md:p-8 rounded-3xl max-w-lg w-full shadow-2xl space-y-6 text-left"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 text-indigo-500 rounded-2xl flex items-center justify-center font-bold shrink-0">
                    🔗
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 leading-snug">회의실 전용 링크 공유 및 관리</h3>
                    <p className="text-xs text-slate-400">초대받은 로그인 팀원만 회의실에 참여할 수 있습니다.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  className="text-slate-400 hover:text-slate-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Card 1: ① 참여자 전용 링크 */}
              <div className="p-5 bg-indigo-50/50 rounded-3xl border border-indigo-100/80 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-indigo-600 text-white">
                    ① 참여자 전용 링크
                  </span>
                  <span className="text-xs font-bold text-indigo-900">최대 6명 (의견 및 아이디어 제출 가능)</span>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                  회의에 직접 동참하여 아이디어를 발제하고 익명 평가 기준을 제출하는 핵심 참여자 링크입니다. (입장 시 닉네임 최대 6자 설정)
                </p>

                {/* Email invitation form */}
                <form onSubmit={handleSendEmailInvite} className="flex gap-2.5">
                  <input
                    type="email"
                    value={inviteEmailInput}
                    onChange={e => setInviteEmailInput(e.target.value)}
                    placeholder="참여자 이메일 입력 (예: member@company.com)"
                    className="flex-1 px-4 py-3 border border-indigo-200/80 rounded-2xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium bg-white"
                  />
                  <button
                    type="submit"
                    className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold transition shadow-xs shrink-0"
                  >
                    이메일 초대
                  </button>
                </form>

                {/* Copy Link Button */}
                <button
                  type="button"
                  onClick={async () => {
                    let tokenToUse = activeInviteToken;
                    if (!tokenToUse || inviteSecondsLeft <= 0) {
                      if (activeRoomId) {
                        tokenToUse = await handleGenerateNewInviteToken(activeRoomId);
                      }
                    }
                    if (tokenToUse) {
                      const inviteUrl = `${window.location.origin}/invite/${tokenToUse}`;
                      navigator.clipboard.writeText(inviteUrl);
                      triggerToast('참여자 전용 초대 링크가 클립보드에 복사되었습니다!');
                    } else {
                      copyParticipantLink();
                    }
                  }}
                  className="w-full py-3.5 bg-white hover:bg-indigo-50/50 border border-indigo-200 text-indigo-900 rounded-2xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                >
                  <Copy className="w-4 h-4 text-indigo-600" />
                  <span>참여자 전용 복사 링크</span>
                </button>
              </div>

              {/* Footer close button */}
              <div className="pt-1 text-right">
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-2xl transition"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Winner Announcement Popup Modal ("최종 아이디어가 선정되었습니다") */}
      <AnimatePresence>
        {showWinnerModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white p-6 md:p-8 rounded-3xl max-w-xl w-full shadow-2xl space-y-6 text-center border border-indigo-100 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-amber-400 via-indigo-600 to-emerald-500" />

              <button
                type="button"
                onClick={() => setShowWinnerModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-16 h-16 bg-amber-50 border border-amber-200 text-amber-500 rounded-full flex items-center justify-center mx-auto shadow-md">
                <Award className="w-8 h-8 animate-bounce text-amber-500" />
              </div>

              <div className="space-y-1.5">
                <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                  🎉 최종 아이디어가 선정되었습니다
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  방 개설 설정 기준 (최종 {roomDetails?.room.targetWinnerCount || 1}개 결과 선정)에 따른 최종 우승작 목록입니다.
                </p>
              </div>

              <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1 text-left">
                {(() => {
                  const allIdeas = roomDetails?.ideas || [];
                  const winners = allIdeas.filter(i => i.status === 'WINNER' || (roomDetails?.room.status === 'CLOSED' && i.status === 'ACTIVE'));
                  const targetCount = roomDetails?.room.targetWinnerCount || 1;
                  const displayWinners = winners.length > 0
                    ? winners
                    : allIdeas.filter(i => i.status === 'ACTIVE').slice(0, targetCount);

                  if (displayWinners.length === 0) {
                    return <p className="text-xs text-slate-400 text-center py-4">선정된 최종 아이디어가 없습니다.</p>;
                  }

                  return displayWinners.map((winner, idx) => {
                    const stats = roomDetails?.aggregatedScores?.[winner.id];
                    return (
                      <div key={winner.id} className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3 shadow-xs">
                        <div className="flex items-start justify-between gap-2 border-b border-slate-200/60 pb-2">
                          <div>
                            <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100 mb-1 inline-block">
                              최종 선정 아이디어 #{idx + 1}
                            </span>
                            <h3 className="text-base font-bold text-slate-900">{winner.title}</h3>
                          </div>
                          {stats && (
                            <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-100 shrink-0">
                              {stats.score}점 ({stats.keepCount}표 찬성)
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                          {winner.description}
                        </p>

                        <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                          <span className="font-semibold bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                            제안자: {winner.submitterName}
                          </span>
                          {winner.attachmentUrl && (
                            <a
                              href={winner.attachmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-600 hover:underline font-bold text-[11px]"
                            >
                              📎 첨부파일 보기
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowWinnerModal(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={() => setShowWinnerModal(false)}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition shadow-md flex items-center justify-center gap-1"
                >
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>최종 결과 확인하기</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Proposal Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingProposalId && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-6 rounded-3xl max-w-sm w-full shadow-2xl space-y-5 text-center border border-slate-100"
            >
              <div className="w-12 h-12 bg-rose-50 border border-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto shadow-xs">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-slate-900">평가 기준 삭제</h3>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  이 평가 기준을 삭제하시겠습니까? 삭제한 내용은 복구할 수 없습니다.
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDeletingProposalId(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteProposal}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition shadow-xs"
                >
                  삭제하기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Final Candidate Vote Modal ("최종 후보 투표하기") */}
      {/* Final Candidate Vote Modal ("2차 별 스티커 투표하기 모달") */}
      <AnimatePresence>
        {showFinalVoteModal && (
          <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 overflow-hidden">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-2xl max-h-[85vh] md:max-h-[80vh] shadow-2xl flex flex-col border border-indigo-100 relative overflow-hidden text-left"
            >
              {/* Top Accent Line */}
              <div className="h-2 bg-gradient-to-r from-amber-400 via-indigo-600 to-indigo-700 shrink-0" />

              {/* Fixed Header */}
              <div className="p-5 md:px-6 md:pt-5 md:pb-4 border-b border-slate-100 shrink-0 space-y-3 bg-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center font-bold border border-amber-200 shrink-0">
                      ⭐
                    </div>
                    <div>
                      <h3 className="text-base font-extrabold text-slate-900">
                        {roomDetails?.room.decisionMode === 'QUICK'
                          ? '2단계 익명 투표'
                          : '4단계 2차 별 스티커 투표'}
                      </h3>
                      <p className="text-xs text-slate-500 font-medium">생존한 후보 아이디어 중 최종 결과로 채택할 후보에 별 스티커를 붙여주세요.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFinalVoteModal(false)}
                    className="text-slate-400 hover:text-slate-600 transition p-1 rounded-lg hover:bg-slate-100 shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Star Status Display Header Banner */}
                {(() => {
                  const targetWinners = roomDetails?.room.targetWinnerCount || 1;
                  const activeIdeaIds = (roomDetails?.ideas || []).filter(i => i.status === 'ACTIVE').map(i => i.id);
                  const validMyStarVotes = (roomDetails?.myStarVotes || []).filter(id => activeIdeaIds.includes(id));
                  const isSubmitted = Boolean(roomDetails?.isStarVoteSubmitted && validMyStarVotes.length > 0);
                  const validLocalSelected = mySelectedStarIdeaIds.filter(id => activeIdeaIds.includes(id));
                  const currentSelectedCount = isSubmitted ? validMyStarVotes.length : validLocalSelected.length;
                  const remainingStars = Math.max(0, targetWinners - currentSelectedCount);

                  return (
                    <div className="bg-slate-900 text-white p-3 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300">최종 결과 목표: <strong className="text-white">{targetWinners}개</strong></span>
                        <span className="text-slate-600">|</span>
                        <span className="text-amber-300 font-bold">내 별 스티커: ⭐ {targetWinners}개</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="bg-amber-400/20 text-amber-300 px-2.5 py-0.5 rounded-md font-bold border border-amber-400/30">
                          사용한 별: <span className="text-white">{currentSelectedCount}개</span>
                        </span>
                        <span className="bg-white/10 text-slate-200 px-2.5 py-0.5 rounded-md font-bold border border-white/20">
                          남은 별: <span className="text-amber-400">{remainingStars}개</span>
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Scrollable Middle Candidates List */}
              <div className="p-5 md:p-6 overflow-y-auto flex-1 space-y-3 text-left max-h-full">
                {(() => {
                  const targetWinners = roomDetails?.room.targetWinnerCount || 1;
                  const activeIdeas = (roomDetails?.ideas || []).filter(i => i.status === 'ACTIVE');
                  const activeIdeaIds = activeIdeas.map(i => i.id);
                  const validMyStarVotes = (roomDetails?.myStarVotes || []).filter(id => activeIdeaIds.includes(id));
                  const isSubmittedByMe = Boolean(
                    (roomDetails?.isStarVoteSubmitted || validMyStarVotes.length > 0) &&
                    validMyStarVotes.length >= targetWinners
                  );

                  if (activeIdeas.length === 0) {
                    return <p className="text-xs text-slate-400 text-center py-6">투표 가능한 활성 후보가 없습니다.</p>;
                  }

                  return activeIdeas.map(idea => {
                    const isSelectedByMe = isSubmittedByMe
                      ? validMyStarVotes.includes(idea.id)
                      : mySelectedStarIdeaIds.includes(idea.id);
                    const totalStarVotes = (roomDetails?.starVotes?.[idea.id] || 0);

                    return (
                      <div
                        key={idea.id}
                        onClick={() => handleToggleStarIdea(idea.id)}
                        className={`p-4 md:p-4.5 rounded-2xl border transition cursor-pointer flex flex-col space-y-2.5 ${isSelectedByMe
                          ? 'bg-amber-50/70 border-amber-300 ring-2 ring-amber-400/30 shadow-xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50/80 hover:border-slate-300'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="text-sm font-extrabold text-slate-900 tracking-tight">{idea.title}</h4>
                              {isSelectedByMe ? (
                                <span className="text-[10px] font-black text-amber-950 bg-amber-200/90 border border-amber-300/80 px-2 py-0.5 rounded-md flex items-center gap-1">
                                  ★ 내가 선택한 후보
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                                  ☆ 선택 전
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-600 leading-normal line-clamp-3 whitespace-pre-line">
                              {idea.description}
                            </p>
                          </div>

                          {/* Star Toggle Display Button */}
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleStarIdea(idea.id);
                              }}
                              disabled={isSubmittedByMe}
                              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition flex items-center gap-1 ${isSelectedByMe
                                ? 'bg-amber-400 text-slate-950 border border-amber-500 shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
                                } disabled:opacity-80 disabled:cursor-not-allowed`}
                            >
                              <span className="text-sm">{isSelectedByMe ? '★' : '☆'}</span>
                              <span>{isSelectedByMe ? '별 붙임' : '별 붙이기'}</span>
                            </button>

                            {roomDetails?.room.finalVoteStatus === 'FINALIZED' && totalStarVotes > 0 && (
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                                ⭐ {totalStarVotes}표 득표
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 pt-1 border-t border-slate-100/80">
                          <span>제안자: 평가 종료 전 비공개</span>
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">
                            다른 사람의 선택과 중간 집계 비공개
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Fixed Footer with Submission Controls */}
              {(() => {
                const targetWinners = roomDetails?.room.targetWinnerCount || 1;
                const activeIdeaIds = (roomDetails?.ideas || []).filter(i => i.status === 'ACTIVE').map(i => i.id);
                const validMyStarVotes = (roomDetails?.myStarVotes || []).filter(id => activeIdeaIds.includes(id));
                const isSubmitted = Boolean(roomDetails?.isStarVoteSubmitted && validMyStarVotes.length > 0);
                const validLocalSelected = mySelectedStarIdeaIds.filter(id => activeIdeaIds.includes(id));
                const currentSelectedCount = isSubmitted ? validMyStarVotes.length : validLocalSelected.length;
                const remainingStars = Math.max(0, targetWinners - currentSelectedCount);

                return (
                  <div className="p-4 md:px-6 border-t border-slate-100 bg-slate-50 shrink-0 flex items-center justify-between gap-3">
                    <div className="text-xs font-bold text-slate-600 hidden sm:block">
                      {isSubmitted ? (
                        <span className="text-emerald-600 flex items-center gap-1">
                          <Check className="w-4 h-4" />
                          이미 투표가 제출되었습니다
                        </span>
                      ) : remainingStars > 0 ? (
                        <span className="text-amber-700 font-semibold bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                          ⚠️ 평가 기준을 확인한 뒤 최종 후보로 선택할 아이디어 {targetWinners}개에 1위부터 {targetWinners}위까지 순위를 모두 지정해 주세요.
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                          ✓ 별 스티커 순위 지정 완료! 투표를 제출할 수 있습니다.
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => setShowFinalVoteModal(false)}
                        className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition flex-1 sm:flex-none"
                      >
                        닫기
                      </button>

                      {!isSubmitted ? (
                        <button
                          type="button"
                          onClick={handleSubmitStarVote}
                          disabled={remainingStars > 0 || isSubmittingStarVote}
                          className={`px-5 py-2.5 rounded-xl text-xs font-extrabold transition flex-1 sm:flex-none flex items-center justify-center gap-1.5 shadow-md ${remainingStars === 0 && !isSubmittingStarVote
                            ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 border border-amber-500 cursor-pointer active:scale-95'
                            : 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
                            }`}
                        >
                          {isSubmittingStarVote ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              제출 중...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>{remainingStars === 0 ? '별 스티커 투표 제출' : `별 ${remainingStars}개 추가 선택 필요`}</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowFinalVoteModal(false)}
                          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition shadow-md flex items-center justify-center gap-1 flex-1 sm:flex-none"
                        >
                          <Check className="w-4 h-4" />
                          <span>투표 제출 완료됨</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Room Settings Edit Modal (Host Only) */}
      <AnimatePresence>
        {showRoomSettingsModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white p-6 md:p-8 rounded-3xl max-w-lg w-full shadow-2xl space-y-5 text-left"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-slate-900 text-amber-400 rounded-xl flex items-center justify-center font-bold">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900">⚙️ 방 설정 및 정보 수정 (방장 전용)</h3>
                    <p className="text-xs text-slate-400">회의 주제, 참여 인원, 최소 정족수 등 방 정보를 변경합니다.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRoomSettingsModal(false)}
                  className="text-slate-400 hover:text-slate-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleUpdateRoomSettings} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">회의 주제 (방 제목) <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={editRoomTitle}
                    onChange={e => setEditRoomTitle(e.target.value)}
                    placeholder="예: 2026 하반기 신규 서비스 기획 아이디어 선정"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">방 상세 설명 & 핵심 목표</label>
                  <textarea
                    value={editRoomDesc}
                    onChange={e => setEditRoomDesc(e.target.value)}
                    rows={3}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">아이디어 카테고리</label>
                    <select
                      value={editRoomCategory}
                      onChange={e => setEditRoomCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value="기획">💡 기획 / 신규 비즈니스</option>
                      <option value="디자인">🎨 디자인 / UX·UI</option>
                      <option value="개발">💻 개발 / IT 파이프라인</option>
                      <option value="마케팅">📢 마케팅 / 바이럴</option>
                      <option value="기타">📂 기타</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">최종 우승작 선정 개수</label>
                    <select
                      value={editRoomTargetWinnerCount}
                      onChange={e => setEditRoomTargetWinnerCount(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value={1}>🏆 1개 아이디어 확정</option>
                      <option value={2}>🏆 2개 아이디어 확정</option>
                      <option value={3}>🏆 3개 아이디어 확정</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">최대 정원 (최대 6명)</label>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={editRoomMaxParticipants}
                      onChange={e => setEditRoomMaxParticipants(Number(e.target.value))}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">익명 안심 최소 정족수</label>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={editRoomMinThreshold}
                      onChange={e => setEditRoomMinThreshold(Number(e.target.value))}
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowRoomSettingsModal(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdatingRoomSettings}
                    className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-extrabold transition shadow-md flex items-center gap-1.5"
                  >
                    {isUpdatingRoomSettings ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        저장 중...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5 text-amber-400" />
                        방 정보 변경 사항 저장
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

