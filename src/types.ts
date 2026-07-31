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
  reasonText?: string;
  reasonType?: 'OBJECTIVE_CONSTRAINT' | 'PREFERENCE';
  round: number;
}

export interface EliminationRound {
  id: string;
  roomId: string;
  roundNumber: number;
  eliminatedIdeaIds: string[];
  aiSummaryText: string;
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
  participants?: Participant[];
  rounds: EliminationRound[];
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
  starVotes?: Record<string, number>; // ideaId -> total star votes count
  myStarVotes?: string[]; // array of selected ideaIds for current user
  isStarVoteSubmitted?: boolean;
  starVoteCount?: number;
  starVoteStatus?: 'voting' | 'tie_pending' | 'finalized';
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
  errorCode?: 'NOT_FOUND' | 'DEACTIVATED' | 'EXPIRED' | 'ROOM_DELETED' | 'ROOM_CLOSED' | 'CAPACITY_FULL' | 'STORE_UNAVAILABLE' | 'ERROR';
  errorMessage?: string;
  // The invite landing page only needs these public display fields. Keeping
  // this type narrow prevents the BFF from accidentally exposing hostId,
  // deadlines, elimination settings, or other room-internal data to anyone
  // who merely possesses a short-lived invite URL.
  room?: Pick<Room, 'id' | 'title' | 'description' | 'category' | 'isPublic' | 'maxParticipants' | 'status'>;
  hostNickname?: string;
  participantCount?: number;
  maxParticipants?: number;
  expiresAt?: string;
  secondsRemaining?: number;
}
