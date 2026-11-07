import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from '../components/Badges';
import { LiveStatus, TableWrap } from '../components/Live';
import { OrderSummaryView } from '../components/OrderSummaryView';
import { SourcesBanner } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';

export function Incidents() {
  const [paused, setPaused] = useState(false);
  const { state, reload } = useResource((signal) => api.GET('/api/v1/incidents', { signal }), [], { refreshMs: paused ? undefined : 15000 });
  return (
    <>
      <title>Incidents · box1 Operations</title>
      <h1>Incidents</h1>
      <p className="meta">Derived by the console from order status until an incident contract exists (box1-docs#17).</p>
      {state.kind === 'loading' && <Loading label="Loading incidents" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <SourcesBanner sources={state.data.sources} />
          <LiveStatus loadedAt={state.loadedAt} refreshing={state.refreshing} refreshFailed={state.refreshFailed}
            paused={paused} onToggle={() => setPaused(!paused)} />
          {!state.data.window.complete && state.data.sources.every((s) => s.status === 'OK') && (
            <p className="meta">Only the {state.data.window.scanned} most recent orders were checked.</p>
          )}
          {state.data.items.length === 0 ? (state.data.sources.every((s) => s.status === 'OK') ? <Empty title="No active incidents" /> : null) : (
            <TableWrap label="Incidents">
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
            </TableWrap>
          )}
        </>
      )}
    </>
  );
}

export function IncidentDetail() {
  const { incidentId = '' } = useParams();
  const [paused, setPaused] = useState(false);
  const [inactive, setInactive] = useState(false);
  const { state, reload } = useResource(
    (signal) => api.GET('/api/v1/incidents/{incidentId}/evidence', { params: { path: { incidentId } }, signal }),
    [incidentId], { refreshMs: paused || inactive ? undefined : 5000 });
  // The Assistant (box1-docs#101) is offered only to people agentic-operations would let start an analysis.
  const assistant = useResource((signal) => api.GET('/api/v1/assistant', { signal }), []);
  const canAnalyze = assistant.state.kind === 'ready' && assistant.state.data.configured && assistant.state.data.canAnalyze;
  const nowInactive = state.kind === 'ready' && !state.data.incident.active;
  if (nowInactive !== inactive) setInactive(nowInactive);
  return (
    <>
      <title>{`Incident ${incidentId} · box1 Operations`}</title>
      <p className="crumbs"><Link to="/incidents">Incidents</Link> / <span aria-current="page">{incidentId}</span></p>
      <h1>Incident evidence</h1>
      {state.kind === 'loading' && <Loading label="Loading evidence" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <LiveStatus loadedAt={state.loadedAt} refreshing={state.refreshing} refreshFailed={state.refreshFailed}
            paused={paused} onToggle={() => setPaused(!paused)} final={inactive} />
          <div className={`callout ${state.data.incident.active ? 'tone-attention' : 'tone-neutral'}`} data-testid="incident-status">
            <strong>{state.data.incident.active ? 'Active' : 'No active incident'}:</strong> {state.data.incident.title}.
            {' '}Order <Link to={`/orders/${state.data.incident.orderId}`}>{state.data.incident.orderId}</Link>.
          </div>
          {canAnalyze && /^inc_ord_/.test(incidentId) && (
            <p><Link className="button" to={`/assistant?incident=${encodeURIComponent(incidentId)}`} data-testid="ask-assistant">
              Ask the assistant to analyze this incident</Link></p>
          )}
          <OrderSummaryView summary={state.data.summary} />
        </>
      )}
    </>
  );
}
