import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import { Link } from 'react-router';
import { api, type Problem } from '../api/client';
import { useResource } from '../api/useResource';
import { Time } from './Badges';


const POLL_MS = 2000;
/** Stop polling after this long; the analysis keeps running in agentic-operations and can be shown again. */
const POLL_CAP_MS = 3 * 60 * 1000;

const STATUS_TONE: Record<string, string> = {
  QUEUED: 'waiting', RUNNING: 'waiting', COMPLETED: 'done', DEGRADED: 'attention',
  MODEL_UNAVAILABLE: 'failure', MODEL_INVALID_OUTPUT: 'failure', FAILED: 'failure',
};

/** What each final status without a usable diagnosis means, in plain words. Nothing is ever guessed in its place. */
const NO_DIAGNOSIS: Record<string, string> = {
  MODEL_UNAVAILABLE: 'The model did not answer, so there is no diagnosis. Nothing was guessed in its place.',
  MODEL_INVALID_OUTPUT: 'The model’s answer failed validation and was discarded, so there is no diagnosis.',
  FAILED: 'The analysis failed before it produced a diagnosis.',
};

const RETRIEVAL_TONE: Record<string, string> = { OK: 'done', UNAVAILABLE: 'unknown', NOT_FOUND: 'neutral' };

/** One analysis in the Assistant transcript: polls agentic-operations (through the console) until it is final. */
export function AnalysisMessage({ analysisId }: { analysisId: string }) {
  const started = useRef(Date.now());
  const [capped, setCapped] = useState(false);
  const [finished, setFinished] = useState(false);
  const [refused, setRefused] = useState(false);
  const { state, reload } = useResource(
    (signal) => api.GET('/api/v1/assistant/analyses/{analysisId}', { params: { path: { analysisId } }, signal }),
    [analysisId], { refreshMs: finished || capped || refused ? undefined : POLL_MS });

  // An expired, unknown or refused analysis will not change by asking again: stop polling (5xx keeps retrying).
  const nowRefused = state.kind === 'error' && state.problem.status >= 400 && state.problem.status < 500;
  useEffect(() => {
    if (nowRefused) setRefused(true);
  }, [nowRefused]);

  const nowFinished = state.kind === 'ready' && state.data.finished;
  useEffect(() => {
    if (nowFinished) setFinished(true);
  }, [nowFinished]);
  useEffect(() => {
    if (finished) return;
    const t = window.setTimeout(() => setCapped(true), Math.max(0, POLL_CAP_MS - (Date.now() - started.current)));
    return () => window.clearTimeout(t);
  }, [finished]);

  if (state.kind === 'loading') {
    return <p className="meta" role="status"><span className="spinner" aria-hidden="true" />Fetching analysis <code>{analysisId}</code>…</p>;
  }
  if (state.kind === 'error') {
    return <InlineProblem problem={state.problem} onRetry={state.problem.status >= 500 ? reload : undefined} />;
  }
  const a = state.data;
  return (
    <article className="analysis" aria-label={`Analysis ${a.analysisId}`} data-testid="analysis" data-status={a.status}>
      <header className="analysis-head">
        <span className={`badge tone-${STATUS_TONE[a.status] ?? 'neutral'}`} data-testid="analysis-status">{a.status}</span>
        <span className="meta">
          Analysis <code>{a.analysisId}</code>
          {a.incidentId && <> for <Link to={`/incidents/${a.incidentId}`}>{a.incidentId}</Link></>}
          {a.incidentType && <> · {a.incidentType}</>}
        </span>
      </header>
      {!a.finished && (
        <p className="meta" role="status">
          {capped ? <>Still {a.status.toLowerCase()} after three minutes; updates stopped. <Button onPress={() => { setCapped(false); started.current = Date.now(); reload(); }}>Check again</Button></>
            : <><span className="spinner" aria-hidden="true" />{a.status === 'QUEUED' ? 'Queued for the model' : 'Analyzing the evidence'}…</>}
        </p>
      )}
      {a.finished && NO_DIAGNOSIS[a.status] && (
        <p className="callout tone-failure" data-testid="no-diagnosis">
          {NO_DIAGNOSIS[a.status]}{a.statusDetail && <> ({a.statusDetail})</>}
        </p>
      )}
      {a.status === 'DEGRADED' && (
        <p className="callout tone-attention">
          Some core evidence could not be retrieved; read these findings with that in mind.{a.statusDetail && <> ({a.statusDetail})</>}
        </p>
      )}
      {a.summary && <p className="analysis-summary">{a.summary}</p>}
      {a.findings.length > 0 && (
        <section>
          <h3>Findings</h3>
          <ul className="findings">
            {a.findings.map((f, i) => (
              <li key={i}>
                {f.statement}{' '}
                {f.confidence && <span className="badge tone-neutral">{f.confidence.toLowerCase()} confidence</span>}{' '}
                <span className="meta">
                  Evidence:{' '}
                  {f.evidenceRefs.map((ref, j) => (
                    <span key={ref}>{j > 0 && ', '}<a href={`#${a.analysisId}-${ref}`}>{ref}</a></span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.unknowns.length > 0 && (
        <section>
          <h3>Not known</h3>
          <ul>{a.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </section>
      )}
      {a.suggestedActions.length > 0 && (
        <section className="callout tone-attention proposals" data-testid="proposals">
          <h3>Proposed only — never executed</h3>
          <p className="meta">Neither the console nor agentic-operations can carry these out. A person decides and acts through the normal change process.</p>
          <ul>
            {a.suggestedActions.map((s, i) => (
              <li key={i}>
                <code>{s.type}</code>{s.description && <>: {s.description}</>}
                {s.expectedEffect && <div><span className="id-label">Expected effect</span> {s.expectedEffect}</div>}
                {s.rollback && <div><span className="id-label">Rollback</span> {s.rollback}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.evidence.length > 0 && (
        <details>
          <summary>Evidence ({a.evidence.length})</summary>
          <ul className="evidence-list">
            {a.evidence.map((e) => (
              <li key={e.ref} id={`${a.analysisId}-${e.ref}`} tabIndex={-1}>
                <code>{e.ref}</code> {e.type}{e.source && <> · {e.source}</>}{' '}
                <span className={`badge tone-${RETRIEVAL_TONE[e.retrievalStatus ?? ''] ?? 'attention'}`}>{e.retrievalStatus ?? 'UNKNOWN'}</span>
                {e.detail && <div>{e.detail}</div>}
                <div className="meta">
                  {e.timestamp && <>Observed <Time value={e.timestamp} /> · </>}
                  {e.link && <SafeLink link={e.link} />}
                  {e.truncated && ' · truncated for the model'}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {a.finished && (
        <p className="meta analysis-foot">
          {a.orderId && <>Order <Link to={`/orders/${a.orderId}`}>{a.orderId}</Link> · </>}
          {a.model?.modelId && <>Model <code>{a.model.modelId}</code>{a.model.contextProfile && <> ({a.model.contextProfile})</>} · </>}
          {a.quality && <>{a.quality.citedFindings} cited finding(s), {a.quality.unsupportedAssertions} unsupported dropped, {a.quality.droppedActions} action(s) dropped · </>}
          {a.completedAt && <>Completed <Time value={a.completedAt} /></>}
        </p>
      )}
    </article>
  );
}

/** Evidence links are identifiers built by agentic-operations; only an https URL is made clickable. */
function SafeLink({ link }: { link: string }) {
  if (/^https:\/\/[^\s]+$/.test(link)) {
    return <a href={link} target="_blank" rel="noreferrer noopener">{link}</a>;
  }
  return <code>{link}</code>;
}

/** A refusal or failure inside the transcript, in plain words with its stable code. */
export function InlineProblem({ problem, onRetry }: { problem: Problem; onRetry?: () => void }) {
  if (problem.status === 401) {
    return (
      <p className="callout tone-failure" role="alert">
        Your console session has ended. <a href="/" data-testid="sign-in-again">Sign in again</a> to continue.
      </p>
    );
  }
  return (
    <div className="callout tone-failure" data-testid="assistant-problem" data-code={problem.code}>
      <strong>{problem.title}.</strong> {problem.detail}
      <div className="meta">Code <code>{problem.code}</code>{problem.status > 0 && <> · HTTP {problem.status}</>}</div>
      {onRetry && <Button onPress={onRetry}>Retry</Button>}
    </div>
  );
}
