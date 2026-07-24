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
  Trash
} from 'lucide-react';
import { 
  Room, 
  RoomStatus, 
  Idea, 
  Criterion, 
  CriterionProposal, 
  Evaluation, 
  EliminationRound, 
  RoomDetails 
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

  // Password validation helper: 소문자 및 숫자로만 구성, 최대 15자
  const isPasswordValid = useMemo(() => {
    if (!authPassword) return false;
    const isValidCharAndLength = /^[a-z0-9]{1,15}$/.test(authPassword);
    const hasLowercase = /[a-z]/.test(authPassword);
    const hasDigit = /[0-9]/.test(authPassword);
    return isValidCharAndLength && hasLowercase && hasDigit;
  }, [authPassword]);

  // Email validation helper: 이메일 형식 검사
  const isEmailValid = useMemo(() => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail.trim());
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

    if (!isEmailValid) {
      setAuthError(failMsg);
      triggerToast(failMsg, 'error');
      return;
    }

    const trimmedEmail = authEmail.trim().toLowerCase();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });

      if (error) throw error;

      const user = data.user;
      const uName = user.user_metadata?.full_name || user.email?.split('@')[0] || '사용자';
      saveLocalRegisteredUser(authEmail.trim(), authPassword, uName, user.id);

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
        setUserEmail(authEmail.trim());
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
  const [roomFilterStatus, setRoomFilterStatus] = useState<'ALL' | 'IN_PROGRESS' | 'CLOSED'>('ALL');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomDetails, setRoomDetails] = useState<RoomDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // ----------------------------------------------------------------
  // Forms & Interactive UI states (ENTRY-02, IDEA-02, IDEA-03)
  // ----------------------------------------------------------------
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [newRoomCategory, setNewRoomCategory] = useState<'기획' | '디자인'>('기획');
  const [newRoomMaxParticipants, setNewRoomMaxParticipants] = useState(4);
  const [newRoomTargetWinners, setNewRoomTargetWinners] = useState(1);
  const [newRoomIsPublic, setNewRoomIsPublic] = useState(true);
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

  // Copy Link feedback
  const [copied, setCopied] = useState(false);

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

    // URL 쿼리 파라미터에서 roomId를 분석하여 방에 자동 입장 처리 (팀원 초대 링크 지원)
    const params = new URLSearchParams(window.location.search);
    const urlRoomId = params.get('roomId');
    if (urlRoomId) {
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

  const fetchRooms = async () => {
    try {
      const res = await fetch('/api/rooms');
      const data = await res.json();
      setRoomsList(data);
    } catch (err) {
      console.error('Error fetching rooms:', err);
    }
  };

  const fetchRoomDetails = async (id: string, isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch(`/api/rooms/${id}?userId=${userId}`);
      if (!res.ok) throw new Error('방 세부사항 로드 실패');
      const data: RoomDetails = await res.json();
      setRoomDetails(data);
      
      // If we are in CRITERIA_REVIEW, populate editable candidates
      if (data.room.status === 'CRITERIA_REVIEW' && editableCriteria.length === 0) {
        setEditableCriteria(data.criteria);
      }
    } catch (err) {
      console.error('Error fetching room details:', err);
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

  // Create Room (ENTRY-02)
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn) {
      setShowLoginModal(true);
      return;
    }
    if (!newRoomTitle.trim()) return;

    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newRoomTitle,
          description: newRoomDesc,
          category: newRoomCategory,
          maxParticipants: Math.min(newRoomMaxParticipants, 6),
          targetWinnerCount: newRoomTargetWinners,
          isPublic: newRoomIsPublic,
          hostId: userId,
          minResponseThreshold: newRoomThreshold,
          eliminationConfig: { countPerRound: 1, tieBreak: 'random' },
        }),
      });

      if (!res.ok) throw new Error();
      const created = await res.json();
      
      triggerToast('회의방이 성공적으로 생성되었습니다!');
      setIsCreatingRoom(false);
      setNewRoomTitle('');
      setNewRoomDesc('');
      setNewRoomThreshold(3);
      
      // Select the newly created room & fetch details immediately
      setActiveRoomId(created.id);
      fetchRoomDetails(created.id);
      fetchRooms();
    } catch (err) {
      triggerToast('방 생성 도중 오류가 발생했습니다.', 'error');
    }
  };

  // Toggle Room Pin (ENTRY-03)
  const handleTogglePin = async (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/rooms/${roomId}/pin`, { method: 'POST' });
      if (res.ok) {
        fetchRooms();
      }
    } catch (err) {
      console.error(err);
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

  // Submit Idea (IDEA-02 & IDEA-03)
  const handleSubmitIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ideaTitle.trim() || !ideaDesc.trim()) {
      triggerToast('제목과 내용을 모두 작성해 주세요.', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/ideas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: ideaTitle,
          description: ideaDesc,
          attachmentUrl: ideaLink,
          pdfAttachmentUrl: ideaPdfName,
          tags: ideaTags ? ideaTags.split(',').map(t => t.trim()).filter(Boolean) : [],
          submitterId: userId,
          submitterName: nickname,
        }),
      });

      if (!res.ok) throw new Error();
      triggerToast('아이디어가 성공적으로 등록되었습니다!');
      setIdeaTitle('');
      setIdeaDesc('');
      setIdeaLink('');
      setIdeaPdfName('');
      setIdeaTags('');
      fetchRoomDetails(activeRoomId!);
    } catch (err) {
      triggerToast('아이디어 등록 실패', 'error');
    }
  };

  // Propose Criterion (Anonymous)
  const handleProposeCriterion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposalText.trim()) return;

    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/criteria/propose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: proposalText,
          proposerId: userId,
        }),
      });

      if (!res.ok) throw new Error();
      triggerToast('평가 기준 제안이 익명으로 제출되었습니다!');
      setProposalText('');
      fetchRoomDetails(activeRoomId!);
    } catch (err) {
      triggerToast('기준 제안 제출 실패', 'error');
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
    try {
      const res = await fetch(`/api/rooms/${activeRoomId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      triggerToast(`방 상태를 강제로 [${status}]로 변경했습니다.`);
      fetchRoomDetails(activeRoomId!);
    } catch (err) {
      triggerToast('상태 강제 변경 실패', 'error');
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
                        className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-sm transition"
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

                {/* Filter buttons (ENTRY-01) */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setRoomFilterStatus('ALL')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${
                      roomFilterStatus === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    전체
                  </button>
                  <button
                    onClick={() => setRoomFilterStatus('IN_PROGRESS')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${
                      roomFilterStatus === 'IN_PROGRESS' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    진행 중
                  </button>
                  <button
                    onClick={() => setRoomFilterStatus('CLOSED')}
                    className={`text-xs font-bold px-3 py-1 rounded-lg transition ${
                      roomFilterStatus === 'CLOSED' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    완료
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
                      if (roomFilterStatus === 'IN_PROGRESS') return room.status !== 'CLOSED';
                      if (roomFilterStatus === 'CLOSED') return room.status === 'CLOSED';
                      return true;
                    })
                    .sort((a, b) => {
                      // ENTRY-03: Pin logic - pinned rooms first (up to 3)
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
                      } else if (room.status === 'CRITERIA_PROPOSAL') {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/50">🗳️ 평가기준 제안</span>;
                      } else if (room.status === 'CRITERIA_REVIEW') {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/50">⚖️ 기준 검토</span>;
                      } else if (room.status === 'EVALUATION') {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200/50">🔒 익명 평가 중</span>;
                      } else if (room.status === 'ELIMINATION') {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200/50">✂️ 단계적 소거 중</span>;
                      } else if (room.status === 'CLOSED') {
                        statusBadge = <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-900 text-white border border-slate-900">🎉 종료 (최종선정)</span>;
                      }

                      const pinnedCount = roomsList.filter(r => r.isPinned).length;

                      return (
                        <motion.div
                          key={room.id}
                          whileHover={{ y: -2 }}
                          onClick={() => handleSelectRoom(room.id)}
                          className={`p-5 rounded-2xl border transition flex flex-col justify-between cursor-pointer group relative ${
                            room.isPinned 
                              ? 'bg-amber-50/40 border-amber-300/80 shadow-md' 
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
                              
                              {/* ENTRY-03 Pin icon button */}
                              <button
                                onClick={(e) => {
                                  if (!room.isPinned && pinnedCount >= 3) {
                                    triggerToast('고정은 최대 3개까지만 가능합니다.', 'error');
                                    e.stopPropagation();
                                    return;
                                  }
                                  handleTogglePin(e, room.id);
                                }}
                                title={room.isPinned ? '고정 해제' : '상단 고정 (최대 3개)'}
                                className={`p-1.5 rounded-full transition ${
                                  room.isPinned ? 'text-amber-500 bg-amber-100 hover:bg-amber-200' : 'text-slate-300 hover:text-amber-500 hover:bg-slate-100'
                                }`}
                              >
                                📌
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
                              <span>💡 아이디어 {room.ideasCount}개</span>
                              <span>•</span>
                              <span>👥 참여 {room.evaluatorsCount}/{room.maxParticipants || 10}명</span>
                            </div>
                            <span className="text-slate-400 group-hover:text-indigo-600 flex items-center gap-0.5 font-bold transition">
                              참여
                              <ChevronRight className="w-3.5 h-3.5" />
                            </span>
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
                            onClick={copyShareLink}
                            className="text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full transition flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" />
                            링크 공유
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
                        <div className="text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1 rounded-full shrink-0">
                          👥 참여 {roomDetails.evaluatorsCount}명 / 최소 {roomDetails.room.minResponseThreshold}명
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
                    
                    {/* Left: Ideas List */}
                    <div className="lg:col-span-7 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                          제출된 아이디어 목록 ({roomDetails.ideas.length}개)
                        </h2>
                        <span className="text-xs text-slate-400 font-medium">※ 실명 기재로 전체 공개됩니다.</span>
                      </div>

                      {roomDetails.ideas.length === 0 ? (
                        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/80">
                          <PlusCircle className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                          <p className="text-sm font-bold text-slate-500">아직 제출된 아이디어가 없습니다.</p>
                          <p className="text-xs text-slate-400 mt-1">우측 등록 양식을 통해 기획안을 먼저 등록해 주세요.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {roomDetails.ideas.map((idea) => (
                            <motion.div
                              key={idea.id}
                              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3"
                            >
                              <div className="flex items-center justify-between">
                                <h3 className="text-base font-bold text-slate-950">{idea.title}</h3>
                                <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full flex items-center gap-1">
                                  <User className="w-3 h-3 text-slate-400" />
                                  {idea.submitterName}
                                </span>
                              </div>
                              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                                {idea.description}
                              </p>
                              {idea.tags && idea.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                  {idea.tags.map((tag, tIdx) => (
                                    <span key={tIdx} className="text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-md">
                                      #{tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500 pt-1">
                                {idea.attachmentUrl && (
                                  <div>
                                    🔗 참고 링크: <a href={idea.attachmentUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline hover:text-indigo-800">{idea.attachmentUrl}</a>
                                  </div>
                                )}
                                {idea.pdfAttachmentUrl && (
                                  <div>
                                    📄 첨부파일: <span className="text-slate-800 underline">{idea.pdfAttachmentUrl}</span>
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
                        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
                          내 아이디어 등록하기
                        </h2>

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
                            <label className="text-xs font-bold text-slate-700">카테고리 태그 (IDEA-03, 쉼표로 구분)</label>
                            <input
                              type="text"
                              value={ideaTags}
                              onChange={e => setIdeaTags(e.target.value)}
                              placeholder="예: 마케팅, 숏폼, 챌린지"
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
                            <label className="text-xs font-bold text-slate-700">참고 파일(PDF) 첨부 (IDEA-02)</label>
                            <input
                              type="file"
                              accept=".pdf"
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) setIdeaPdfName(file.name);
                              }}
                              className="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                            />
                          </div>

                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-slate-500 leading-relaxed">
                            💡 **공개 원칙**: 다른 참여자들에게 내 실명(<strong>{nickname}</strong>)과 작성 글이 상시 투명하게 공개됩니다.
                          </div>

                          <button
                            type="submit"
                            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-sm"
                          >
                            아이디어 올리기
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
                    
                    {/* Left: Input Proposal Form */}
                    <div className="lg:col-span-7 space-y-4">
                      <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div className="border-b border-slate-100 pb-2">
                          <h2 className="text-base font-bold text-slate-900">평가 기준 익명 제안</h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            "이 아이디어들을 필터링할 때 어떤 기준을 중요하게 검토해야 하는가?" 의견을 익명으로 솔직히 제안해 주세요.
                          </p>
                        </div>

                        <form onSubmit={handleProposeCriterion} className="space-y-4">
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-slate-700">제안할 기준 의견</label>
                            <textarea
                              required
                              value={proposalText}
                              onChange={e => setProposalText(e.target.value)}
                              placeholder="예: 예산 한계인 1,500만원 내로 준비가 가능한지 여부 / 다른 마케팅 채널과 동시 병행하기 너무 바쁘지 않은 범위인지"
                              rows={4}
                              className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                            />
                          </div>

                          <div className="bg-emerald-50 text-emerald-800 p-3.5 rounded-xl text-xs leading-relaxed border border-emerald-100">
                            🔒 **익명 보장**: 방장이나 다른 팀원을 포함한 그 누구도 누가 이 기준을 제안했는지 절대 추적할 수 없습니다. 어투나 문법에 얽매이지 않고 자유롭게 우려사항을 포함해 적어 주십시오.
                          </div>

                          <button
                            type="submit"
                            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition shadow-sm"
                          >
                            익명 제안 등록하기
                          </button>
                        </form>
                      </div>
                    </div>

                    {/* Right: Progress Tracker & Clustering triggering (Host-only) */}
                    <div className="lg:col-span-5 space-y-6">
                      <div className="bg-white p-5 md:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <h2 className="text-base font-bold text-slate-900">제안 현황</h2>
                        
                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-600">현재 수집된 익명 기준 제안 수:</span>
                          <span className="text-lg font-black text-slate-900">{roomDetails.proposalsCount}개</span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-normal">
                          ※ 개별 제안의 원문은 익명성 유지를 위해 이곳에 직접 나열되지 않으며, 충분한 제안이 모이면 AI가 유사 맥락을 모아 분류 및 병합 요약합니다.
                        </p>
                      </div>

                      {/* Host Control: Triggers Clustering */}
                      {roomDetails.room.hostId === userId && (
                        <div className="bg-slate-900 text-white p-5 md:p-6 rounded-2xl space-y-4 shadow-md">
                          <h3 className="text-sm font-bold flex items-center gap-1.5 text-amber-400">
                            <Sparkles className="w-4 h-4" />
                            AI 의사수렴 분류기 가동 (방장 전용)
                          </h3>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            팀원들의 기준 수집이 끝났다면 AI에게 중복 제거 및 클러스터링 분석을 명령하십시오. Gemini 모델이 의견들을 병합하여 깔끔한 **3~5개의 대표 평가 기준** 리스트로 정립합니다.
                          </p>
                          <button
                            onClick={handleTriggerClustering}
                            disabled={roomDetails.proposalsCount === 0 || loading}
                            className="w-full py-2.5 bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-50 transition rounded-xl text-xs font-bold flex items-center justify-center gap-1 shadow-sm"
                          >
                            {loading ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                AI 의견 수렴 분석 중...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                                AI 기준 클러스터링 가동
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
                    type="email"
                    required
                    value={authEmail}
                    onChange={e => { setAuthEmail(e.target.value); setAuthError(null); }}
                    placeholder="user@example.com"
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
    </div>
  );
}
