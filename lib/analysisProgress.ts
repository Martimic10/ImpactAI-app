import type { AnalysisProgress } from '@/lib/analysis';

/** Slowly tick progress while a long async step runs (no jumps to the end %). */
export async function runWithProgressTicks<T>(
  onProgress: ((p: AnalysisProgress) => void) | undefined,
  from: number,
  to: number,
  label: string,
  work: () => Promise<T>,
  tickMs = 320,
): Promise<T> {
  if (!onProgress || to <= from) {
    return work();
  }

  let pct = from;
  onProgress({ pct: Math.floor(pct), label });

  const timer = setInterval(() => {
    if (pct < to - 0.6) {
      pct = Math.min(to - 1, pct + 0.45);
      onProgress({ pct: Math.floor(pct), label });
    }
  }, tickMs);

  try {
    return await work();
  } finally {
    clearInterval(timer);
    onProgress({ pct: to, label });
  }
}
