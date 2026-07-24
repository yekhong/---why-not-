export type RoomStatus =
  | 'DRAFT'
  | 'IDEA_SUBMISSION'
  | 'CRITERIA_PROPOSAL'
  | 'CRITERIA_REVIEW'
  | 'EVALUATION'
  | 'ELIMINATION'
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
  category?: '기획' | '디자인' | '기타' | string;
  isPublic?: boolean;
  maxParticipants?: number;
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
  clusterId?: string;
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

export interface RoomDetails {
  room: Room;
  ideas: Idea[];
  criteria: Criterion[];
  proposalsCount: number;
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
  // If threshold is met, we might send aggregated scores or AI-rephrased comments:
  aggregatedScores?: Record<string, {
    score: number;
    keepCount: number;
    neutralCount: number;
    excludeCount: number;
    objectiveExcludeCount: number;
  }>;
  aiSummarizedComments?: Record<string, {
    objectiveComments: string[];
    preferenceComments: string[];
  }>;
}
