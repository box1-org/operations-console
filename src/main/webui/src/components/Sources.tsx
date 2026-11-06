import type { SourceStatus } from '../api/client';

const NAMES: Record<string, string> = {
  'order-service': 'Order service',
  'inventory-service': 'Inventory service',
  'fulfillment-adapter': 'Fulfillment adapter',
  'asset-service': 'Asset telemetry service',
  'scenario-controller': 'Scenario controller',
};

export function sourceName(id: string): string {
  return NAMES[id] ?? id;
}

/** Names every source that did not answer fully. Values from those sources are absent, never guessed (D-006). */
export function SourcesBanner({ sources }: { sources: SourceStatus[] }) {
  const problems = sources.filter((s) => s.status !== 'OK');
  if (problems.length === 0) return null;
  const hard = problems.some((s) => s.status === 'UNAVAILABLE' || s.status === 'DEGRADED');
  return (
    <div className={`sources ${hard ? 'sources-warn' : 'sources-info'}`} role={hard ? 'alert' : 'status'} data-testid="sources-banner">
      <strong>{hard ? 'Partial data: ' : 'Not shown: '}</strong>
      <ul>
        {problems.map((s) => (
          <li key={s.source} data-source={s.source} data-status={s.status}>
            <span className="source-name">{sourceName(s.source)}</span> — {statusText(s.status)}
            {s.detail && <>: {s.detail}</>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusText(status: SourceStatus['status']): string {
  switch (status) {
    case 'UNAVAILABLE': return 'unavailable';
    case 'DEGRADED': return 'incomplete';
    case 'NOT_AUTHORIZED': return 'refused the console';
    case 'NOT_CONFIGURED': return 'not connected';
    default: return 'OK';
  }
}
