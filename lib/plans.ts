import { User, Plan } from '@/types';

const ELEVATED_ROLES = ['founder', 'admin'];

export function hasProAccess(user: User | null): boolean {
  if (!user) return false;
  return (
    user.plan === 'pro' ||
    user.plan === 'admin' ||
    ELEVATED_ROLES.includes(user.role)
  );
}

export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  return user.plan === 'admin' || user.role === 'admin';
}

export function isFounder(user: User | null): boolean {
  if (!user) return false;
  return user.role === 'founder';
}

export type LeaderboardMetric = 'score' | 'streak' | 'swings';
export type LeaderboardScopeId = 'weekly' | 'monthly' | 'friends' | 'global';

/** Free tier can start these games without Pro. */
export const FREE_GAME_IDS = ['closest_pin', 'match_play', 'par3'] as const;

export const FREE_LIMITS = {
  swingsPerDay: 3,
  coachMessagesPerDay: 5,
  leaderboardMetric: 'score' as LeaderboardMetric,
  leaderboardScope: 'weekly' as LeaderboardScopeId,
};

export const PLAN_LIMITS: Record<Plan, { swingsPerDay: number; slowMotion: boolean }> = {
  free: { swingsPerDay: FREE_LIMITS.swingsPerDay, slowMotion: false },
  pro: { swingsPerDay: Infinity, slowMotion: true },
  admin: { swingsPerDay: Infinity, slowMotion: true },
};

export function getPlanLimits(user: User | null) {
  if (hasProAccess(user)) return PLAN_LIMITS.pro;
  return PLAN_LIMITS.free;
}

export const PLAN_LABELS: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  admin: 'Admin',
};

export function isFreeGame(gameId: string): boolean {
  return (FREE_GAME_IDS as readonly string[]).includes(gameId);
}

export function requiresProForGame(gameId: string): boolean {
  return !isFreeGame(gameId);
}

export function canUseLeaderboardMetric(_isPro: boolean, _mode: LeaderboardMetric): boolean {
  return true;
}

export function canUseLeaderboardScope(isPro: boolean, scope: LeaderboardScopeId): boolean {
  return isPro || scope === FREE_LIMITS.leaderboardScope;
}

export function getCoachMessageLimit(isPro: boolean): number {
  return isPro ? Infinity : FREE_LIMITS.coachMessagesPerDay;
}
