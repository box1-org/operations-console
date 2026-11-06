import { useState } from 'react';
import { Button } from 'react-aria-components';
import { api, asProblem, type Problem, type Schemas } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from '../components/Badges';
import { SourcesBanner } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';
import { useHasRole, useScenarioOperator, useSession } from '../session';

type Scenario = Schemas['Scenario'];
type Run = Schemas['ScenarioRun'];

const ACTIVE = new Set(['RUNNING', 'AWAITING_OPERATOR']);
const STATUS_TONE: Record<string, string> = {
  RUNNING: 'waiting', AWAITING_OPERATOR: 'attention', VERIFIED: 'done', NOT_VERIFIED: 'attention', FAILED: 'failure',
  STOPPED: 'neutral', EXPIRED: 'neutral', ABORTED_RESTART: 'attention',
};
const STATUS_LABEL: Record<string, string> = {
  RUNNING: 'Running', AWAITING_OPERATOR: 'Waiting for you', VERIFIED: 'Verified', NOT_VERIFIED: 'Not verified',
  FAILED: 'Failed', STOPPED: 'Stopped', EXPIRED: 'Expired', ABORTED_RESTART: 'Aborted by a restart',
};
const MECHANISM_LABEL: Record<string, string> = {
  SERVICE_API: 'Service API', GUIDED_ERP: 'Guided ERP step', VM_LEVEL: 'VM level', PLATFORM: 'Platform',
};

function RunBadge({ status }: { status?: string | null }) {
  const s = status ?? 'UNKNOWN';
  return <span className={`badge tone-${STATUS_TONE[s] ?? 'unknown'}`} data-run-status={s}>{STATUS_LABEL[s] ?? s}</span>;
}

/** Runs one console action and reports its Problem, so every button shows the controller's own words on refusal. */
function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  async function run<T>(label: string, call: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T | null> {
    setBusy(label);
    setProblem(null);
    try {
      const { data, error, response } = await call();
      if (data !== undefined && response.ok) return data;
      setProblem(asProblem(error, response.status));
    } catch (e) {
      setProblem(asProblem(e, 0));
    } finally {
      setBusy(null);
    }
    return null;
  }
  return { busy, problem, run, clear: () => setProblem(null) };
}

/**
 * Demo control through the scenario controller (box1-docs#19). Viewers see the catalog, runs and audit; people with
 * console-operator here and scenario-operator on the controller can seed, start, stop, reset and confirm steps. The
 * controller enforces its roles itself and names the person in its audit.
 */
