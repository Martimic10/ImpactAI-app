/** Encode a local file URI for expo-router query params (handles #, ?, spaces). */
export function encodeVideoUriForRoute(uri: string): string {
  return encodeURIComponent(uri);
}

/** Decode route param from preview / upload / processing screens. */
export function decodeVideoUriFromRoute(param: string | string[] | undefined): string | null {
  if (param == null) return null;
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw || typeof raw !== 'string') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
