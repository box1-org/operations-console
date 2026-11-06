import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from '../components/Badges';
import { LiveStatus, TableWrap } from '../components/Live';
import { SourcesBanner } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';
import { useHasRole } from '../session';

const STATE_ORDER = ['SUBMITTED', 'RESERVED', 'FULFILLMENT_REQUESTED', 'SHIPPED', 'COMPLETED', 'REJECTED', 'EXCEPTION', 'CANCELLED'];
const SHORT: Record<string, string> = { FULFILLMENT_REQUESTED: 'Awaiting ERP acknowledgement', EXCEPTION: 'Exception' };

export function Home() {
  const canPlace = useHasRole('console-operator');
  const [paused, setPaused] = useState(false);
  const { state, reload } = useResource((signal) => api.GET('/api/v1/overview', { signal }), [], { refreshMs: paused ? undefined : 15000 });
  return (
    <>
      <title>Overview · box1 Operations</title>
      <div className="page-head">
        <h1>Operations overview</h1>
        {canPlace && <Link className="button" to="/orders/new">Place order</Link>}
      </div>
      {state.kind === 'loading' && <Loading label="Loading indicators" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (() => {
        const { indicators, exceptionQueue, sources, stuckThresholdMinutes } = state.data;
        const allOk = sources.every((s) => s.status === 'OK');
        return (
          <>
            <SourcesBanner sources={sources} />
            <LiveStatus loadedAt={state.loadedAt} refreshing={state.refreshing} refreshFailed={state.refreshFailed}
              paused={paused} onToggle={() => setPaused(!paused)} />
            {indicators ? (
              <>
                <p className="meta">Based on the {indicators.scanned} most recent orders{indicators.windowComplete ? '' : ' (older orders not included)'}.</p>
                <ul className="kpis" aria-label="Business indicators">
                  <li className="kpi tone-waiting"><span className="kpi-value">{indicators.stuck}</span><span className="kpi-label">Awaiting ERP over {stuckThresholdMinutes} min</span></li>
                  <li className="kpi tone-attention"><span className="kpi-value">{indicators.exceptions}</span><span className="kpi-label">Exceptions</span></li>
                  {STATE_ORDER.filter((s) => indicators.byState[s]).map((s) => (
                    <li className="kpi" key={s}><span className="kpi-value">{indicators.byState[s]}</span><span className="kpi-label">{SHORT[s] ?? s.charAt(0) + s.slice(1).toLowerCase()}</span></li>
                  ))}
                </ul>
              </>
            ) : <p className="callout tone-unknown" data-testid="indicators-unavailable">Indicators unavailable: the order service did not answer, so no counts are shown.</p>}
            <section aria-labelledby="queue-h" className="panel">
              <h2 id="queue-h">Exception queue</h2>
              {exceptionQueue.length === 0 ? (allOk ? <Empty title="No exceptions">No order needs attention in the scanned window.</Empty> : <p className="meta">Not known while the order service is unavailable.</p>) : (
                <TableWrap label="Exception queue">
                  <table className="table">
                    <caption className="sr-only">Orders needing attention, oldest first</caption>
                    <thead><tr><th scope="col">Order</th><th scope="col">Issue</th><th scope="col">Since</th></tr></thead>
                    <tbody>
                      {exceptionQueue.map((i) => (
                        <tr key={i.incidentId}>
                          <td><Link to={`/incidents/${i.incidentId}`}>{i.orderId}</Link></td>
                          <td>{i.title}</td>
                          <td><Time value={i.since} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </section>
          </>
        );
      })()}
    </>
  );
}
