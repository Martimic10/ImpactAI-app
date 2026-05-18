/** App-normalized golf course models (not tied to GolfCourseAPI raw shape). */

export type Hole = {
  number: number;
  par: number;
  handicap: number;
  yardage: number;
};

export type TeeSet = {
  id: string;
  name: string;
  color?: string;
  totalYards: number;
  rating?: number;
  slope?: number;
  par: number;
  holeCount: number;
  holes: Hole[];
};

export type Course = {
  id: string;
  name: string;
  clubName?: string;
  city: string;
  state: string;
  country: string;
  holes: number;
  teeSets: TeeSet[];
};

export type HoleSelection = 'front9' | 'back9' | '18';

export type GameSetup = {
  course: Course | null;
  teeSet: TeeSet | null;
  holeSelection: HoleSelection;
  selectedHoles: Hole[];
  isDemo: boolean;
  usingFallback: boolean;
};

/** Resolved scorecard passed into live games. */
export type ActiveCourseScorecard = {
  course: Course;
  teeSet: TeeSet;
  holeSelection: HoleSelection;
  selectedHoles: Hole[];
  isDemo: boolean;
  usingFallback: boolean;
};

export type CourseSearchResult = Pick<Course, 'id' | 'name' | 'city' | 'state' | 'country' | 'holes'> & {
  clubName?: string;
};
