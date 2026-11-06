import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from '../components/Badges';
import { SourcesBanner } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';

export function Sites() {
  const { state, reload } = useResource((signal) => api.GET('/api/v1/sites', { signal }), []);
  return (
    <>
      <h1>Sites &amp; assets</h1>
      {state.kind === 'loading' && <Loading label="Loading sites" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <SourcesBanner sources={state.data.sources} />
          <p>
            Equipment telemetry, load and chaos live in the <a href={state.data.telemetryConsoleUrl}>asset telemetry console</a>{' '}
            (needs that service's own role).
          </p>
          {state.data.items.length === 0 ? <Empty title="No stock reported" /> : state.data.items.map((site) => (
            <section className="panel" key={site.siteId} aria-labelledby={`site-${site.siteId}`}>
              <h2 id={`site-${site.siteId}`}><code>{site.siteId}</code></h2>
              <table className="table">
                <caption className="sr-only">Stock at {site.siteId}</caption>
                <thead><tr><th scope="col">SKU</th><th scope="col">On hand</th><th scope="col">Reserved</th><th scope="col">Available</th><th scope="col">Updated</th></tr></thead>
                <tbody>
                  {site.stock.map((s) => (
                    <tr key={s.sku}><td><code>{s.sku}</code></td><td>{s.onHand}</td><td>{s.reserved}</td><td>{s.available}</td><td><Time value={s.updatedAt} /></td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </>
  );
}
