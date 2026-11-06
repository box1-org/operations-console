import type { Schemas } from '../api/client';

const STATE_TONE: Record<string, string> = {
  SUBMITTED: 'neutral', RESERVED: 'neutral', FULFILLMENT_REQUESTED: 'waiting', SHIPPED: 'done', COMPLETED: 'done',
  REJECTED: 'failure', EXCEPTION: 'attention', CANCELLED: 'neutral',
};

export function StateBadge({ order }: { order: Pick<Schemas['Order'], 'state' | 'stateLabel'> }) {
  return <span className={`badge tone-${STATE_TONE[order.state] ?? 'neutral'}`} data-state={order.state}>{order.stateLabel}</span>;
}

export function ErpBadge({ erp }: { erp: Schemas['ErpProgress'] }) {
  return <span className={`badge tone-${erp.tone}`} data-erp-stage={erp.stage}>{erp.label}</span>;
}

export function Ids({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <span className="id">
      <span className="id-label">{label}</span> <code>{value}</code>
    </span>
  );
}

export function Time({ value }: { value?: string | null }) {
  if (!value) return <span className="meta">—</span>;
  const d = new Date(value);
  return <time dateTime={value}>{d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })}</time>;
}
