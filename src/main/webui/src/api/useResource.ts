import { useCallback, useEffect, useRef, useState } from 'react';
import { asProblem, type Problem } from './client';

export type Resource<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T; loadedAt: Date; refreshing: boolean }
  | { kind: 'error'; problem: Problem };

type Fetcher<T> = (signal: AbortSignal) => Promise<{ data?: T; error?: unknown; response: Response }>;

/** Load one console API resource with explicit loading, ready and error states. Never retries silently. */
export function useResource<T>(fetcher: Fetcher<T>, deps: unknown[], refreshMs?: number) {
  const [state, setState] = useState<Resource<T>>({ kind: 'loading' });
  const latest = useRef(fetcher);
  latest.current = fetcher;

  const load = useCallback(async (signal: AbortSignal, background: boolean) => {
    if (background) {
      setState((s) => (s.kind === 'ready' ? { ...s, refreshing: true } : s));
    } else {
      setState({ kind: 'loading' });
    }
    try {
      const { data, error, response } = await latest.current(signal);
      if (signal.aborted) return;
      if (data !== undefined && response.ok) {
        setState({ kind: 'ready', data, loadedAt: new Date(), refreshing: false });
      } else {
        setState({ kind: 'error', problem: asProblem(error, response.status) });
      }
    } catch (e) {
      if (!signal.aborted) setState({ kind: 'error', problem: asProblem(e, 0) });
    }
  }, []);

  const reload = useCallback(() => {
    const c = new AbortController();
    void load(c.signal, false);
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal, false);
    let timer: number | undefined;
    if (refreshMs) {
      timer = window.setInterval(() => void load(controller.signal, true), refreshMs);
    }
    return () => {
      controller.abort();
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshMs, load]);

  return { state, reload };
}
