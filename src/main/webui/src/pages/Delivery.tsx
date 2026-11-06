import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { SourcesBanner } from '../components/Sources';
import { Forbidden, Loading, ProblemView } from '../components/States';
import { useHasRole } from '../session';

export function Delivery() {
  const isDeveloper = useHasRole('console-developer');
  const { state, reload } = useResource((signal) => api.GET('/api/v1/delivery', { signal }), []);
  return (
    <>
      <h1>Delivery</h1>
      <p className="meta">Source revision each service reports through its <code>/api/info</code>.</p>
      {!isDeveloper && state.kind !== 'ready' && state.kind !== 'loading' ? <Forbidden /> : null}
      {state.kind === 'loading' && <Loading label="Loading revisions" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <SourcesBanner sources={state.data.sources} />
          <table className="table">
            <caption className="sr-only">Deployed revisions</caption>
            <thead><tr><th scope="col">Service</th><th scope="col">Revision</th><th scope="col">Version</th></tr></thead>
            <tbody>
              {state.data.services.map((s) => (
                <tr key={s.service}>
                  <td>{s.service}</td>
                  <td>{s.commitUrl ? <a href={s.commitUrl} rel="noreferrer noopener" target="_blank"><code>{s.gitRef?.slice(0, 12)}</code></a> : <span className="meta">{s.gitRef ?? 'unknown'}</span>}</td>
                  <td>{s.version ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
