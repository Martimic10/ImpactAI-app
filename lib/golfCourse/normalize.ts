import type { Course, CourseSearchResult, Hole, TeeSet } from '@/lib/golfCourse/types';

type ApiLocation = {
  address?: string;
  city?: string;
  state?: string;
  country?: string;
};

type ApiSearchCourse = {
  id: number;
  club_name?: string;
  course_name?: string;
  location?: ApiLocation;
};

type ApiHole = {
  par?: number;
  yardage?: number;
  handicap?: number;
};

type ApiTee = {
  tee_name?: string;
  course_rating?: number;
  slope_rating?: number;
  total_yards?: number;
  number_of_holes?: number;
  par_total?: number;
  holes?: ApiHole[];
};

type ApiCourseDetail = {
  id: number;
  club_name?: string;
  course_name?: string;
  location?: ApiLocation;
  tees?: {
    female?: ApiTee[];
    male?: ApiTee[];
  };
};

function parseAddressParts(address?: string): { city: string; state: string; country: string } {
  if (!address) return { city: '', state: '', country: '' };
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length >= 3) {
    const country = parts[parts.length - 1] ?? '';
    const stateZip = parts[parts.length - 2] ?? '';
    const city = parts[parts.length - 3] ?? '';
    const state = stateZip.split(/\s+/)[0] ?? stateZip;
    return { city, state, country };
  }
  return { city: parts[0] ?? '', state: '', country: parts[parts.length - 1] ?? '' };
}

function locationFields(loc?: ApiLocation) {
  if (loc?.city) {
    return {
      city: loc.city,
      state: loc.state ?? '',
      country: loc.country ?? '',
    };
  }
  return parseAddressParts(loc?.address);
}

function normalizeHoles(raw: ApiHole[] | undefined, holeCount: number): Hole[] {
  if (!raw?.length) return [];
  return raw.map((h, i) => ({
    number: i + 1,
    par: Number(h.par) || 4,
    handicap: Number(h.handicap) || i + 1,
    yardage: Number(h.yardage) || 0,
  })).slice(0, holeCount);
}

function normalizeTee(
  raw: ApiTee,
  courseId: string,
  gender: 'male' | 'female',
  index: number,
): TeeSet | null {
  const name = raw.tee_name?.trim() || 'Tee';
  const holes = normalizeHoles(raw.holes, Number(raw.number_of_holes) || raw.holes?.length || 18);
  if (holes.length === 0) return null;

  const totalYards =
    Number(raw.total_yards) ||
    holes.reduce((sum, h) => sum + h.yardage, 0);
  const par =
    Number(raw.par_total) ||
    holes.reduce((sum, h) => sum + h.par, 0);

  return {
    id: `${courseId}-${gender}-${index}-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    color: name,
    totalYards,
    rating: raw.course_rating != null ? Number(raw.course_rating) : undefined,
    slope: raw.slope_rating != null ? Number(raw.slope_rating) : undefined,
    par,
    holeCount: holes.length,
    holes,
  };
}

export function normalizeSearchCourse(raw: ApiSearchCourse): CourseSearchResult {
  const loc = locationFields(raw.location);
  const name = raw.course_name?.trim() || raw.club_name?.trim() || 'Golf Course';
  return {
    id: String(raw.id),
    name,
    clubName: raw.club_name,
    city: loc.city,
    state: loc.state,
    country: loc.country,
    holes: 18,
  };
}

export function normalizeCourseDetail(raw: ApiCourseDetail): Course {
  const loc = locationFields(raw.location);
  const name = raw.course_name?.trim() || raw.club_name?.trim() || 'Golf Course';
  const courseId = String(raw.id);

  const teeSets: TeeSet[] = [];
  const pushTees = (list: ApiTee[] | undefined, gender: 'male' | 'female') => {
    (list ?? []).forEach((t, i) => {
      const tee = normalizeTee(t, courseId, gender, i);
      if (tee) teeSets.push(tee);
    });
  };
  pushTees(raw.tees?.male, 'male');
  pushTees(raw.tees?.female, 'female');

  const maxHoles = teeSets.reduce((m, t) => Math.max(m, t.holeCount), 0);

  return {
    id: courseId,
    name,
    clubName: raw.club_name,
    city: loc.city,
    state: loc.state,
    country: loc.country,
    holes: maxHoles || 18,
    teeSets,
  };
}
