import { Link } from 'react-router';
import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from '../components/Badges';
import { SourcesBanner } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';
import { useHasRole } from '../session';

const STATE_ORDER = ['SUBMITTED', 'RESERVED', 'FULFILLMENT_REQUESTED', 'SHIPPED', 'COMPLETED', 'REJECTED', 'EXCEPTION', 'CANCELLED'];
const SHORT: Record<string, string> = { FULFILLMENT_REQUESTED: 'Awaiting ERP acknowledgement', EXCEPTION: 'Exception' };

export function Home() {
  const canPlace = useHasRole('console-operator');
  const { state, reload } = useResource((signal) => api.GET('/api/v1/overview', { signal }), [], 15000);
  return (
    <>
      <div className="page-head">
        <h1>Operations overview</h1>
        {canPlace && <Link className="button" to="/orders/new">Place order</Link>}
      </div>
      {state.kind === 'loading' && <Loading label="Loading indicators" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (() => {
        const { indicators, exceptionQueue, sources, stuckThresholdMinutes } = state.data;
        return (
          <>
            <SourcesBanner sources={sources} />
            <p className="meta">Based on the {indicators.scanned} most recent orders{indicators.windowComplete ? '' : ' (older orders not included)'} · updated <Time value={state.loadedAt.toISOString()} /></p>
            <ul className="kpis" aria-label="Business indicators">
              <li className="kpi tone-waiting"><span className="kpi-value">{indicators.stuck}</span><span className="kpi-label">Awaiting ERP over {stuckThresholdMinutes} min</span></li>
              <li className="kpi tone-attention"><span className="kpi-value">{indicators.exceptions}</span><span className="kpi-label">Exceptions</span></li>
              {STATE_ORDER.filter((s) => indicators.byState[s]).map((s) => (
                <li className="kpi" key={s}><span className="kpi-value">{indicators.byState[s]}</span><span className="kpi-label">{SHORT[s] ?? s.charAt(0) + s.slice(1).toLowerCase()}</span></li>
              ))}
            </ul>
            <section aria-labelledby="queue-h" className="panel">
              <h2 id="queue-h">Exception queue</h2>
              {exceptionQueue.length === 0 ? <Empty title="No exceptions">No order needs attention in the scanned window.</Empty> : (
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
              )}
            </section>
          </>
        );
      })()}
    </>
  );
}
