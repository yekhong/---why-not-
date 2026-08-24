export type RoomStatus =
  | 'DRAFT'
  | 'IDEA_SUBMISSION'
  | 'CRITERIA_PROPOSAL'
  | 'CRITERIA_REVIEW'
  | 'EVALUATION'
  | 'ELIMINATION'
  | 'FINAL_VOTE'
  | 'EVALUATION_ROUND_2'
  | 'CLOSED';

export type DecisionMode = 'STRUCTURED' | 'QUICK';
export type ParticipantRole = 'PARTICIPANT' | 'VOTER';
export type InviteType = 'PARTICIPANT' | 'VOTER';
export type FinalVoteStatus =
  | 'NOT_STARTED'
  | 'VOTING'
  | 'TIE_PENDING'
  | 'CONSENT_PENDING'
  | 'ROULETTE_PENDING'
  | 'FINALIZED';

export interface EliminationConfig {
  countPerRound: number;
  ratioPerRound?: number;
  tieBreak: 'random' | 'revote';
}

export interface Deadlines {
  ideaSubmissionAt?: string;
  criteriaProposalAt?: string;
  evaluationAt?: string; // legacy: V11 stored final-vote end time here
  voteStartTime?: string; // legacy: V11 stored final-vote start time here
  finalVoteStartAt?: string;
  finalVoteEndAt?: string;
}

export interface Room {
  id: string;
  title: string;
  description?: string;
  category?: '기획' | '디자인' | string;
  isPublic?: boolean;
  maxParticipants?: number; // max 6
  targetWinnerCount?: number; // 1~3
  isPinned?: boolean;
  hostId: string;
  status: RoomStatus;
  minResponseThreshold: number; // default: 3
  eliminationConfig: EliminationConfig;
  deadlines: Deadlines;
  createdAt: string;
  engineVersion?: number;
  decisionMode?: DecisionMode;
  finalVoteStatus?: FinalVoteStatus;
  tieCandidateIdeaIds?: string[];
  tieSlots?: number;
  currentRoundId?: string;
  currentFinalVoteCycleId?: string;
  criteriaSetVersion?: number;
  externalVotersEnabled?: boolean;
  requiredVoterCount?: number;
  finalVoteRosterLockedAt?: string;
  stateVersion?: string;
}

export interface Idea {
  id: string;
  roomId: string;
  title: string;
  description: string;
  attachmentUrl?: string;
  pdfAttachmentUrl?: string; // legacy filename-only field; V14 keeps it for old data compatibility
  pdfAttachmentPath?: string;
  pdfAttachmentName?: string;
  pdfAttachmentSize?: number;
  tags?: string[];
  submitterId: string;
  submitterName: string;
  status: 'ACTIVE' | 'ELIMINATED' | 'WINNER';
  eliminatedRound?: number;
  winnerSelectionMethod?: 'CUMULATIVE_STAR' | 'ROULETTE' | 'AUTO_ALL';
  evaluationCard?: EvaluationCard;
}

export interface EvaluationCard {
  title: string;
  summary: string;
  criteriaNotes: string[];
  source: 'AI' | 'ORIGINAL_FALLBACK';
}

export interface CriterionProposal {
  id: string;
  roomId: string;
  rawText: string;
  proposerId?: string;
  clusterId?: string;
  isAiSuggested?: boolean;
  sourceType?: 'ai' | 'user';
  updatedAt?: string;
}

export interface Criterion {
  id: string;
  roomId: string;
  name: string;
  description: string;
  sourceClusterId?: string;
  confirmed: boolean;
}

export interface Evaluation {
  id: string;
  roomId: string;
  ideaId: string;
  evaluatorId?: string; // Kept private on the server
  decision?: 'KEEP' | 'NEUTRAL' | 'EXCLUDE';
  overallScore?: number;
  feedbackText?: string;
  excludedCriterionIds?: string[];
  criteriaEvaluations?: Record<string, CriteriaEvaluationValue>;
  reasonText?: string;
  reasonType?: 'OBJECTIVE_CONSTRAINT' | 'PREFERENCE';
  round: number;
  roundId?: string;
}

export type CriteriaEvaluationValue = 'MET' | 'PARTIAL' | 'NOT_MET' | 'UNSURE';

export interface CriterionMetric {
  criterionId: string;
  complianceRate: number;
  validResponseCount: number;
  unsureCount: number;
  unsureRate: number;
  metCount: number;
  partialCount: number;
  notMetCount: number;
}

