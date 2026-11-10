import type { Schemas } from '../api/client';

type Site = Schemas['Site'];
type Shape = 'circle' | 'triangle' | 'square' | 'diamond';

/** How a site's state is shown: always a text label and a shape, never colour alone (WCAG 1.4.1). */
export interface ShownState { key: string; label: string; tone: string; shape: Shape }

const STATES: Record<string, ShownState> = {
  ONLINE: { key: 'ONLINE', label: 'Online', tone: 'done', shape: 'circle' },
  DEGRADED: { key: 'DEGRADED', label: 'Degraded', tone: 'attention', shape: 'triangle' },
  OFFLINE: { key: 'OFFLINE', label: 'Offline', tone: 'failure', shape: 'square' },
  UNKNOWN: { key: 'UNKNOWN', label: 'Unknown state', tone: 'unknown', shape: 'diamond' },
};
const NOT_REPORTING: ShownState = { key: 'NOT_REPORTING', label: 'No status reported', tone: 'unknown', shape: 'diamond' };
const UNAVAILABLE: ShownState = { key: 'UNAVAILABLE', label: 'Status unavailable', tone: 'unknown', shape: 'diamond' };

export function siteState(site: Site, statusRead: boolean): ShownState {
  if (site.status) return STATES[site.status.state] ?? STATES.UNKNOWN;
  return statusRead ? NOT_REPORTING : UNAVAILABLE;
}

