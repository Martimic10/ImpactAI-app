import { User, Plan } from '@/types';

export function hasProAccess(user: User | null): boolean {
  if (!user) return false;
  return user.plan === 'pro' || user.plan === 'admin' || user.role === 'admin';
}

export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  return user.plan === 'admin' || user.role === 'admin';
}

export const PLAN_LIMITS: Record<Plan, { swingsPerDay: number; slowMotion: boolean }> = {
  free: { swingsPerDay: 3, slowMotion: false },
  pro: { swingsPerDay: Infinity, slowMotion: true },
  admin: { swingsPerDay: Infinity, slowMotion: true },
};

export const PLAN_LABELS: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  admin: 'Admin',
};
