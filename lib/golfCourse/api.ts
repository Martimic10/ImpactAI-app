import { FetchTimeoutError, fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { normalizeCourseDetail, normalizeSearchCourse } from '@/lib/golfCourse/normalize';
import type { Course, CourseSearchResult } from '@/lib/golfCourse/types';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
/** GolfCourseAPI + proxy can be slow on first request from a phone. */
const SEARCH_TIMEOUT_MS = 35_000;
const DETAIL_TIMEOUT_MS = 40_000;
const PING_TIMEOUT_MS = 6_000;

export class GolfCourseApiError extends Error {
  constructor(
    message: string,
    readonly code: 'network' | 'missing_key' | 'not_found' | 'server' = 'server',
  ) {
    super(message);
    this.name = 'GolfCourseApiError';
  }
}

function ensureBackend(): string {
  if (!BACKEND_URL) {
    throw new GolfCourseApiError(
      'Set EXPO_PUBLIC_BACKEND_URL in .env.local to your backend URL (e.g. http://YOUR_IP:8000).',
      'missing_key',
    );
  }
  return BACKEND_URL.replace(/\/$/, '');
}

export function getBackendUrlForDisplay(): string {
  return BACKEND_URL.replace(/\/$/, '') || '(not set)';
}

/** User-friendly message when search fails on device. */
export function formatGolfSearchError(e: unknown): string {
  const backend = getBackendUrlForDisplay();

  if (e instanceof GolfCourseApiError) return e.message;

  if (e instanceof FetchTimeoutError) {
    return `Search timed out. Keep the backend running on your Mac (${backend}) and stay on the same Wi‑Fi.`;
  }

  if (e instanceof DOMException && e.name === 'AbortError') {
    return '';
  }

  if (e instanceof TypeError) {
    return `Cannot reach your Mac backend (${backend}). In .env.local use http://YOUR_MAC_IP:8000 — not localhost — and run dev_golf_server.py.`;
  }

  if (e instanceof Error && e.message) return e.message;

  return 'Search failed. Check that the golf server is running and EXPO_PUBLIC_BACKEND_URL uses your Mac’s Wi‑Fi IP.';
}

export async function pingGolfBackend(signal?: AbortSignal): Promise<boolean> {
  try {
    const base = ensureBackend();
    const res = await fetchWithTimeout(`${base}/golf-courses/status`, {
      method: 'GET',
      timeoutMs: PING_TIMEOUT_MS,
      signal,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { configured?: boolean };
    return Boolean(data.configured);
  } catch {
    return false;
  }
}

async function readApiErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { detail?: string | { msg?: string }[] };
    if (typeof json.detail === 'string') return json.detail;
    if (Array.isArray(json.detail)) {
      return json.detail.map((d) => d.msg ?? String(d)).join(', ');
    }
  } catch {
    /* not JSON */
  }
  return text.trim() || `Request failed (${res.status})`;
}

export async function searchCourses(
  query: string,
  signal?: AbortSignal,
): Promise<CourseSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const base = ensureBackend();
  const url = `${base}/golf-courses/search?${new URLSearchParams({ search_query: q })}`;
  const res = await fetchWithTimeout(url, { method: 'GET', timeoutMs: SEARCH_TIMEOUT_MS, signal });

  if (!res.ok) {
    const message = await readApiErrorMessage(res);
    if (res.status === 503) {
      throw new GolfCourseApiError(
        message.includes('not configured') || message.includes('invalid')
          ? message
          : 'Golf course API is not configured on the server. Add GOLF_COURSE_API_KEY to backend/.env and restart.',
        'missing_key',
      );
    }
    if (res.status === 502) {
      throw new GolfCourseApiError(message || 'Could not reach GolfCourseAPI.', 'network');
    }
    throw new GolfCourseApiError(message, 'server');
  }

  const data = (await res.json()) as { courses?: unknown[] };
  return (data.courses ?? [])
    .map((row) => normalizeSearchCourse(row as Parameters<typeof normalizeSearchCourse>[0]))
    .filter((c) => c.name);
}

export async function fetchCourseDetails(courseId: string): Promise<Course> {
  const base = ensureBackend();
  const url = `${base}/golf-courses/${encodeURIComponent(courseId)}`;
  const res = await fetchWithTimeout(url, { method: 'GET', timeoutMs: DETAIL_TIMEOUT_MS });

  if (!res.ok) {
    if (res.status === 404) throw new GolfCourseApiError('Course not found.', 'not_found');
    throw new GolfCourseApiError(`Could not load course (${res.status}).`, 'server');
  }

  const data = await res.json();
  const course = normalizeCourseDetail(data as Parameters<typeof normalizeCourseDetail>[0]);
  if (course.teeSets.length === 0) {
    throw new GolfCourseApiError('This course has no tee data yet.', 'not_found');
  }
  return course;
}

export function filterDemoCourses(query: string, demos: CourseSearchResult[]): CourseSearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return demos.filter((c) => {
    const hay = `${c.name} ${c.clubName ?? ''} ${c.city} ${c.state}`.toLowerCase();
    return hay.includes(q);
  });
}
