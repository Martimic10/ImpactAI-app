import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameSetupRow } from '@/components/friends/GameSetupCard';
import { DEMO_COURSE, DEFAULT_GAME_SETUP } from '@/lib/golfCourse/demoCourse';
import {
  fetchCourseDetails,
  filterDemoCourses,
  formatGolfSearchError,
  GolfCourseApiError,
  pingGolfBackend,
  searchCourses,
} from '@/lib/golfCourse/api';
import {
  formatCourseLocation,
  formatTeeRowValue,
  holeSelectionLabel,
  patchSetupWithHoles,
  patchSetupWithTee,
  resolveActiveScorecard,
} from '@/lib/golfCourse/setup';
import type { ActiveCourseScorecard, CourseSearchResult, GameSetup, HoleSelection, TeeSet } from '@/lib/golfCourse/types';

export type CourseSetupSheet = 'course' | 'tee' | 'holes' | null;

export function useGameCourseSetup() {
  const [setup, setSetup] = useState<GameSetup>(DEFAULT_GAME_SETUP);
  const [activeSheet, setActiveSheet] = useState<CourseSetupSheet>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CourseSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [courseLoading, setCourseLoading] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);

  const searchAbortRef = useRef<AbortController | null>(null);
  const searchGenRef = useRef(0);

  const activeScorecard = useMemo(
    () => resolveActiveScorecard(setup) ?? resolveActiveScorecard(DEFAULT_GAME_SETUP)!,
    [setup],
  );

  const setupRows: GameSetupRow[] = useMemo(() => {
    const course = setup.course ?? DEMO_COURSE;
    const loc = formatCourseLocation(course.city, course.state);
    const courseValue = loc ? `${course.name} · ${loc}` : course.name;
    const teeValue = setup.teeSet ? formatTeeRowValue(setup.teeSet) : 'Select tees';
    const holesValue = holeSelectionLabel(setup.holeSelection);
    return [
      { key: 'course', label: 'Course', value: courseValue },
      { key: 'tee', label: 'Tees', value: teeValue },
      { key: 'holes', label: 'Holes', value: holesValue },
    ];
  }, [setup]);

  const demoSearchPool: CourseSearchResult[] = useMemo(
    () => [
      {
        id: DEMO_COURSE.id,
        name: DEMO_COURSE.name,
        clubName: DEMO_COURSE.clubName,
        city: DEMO_COURSE.city,
        state: DEMO_COURSE.state,
        country: DEMO_COURSE.country,
        holes: DEMO_COURSE.holes,
      },
    ],
    [],
  );

  useEffect(() => {
    if (activeSheet !== 'course') return undefined;
    let cancelled = false;
    void pingGolfBackend().then((ok) => {
      if (!cancelled) setBackendReachable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSheet]);

  const runSearch = useCallback(
    async (query: string) => {
      const q = query.trim();
      setSearchQuery(q);
      if (q.length < 2) {
        searchAbortRef.current?.abort();
        setSearchResults([]);
        setSearchError(null);
        return;
      }

      searchAbortRef.current?.abort();
      const ac = new AbortController();
      searchAbortRef.current = ac;
      const gen = ++searchGenRef.current;

      setSearchLoading(true);
      setSearchError(null);
      try {
        const results = await searchCourses(q, ac.signal);
        if (gen !== searchGenRef.current || ac.signal.aborted) return;
        setSearchResults(results);
        if (results.length === 0) {
          setSearchError('No courses found. Try a different name or city.');
        }
      } catch (e) {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        if (gen !== searchGenRef.current) return;

        const message = formatGolfSearchError(e);
        const demoHits = filterDemoCourses(q, demoSearchPool);
        if (demoHits.length > 0) {
          setSearchResults(demoHits);
          setSearchError(message ? `${message} Showing demo matches.` : 'Showing demo matches.');
        } else {
          setSearchResults([]);
          setSearchError(message || 'Search failed.');
        }
      } finally {
        if (gen === searchGenRef.current) setSearchLoading(false);
      }
    },
    [demoSearchPool],
  );

  const selectCourse = useCallback(
    async (result: CourseSearchResult) => {
      setActiveSheet(null);
      setCourseError(null);

      if (result.id === DEMO_COURSE.id) {
        const tee = DEMO_COURSE.teeSets[0]!;
        setSetup({
          course: DEMO_COURSE,
          teeSet: tee,
          holeSelection: '18',
          selectedHoles: tee.holes,
          isDemo: true,
          usingFallback: true,
        });
        return;
      }

      setCourseLoading(true);
      try {
        const course = await fetchCourseDetails(result.id);
        const preferred =
          course.teeSets.find((t) => /white/i.test(t.name)) ??
          course.teeSets.find((t) => t.holeCount >= 9) ??
          course.teeSets[0]!;
        setSetup((prev) =>
          patchSetupWithTee(
            {
              ...prev,
              course,
              isDemo: false,
              usingFallback: false,
            },
            preferred,
          ),
        );
      } catch (e) {
        setCourseError(
          e instanceof GolfCourseApiError ? e.message : 'Could not load course details.',
        );
      } finally {
        setCourseLoading(false);
      }
    },
    [],
  );

  const selectTee = useCallback((tee: TeeSet) => {
    setSetup((prev) => patchSetupWithTee({ ...prev, isDemo: false, usingFallback: false }, tee));
    setActiveSheet(null);
  }, []);

  const selectHoleSelection = useCallback((selection: HoleSelection) => {
    setSetup((prev) => patchSetupWithHoles(prev, selection));
    setActiveSheet(null);
  }, []);

  const onSetupRowPress = useCallback((label: string) => {
    if (label === 'Course') setActiveSheet('course');
    else if (label === 'Tees') {
      if (!setup.course?.teeSets.length) {
        setCourseError('Select a course first.');
        setActiveSheet('course');
        return;
      }
      setActiveSheet('tee');
    } else if (label === 'Holes') {
      if (!setup.teeSet) {
        setCourseError('Select tees first.');
        setActiveSheet('tee');
        return;
      }
      setActiveSheet('holes');
    }
  }, [setup.course?.teeSets.length, setup.teeSet]);

  const closeSheet = useCallback(() => setActiveSheet(null), []);

  const getActiveForSession = useCallback((): ActiveCourseScorecard => activeScorecard, [activeScorecard]);

  return {
    setup,
    activeScorecard,
    setupRows,
    activeSheet,
    searchQuery,
    searchResults,
    searchLoading,
    searchError,
    courseLoading,
    courseError,
    backendReachable,
    usingFallback: setup.usingFallback,
    isDemo: setup.isDemo,
    runSearch,
    selectCourse,
    selectTee,
    selectHoleSelection,
    onSetupRowPress,
    closeSheet,
    getActiveForSession,
  };
}

export type GameCourseSetup = ReturnType<typeof useGameCourseSetup>;
