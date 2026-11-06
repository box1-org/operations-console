import { Link, useSearchParams } from 'react-router';
import { Button } from 'react-aria-components';
import { api, type Schemas } from '../api/client';
import { useResource } from '../api/useResource';
import { StateBadge, Time } from '../components/Badges';
import { SourcesBanner } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';
import { TableWrap } from '../components/Live';
import { useHasRole } from '../session';

const STATES: Schemas['OrderState'][] = ['SUBMITTED', 'RESERVED', 'FULFILLMENT_REQUESTED', 'SHIPPED', 'COMPLETED', 'REJECTED', 'EXCEPTION', 'CANCELLED'];
type Sort = 'createdAt' | '-createdAt' | 'updatedAt' | '-updatedAt';

export function Orders() {
  const canPlace = useHasRole('console-operator');
  const [params, setParams] = useSearchParams();
  const state = (params.get('state') || undefined) as Schemas['OrderState'] | undefined;
  const siteId = params.get('siteId') || undefined;
  const sku = params.get('sku') || undefined;
  const sort = (params.get('sort') || '-createdAt') as Sort;
  const page = Number(params.get('page') || 0);
  const size = 20;
  const { state: res, reload } = useResource(
    (signal) => api.GET('/api/v1/orders', { params: { query: { state, siteId, sku, sort, page, size } }, signal }),
    [state, siteId, sku, sort, page], { keepDataOnChange: true });

  function update(form: HTMLFormElement) {
    const data = new FormData(form);
    const next = new URLSearchParams();
    for (const key of ['state', 'siteId', 'sku', 'sort']) {
      const v = String(data.get(key) ?? '').trim();
      if (v) next.set(key, v);
    }
    setParams(next);
  }

  return (
    <>
      <title>Orders · box1 Operations</title>
      <div className="page-head">
        <h1>Orders</h1>
        {canPlace && <Link className="button" to="/orders/new">Place order</Link>}
      </div>
      <form className="filters" aria-label="Filter orders" onSubmit={(e) => { e.preventDefault(); update(e.currentTarget); }}>
        <label>State
          <select name="state" defaultValue={state ?? ''}>
            <option value="">Any</option>
            {STATES.map((s) => <option key={s} value={s}>{s === 'FULFILLMENT_REQUESTED' ? 'Awaiting ERP acknowledgement' : s.toLowerCase()}</option>)}
          </select>
        </label>
        <label>Site <input name="siteId" defaultValue={siteId} placeholder="site_…" pattern="site_[A-Za-z0-9_-]{1,64}" /></label>
        <label>SKU <input name="sku" defaultValue={sku} maxLength={80} /></label>
        <label>Sort
          <select name="sort" defaultValue={sort}>
            <option value="-createdAt">Newest first</option>
            <option value="createdAt">Oldest first</option>
            <option value="-updatedAt">Recently changed</option>
            <option value="updatedAt">Least recently changed</option>
          </select>
        </label>
        <Button type="submit">Apply</Button>
      </form>
      {res.kind === 'loading' && <Loading label="Loading orders" />}
      {res.kind === 'error' && <ProblemView problem={res.problem} onRetry={reload} />}
      {res.kind === 'ready' && (() => {
        const d = res.data;
        const pages = Math.max(1, Math.ceil(d.total / d.size));
        const unavailable = d.sources.some((s) => s.status === 'UNAVAILABLE');
        return (
          <>
            <SourcesBanner sources={d.sources} />
            <p className="meta">
              {d.total} matching order(s) among the {d.window.scanned} most recent{d.window.complete ? '' : '; older orders were not searched'}.
            </p>
            {d.items.length === 0 ? (
              unavailable ? null : <Empty title="No orders match">Change the filters, or place an order.</Empty>
            ) : (
              <TableWrap label="Orders"><table className="table">
                <caption className="sr-only">Orders, page {d.page + 1} of {pages}</caption>
                <thead><tr><th scope="col">Order</th><th scope="col">State</th><th scope="col">Item</th><th scope="col">Site</th><th scope="col">Created</th><th scope="col">Last change</th></tr></thead>
                <tbody>
                  {d.items.map((o) => (
                    <tr key={o.orderId}>
                      <td><Link to={`/orders/${o.orderId}`}>{o.orderId}</Link></td>
                      <td><StateBadge order={o} /></td>
                      <td>{o.quantity ?? '?'} × <code>{o.sku ?? '?'}</code></td>
                      <td><code>{o.siteId}</code></td>
                      <td><Time value={o.createdAt} /></td>
                      <td><Time value={o.updatedAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></TableWrap>
            )}
            <p className="sr-only" aria-live="polite" aria-atomic="true">{res.refreshing ? 'Loading' : `${d.total} matching orders, page ${d.page + 1} of ${pages}`}</p>
            <nav className="pager" aria-label="Order pages">
              <Button isDisabled={d.page <= 0} onPress={() => { params.set('page', String(d.page - 1)); setParams(params); }}>Previous</Button>
              <span>Page {d.page + 1} of {pages}</span>
              <Button isDisabled={d.page + 1 >= pages} onPress={() => { params.set('page', String(d.page + 1)); setParams(params); }}>Next</Button>
            </nav>
          </>
        );
      })()}
    </>
  );
}
