import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from '../components/Badges';
import { SourcesBanner } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';
import { TableWrap } from '../components/Live';

export function Sites() {
  const { state, reload } = useResource((signal) => api.GET('/api/v1/sites', { signal }), []);
  return (
    <>
      <title>Sites · box1 Operations</title>
      <h1>Sites &amp; assets</h1>
      {state.kind === 'loading' && <Loading label="Loading sites" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <SourcesBanner sources={state.data.sources} />
          <section className="panel" aria-labelledby="active-alerts">
            <h2 id="active-alerts">Active equipment alerts</h2>
            {state.data.alerts.length === 0 ? (
              <p className="meta">
                {state.data.sources.some((s) => s.source === 'asset-service' && s.status !== 'OK' && s.status !== 'DEGRADED')
                  ? 'Alerts could not be read; see the source status above.'
                  : 'No active alerts.'}
              </p>
            ) : (
              <TableWrap label="Active equipment alerts"><table className="table">
                <caption className="sr-only">Active equipment alerts, newest first</caption>
                <thead><tr><th scope="col">Site</th><th scope="col">Asset</th><th scope="col">Metric</th><th scope="col">Severity</th><th scope="col">Last</th><th scope="col">Peak</th><th scope="col">Threshold</th><th scope="col">Since</th></tr></thead>
                <tbody>
                  {state.data.alerts.map((a) => (
                    <tr key={a.alertId}>
                      <td><code>{a.siteId}</code></td><td><code>{a.assetId}</code></td><td>{a.metricName}</td><td>{a.severity}</td>
                      <td>{value(a.lastValue, a.unit)}</td><td>{value(a.peakValue, a.unit)}</td><td>{value(a.threshold, a.unit)}</td>
                      <td><Time value={a.activatedAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></TableWrap>
            )}
            <p>
              Readings, load and chaos live in the <a href={state.data.telemetryConsoleUrl}>asset telemetry console</a>{' '}
              (needs that service's own role).
            </p>
          </section>
          {state.data.items.length === 0 ? <Empty title="No stock reported" /> : state.data.items.map((site) => (
            <section className="panel" key={site.siteId} aria-labelledby={`site-${site.siteId}`}>
              <h2 id={`site-${site.siteId}`}><code>{site.siteId}</code></h2>
              <TableWrap label={`Stock at ${site.siteId}`}><table className="table">
                <caption className="sr-only">Stock at {site.siteId}</caption>
                <thead><tr><th scope="col">SKU</th><th scope="col">On hand</th><th scope="col">Reserved</th><th scope="col">Available</th><th scope="col">Updated</th></tr></thead>
                <tbody>
                  {site.stock.map((s) => (
                    <tr key={s.sku}><td><code>{s.sku}</code></td><td>{s.onHand ?? '—'}</td><td>{s.reserved ?? '—'}</td><td>{s.available ?? '—'}</td><td><Time value={s.updatedAt} /></td></tr>
                  ))}
                </tbody>
              </table></TableWrap>
            </section>
          ))}
        </>
      )}
    </>
  );
}

function value(v: number | null | undefined, unit: string | null | undefined) {
  return v == null ? '—' : `${v}${unit ? ` ${unit}` : ''}`;
}
