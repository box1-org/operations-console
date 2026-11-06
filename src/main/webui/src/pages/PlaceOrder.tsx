import { useState } from 'react';
import { Link } from 'react-router';
import { Button, FieldError, Form, Input, Label, NumberField, TextField, Group } from 'react-aria-components';
import { api, asProblem, type Problem, type Schemas } from '../api/client';
import { StateBadge } from '../components/Badges';
import { Forbidden, ProblemView } from '../components/States';
import { useHasRole } from '../session';

type Placed = Schemas['PlacedOrder'];

/**
 * One idempotency key per submission, reused if the operator retries after a failure, so a double click or a retry
 * after a timeout can never create a second order. A new key is made only after the backend confirms an order.
 */
export function PlaceOrder() {
  const canPlace = useHasRole('console-operator');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  if (!canPlace) return <><h1>Place order</h1><Forbidden /></>;

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    setProblem(null);
    try {
      const { data: ok, error, response } = await api.POST('/api/v1/orders', {
        params: { header: { 'X-Box1-Console': '1', 'Idempotency-Key': key } },
        body: {
          customerId: String(data.get('customerId')).trim(),
          sku: String(data.get('sku')).trim(),
          quantity: Number(data.get('quantity')),
          siteId: String(data.get('siteId')).trim(),
        },
      });
      if (ok) setPlaced(ok);
      else setProblem(asProblem(error, response.status));
    } catch (e) {
      setProblem(asProblem(e, 0));
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    return (
      <>
        <h1>Place order</h1>
        <div className="callout tone-done" role="status" data-testid="placed">
          <p><strong>{placed.replayed ? 'Already placed.' : 'Order accepted by the order service.'}</strong>{' '}
            {placed.replayed && 'This submission had been received before; the existing order is shown and no second order was created. '}
            Order <Link to={`/orders/${placed.order.orderId}`}>{placed.order.orderId}</Link> is <StateBadge order={placed.order} />.</p>
          <p className="meta">The console shows progress only as the services report it.</p>
        </div>
        <p><Link className="button" to={`/orders/${placed.order.orderId}`}>Follow this order</Link>{' '}
          <Button onPress={() => { setPlaced(null); setKey(crypto.randomUUID()); }}>Place another order</Button></p>
      </>
    );
  }

  return (
    <>
      <h1>Place order</h1>
      <p className="meta">Use synthetic demo identifiers only (see the demo walkthrough). Submission key <code data-testid="idempotency-key">{key}</code>.</p>
      {problem && <ProblemView problem={problem} />}
      {problem?.code === 'UPSTREAM_UNAVAILABLE' && <p className="meta" role="note">Submitting again reuses the same key, so it cannot create a duplicate order.</p>}
      <Form className="form" onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
        <TextField name="customerId" isRequired defaultValue="cust_demo_ada" validate={(v) => /^cust_[A-Za-z0-9_-]{1,64}$/.test(v) ? null : 'Use a cust_… identifier.'}>
          <Label>Customer</Label><Input /><FieldError />
        </TextField>
        <TextField name="sku" isRequired maxLength={80}>
          <Label>SKU</Label><Input /><FieldError />
        </TextField>
        <NumberField name="quantity" isRequired defaultValue={1} minValue={1} maxValue={1000}>
          <Label>Quantity</Label><Group><Input /></Group><FieldError />
        </NumberField>
        <TextField name="siteId" isRequired validate={(v) => /^site_[A-Za-z0-9_-]{1,64}$/.test(v) ? null : 'Use a site_… identifier.'}>
          <Label>Site</Label><Input /><FieldError />
        </TextField>
        <Button type="submit" isDisabled={busy}>{busy ? 'Submitting…' : 'Submit order'}</Button>
      </Form>
    </>
  );
}
