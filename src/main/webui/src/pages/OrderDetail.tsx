import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { LiveStatus } from '../components/Live';
import { OrderSummaryView } from '../components/OrderSummaryView';
import { Loading, ProblemView } from '../components/States';

// EXCEPTION is not final: manual reconciliation moves the order on, so keep following it (review FE-1).
const TERMINAL = new Set(['COMPLETED', 'REJECTED', 'CANCELLED']);

/** Follows one order; refreshes every 5 s until the order service reports a terminal state. */
export function OrderDetail() {
  const { orderId = '' } = useParams();
  const [paused, setPaused] = useState(false);
  const [final, setFinal] = useState(false);
  const { state, reload } = useResource(
    (signal) => api.GET('/api/v1/orders/{orderId}/summary', { params: { path: { orderId } }, signal }),
    [orderId], { refreshMs: final || paused ? undefined : 5000 });
  const isFinal = state.kind === 'ready' && TERMINAL.has(state.data.order.state);
  if (isFinal !== final) setFinal(isFinal);

  return (
    <>
      <p className="crumbs"><Link to="/orders">Orders</Link> / <span aria-current="page">{orderId}</span></p>
      <title>{`Order ${orderId} · box1 Operations`}</title>
      <h1>Order <code>{orderId}</code></h1>
      {state.kind === 'ready' && (
        <LiveStatus loadedAt={state.loadedAt} refreshing={state.refreshing} refreshFailed={state.refreshFailed}
          paused={paused} onToggle={() => setPaused(!paused)} final={final} />
      )}
      {state.kind === 'loading' && <Loading label="Loading order" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && <OrderSummaryView summary={state.data} />}
    </>
  );
}
