import { api } from '../api/client';
import { useResource } from '../api/useResource';
import { SourcesBanner } from '../components/Sources';
import { Empty, Loading, ProblemView } from '../components/States';
import { useSession } from '../session';

/** Read-only until the scenario controller (#19) exists; no fault actions are offered here (D-010). */
export function Demo() {
  const me = useSession();
  const { state, reload } = useResource((signal) => api.GET('/api/v1/scenarios', { signal }), []);
  return (
    <>
      <h1>Demo control</h1>
      <p>Environment: <strong>{me.environment}</strong>. Named fault scenarios are started and stopped only by the scenario controller.</p>
      {state.kind === 'loading' && <Loading label="Loading scenarios" />}
      {state.kind === 'error' && <ProblemView problem={state.problem} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <SourcesBanner sources={state.data.sources} />
          {state.data.items.length === 0
            ? <Empty title="No named scenarios available">The console offers no fault actions until the scenario controller is deployed.</Empty>
            : <ul>{state.data.items.map((s) => <li key={s.name}><code>{s.name}</code> {s.description}</li>)}</ul>}
          <p>Telemetry load and chaos: <a href={state.data.telemetryConsoleUrl}>asset telemetry console</a>.</p>
        </>
      )}
    </>
  );
}