export function Demo() {
  const me = useSession();
  const consoleOperator = useHasRole('console-operator');
  const scenarioOperator = useScenarioOperator();
  const canAct = consoleOperator && scenarioOperator;
  const catalog = useResource((signal) => api.GET('/api/v1/scenarios', { signal }), []);
  const runs = useResource((signal) => api.GET('/api/v1/scenario-runs', { signal }), [], { refreshMs: 3000 });
  const action = useAction();
  const [seeded, setSeeded] = useState<Schemas['SeedResult'] | null>(null);
  const [reset, setReset] = useState<Schemas['ResetResult'] | null>(null);

  const runList = runs.state.kind === 'ready' ? runs.state.data.items : [];
  const active = runList.find((r) => r.status && ACTIVE.has(r.status) && !r.endedAt);

  async function seed() {
    const r = await action.run('seed', () => api.POST('/api/v1/scenario-fixtures/seed', { body: {} }));
    if (r) setSeeded(r);
  }

  async function doReset(name: string) {
    const r = await action.run(`reset:${name}`, () => api.POST('/api/v1/scenarios/{name}/reset', { params: { path: { name } }, body: {} }));
    if (r) {
      setReset(r);
      runs.reload();
    }
  }

  return (
    <>
      <title>Demo control · box1 Operations</title>
      <div className="page-head">
        <h1>Demo control</h1>
        {canAct && (
          <Button onPress={() => void seed()} isDisabled={action.busy !== null} data-testid="seed">
            {action.busy === 'seed' ? 'Seeding…' : 'Seed fixtures'}
          </Button>
        )}
      </div>
      <p>
        Environment: <strong>{me.environment}</strong>. Scenarios run in the scenario controller, which checks the end state
        before it reports success and puts the fixture stock back afterwards. It changes data only through each service&apos;s own API.
      </p>
      {consoleOperator && !scenarioOperator && (
        <p className="callout tone-unknown" data-testid="needs-scenario-role">
          Starting scenarios also needs the <code>scenario-operator</code> role on the scenario controller. You can follow runs here.
        </p>
      )}
      {seeded && (
        <p className="callout tone-done" role="status" data-testid="seeded">
          Fixtures seeded: {seeded.created} created, {seeded.unchanged} already in place.
        </p>
      )}
      {reset && (
        <p className="callout tone-done" role="status" data-testid="reset-result">
          Reset: <strong>{reset.resetResult}</strong>{reset.resetDetail && <> — {reset.resetDetail}</>}
        </p>
      )}
      {action.problem && <ProblemView problem={action.problem} />}

      {active && <ActiveRun runId={active.scenarioRunId} canAct={canAct} onEnded={runs.reload} />}

      <h2>Scenarios</h2>
      {catalog.state.kind === 'loading' && <Loading label="Loading scenarios" />}
      {catalog.state.kind === 'error' && <ProblemView problem={catalog.state.problem} onRetry={catalog.reload} />}
      {catalog.state.kind === 'ready' && (
        <>
          <SourcesBanner sources={catalog.state.data.sources} />
          {catalog.state.data.items.length === 0
            ? <Empty title="No scenarios to show">The scenario controller did not return its catalog.</Empty>
            : (
              <ul className="panel-grid scenario-grid" aria-label="Scenarios">
                {catalog.state.data.items.map((s) => (
                  <ScenarioCard key={s.name} scenario={s} canAct={canAct} blocked={Boolean(active) || action.busy !== null}
                    onStarted={runs.reload} onReset={() => void doReset(s.name)} resetting={action.busy === `reset:${s.name}`} />
                ))}
              </ul>
            )}
          <p className="meta">Telemetry load and chaos are in the <a href={catalog.state.data.telemetryConsoleUrl}>asset telemetry console</a>.</p>
        </>
      )}

      <h2>Recent runs</h2>
      {runs.state.kind === 'loading' && <Loading label="Loading runs" />}
      {runs.state.kind === 'error' && <ProblemView problem={runs.state.problem} onRetry={runs.reload} />}
      {runs.state.kind === 'ready' && (
        <>
          <SourcesBanner sources={runs.state.data.sources} />
          {runList.length === 0 ? <Empty title="No runs yet" /> : <RunTable runs={runList} />}
        </>
      )}

      <AuditSection />
      <FixturesSection />
    </>
  );
}

