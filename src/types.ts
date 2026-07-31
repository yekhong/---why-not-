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
export type FinalVoteStatus = 'NOT_STARTED' | 'VOTING' | 'TIE_PENDING' | 'FINALIZED';

export interface EliminationConfig {
  countPerRound: number;
  ratioPerRound?: number;
  tieBreak: 'random' | 'revote';
}

export interface Deadlines {
  ideaSubmissionAt?: string;
  criteriaProposalAt?: string;
  evaluationAt?: string;
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
<<<<<<< HEAD
=======
  decisionMode?: DecisionMode;
  finalVoteStatus?: FinalVoteStatus;
  tieCandidateIdeaIds?: string[];
  tieSlots?: number;
  currentRoundId?: string;
  criteriaSetVersion?: number;
>>>>>>> f753dd0069db3b2eed0599a255560ddaad17ddef
}

export interface Idea {
  id: string;
  roomId: string;
  title: string;
  description: string;
  attachmentUrl?: string;
  pdfAttachmentUrl?: string;
  tags?: string[];
  submitterId: string;
  submitterName: string;
  status: 'ACTIVE' | 'ELIMINATED' | 'WINNER';
  eliminatedRound?: number;
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
  decision: 'KEEP' | 'NEUTRAL' | 'EXCLUDE';
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
  role?: string;
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
}

export interface AggregatedScore {
  score: number;
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
  createdAt?: string;
}

export interface InviteDetailsResponse {
  isValid: boolean;
  errorCode?: 'NOT_FOUND' | 'DEACTIVATED' | 'EXPIRED' | 'ROOM_DELETED' | 'ROOM_CLOSED' | 'CAPACITY_FULL' | 'ERROR';
  errorMessage?: string;
  room?: Room;
  hostNickname?: string;
  participantCount?: number;
  maxParticipants?: number;
  expiresAt?: string;
  secondsRemaining?: number;
}