/** "6 s ago", "4 min ago"; asset-service's age at read time when it gave one, else from the timestamp. */
export function ago(ageSeconds: number | null | undefined, at: string | null | undefined): string {
  let s = ageSeconds ?? (at ? Math.round((Date.now() - new Date(at).getTime()) / 1000) : null);
  if (s == null || Number.isNaN(s)) return '—';
  s = Math.max(0, s);
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** A shape drawn around (0, 0) with radius r. */
function ShapePath({ shape, r, className }: { shape: Shape; r: number; className?: string }) {
  switch (shape) {
    case 'circle': return <circle className={className} r={r} />;
    case 'triangle': return <polygon className={className} points={`0,${-r * 1.15} ${r * 1.1},${r * 0.8} ${-r * 1.1},${r * 0.8}`} />;
    case 'square': return <rect className={className} x={-r * 0.85} y={-r * 0.85} width={r * 1.7} height={r * 1.7} />;
    default: return <polygon className={className} points={`0,${-r * 1.1} ${r * 1.1},0 0,${r * 1.1} ${-r * 1.1},0`} />;
  }
}

/** Inner mark that repeats the meaning in black and white: tick, exclamation, cross, question mark. */
function Glyph({ shape, r }: { shape: Shape; r: number }) {
  const k = r / 10;
  switch (shape) {
    case 'circle': return <path className="glyph" d={`M${-4.5 * k},${0.5 * k} L${-1.2 * k},${3.8 * k} L${5 * k},${-3.5 * k}`} />;
    case 'triangle': return <path className="glyph" d={`M0,${-4.5 * k} L0,${2 * k} M0,${4.2 * k} L0,${5 * k}`} />;
    case 'square': return <path className="glyph" d={`M${-4 * k},${-4 * k} L${4 * k},${4 * k} M${4 * k},${-4 * k} L${-4 * k},${4 * k}`} />;
    default: return <path className="glyph" d={`M${-3 * k},${-2.5 * k} Q0,${-6.5 * k} ${3 * k},${-2.5 * k} Q${3 * k},0 0,${1.2 * k} L0,${2.5 * k} M0,${4.6 * k} L0,${5.4 * k}`} />;
  }
}

export function StateIcon({ shown }: { shown: ShownState }) {
  return (
    <svg className="state-icon" viewBox="-12 -12 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <ShapePath shape={shown.shape} r={10} className="marker-shape" />
      <Glyph shape={shown.shape} r={10} />
    </svg>
  );
}

export function SiteStateBadge({ site, statusRead }: { site: Site; statusRead: boolean }) {
  const shown = siteState(site, statusRead);
  return (
    <span className={`badge site-state tone-${shown.tone}`} data-site-state={shown.key}>
      <StateIcon shown={shown} /> {shown.label}
    </span>
  );
}

const W = 640;
const H = 320;
const PAD = 36;

/**
 * A self-contained schematic map: fixed places from the console's configuration, no tiles, images or fonts from
 * anywhere (the CSP stays default-src 'self'). Each marker is a link to the site's row in the status table, so it is
 * reachable with Tab and named for assistive technology. Sites without a configured place are listed below it.
 */
export function SiteMap({ sites, statusRead }: { sites: Site[]; statusRead: boolean }) {
  const placed = sites.filter((s) => s.location);
  const unplaced = sites.filter((s) => !s.location);
  const focusRow = (siteId: string) => (e: React.MouseEvent) => {
    const row = document.getElementById(`site-row-${siteId}`);
    if (!row) return;
    e.preventDefault();
    row.scrollIntoView({ block: 'center' });
    row.focus({ preventScroll: true });
  };
  return (
    <figure className="site-map-figure">
      <svg className="site-map" viewBox={`0 0 ${W} ${H}`} role="group" aria-labelledby="site-map-caption" data-testid="site-map">
        <rect className="map-sea" x="0" y="0" width={W} height={H} rx="6" />
        <path className="map-land" d={`M40,70 C90,30 200,40 260,52 C330,66 360,30 430,38 C520,48 590,60 606,110 C620,160 596,214 560,250
          C520,286 430,290 360,278 C300,268 250,292 180,286 C110,280 52,252 38,200 C26,156 20,104 40,70 Z`} />
        <line className="map-divider" x1={W / 2} y1="22" x2={W / 2} y2={H - 22} />
        <text className="map-region" x="24" y="28">West</text>
        <text className="map-region" x={W - 24} y="28" textAnchor="end">East</text>
        <g className="map-compass" transform={`translate(${W - 30}, ${H - 46})`} aria-hidden="true">
          <path d="M0,-14 L6,6 L0,2 L-6,6 Z" />
          <text y="22" textAnchor="middle">N</text>
        </g>
        {placed.map((site) => {
          const shown = siteState(site, statusRead);
          const x = PAD + ((site.location!.x / 100) * (W - 2 * PAD));
          const y = PAD + ((site.location!.y / 100) * (H - 2 * PAD));
          const st = site.status;
          // The name starts with the visible text (WCAG 2.5.3), then adds what only the table shows.
          const name = [
            `${site.siteId} ${shown.label}`,
            site.location!.region,
            st?.lastSeenAt ? `last seen ${ago(st.lastSeenAgeSeconds, st.lastSeenAt)}` : null,
            site.activeAlerts == null ? null : `${site.activeAlerts} active ${site.activeAlerts === 1 ? 'alert' : 'alerts'}`,
          ].filter(Boolean).join(', ');
          return (
            <a key={site.siteId} href={`#site-row-${site.siteId}`} className={`map-marker tone-${shown.tone}`}
              aria-label={name} data-site={site.siteId} data-site-state={shown.key} onClick={focusRow(site.siteId)}>
              <g transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)})`}>
                <circle className="marker-focus" r="22" />
                <ShapePath shape={shown.shape} r={12} className="marker-shape" />
                <Glyph shape={shown.shape} r={12} />
                <text textAnchor="middle">
                  <tspan className="marker-label" x="0" y="32">{site.siteId}</tspan>{' '}
                  <tspan className="marker-state" x="0" y="48">{shown.label}</tspan>
                </text>
              </g>
            </a>
          );
        })}
      </svg>
      <figcaption id="site-map-caption" className="meta">
        Site map (schematic, not to scale): places come from the console's configuration. Select a site to go to its row.
        {' '}Shapes: circle with tick online, triangle with exclamation degraded, square with cross offline, diamond with question
        mark no or unknown status.
      </figcaption>
      {unplaced.length > 0 && (
        <p className="meta" data-testid="unplaced-sites">
          Not on the map (no place configured):{' '}
          {unplaced.map((s, i) => (
            <span key={s.siteId}>{i > 0 && ', '}<a href={`#site-row-${s.siteId}`} onClick={focusRow(s.siteId)}><code>{s.siteId}</code></a>
              {' '}({siteState(s, statusRead).label.toLowerCase()})</span>
          ))}
        </p>
      )}
    </figure>
  );
}