export interface CriteriaSetApprovalSummary {
  version: number;
  approveCount: number;
  reviseCount: number;
  eligibleCount: number;
  requiredApproveCount: number;
  myVote?: 'APPROVE' | 'REVISE';
  approved: boolean;
  needsRevision?: boolean;
}


export interface EliminationRound {
  id: string;
  roomId: string;
  roundNumber: number;
  eliminatedIdeaIds: string[];
  aiSummaryText: string;
}

export interface DecisionRound {
  id: string;
  roomId: string;
  roundNumber: number;
  decisionMode: DecisionMode;
  status: 'ACTIVE' | 'COMPLETED';
  startedAt: string;
  completedAt?: string;
  evaluationMethod?: 'LEGACY' | 'SCORE_FEEDBACK' | 'SCORE_ONLY';
  aggregationStatus?: 'NOT_STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  resultSnapshot?: Record<string, unknown>;
}

export interface DecisionReport {
  reportText: string;
  selectedReasons: string[];
  majorConcerns: string[];
  unverifiedAssumptions: string[];
  nextValidationTasks: string[];
  modelName: string;
  promptVersion: string;
  generatedAt: string;
}

export interface Participant {
  id?: string;
  roomId: string;
  userId: string;
  nickname: string;
  role?: ParticipantRole;
  isIdeaDone?: boolean;
}

export interface StarVote {
  id?: string;
  roomId: string;
  userId: string;
  selectedIdeaIds: string[];
  createdAt?: string;
}

export interface RoomDetails {
  room: Room;
  ideas: Idea[];
  criteria: Criterion[];
  proposals?: CriterionProposal[];
  proposalsCount: number;
  completedParticipantsCount?: number; // count of unique participants who submitted 1 or more ideas
  criteriaCompletedParticipantsCount?: number;
  criteriaProposalsRevealed?: boolean;
  criteriaApproval?: CriteriaSetApprovalSummary;
  participants?: Participant[];
  rounds: EliminationRound[];
  decisionRounds?: DecisionRound[];
  evaluatorsCount: number;
  myEvaluations?: Evaluation[];
  hasEvaluated: boolean;
  minResponseThresholdMet: boolean;
  evaluationExpectedCount?: number;
  evaluationSubmittedCount?: number;
  allEvaluationsCompleted?: boolean;
  lowReliabilityWarning?: boolean;
  isEvaluationReediting?: boolean;
  scoreConfig: {
    keepWeight: number;
    neutralWeight: number;
    excludeWeight: number;
    objectiveConstraintPenalty: number;
  };
  aiFinalSummary?: string;
  decisionReport?: DecisionReport;
  starVotes?: Record<string, number>; // ideaId -> total star votes count
  myStarVotes?: string[]; // array of selected ideaIds for current user
  isStarVoteSubmitted?: boolean;
  starVoteCount?: number;
  starVoteSubmittedCount?: number;
  starVoteStatus?: 'voting' | 'tie_pending' | 'finalized';
  tieCandidateIdeaIds?: string[];
  tieSlots?: number;
  finalVoteExpectedCount?: number;
  // If threshold is met, we might send aggregated scores or AI-rephrased comments:
  aggregatedScores?: Record<string, AggregatedScore>;
  aiSummarizedComments?: Record<string, {
    objectiveComments: string[];
    preferenceComments: string[];
  }>;
  screeningSummary?: ScreeningSummary;
  anonymousFeedbackByIdea?: Record<string, string[]>;
  scoreRounds?: ScoreRoundResult[];
  activeScorePhase?: 'FIRST' | 'SECOND' | null;
  finalVoteCycle?: FinalVoteCycleState;
  myParticipantRole?: ParticipantRole;
  waitingForFinalVote?: boolean;
  participantCount?: number;
  voterSetup?: VoterSetupState;
  hasMyCriterionProposal?: boolean;
}

export interface VoterSetupState {
  enabled: boolean;
  requiredCount: number;
  registeredCount: number;
  activeCount: number;
  pendingCount: number;
  remainingCount: number;
  rosterLocked: boolean;
  canStartFinalVote: boolean;
  registrations?: Array<{
    userId: string;
    nickname: string;
    status: 'WAITING' | 'ACTIVE';
  }>;
}

export interface AccountRoomInvite {
  id: string;
  roomId: string;
  loginId: string;
  role: ParticipantRole;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELED' | 'EXPIRED';
  createdAt: string;
  acceptedAt?: string;
  canceledAt?: string;
  respondedAt?: string;
}

export interface PendingParticipantAccountInvite {
  id: string;
  roomId: string;
  roomTitle: string;
  invitedBy: string;
  role: 'PARTICIPANT';
  status: 'PENDING';
  roomStatus: RoomStatus;
  createdAt: string;
}

