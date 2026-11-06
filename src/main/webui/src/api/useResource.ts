import { useCallback, useEffect, useRef, useState } from 'react';
import { asProblem, type Problem } from './client';

export type Resource<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T; loadedAt: Date; refreshing: boolean; refreshFailed: Problem | null }
  | { kind: 'error'; problem: Problem };

type Fetcher<T> = (signal: AbortSignal) => Promise<{ data?: T; error?: unknown; response: Response }>;

interface Options {
  /** Poll interval; polling never replaces data with a spinner and stops on 401/403. */
  refreshMs?: number;
  /** Keep the previous data visible while a dependency change loads (lists and paging). */
  keepDataOnChange?: boolean;
}

/**
 * Loads one console API resource with explicit loading, ready and error states. Each load is sequence-numbered and
 * aborted when superseded, so a late response can never land on the wrong page. A failed background refresh keeps
 * the data on screen and reports the failure quietly (review FE-2, FE-3).
 */
export function useResource<T>(fetcher: Fetcher<T>, deps: unknown[], options: Options = {}) {
  const { refreshMs, keepDataOnChange = false } = options;
  const [state, setState] = useState<Resource<T>>({ kind: 'loading' });
  const [stopped, setStopped] = useState(false);
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const seq = useRef(0);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (mode: 'foreground' | 'keep' | 'background') => {
    if (mode === 'background' && inFlight.current) return;
    const id = ++seq.current;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    inFlight.current = true;
    setState((s) => (s.kind === 'ready' && mode !== 'foreground' ? { ...s, refreshing: true } : { kind: 'loading' }));
    let problem: Problem | null = null;
    try {
      const { data, error, response } = await latest.current(c.signal);
      if (id !== seq.current) return;
      if (data !== undefined && response.ok) {
        setState({ kind: 'ready', data, loadedAt: new Date(), refreshing: false, refreshFailed: null });
        return;
      }
      problem = asProblem(error, response.status);
    } catch (e) {
      if (id !== seq.current || c.signal.aborted) return;
      problem = asProblem(e, 0);
    } finally {
      if (id === seq.current) inFlight.current = false;
    }
    const p = problem;
    const sessionOrRole = p.status === 401 || p.status === 403;
    if (sessionOrRole) setStopped(true);
    setState((s) => (mode === 'background' && s.kind === 'ready' && !sessionOrRole
      ? { ...s, refreshing: false, refreshFailed: p }
      : { kind: 'error', problem: p }));
  }, []);

  useEffect(() => {
    setStopped(false);
    void load(keepDataOnChange ? 'keep' : 'foreground');
    return () => {
      seq.current++;
      controller.current?.abort();
      inFlight.current = false;
    };
    // The dependency list is the caller's: it names exactly what the fetcher reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!refreshMs || stopped) return;
    const timer = window.setInterval(() => void load('background'), refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs, stopped, load]);

  const reload = useCallback(() => void load('foreground'), [load]);
  return { state, reload };
}
