import { useState } from 'react';
import { api, type Schemas, type SourceStatus } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from '../components/Badges';
import { SourcesBanner, sourceName } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';
import { LiveStatus, TableWrap } from '../components/Live';
import { SiteMap, SiteStateBadge, ago, siteState } from '../components/SiteMap';

type Site = Schemas['Site'];

export function Sites() {
  const [paused, setPaused] = useState(false);
  const { state, reload } = useResource((signal) => api.GET('/api/v1/sites', { signal }), [],
    { refreshMs: paused ? undefined : 15000 });
  return (
    <>
      <title>Sites · box1 Operations</title>
      <h1>Sites &amp; assets</h1>
      {state.kind === 'loading' && <Loading label="Loading sites" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (() => {
        const { items, alerts, sources, siteStatusSource, telemetryConsoleUrl } = state.data;
        const statusRead = siteStatusSource.status === 'OK';
        const asset = sources.find((s) => s.source === 'asset-service');
        const alertsPartial = asset?.status === 'DEGRADED';
        const stocked = items.filter((s) => s.stock.length > 0);
        return (
          <>
            <SourcesBanner sources={sources} />
            <LiveStatus loadedAt={state.loadedAt} refreshing={state.refreshing} refreshFailed={state.refreshFailed}
              paused={paused} onToggle={() => setPaused(!paused)} />
            <section className="panel" aria-labelledby="site-status">
              <h2 id="site-status">Site status</h2>
              {!statusRead && <SiteStatusUnavailable source={siteStatusSource} />}
              {items.length === 0 ? <Empty title="No sites reported" /> : (
                <>
                  <SiteMap sites={items} statusRead={statusRead} />
                  <SiteStatusTable sites={items} statusRead={statusRead} alertsPartial={alertsPartial} />
                </>
              )}
            </section>
            <section className="panel" aria-labelledby="active-alerts">
              <h2 id="active-alerts">Active equipment alerts</h2>
              {alerts.length === 0 ? (
                <p className="meta">
                  {asset && asset.status !== 'OK' && asset.status !== 'DEGRADED'
                    ? 'Alerts could not be read; see the source status above.'
                    : 'No active alerts.'}
                </p>
              ) : (
                <TableWrap label="Active equipment alerts"><table className="table">
                  <caption className="sr-only">Active equipment alerts, newest first</caption>
                  <thead><tr><th scope="col">Site</th><th scope="col">Asset</th><th scope="col">Metric</th><th scope="col">Severity</th><th scope="col">Last</th><th scope="col">Peak</th><th scope="col">Threshold</th><th scope="col">Since</th></tr></thead>
                  <tbody>
                    {alerts.map((a) => (
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
                Readings, load and chaos live in the <a href={telemetryConsoleUrl}>asset telemetry console</a>{' '}
                (needs that service's own role).
              </p>
            </section>
            {stocked.length === 0 ? <Empty title="No stock reported" /> : stocked.map((site) => (
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
        );
      })()}
    </>
  );
}

/** The site status read failed while the rest of the page may be fine: say so here, values stay absent (D-006). */
function SiteStatusUnavailable({ source }: { source: SourceStatus }) {
  return (
    <div className="sources sources-info" role="status" data-testid="site-status-source" data-status={source.status}>
      <strong>Site status unavailable: </strong>
      {sourceName(source.source)} did not provide it{source.detail ? <> ({source.detail})</> : '.'}
      {' '}Sites known from inventory and alerts are still listed.
    </div>
  );
}

const REASONS: Record<string, string> = {
  HEARTBEAT_STALE: 'No heartbeat within the offline window',
  BUFFER_DEPTH: 'Buffer depth at or over the threshold',
  BUFFER_AGE: 'Oldest buffered row too old',
  GREENBOOT_RED: 'Greenboot health checks failed',
};

const GREENBOOT: Record<string, string> = { GREEN: 'Green (healthy)', RED: 'Red (failed)', UNKNOWN: 'Unknown' };

function SiteStatusTable({ sites, statusRead, alertsPartial }: { sites: Site[]; statusRead: boolean; alertsPartial: boolean }) {
  return (
    <TableWrap label="Site status"><table className="table site-status-table" data-testid="site-status-table">
      <caption className="sr-only">Status of each site as asset-service last derived it</caption>
      <thead><tr>
        <th scope="col">Site</th><th scope="col">State</th><th scope="col">Reasons</th><th scope="col">Last seen</th>
        <th scope="col">Buffer</th><th scope="col">Booted image</th><th scope="col">Greenboot</th><th scope="col">Active alerts</th>
      </tr></thead>
      <tbody>
        {reportingFirst(sites).map((site) => {
          const st = site.status;
          return (
            <tr key={site.siteId} id={`site-row-${site.siteId}`} tabIndex={-1} data-site={site.siteId}
              data-state={siteState(site, statusRead).key}>
              <th scope="row"><code>{site.siteId}</code>{site.location?.region && <div className="meta">{site.location.region}</div>}</th>
              <td><SiteStateBadge site={site} statusRead={statusRead} /></td>
              <td>{st && st.stateReasons.length > 0
                ? <ul className="plain-list">{st.stateReasons.map((r) => <li key={r}>{REASONS[r] ?? r}</li>)}</ul>
                : <span className="meta">—</span>}</td>
              <td>{st?.lastSeenAt ? <>{ago(st.lastSeenAgeSeconds, st.lastSeenAt)}<div className="meta"><Time value={st.lastSeenAt} /></div></>
                : <span className="meta">—</span>}</td>
              <td>{st && st.bufferDepth != null ? (
                <>
                  {st.bufferDepth} {st.bufferDepth === 1 ? 'row' : 'rows'}
                  <div className="meta">
                    site events {st.siteEventBacklog ?? '—'}
                    {st.bufferOldestAgeSeconds ? <> · oldest {duration(st.bufferOldestAgeSeconds)}</> : null}
                    {st.readingsDropped ? <> · {st.readingsDropped} readings dropped</> : null}
                  </div>
                </>
              ) : <span className="meta">—</span>}</td>
              <td><Digest value={st?.bootedImageDigest} staged={st?.stagedImageDigest} /></td>
              <td>{st?.greenbootStatus ? (GREENBOOT[st.greenbootStatus] ?? st.greenbootStatus) : <span className="meta">—</span>}</td>
              <td>{site.activeAlerts == null ? <span className="meta">unknown</span>
                : alertsPartial && site.activeAlerts > 0 ? `${site.activeAlerts} or more` : site.activeAlerts}</td>
            </tr>
          );
        })}
      </tbody>
    </table></TableWrap>
  );
}

/** Sites that report status first, then the rest, each by siteId. */
function reportingFirst(sites: Site[]): Site[] {
  return [...sites].sort((a, b) => Number(!a.status) - Number(!b.status) || a.siteId.localeCompare(b.siteId));
}

/** A shortened digest; the full value is one keyboard press away and can be copied. */
function Digest({ value: digest, staged }: { value?: string | null; staged?: string | null }) {
  if (!digest) return <span className="meta">unknown</span>;
  const short = digest.replace(/^(sha256:[0-9a-f]{12})[0-9a-f]+$/, '$1…');
  return (
    <details className="digest">
      <summary><code>{short}</code><span className="sr-only"> (show full digest)</span></summary>
      <code className="digest-full">{digest}</code>
      {staged && staged !== digest && <div className="meta">Staged for next boot: <code>{staged}</code></div>}
    </details>
  );
}

function duration(seconds: number): string {
  return ago(seconds, null).replace(/ ago$/, '');
}

function value(v: number | null | undefined, unit: string | null | undefined) {
  return v == null ? '—' : `${v}${unit ? ` ${unit}` : ''}`;
}
