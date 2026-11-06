import { Button } from 'react-aria-components';
import type { Problem } from '../api/client';
import { Time } from './Badges';

/** "Updated hh:mm" with a pause control for auto-updating pages (WCAG 2.2.2) and a quiet note if a refresh failed. */
export function LiveStatus({ loadedAt, refreshing, refreshFailed, paused, onToggle, final }: {
  loadedAt: Date; refreshing: boolean; refreshFailed: Problem | null; paused: boolean; onToggle: () => void; final?: boolean;
}) {
  return (
    <p className="meta live-status">
      Updated <Time value={loadedAt.toISOString()} />{refreshing && ' · refreshing'}
      {refreshFailed && <span className="refresh-failed"> · last refresh failed ({refreshFailed.title}); showing the previous data</span>}
      {final ? ' · final state, no longer updating' : (
        <> · <Button onPress={onToggle}>{paused ? 'Resume updates' : 'Pause updates'}</Button></>
      )}
    </p>
  );
}

/** Tables keep their semantics at narrow widths and scroll inside this wrapper instead (review FE-6). */
export function TableWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
