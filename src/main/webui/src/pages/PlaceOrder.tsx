import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, FieldError, Form, Group, Input, Label, NumberField, TextField } from 'react-aria-components';
import { api, asProblem, type Problem, type Schemas } from '../api/client';
import { StateBadge } from '../components/Badges';
import { Forbidden, ProblemView } from '../components/States';
import { useHasRole } from '../session';

type Placed = Schemas['PlacedOrder'];
type Draft = Schemas['PlaceOrder'];
interface Pending { key: string; draft: Draft }

const STORE = 'box1.console.pendingOrder';
const AMBIGUOUS = new Set(['UPSTREAM_UNAVAILABLE', 'NETWORK_ERROR']);

/**
 * One idempotency key per order. If the backend could not confirm a submission (timeout or network error), the key
 * and the exact values are kept (in this tab's sessionStorage; never a token) and the form is locked to them, so a
 * retry, a reload or leaving and returning can only replay the same order, never create a second (review FE-4,
 * ARCH-4). Only an explicit "start a new order", after a warning, makes a new key.
 */
export function PlaceOrder() {
  const canPlace = useHasRole('console-operator');
  const [pending, setPending] = useState<Pending | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as Pending | null; } catch { return null; }
  });
  const [key, setKey] = useState(() => pending?.key ?? crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => { if (placed || problem) result.current?.focus(); }, [placed, problem]);
  if (!canPlace) return <><title>Place order · box1 Operations</title><h1>Place order</h1><Forbidden /></>;

  function remember(p: Pending | null) {
    setPending(p);
    if (p) sessionStorage.setItem(STORE, JSON.stringify(p)); else sessionStorage.removeItem(STORE);
  }

  async function submit(draft: Draft) {
    setBusy(true);
    setProblem(null);
    try {
      const { data: ok, error, response } = await api.POST('/api/v1/orders', {
        params: { header: { 'X-Box1-Console': '1', 'Idempotency-Key': key } }, body: draft,
      });
      if (ok) { remember(null); setPlaced(ok); return; }
      const p = asProblem(error, response.status);
      if (AMBIGUOUS.has(p.code)) remember({ key, draft });
      setProblem(p);
    } catch (e) {
      remember({ key, draft });
      setProblem(asProblem(e, 0));
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    remember(null);
    setProblem(null);
    setPlaced(null);
    setKey(crypto.randomUUID());
  }

  if (placed) {
    return (
      <>
        <title>Order placed · box1 Operations</title>
        <h1>Place order</h1>
        <div className="callout tone-done" data-testid="placed" tabIndex={-1} ref={result}>
          <p><strong>{placed.replayed ? 'Already placed.' : 'Order accepted by the order service.'}</strong>{' '}
            {placed.replayed && 'This submission had been received before; the existing order is shown and no second order was created. '}
            Order <Link to={`/orders/${placed.order.orderId}`}>{placed.order.orderId}</Link> is <StateBadge order={placed.order} />.</p>
          <p className="meta">The console shows progress only as the services report it.</p>
        </div>
        <p><Link className="button" to={`/orders/${placed.order.orderId}`}>Follow this order</Link>{' '}
          <Button onPress={startNew}>Place another order</Button></p>
      </>
    );
  }

  const locked = pending !== null;
  const values: Partial<Draft> = pending?.draft ?? { customerId: 'cust_demo_ada', quantity: 1 };
  return (
    <>
      <title>Place order · box1 Operations</title>
      <h1>Place order</h1>
      <p className="meta">Use synthetic demo identifiers only (see the demo walkthrough). Submission key <code data-testid="idempotency-key">{key}</code>.</p>
      <div tabIndex={-1} ref={result}>
        {problem && <ProblemView problem={problem} />}
        {locked && (
          <div className="callout tone-attention" data-testid="unconfirmed">
            <p><strong>An earlier submission was not confirmed.</strong> The order service may already have it. Submitting again sends the
              same key and values, which returns the existing order if there is one and never creates a second.</p>
            <p>Check <Link to={`/orders?sku=${encodeURIComponent(values.sku ?? '')}&siteId=${encodeURIComponent(values.siteId ?? '')}`}>recent orders for this item</Link>, or{' '}
              <Button onPress={startNew}>start a new order instead</Button> (only if you are sure the earlier one does not exist).</p>
          </div>
        )}
        {problem?.code === 'IDEMPOTENCY_CONFLICT' && !locked && (
          <p className="callout tone-attention" data-testid="conflict">This key was already used for different values, so the order service refused it.
            {' '}<Button onPress={startNew}>Start a new order</Button></p>
        )}
      </div>
      <Form className="form" onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void submit(locked ? pending.draft : {
          customerId: String(data.get('customerId')).trim(), sku: String(data.get('sku')).trim(),
          quantity: Number(data.get('quantity')), siteId: String(data.get('siteId')).trim(),
        });
      }}>
        <TextField name="customerId" isRequired isReadOnly={locked} defaultValue={values.customerId} key={`c-${key}`}
          validate={(v) => /^cust_[A-Za-z0-9_-]{1,64}$/.test(v) ? null : 'Use a cust_… identifier.'}>
          <Label>Customer</Label><Input /><FieldError />
        </TextField>
        <TextField name="sku" isRequired isReadOnly={locked} maxLength={80} defaultValue={values.sku} key={`s-${key}`}>
          <Label>SKU</Label><Input /><FieldError />
        </TextField>
        <NumberField name="quantity" isRequired isReadOnly={locked} defaultValue={values.quantity} minValue={1} maxValue={1000} key={`q-${key}`}>
          <Label>Quantity</Label><Group><Input /></Group><FieldError />
        </NumberField>
        <TextField name="siteId" isRequired isReadOnly={locked} defaultValue={values.siteId} key={`l-${key}`}
          validate={(v) => /^site_[A-Za-z0-9_-]{1,64}$/.test(v) ? null : 'Use a site_… identifier.'}>
          <Label>Site</Label><Input /><FieldError />
        </TextField>
        <Button type="submit" isDisabled={busy}>{busy ? 'Submitting…' : locked ? 'Submit the same order again' : 'Submit order'}</Button>
      </Form>
    </>
  );
}
