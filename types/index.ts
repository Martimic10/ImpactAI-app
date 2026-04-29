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
  overallScore: number;    // 1-100
  setupScore: number;      // 1-100
  postureScore: number;    // 1-100
  swingPathScore: number;  // 1-100
  tempoScore: number;      // 1-100
  balanceScore: number;    // 1-100
  contactScore: number;    // 1-100
  confidence: number;      // 1-10 (analysis confidence)
}

export interface SwingScoreReasoning {
  setup: string;
  posture: string;
  swingPath: string;
  tempo: string;
  balance: string;
  contact: string;
}

export interface SwingResult {
  selectedClub: string;
  detectedClubType: string;
  clubMatch: 'match' | 'possible_mismatch' | 'unclear';
  clubMatchReason: string;
  cameraAngle: 'down-the-line' | 'face-on' | 'unclear';
  // New structured scoring (v2)
  scores?: SwingScores;
  scoreReasoning?: SwingScoreReasoning;
  // Legacy single score — kept for backwards compat with old saved swings
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

// Helper — get the overall 1-100 score from any swing (old or new schema)
export function getSwingScore(result: SwingResult): number {
  if (result.scores?.overallScore) {
    const s = result.scores.overallScore;
    // Auto-correct if AI returned 1-10 scale instead of 1-100
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
