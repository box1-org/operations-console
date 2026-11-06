import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from '../components/Badges';
import { OrderSummaryView } from '../components/OrderSummaryView';
import { SourcesBanner } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';

export function Incidents() {
  const { state, reload } = useResource((signal) => api.GET('/api/v1/incidents', { signal }), [], 15000);
  return (
    <>
      <h1>Incidents</h1>
      <p className="meta">Derived by the console from order and fulfillment status until an incident contract exists (box1-docs#17).</p>
      {state.kind === 'loading' && <Loading label="Loading incidents" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <SourcesBanner sources={state.data.sources} />
          {state.data.items.length === 0 ? (state.data.sources.every((s) => s.status === 'OK') ? <Empty title="No active incidents" /> : null) : (
            <table className="table">
              <caption className="sr-only">Active incidents, oldest first</caption>
              <thead><tr><th scope="col">Incident</th><th scope="col">Issue</th><th scope="col">Since</th></tr></thead>
              <tbody>
                {state.data.items.map((i) => (
                  <tr key={i.incidentId}>
                    <td><Link to={`/incidents/${i.incidentId}`}>{i.incidentId}</Link></td>
                    <td>{i.title}</td>
                    <td><Time value={i.since} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}

export function IncidentDetail() {
  const { incidentId = '' } = useParams();
  const { state, reload } = useResource(
    (signal) => api.GET('/api/v1/incidents/{incidentId}/evidence', { params: { path: { incidentId } }, signal }),
    [incidentId], 5000);
  return (
    <>
      <p className="crumbs"><Link to="/incidents">Incidents</Link> / <span aria-current="page">{incidentId}</span></p>
      <h1>Incident evidence</h1>
      {state.kind === 'loading' && <Loading label="Loading evidence" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <div className={`callout ${state.data.incident.active ? 'tone-attention' : 'tone-done'}`} role="status" data-testid="incident-status">
            <strong>{state.data.incident.active ? 'Active' : 'Resolved according to the order service'}:</strong> {state.data.incident.title}.
            {' '}Order <Link to={`/orders/${state.data.incident.orderId}`}>{state.data.incident.orderId}</Link>.
          </div>
          <OrderSummaryView summary={state.data.summary} />
        </>
      )}
    </>
  );
}
