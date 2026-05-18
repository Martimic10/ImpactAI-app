export class FetchTimeoutError extends Error {
  constructor(timeoutMs: number, url?: string) {
    super(
      url
        ? `Request timed out after ${Math.round(timeoutMs / 1000)}s (${url})`
        : `Request timed out after ${Math.round(timeoutMs / 1000)}s`,
    );
    this.name = 'FetchTimeoutError';
  }
}

/** fetch with AbortController — prevents hung analysis when backend/API is slow. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const { timeoutMs = 90_000, signal: outerSignal, ...fetchInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onOuterAbort = () => controller.abort();
  if (outerSignal) {
    if (outerSignal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    outerSignal.addEventListener('abort', onOuterAbort);
  }

  try {
    return await fetch(input, { ...fetchInit, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      if (outerSignal?.aborted) throw err;
      throw new FetchTimeoutError(timeoutMs, typeof input === 'string' ? input : undefined);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}
