import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Button, FieldError, Form, Group, Input, Label, ListBox, ListBoxItem, NumberField, Popover, Select, SelectValue, Text, TextField,
} from 'react-aria-components';
import { api, asProblem, type Problem, type Schemas } from '../api/client';
import { useResource } from '../api/useResource';
import { StateBadge } from '../components/Badges';
import { SourcesBanner } from '../components/Sources';
import { Forbidden, Loading, ProblemView } from '../components/States';
import { useHasRole } from '../session';

type Placed = Schemas['PlacedOrder'];
type Draft = Schemas['PlaceOrder'];
type Site = Schemas['Site'];
interface Pending { key: string; draft: Draft }

const STORE = 'box1.console.pendingOrder';
const AMBIGUOUS = new Set(['UPSTREAM_UNAVAILABLE', 'NETWORK_ERROR']);
/** Synthetic demo customers (demo walkthrough, decision D-011). No service lists customers. */
const DEMO_CUSTOMERS = ['cust_demo_ada', 'cust_demo_lin', 'cust_demo_kai'];
const OTHER = '__other__';
const CUSTOMER_ID = /^cust_[A-Za-z0-9_-]{1,64}$/;
const SITE_ID = /^site_[A-Za-z0-9_-]{1,64}$/;

/**
 * Site and SKU come from the inventory service (via the console's /api/v1/sites); the customer from the demo list or
 * a typed cust_… ID. One idempotency key per order: if the backend could not confirm a submission, the key and the
 * exact values are kept (this tab's sessionStorage; never a token) and the form is locked to them, so a retry, a
 * reload or leaving and returning can only replay the same order, never create a second.
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
  const sites = useResource((signal) => api.GET('/api/v1/sites', { signal }), []);

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

  const inventory = sites.state.kind === 'ready'
    ? sites.state.data.sources.find((s) => s.source === 'inventory-service') : undefined;
  // /api/v1/sites also lists sites known only from edge status or alerts (box1-docs#130); only stocked sites are offered.
  const stocked = sites.state.kind === 'ready' ? sites.state.data.items.filter((s) => s.stock.length > 0) : [];
  const catalog: Site[] | null = sites.state.kind === 'ready' && inventory?.status === 'OK' && stocked.length > 0
    ? stocked : null;
  return (
    <>
      <title>Place order · box1 Operations</title>
      <h1>Place order</h1>
      <p className="meta">Use synthetic demo identifiers only (see the demo walkthrough). Submission key <code data-testid="idempotency-key">{key}</code>.</p>
      <div tabIndex={-1} ref={result}>
        {problem && <ProblemView problem={problem} />}
        {pending && (
          <div className="callout tone-attention" data-testid="unconfirmed">
            <p><strong>An earlier submission was not confirmed.</strong> The order service may already have it. Submitting again sends the
              same key and values, which returns the existing order if there is one and never creates a second.</p>
            <p>Check <Link to={`/orders?sku=${encodeURIComponent(pending.draft.sku)}&siteId=${encodeURIComponent(pending.draft.siteId)}`}>recent orders for this item</Link>, or{' '}
              <Button onPress={startNew}>start a new order instead</Button> (only if you are sure the earlier one does not exist).</p>
          </div>
        )}
        {problem?.code === 'IDEMPOTENCY_CONFLICT' && !pending && (
          <p className="callout tone-attention" data-testid="conflict">This key was already used for different values, so the order service refused it.
            {' '}<Button onPress={startNew}>Start a new order</Button></p>
        )}
      </div>
      {sites.state.kind === 'loading' && !pending && <Loading label="Loading sites and stock from the inventory service" />}
      {sites.state.kind !== 'loading' && !pending && !catalog && (
        <div data-testid="inventory-fallback">
          {sites.state.kind === 'ready'
            ? <SourcesBanner sources={sites.state.data.sources.filter((s) => s.source === 'inventory-service')} />
            : <ProblemView problem={sites.state.problem} />}
          <p className="callout tone-unknown">Site and SKU lists are unavailable because the inventory service did not answer
            {sites.state.kind === 'ready' && inventory?.status === 'OK' ? ' with any stock' : ''}. Type them instead; the order and inventory services still check them.</p>
        </div>
      )}
      {(pending || sites.state.kind !== 'loading') && (
        <OrderForm key={key} pending={pending} catalog={catalog} busy={busy} onSubmit={(d) => void submit(d)} />
      )}
    </>
  );
}

/** The form itself; remounted per submission key, so a new order always starts empty. */
function OrderForm({ pending, catalog, busy, onSubmit }: {
  pending: Pending | null; catalog: Site[] | null; busy: boolean; onSubmit: (draft: Draft) => void;
}) {
  const locked = pending !== null;
  const initial = pending?.draft;
  const [customerChoice, setCustomerChoice] = useState<string>(
    initial ? (DEMO_CUSTOMERS.includes(initial.customerId) ? initial.customerId : OTHER) : DEMO_CUSTOMERS[0]);
  const [otherCustomer, setOtherCustomer] = useState(initial && !DEMO_CUSTOMERS.includes(initial.customerId) ? initial.customerId : '');
  const [siteId, setSiteId] = useState<string>(initial?.siteId ?? '');
  const [sku, setSku] = useState<string>(initial?.sku ?? '');
  const [quantity, setQuantity] = useState<number>(initial?.quantity ?? 1);
  // NumberField commits on blur; the over-available warning follows what is typed, so it shows before submitting.
  const [typed, setTyped] = useState<number>(initial?.quantity ?? 1);

  const site = catalog?.find((s) => s.siteId === siteId);
  const stock = site?.stock.find((s) => s.sku === sku);
  const available = stock?.available ?? null;
  const customerId = customerChoice === OTHER ? otherCustomer.trim() : customerChoice;
  const ready = customerId !== '' && siteId !== '' && sku !== '' && Number.isFinite(quantity) && quantity >= 1;

  // Locked pending values may no longer be in the inventory list; show them anyway.
  const siteItems = [...(catalog ?? []).map((s) => ({ id: s.siteId, label: `${s.siteId} (${s.stock.length} SKU${s.stock.length === 1 ? '' : 's'})` }))];
  if (siteId && !siteItems.some((s) => s.id === siteId)) siteItems.push({ id: siteId, label: siteId });
  const skuItems = (site?.stock ?? []).map((s) => ({
    id: s.sku, label: `${s.sku}: ${s.available ?? '?'} available (${s.onHand ?? '?'} on hand, ${s.reserved ?? '?'} reserved)`,
  }));
  if (sku && !skuItems.some((s) => s.id === sku)) skuItems.push({ id: sku, label: sku });

  return (
    <Form className="form" onSubmit={(e) => {
      e.preventDefault();
      if (!ready) return;
      onSubmit(locked ? pending.draft : { customerId, sku, quantity, siteId });
    }}>
      <Select selectedKey={customerChoice} onSelectionChange={(k) => setCustomerChoice(String(k))} isDisabled={locked} isRequired>
        <Label>Customer</Label>
        <Button className="select-trigger"><SelectValue /><span aria-hidden="true">▾</span></Button>
        <Popover><ListBox>
          {DEMO_CUSTOMERS.map((c) => <ListBoxItem key={c} id={c} textValue={c}>{c} (demo)</ListBoxItem>)}
          <ListBoxItem id={OTHER} textValue="Other">Other…</ListBoxItem>
        </ListBox></Popover>
      </Select>
      {customerChoice === OTHER && (
        <TextField name="customerId" isRequired isReadOnly={locked} value={otherCustomer} onChange={setOtherCustomer}
          validate={(v) => CUSTOMER_ID.test(v) ? null : 'Use a cust_… identifier.'}>
          <Label>Customer ID</Label><Input /><FieldError />
        </TextField>
      )}

      {catalog || locked ? (
        <>
          <Select selectedKey={siteId || null} isRequired isDisabled={locked}
            onSelectionChange={(k) => { setSiteId(String(k)); setSku(''); }}>
            <Label>Site</Label>
            <Button className="select-trigger"><SelectValue>{({ isPlaceholder }) => isPlaceholder ? 'Choose a site' : siteId}</SelectValue><span aria-hidden="true">▾</span></Button>
            <Popover><ListBox items={siteItems}>{(i) => <ListBoxItem id={i.id} textValue={i.id}>{i.label}</ListBoxItem>}</ListBox></Popover>
          </Select>
          <Select selectedKey={sku || null} isRequired isDisabled={locked || !siteId} onSelectionChange={(k) => setSku(String(k))}>
            <Label>SKU</Label>
            <Button className="select-trigger"><SelectValue>{({ isPlaceholder }) => isPlaceholder ? (siteId ? 'Choose a SKU' : 'Choose a site first') : sku}</SelectValue><span aria-hidden="true">▾</span></Button>
            <Popover><ListBox items={skuItems}>{(i) => <ListBoxItem id={i.id} textValue={i.id}>{i.label}</ListBoxItem>}</ListBox></Popover>
          </Select>
        </>
      ) : (
        <>
          <TextField name="siteId" isRequired value={siteId} onChange={setSiteId}
            validate={(v) => SITE_ID.test(v) ? null : 'Use a site_… identifier.'}>
            <Label>Site</Label><Input /><FieldError />
          </TextField>
          <TextField name="sku" isRequired maxLength={80} value={sku} onChange={setSku}>
            <Label>SKU</Label><Input /><FieldError />
          </TextField>
        </>
      )}

      <NumberField name="quantity" isRequired isReadOnly={locked} value={quantity} onChange={(v) => { setQuantity(v); setTyped(v); }} minValue={1} maxValue={1000}>
        <Label>Quantity</Label><Group><Input onInput={(e) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(n)) setTyped(n);
        }} /></Group>
        {available != null && <Text slot="description">{available} available at {siteId}</Text>}
        <FieldError />
      </NumberField>
      {available != null && typed > available && (
        <p className="callout tone-attention" data-testid="over-available">
          More than the {available} available: inventory will likely reject this order. You can still submit it.
        </p>
      )}
      <Button type="submit" isDisabled={busy || !ready}>{busy ? 'Submitting…' : locked ? 'Submit the same order again' : 'Submit order'}</Button>
    </Form>
  );
}
