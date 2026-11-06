import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from 'react-aria-components';
import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from '../components/Badges';
import { OrderSummaryView } from '../components/OrderSummaryView';
import { Loading, ProblemView } from '../components/States';

const TERMINAL = new Set(['COMPLETED', 'REJECTED', 'CANCELLED', 'EXCEPTION']);

/** Follows one order; refreshes every 5 s until the order service reports a terminal state. */
export function OrderDetail() {
  const { orderId = '' } = useParams();
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState(true);
  const { state, reload } = useResource(
    (signal) => api.GET('/api/v1/orders/{orderId}/summary', { params: { path: { orderId } }, signal }),
    [orderId], live && !paused ? 5000 : undefined);
  const finalState = state.kind === 'ready' && TERMINAL.has(state.data.order.state);
  useEffect(() => { if (finalState) setLive(false); }, [finalState]);

  return (
    <>
      <p className="crumbs"><Link to="/orders">Orders</Link> / <span aria-current="page">{orderId}</span></p>
      <div className="page-head">
        <h1>Order <code>{orderId}</code></h1>
        {state.kind === 'ready' && (
          <span className="meta" aria-live="off">
            Updated <Time value={state.loadedAt.toISOString()} />{state.refreshing && ' · refreshing'}
            {live ? <> · <Button onPress={() => setPaused(!paused)}>{paused ? 'Resume updates' : 'Pause updates'}</Button></> : ' · final state'}
          </span>
        )}
      </div>
      {state.kind === 'loading' && <Loading label="Loading order" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && <OrderSummaryView summary={state.data} />}
    </>
  );
}
