import type { ActiveCourseScorecard, Course, GameSetup, TeeSet } from '@/lib/golfCourse/types';

const DEMO_PAR = [4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 3, 4, 4, 5, 4, 4, 3, 5] as const;
const DEMO_HCP = [9, 11, 7, 3, 13, 1, 17, 15, 5, 10, 18, 2, 8, 12, 4, 14, 16, 6] as const;
const DEMO_YDS = [
  380, 502, 174, 331, 188, 523, 106, 418, 464, 446, 390, 202, 430, 573, 397, 402, 178, 543,
] as const;

function buildHoles(): TeeSet['holes'] {
  return DEMO_PAR.map((par, i) => ({
    number: i + 1,
    par,
    handicap: DEMO_HCP[i],
    yardage: DEMO_YDS[i],
  }));
}

export const DEMO_TEE_WHITE: TeeSet = {
  id: 'demo-white',
  name: 'White',
  color: 'White',
  totalYards: DEMO_YDS.reduce((a, b) => a + b, 0),
  rating: 72.1,
  slope: 142,
  par: DEMO_PAR.reduce((a, b) => a + b, 0),
  holeCount: 18,
  holes: buildHoles(),
};

export const DEMO_COURSE: Course = {
  id: 'demo-pebble',
  name: 'Pebble Beach Golf Links',
  clubName: 'Pebble Beach Golf Links',
  city: 'Pebble Beach',
  state: 'CA',
  country: 'USA',
  holes: 18,
  teeSets: [DEMO_TEE_WHITE],
};

export const DEFAULT_GAME_SETUP: GameSetup = {
  course: DEMO_COURSE,
  teeSet: DEMO_TEE_WHITE,
  holeSelection: '18',
  selectedHoles: DEMO_TEE_WHITE.holes,
  isDemo: true,
  usingFallback: true,
};

export function buildDemoActiveScorecard(): ActiveCourseScorecard {
  return {
    course: DEMO_COURSE,
    teeSet: DEMO_TEE_WHITE,
    holeSelection: '18',
    selectedHoles: DEMO_TEE_WHITE.holes,
    isDemo: true,
    usingFallback: true,
  };
}
