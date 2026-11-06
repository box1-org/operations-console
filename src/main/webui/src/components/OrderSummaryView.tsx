import type { Schemas } from '../api/client';
import { ErpBadge, Ids, StateBadge, Time } from './Badges';
import { SourcesBanner } from './Sources';

type Summary = Schemas['OrderSummary'];

/** Order state, reservation, ERP progress, timeline and evidence; shared by order detail and incident evidence. */
export function OrderSummaryView({ summary, headingLevel = 2 }: { summary: Summary; headingLevel?: 2 | 3 }) {
  const H = `h${headingLevel}` as 'h2' | 'h3';
  const { order, erp, reservation } = summary;
  const awaiting = order.state === 'FULFILLMENT_REQUESTED';
  return (
    <>
      <SourcesBanner sources={summary.sources} />
      {awaiting && (
        <div className="callout tone-waiting" role="status" data-testid="awaiting-erp">
          <strong>Awaiting ERP acknowledgement.</strong>{' '}
          {erp.stage === 'UNAVAILABLE'
            ? 'ERP detail unavailable, so the console shows only the order service state.'
            : <>ERP progress: {erp.label}.</>}
          {erp.uploads != null && <> Outstanding attempts: {erp.uploads} upload(s), {erp.resends ?? 0} resend(s).</>}
        </div>
      )}
      <section className="panel-grid" aria-label="Order status">
        <section className="panel">
          <H>Order</H>
          <dl className="facts">
            <dt>State</dt><dd><StateBadge order={order} /> <code className="meta">{order.state}</code></dd>
            {order.statusReason && (<><dt>Reason</dt><dd><code>{order.statusReason}</code></dd></>)}
            <dt>Customer</dt><dd><code>{order.customerId}</code></dd>
            <dt>Item</dt><dd>{order.quantity} × <code>{order.sku}</code> from <code>{order.siteId}</code></dd>
            <dt>Created</dt><dd><Time value={order.createdAt} /></dd>
            <dt>Last change</dt><dd><Time value={order.updatedAt} /></dd>
          </dl>
        </section>
        <section className="panel">
          <H>Reservation</H>
          {order.reservationId == null ? <p className="meta">No reservation yet.</p> : reservation ? (
            <dl className="facts">
              <dt>Status</dt><dd><code>{reservation.status}</code></dd>
              <dt>Reservation</dt><dd><code>{reservation.reservationId}</code></dd>
              <dt>Expires</dt><dd><Time value={reservation.expiresAt} /></dd>
            </dl>
          ) : <p className="meta">Reservation <code>{order.reservationId}</code>: detail unavailable.</p>}
        </section>
        <section className="panel" data-testid="erp-panel">
          <H>ERP progress</H>
          <p><ErpBadge erp={erp} /></p>
          {erp.detail && <p className="meta">{erp.detail}</p>}
          <dl className="facts">
            {erp.fulfillmentRequestId && (<><dt>Request</dt><dd><code>{erp.fulfillmentRequestId}</code>{erp.linkMode === 'derived' && <span className="meta"> (derived link)</span>}</dd></>)}
            {erp.dispatch && (<><dt>Dispatch</dt><dd><code>{erp.dispatch}</code></dd></>)}
            {erp.erpAcknowledgement && (<><dt>Acknowledgement</dt><dd><code>{erp.erpAcknowledgement}</code></dd></>)}
            {erp.outcome && (<><dt>Outcome</dt><dd><code>{erp.outcome}</code>{erp.revision != null && <span className="meta"> · revision {erp.revision}</span>}</dd></>)}
            {erp.needsAttentionReason && (<><dt>Attention</dt><dd><code>{erp.needsAttentionReason}</code></dd></>)}
            {erp.uploads != null && (<><dt>Attempts</dt><dd>{erp.uploads} upload(s), {erp.resends ?? 0} resend(s)</dd></>)}
            {erp.statusAt && (<><dt>ERP status at</dt><dd><Time value={erp.statusAt} /></dd></>)}
          </dl>
        </section>
      </section>

      <section className="panel" aria-labelledby="timeline-h">
        <H id="timeline-h">Timeline</H>
        {summary.timeline.length === 0 ? <p className="meta">No timeline entries were returned.</p> : (
          <ol className="timeline" data-testid="timeline">
            {summary.timeline.map((e) => (
              <li key={e.sequence} className={`timeline-${e.kind.toLowerCase()}`}>
                <div className="timeline-head"><Time value={e.occurredAt} /> <span>{e.description}</span></div>
                <div className="timeline-ids">
                  <Ids label="reason" value={e.reasonCode} />
                  <Ids label="event" value={e.eventType} />
                  <Ids label="trace" value={e.traceId} />
                  <Ids label="correlation" value={e.correlationId} />
                  <Ids label="event id" value={e.eventId} />
                </div>
              </li>
            ))}
          </ol>
        )}
        {!summary.timelineComplete && <p className="meta">Older entries were not loaded.</p>}
      </section>

      <section className="panel" aria-labelledby="evidence-h">
        <H id="evidence-h">Evidence</H>
        <p className="meta">Diagnosis without OpenShift access: these IDs and revisions identify the same request in every service.</p>
        <dl className="facts">
          <dt>Trace ID</dt><dd><code>{order.traceId ?? '—'}</code></dd>
          <dt>Correlation ID</dt><dd><code>{order.correlationId ?? '—'}</code></dd>
        </dl>
        <ul className="evidence" data-testid="evidence">
          {summary.evidence.map((l) => (
            <li key={l.kind} data-kind={l.kind} data-available={l.available}>
              {l.available && l.href ? <a href={l.href} rel="noreferrer noopener" target="_blank">{l.label}</a> : <span>{l.label}</span>}
              {!l.available && l.reason && <span className="meta"> — not available: {l.reason}</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
