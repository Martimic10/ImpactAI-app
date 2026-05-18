import AsyncStorage from '@react-native-async-storage/async-storage';
import { FREE_LIMITS } from '@/lib/plans';

const STORAGE_KEY = '@coach/daily_message_count';

type DailyUsage = { date: string; count: number };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function readUsage(): Promise<DailyUsage> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as DailyUsage;
    if (parsed.date !== todayKey()) return { date: todayKey(), count: 0 };
    return parsed;
  } catch {
    return { date: todayKey(), count: 0 };
  }
}

async function writeUsage(usage: DailyUsage) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
}

export async function getCoachMessagesUsedToday(): Promise<number> {
  const usage = await readUsage();
  return usage.count;
}

export async function incrementCoachMessagesUsed(): Promise<number> {
  const usage = await readUsage();
  const next = { date: todayKey(), count: usage.count + 1 };
  await writeUsage(next);
  return next.count;
}

export function coachMessagesRemaining(isPro: boolean, usedToday: number): number {
  if (isPro) return Infinity;
  return Math.max(0, FREE_LIMITS.coachMessagesPerDay - usedToday);
}

export function canSendCoachMessage(isPro: boolean, usedToday: number): boolean {
  return isPro || usedToday < FREE_LIMITS.coachMessagesPerDay;
}
