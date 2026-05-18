export type Plan = 'free' | 'pro' | 'admin';

export interface User {
  id: string;
  email: string;
  username: string;
  plan: Plan;
  role: string;
  avatar_url?: string;
}

export interface SwingScores {
  overallScore: number;    // 1-100 — weighted formula, not AI-invented
  // v3 categories
  positionScore: number;   // setup + top + impact geometry
  tempoScore: number;      // backswing/downswing ratio — deterministic
  sequenceScore: number;   // body-arm timing, kinematic order
  stabilityScore: number;  // head movement, posture retention, balance
  contactScore: number;    // impact posture, low-point, delivery
  confidence: number;      // 1-10 (analysis confidence)
  // Legacy — kept so old saved swings still render
  setupScore?: number;
  postureScore?: number;
  swingPathScore?: number;
  balanceScore?: number;
}

// v4 — granular per-category scoring with confidence + explainability.
// Populated alongside the legacy SwingScores so old screens keep rendering,
// while new UI can opt in to the richer breakdown.
export interface SwingCategoryScoreV4 {
  key: string;            // 'setup' | 'balance' | 'tempo' | 'rotation' | 'swingPath' | 'impactPosition' | 'followThrough'
  name: string;           // user-facing label
  score: number;          // 0-100 (after confidence adjustment)
  rawScore: number;       // 0-100 (before confidence adjustment)
  weight: number;         // 0-1
  confidence: number;     // 0-1
  reason: string;
  topIssue?: string;
  suggestedFix?: string;
  metrics: Record<string, number | null>;
  penalties: Array<{
    metric: string;
    value: number;
    ideal: string;
    penalty: number;
    severity: 'minor' | 'moderate' | 'severe';
    fault: string;
    fix: string;
  }>;
}

export interface SwingScoringV4 {
  overallScore: number;
  band: 'excellent' | 'strong' | 'solid' | 'needs-work' | 'major-issues' | 'poor';
  bandLabel: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;          // 0-1
  isLeaderboardEligible: boolean;
  warnings: string[];
  topFaults: string[];
  club: { selected: string; group: string };
  categories: Record<string, SwingCategoryScoreV4>;
  phaseValidation: {
    valid: boolean;
    warnings: string[];
    havePhases: { setup: boolean; top: boolean; impact: boolean; finish: boolean };
  };
}

export interface SwingScoreReasoning {
  // v3 field names
  position?: string;
  tempo?: string;
  sequence?: string;
  stability?: string;
  contact?: string;
  // Legacy v2 field names — kept so old saved swings still render
  setup?: string;
  posture?: string;
  swingPath?: string;
  balance?: string;
}

export interface TemporalMetrics {
  backswingDurationMs: number | null;
  downswingDurationMs: number | null;
  tempoRatio: number | null;          // backswing / downswing (3:1 = ideal tour tempo)
  motionSmoothness: number | null;    // 0-100, higher = smoother
  computedTempoScore: number | null;  // deterministic score from ratio
}

export interface SwingResult {
  selectedClub: string;
  detectedClubType: string;
  clubMatch: 'match' | 'possible_mismatch' | 'unclear';
  clubMatchReason: string;
  cameraAngle: 'down-the-line' | 'face-on' | 'unclear';
  scores?: SwingScores;
  scoreReasoning?: SwingScoreReasoning;
  scoringV4?: SwingScoringV4;          // v4 — deterministic breakdown
  temporalMetrics?: TemporalMetrics;
  // Legacy
  confidence?: number;
  primaryIssue: string;
  issueCategory: string;
  whyItHappens: string;
  ballFlightPrediction: string;
  contactPrediction: string;
  clubSpecificNotes: string;
  evidence: string[];
  fixes: string[];
  drill: {
    name: string;
    whyThisDrill: string;
    steps: string[];
  };
  keyCheckpoints: string[];
  summary: string;
}

// Helper — get the overall 1-100 score from any swing (handles all schema versions)
export function getSwingScore(result: SwingResult | null | undefined): number {
  if (!result) return 50;
  if (typeof result.scoringV4?.overallScore === 'number') {
    return Math.max(0, Math.min(100, Math.round(result.scoringV4.overallScore)));
  }
  if (result.scores?.overallScore) {
    const s = result.scores.overallScore;
    return s <= 10 ? s * 10 : s;
  }
  if (result.confidence) return Math.round(result.confidence * 10);
  return 50;
}

export type SwingPhase = 'setup' | 'top' | 'impact' | 'finish';

export interface PoseLandmark {
  x: number;         // normalized 0-1 (left→right)
  y: number;         // normalized 0-1 (top→bottom)
  z?: number;
  visibility?: number;
}

export interface FrameAnalysis {
  imageUrl: string;
  overlayImageUrl?: string;
  timeMs?: number;
  manualTimeMs?: number; // user-set timestamp — overrides timeMs for video seeking
  phase: SwingPhase;
  label: string;
  coachingNote: string;
  landmarks?: PoseLandmark[];
}

export interface VisualAnalysis {
  setup: FrameAnalysis;
  top: FrameAnalysis;
  impact: FrameAnalysis;
  finish: FrameAnalysis;
}

export type SwingStatus = 'uploaded' | 'processing' | 'completed' | 'failed';
export type OverlayStatus = 'none' | 'processing' | 'completed' | 'failed';

export interface Swing {
  id: string;
  user_id: string;
  video_url: string;
  club?: string;
  status: SwingStatus;
  result_json: SwingResult;
  privacy: 'private' | 'friends';
  created_at: string;
  updated_at?: string;
  overlay_video_url?: string;
  overlay_status?: OverlayStatus;
  thumbnail_url?: string;
  analysis_version?: number;
  last_analyzed_at?: string;
  visual_analysis?: VisualAnalysis;
}

export interface Friend {
  id: string;
  user_id: string;
  friend_id: string;
  friend?: UserProfile;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  sender?: UserProfile;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  plan: Plan;
  avatar_url?: string;
  streak?: number;
  last_active?: string;
  total_swings?: number;
  improvement_score?: number;
}

export interface LeaderboardEntry {
  user: UserProfile;
  score: number;
  streak: number;
  total_swings: number;
  latest_swing?: Swing;
}