export interface PendingVoterAccountInvite {
  id: string;
  roomId: string;
  roomTitle: string;
  invitedBy: string;
  role: 'VOTER';
  status: 'PENDING';
  roomStatus: RoomStatus;
  finalVoteStatus?: FinalVoteStatus;
  createdAt: string;
}

export type PendingAccountInvite = PendingParticipantAccountInvite | PendingVoterAccountInvite;

export interface ScoreRoundResult {
  roundId: string;
  roundNumber: number;
  parentRoundId?: string;
  phase: 'FIRST' | 'SECOND';
  completed: boolean;
  candidateIdeaIds: string[];
  survivorIdeaIds: string[];
  eliminatedIdeaIds: string[];
  baseSurvivorCount?: number;
  actualSurvivorCount?: number;
  tieExpanded?: boolean;
  boundaryTieIdeaIds?: string[];
  scoreStats: Record<string, {
    totalScore: number;
    responseCount: number;
    survived: boolean;
  }>;
  aiTiebreak?: AiBoundaryTiebreakDecision | { used: false };
  anonymousFeedbackByIdea?: Record<string, string[]>;
}

export interface FinalRouletteDraw {
  drawNumber: number;
  candidateIdeaIds: string[];
  selectedIdeaId: string;
  drawnAt: string;
}

export interface FinalVoteCycleState {
  cycleId: string;
  cycleNumber: number;
  cycleKind: 'INITIAL' | 'TIE_REVOTE';
  status: 'VOTING' | 'CONSENT' | 'ROULETTE' | 'COMPLETED';
  candidateIdeaIds: string[];
  guaranteedWinnerIdeaIds: string[];
  tieCandidateIdeaIds: string[];
  tieSlots: number;
  starBudget: 3;
  mySelectedIdeaIds: string[];
  myBallotSubmitted: boolean;
  submittedCount: number;
  expectedCount: number;
  myRouletteConsent?: boolean;
  consentedCount: number;
  declinedCount: number;
  rouletteDraws: FinalRouletteDraw[];
  nextRouletteDrawNumber: number;
}

export interface AiBoundaryTiebreakDecision {
  used: true;
  selectedIdeaIds: string[];
  eliminatedIdeaIds: string[];
  selectionReasons: Record<string, string>;
  eliminationReasons: Record<string, string>;
  summary: string;
  modelName: string;
  promptVersion: string;
  decidedAt: string;
}

export interface ScreeningSummary {
  recurringStrengths: string[];
  recurringConcerns: string[];
  disagreements: string[];
  aiAvailable: boolean;
}

export type FeedbackReconstructionStatus =
  | 'PROCESSING'
  | 'READY'
  | 'INSUFFICIENT_EVIDENCE'
  | 'UNAVAILABLE';

export interface FeedbackReconstructionComment {
  text: string;
}

export interface FeedbackReconstructionItem {
  status: FeedbackReconstructionStatus;
  comments: FeedbackReconstructionComment[];
}

export interface FeedbackReconstructionResponse {
  roundId: string;
  items: Record<string, FeedbackReconstructionItem>;
}

export interface AggregatedScore {
  score: number;
  totalScore?: number;
  averageScore?: number;
  responseCount?: number;
  survived?: boolean;
  cutoffScore?: number;
  keepCount: number;
  neutralCount: number;
  excludeCount: number;
  objectiveExcludeCount: number;
  avgCriteriaComplianceRatio?: number; // Average criteria compliance percentage (0~100)
  criteriaMatchCounts?: Record<string, number>; // Per-criterion match/approval count
  validResponseCount?: number;
  unsureCount?: number;
  unsureRate?: number;
  criterionMetrics?: Record<string, CriterionMetric>;
}

export interface RoomInvite {
  id?: string;
  roomId: string;
  inviteToken: string;
  createdBy: string;
  expiresAt: string;
  isActive: boolean;
  inviteType?: InviteType;
  createdAt?: string;
}

export interface InviteDetailsResponse {
  isValid: boolean;
  errorCode?: 'NOT_FOUND' | 'DEACTIVATED' | 'EXPIRED' | 'ROOM_DELETED' | 'ROOM_CLOSED' | 'CAPACITY_FULL' | 'VOTER_CAPACITY_FULL' | 'ERROR';
  errorMessage?: string;
  room?: Room;
  hostNickname?: string;
  participantCount?: number;
  maxParticipants?: number;
  inviteType?: InviteType;
  waiting?: boolean;
  canJoinAsVoter?: boolean;
  expiresAt?: string;
  secondsRemaining?: number;
}
