import { buildDemoActiveScorecard } from '@/lib/golfCourse/demoCourse';
import type { ActiveCourseScorecard } from '@/lib/golfCourse/types';
import { formatCourseMeta } from '@/lib/golfCourse/setup';
import { HOLE_PAR, HOLE_SI, HOLE_YDS, SCORECARD_COURSE_META, SCORECARD_COURSE_NAME } from '@/lib/liveScorecardData';

export type RuntimeScorecard = {
  courseName: string;
  metaLine: string;
  holeCount: number;
  holePar: number[];
  holeHandicap: number[];
  holeYards: number[];
  holeNumbers: number[];
};

const FALLBACK_RUNTIME: RuntimeScorecard = {
  courseName: SCORECARD_COURSE_NAME,
  metaLine: SCORECARD_COURSE_META,
  holeCount: HOLE_PAR.length,
  holePar: [...HOLE_PAR],
  holeHandicap: [...HOLE_SI],
  holeYards: [...HOLE_YDS],
  holeNumbers: HOLE_PAR.map((_, i) => i + 1),
};

export function activeScorecardToRuntime(setup: ActiveCourseScorecard): RuntimeScorecard {
  const holes = setup.selectedHoles;
  return {
    courseName: setup.course.name,
    metaLine: formatCourseMeta(setup),
    holeCount: holes.length,
    holePar: holes.map((h) => h.par),
    holeHandicap: holes.map((h) => h.handicap),
    holeYards: holes.map((h) => h.yardage),
    holeNumbers: holes.map((h) => h.number),
  };
}

export function getRuntimeScorecard(setup: ActiveCourseScorecard | null | undefined): RuntimeScorecard {
  if (!setup) return FALLBACK_RUNTIME;
  return activeScorecardToRuntime(setup);
}

export function getDefaultActiveScorecard(): ActiveCourseScorecard {
  return buildDemoActiveScorecard();
}

function sumNums(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

export function runtimeTotals(runtime: RuntimeScorecard): {
  outPar: number | null;
  inPar: number | null;
  totalPar: number;
  outYds: number | null;
  inYds: number | null;
  totalYds: number;
} {
  const n = runtime.holeCount;
  const hasBack = n > 9;
  const outPar = n >= 9 ? sumNums(runtime.holePar.slice(0, 9)) : null;
  const inPar = hasBack ? sumNums(runtime.holePar.slice(9)) : null;
  const outYds = n >= 9 ? sumNums(runtime.holeYards.slice(0, 9)) : null;
  const inYds = hasBack ? sumNums(runtime.holeYards.slice(9)) : null;
  return {
    outPar,
    inPar,
    totalPar: sumNums(runtime.holePar),
    outYds,
    inYds,
    totalYds: sumNums(runtime.holeYards),
  };
}
