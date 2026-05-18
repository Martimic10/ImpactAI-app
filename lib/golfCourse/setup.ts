import type {
  ActiveCourseScorecard,
  GameSetup,
  Hole,
  HoleSelection,
  TeeSet,
} from '@/lib/golfCourse/types';

export function sumPar(holes: Hole[]): number {
  return holes.reduce((s, h) => s + h.par, 0);
}

export function sumYards(holes: Hole[]): number {
  return holes.reduce((s, h) => s + h.yardage, 0);
}

export function availableHoleSelections(teeSet: TeeSet | null): HoleSelection[] {
  if (!teeSet) return ['18'];
  const n = teeSet.holeCount;
  if (n >= 18) return ['front9', 'back9', '18'];
  if (n >= 9) return ['front9'];
  return ['front9'];
}

export function isHoleSelectionEnabled(teeSet: TeeSet | null, selection: HoleSelection): boolean {
  return availableHoleSelections(teeSet).includes(selection);
}

export function applyHoleSelection(teeSet: TeeSet, selection: HoleSelection): Hole[] {
  const holes = teeSet.holes;
  if (holes.length >= 18) {
    if (selection === 'front9') return holes.slice(0, 9);
    if (selection === 'back9') return holes.slice(9, 18);
    return holes.slice(0, 18);
  }
  return holes.slice(0, Math.min(9, holes.length));
}

export function holeSelectionLabel(selection: HoleSelection): string {
  if (selection === 'front9') return 'Front 9';
  if (selection === 'back9') return 'Back 9';
  return '18 Holes';
}

export function formatCourseLocation(city: string, state: string): string {
  if (city && state) return `${city}, ${state}`;
  return city || state || '';
}

export function formatTeeRowValue(tee: TeeSet): string {
  const rating =
    tee.rating != null && tee.slope != null
      ? ` · ${tee.rating}/${tee.slope}`
      : tee.rating != null
        ? ` · ${tee.rating}`
        : '';
  return `${tee.name} (${tee.totalYards.toLocaleString()} yds · Par ${tee.par})${rating}`;
}

export function formatCourseMeta(setup: ActiveCourseScorecard): string {
  const holes = setup.selectedHoles.length;
  const yds = sumYards(setup.selectedHoles);
  const sel = holeSelectionLabel(setup.holeSelection);
  return `${sel} · ${setup.teeSet.name} Tees (${yds.toLocaleString()} yds)`;
}

export function resolveActiveScorecard(setup: GameSetup): ActiveCourseScorecard | null {
  if (!setup.course || !setup.teeSet || setup.selectedHoles.length === 0) return null;
  return {
    course: setup.course,
    teeSet: setup.teeSet,
    holeSelection: setup.holeSelection,
    selectedHoles: setup.selectedHoles,
    isDemo: setup.isDemo,
    usingFallback: setup.usingFallback,
  };
}

export function patchSetupWithTee(setup: GameSetup, teeSet: TeeSet): GameSetup {
  const holeSelection = isHoleSelectionEnabled(teeSet, setup.holeSelection)
    ? setup.holeSelection
    : availableHoleSelections(teeSet)[0] ?? 'front9';
  const selectedHoles = applyHoleSelection(teeSet, holeSelection);
  return { ...setup, teeSet, holeSelection, selectedHoles, isDemo: false };
}

export function patchSetupWithHoles(setup: GameSetup, holeSelection: HoleSelection): GameSetup {
  if (!setup.teeSet) return setup;
  const selectedHoles = applyHoleSelection(setup.teeSet, holeSelection);
  return { ...setup, holeSelection, selectedHoles };
}