function ScenarioCard({ scenario: s, canAct, blocked, onStarted, onReset, resetting }: {
  scenario: Scenario; canAct: boolean; blocked: boolean; onStarted: () => void; onReset: () => void; resetting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  const available = s.availability === 'AVAILABLE';

  async function start() {
    const r = await action.run('start', () => api.POST('/api/v1/scenarios/{name}/start', { params: { path: { name: s.name } }, body: {} }));
    if (r) {
      setConfirming(false);
      onStarted();
    }
  }

  return (
    <li className="panel scenario" data-scenario={s.name} data-availability={s.availability}>
      <h3>{s.title ?? s.name}</h3>
      <p className="meta"><code>{s.name}</code>{s.mechanism && <> · {MECHANISM_LABEL[s.mechanism] ?? s.mechanism}</>}
        {s.defaultDurationSeconds != null && <> · up to {Math.round(s.defaultDurationSeconds / 60)} min</>}</p>
      {s.description && <p>{s.description}</p>}
      {!available && (
        <p className="callout tone-unknown" data-testid="not-yet-possible"><strong>Not yet possible.</strong> {s.notPossibleReason}</p>
      )}
      {available && s.expectedObservation && <p><span className="id-label">Checks:</span> {s.expectedObservation}</p>}
      {available && s.operatorSteps.length > 0 && (
        <>
          <p className="id-label">Your steps, when the run asks:</p>
          <ol className="steps">{s.operatorSteps.map((step) => <li key={step}>{step}</li>)}</ol>
        </>
      )}
      {available && canAct && !confirming && (
        <p className="actions">
          <Button onPress={() => { action.clear(); setConfirming(true); }} isDisabled={blocked} data-testid={`start-${s.name}`}>Start…</Button>{' '}
          <Button onPress={onReset} isDisabled={blocked} data-testid={`reset-${s.name}`}>{resetting ? 'Resetting…' : 'Reset stock'}</Button>
        </p>
      )}
      {confirming && (
        <div className="callout tone-attention" role="group" aria-label={`Confirm starting ${s.title ?? s.name}`} data-testid="confirm-start">
          <p>Start <strong>{s.title ?? s.name}</strong> in this environment? It places fixture orders through the order service.
            {s.resetAction && <> Afterwards: {s.resetAction}</>}</p>
          <p className="actions">
            <Button onPress={() => void start()} isDisabled={action.busy !== null} data-testid="confirm-start-button">
              {action.busy ? 'Starting…' : 'Start scenario'}</Button>{' '}
            <Button onPress={() => setConfirming(false)} isDisabled={action.busy !== null}>Cancel</Button>
          </p>
        </div>
      )}
      {action.problem && <ProblemView problem={action.problem} />}
    </li>
  );
}

/** The run in progress, polled every 3 s: its status, what the operator must do now, and stop/confirm. */
function ActiveRun({ runId, canAct, onEnded }: { runId: string; canAct: boolean; onEnded: () => void }) {
  const { state } = useResource((signal) => api.GET('/api/v1/scenario-runs/{scenarioRunId}',
    { params: { path: { scenarioRunId: runId } }, signal }), [runId], { refreshMs: 3000 });
  const action = useAction();
  if (state.kind !== 'ready') return state.kind === 'error' ? <ProblemView problem={state.problem} /> : <Loading label="Loading the active run" />;
  const run = state.data;

  async function stop() {
    if (!run.scenario) return;
    const name = run.scenario;
    if (await action.run('stop', () => api.POST('/api/v1/scenarios/{name}/stop', { params: { path: { name } }, body: {} }))) onEnded();
  }

  async function confirm(step: string) {
    await action.run('confirm', () => api.POST('/api/v1/scenario-runs/{scenarioRunId}/confirm',
      { params: { path: { scenarioRunId: run.scenarioRunId } }, body: { step } }));
  }

  return (
    <section className="panel active-run" aria-live="polite" data-testid="active-run" data-run-status={run.status ?? ''}>
      <div className="page-head">
        <h2>{run.title ?? run.scenario} <RunBadge status={run.status} /></h2>
        {canAct && run.status && ACTIVE.has(run.status) && (
          <Button onPress={() => void stop()} isDisabled={action.busy !== null} data-testid="stop">{action.busy === 'stop' ? 'Stopping…' : 'Stop'}</Button>
        )}
      </div>
      {/* The controller keeps the last step's text on the run; it is the operator's task only while the run waits. */}
      {run.status === 'AWAITING_OPERATOR' && run.operatorStep && (
        <div className="callout tone-attention" data-testid="operator-step">
          <p><strong>Your step:</strong> {run.operatorStep}</p>
          {run.operatorStepId && canAct && (
            <p><Button onPress={() => void confirm(run.operatorStepId!)} isDisabled={action.busy !== null} data-testid="confirm-step">
              {action.busy === 'confirm' ? 'Recording…' : 'I have done this'}</Button>
              <span className="meta"> Recorded in the audit under your name ({run.operatorStepId}).</span></p>
          )}
        </div>
      )}
      {run.detail && <p>{run.detail}</p>}
      <dl className="facts">
        <dt>Run</dt><dd><code>{run.scenarioRunId}</code></dd>
        <dt>Started</dt><dd><Time value={run.startedAt} />{run.startedStardate && <span className="meta"> · stardate {run.startedStardate}</span>}</dd>
        <dt>Time limit</dt><dd>{run.expiresAt ? <>until <Time value={run.expiresAt} /></> : '—'}</dd>
        <dt>Started by</dt><dd>{run.actor ?? '—'}</dd>
      </dl>
      {action.problem && <ProblemView problem={action.problem} />}
    </section>
  );
}

function RunTable({ runs }: { runs: Run[] }) {
  return (
    <table className="table" data-testid="runs">
      <thead><tr><th>Scenario</th><th>Status</th><th>Started</th><th>By</th><th>Reset</th></tr></thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.scenarioRunId} data-run={r.scenarioRunId}>
            <td>{r.title ?? r.scenario}<br /><code className="meta">{r.scenarioRunId}</code></td>
            <td><RunBadge status={r.status} />{r.detail && <div className="meta">{r.detail}</div>}</td>
            <td><Time value={r.startedAt} /></td>
            <td>{r.actor ?? '—'}</td>
            <td>{r.resetResult ?? '—'}{r.resetDetail && <div className="meta">{r.resetDetail}</div>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuditSection() {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><h2 className="inline">Audit trail</h2></summary>
      {open && <AuditTable />}
    </details>
  );
}

function AuditTable() {
  const { state, reload } = useResource((signal) => api.GET('/api/v1/scenario-audit', { signal }), []);
  if (state.kind === 'loading') return <Loading label="Loading the audit trail" />;
  if (state.kind === 'error') return <ProblemView problem={state.problem} onRetry={reload} />;
  return (
    <>
      <SourcesBanner sources={state.data.sources} />
      {state.data.items.length === 0 ? <Empty title="No audit records" /> : (
        <table className="table" data-testid="audit">
          <thead><tr><th>When</th><th>Action</th><th>Outcome</th><th>Who</th><th>Detail</th></tr></thead>
          <tbody>
            {state.data.items.map((a) => (
              <tr key={a.seq ?? `${a.scenarioRunId}-${a.action}-${a.occurredAt}`}>
                <td><Time value={a.occurredAt} /></td>
                <td><code>{a.action}</code>{a.scenario && <div className="meta">{a.scenario}</div>}</td>
                <td>{a.outcome}</td>
                <td>{a.actor}</td>
                <td>{a.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function FixturesSection() {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><h2 className="inline">Fixtures</h2></summary>
      {open && <FixturesView />}
    </details>
  );
}

function FixturesView() {
  const { state, reload } = useResource((signal) => api.GET('/api/v1/scenario-fixtures', { signal }), []);
  if (state.kind === 'loading') return <Loading label="Loading fixtures" />;
  if (state.kind === 'error') return <ProblemView problem={state.problem} onRetry={reload} />;
  const f = state.data;
  return (
    <>
      <SourcesBanner sources={f.sources} />
      <div className="panel-grid">
        <section className="panel"><h3>Sites</h3>
          <ul>{f.sites.map((s) => <li key={s.siteId}>{s.displayName} <code className="meta">{s.siteId}</code>{s.status !== 'ACTIVE' && <> · {s.status}</>}</li>)}</ul></section>
        <section className="panel"><h3>Customers</h3>
          <ul>{f.customers.map((c) => <li key={c.customerId}>{c.displayName} <code className="meta">{c.customerId}</code></li>)}</ul></section>
        <section className="panel"><h3>Products</h3>
          <ul>{f.products.map((p) => <li key={p.sku}>{p.displayName} <code className="meta">{p.sku}</code></li>)}</ul></section>
      </div>
      <table className="table">
        <thead><tr><th>Site</th><th>SKU</th><th>Opening stock</th></tr></thead>
        <tbody>{f.stock.map((s) => <tr key={`${s.siteId}/${s.sku}`}><td>{s.siteId}</td><td>{s.sku}</td><td>{s.openingQuantity}</td></tr>)}</tbody>
      </table>
    </>
  );
}
