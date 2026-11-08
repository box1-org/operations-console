import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import { Link } from 'react-router';
import { api, type Schemas } from '../api/client';
import { useResource } from '../api/useResource';
import { InlineProblem } from './AnalysisMessage';

type Step = Schemas['ChatStep'];

const POLL_MS = 1500;
/** Stop polling after this long; agentic-operations ends a turn within 90 s, so this only guards against a stall. */
const POLL_CAP_MS = 3 * 60 * 1000;

const TOOL_LABEL: Record<string, string> = {
  get_order_timeline: 'Read order timeline',
  get_fulfillment_status: 'Read fulfillment status',
  get_inventory_reservation: 'Read inventory reservation',
  list_recent_events: 'Read recent events',
  get_deployed_revision: 'Read deployed revision',
  get_analysis: 'Read analysis',
};

const DECISION_TEXT: Record<string, string> = {
  invalid_argument: 'refused: invalid argument',
  unknown_tool: 'refused: not an available tool',
  not_found: 'not found',
  limit: 'skipped: read budget used up',
  error: 'failed',
};

/** What each final status without an answer means, in plain words. Nothing is guessed in its place. */
const NO_ANSWER: Record<string, string> = {
  MODEL_UNAVAILABLE: 'The model did not answer, so there is no reply. Nothing was guessed in its place.',
  MODEL_INVALID_OUTPUT: 'The model’s reply was cut off or unusable and was discarded.',
  FAILED: 'This message could not be answered.',
};

/**
 * One Assistant reply (box1-docs#101): polls the conversation in agentic-operations until this turn is final, showing
 * each read-only tool step as it lands. The answer is model text, shown as plain text and labelled as such.
 */
export function ChatTurnMessage({ conversationId, turnId, onSettled }: {
  conversationId: string; turnId: string; onSettled?: (turnId: string) => void;
}) {
  const started = useRef(Date.now());
  const [capped, setCapped] = useState(false);
  const [settled, setSettled] = useState(false);
  const { state, reload } = useResource(
    (signal) => api.GET('/api/v1/assistant/conversations/{conversationId}', { params: { path: { conversationId } }, signal }),
    [conversationId], { refreshMs: settled || capped ? undefined : POLL_MS });

  const turn = state.kind === 'ready' ? state.data.turns.find((t) => t.turnId === turnId) : undefined;
  // Final, missing, refused or expired: asking again will not change it (5xx keeps retrying until the cap).
  const nowSettled = (turn?.finished ?? false)
    || (state.kind === 'ready' && !turn)
    || (state.kind === 'error' && state.problem.status >= 400 && state.problem.status < 500);
  useEffect(() => {
    if (nowSettled) {
      setSettled(true);
      onSettled?.(turnId);
    }
  }, [nowSettled, onSettled, turnId]);
  useEffect(() => {
    if (settled) {
      return;
    }
    const t = window.setTimeout(() => {
      setCapped(true);
      onSettled?.(turnId);
    }, Math.max(0, POLL_CAP_MS - (Date.now() - started.current)));
    return () => window.clearTimeout(t);
  }, [settled, onSettled, turnId]);

  if (state.kind === 'loading') {
    return <p className="meta" role="status"><span className="spinner" aria-hidden="true" />Waiting for the assistant…</p>;
  }
  if (state.kind === 'error') {
    return <InlineProblem problem={state.problem} onRetry={state.problem.status >= 500 ? reload : undefined} />;
  }
  if (!turn) {
    return <p className="meta">This reply is no longer available: the conversation was restarted.</p>;
  }
  return (
    <div className="chat-turn" data-testid="chat-turn" data-status={turn.status ?? ''}>
      {!turn.finished && (
        <p className="meta" role="status">
          {capped ? <>Still working after three minutes; updates stopped. <Button onPress={() => { setCapped(false); started.current = Date.now(); reload(); }}>Check again</Button></>
            : <><span className="spinner" aria-hidden="true" />{turn.status === 'QUEUED' ? 'Waiting for the model' : 'Thinking'}…</>}
        </p>
      )}
      {!turn.finished && turn.steps.length > 0 && <Steps steps={turn.steps} finished={false} />}
      {turn.finished && turn.answer != null && (
        <>
          <p className="chat-answer" data-testid="chat-answer">{turn.answer}</p>
          {turn.status === 'LIMIT_REACHED' && (
            <p className="meta">The read budget for this message ran out, so this answer may be incomplete.</p>
          )}
          <p className="meta chat-disclaimer">Answers come from a model and can be wrong; check the sources.</p>
        </>
      )}
      {turn.finished && turn.answer == null && (
        <p className="callout tone-failure" data-testid="chat-no-answer">
          {NO_ANSWER[turn.status ?? ''] ?? 'There is no reply for this message.'}{turn.statusDetail && <> ({turn.statusDetail})</>}
        </p>
      )}
      {turn.finished && turn.steps.length > 0 && <Steps steps={turn.steps} finished />}
    </div>
  );
}

function Steps({ steps, finished }: { steps: Step[]; finished: boolean }) {
  return (
    <details className="chat-steps" open={!finished} data-testid="chat-steps">
      <summary>{finished ? 'Sources consulted' : 'Reading'} ({steps.length})</summary>
      <ul>
        {steps.map((s, i) => (
          <li key={i}>
            {TOOL_LABEL[s.tool ?? ''] ?? 'Unknown tool'}
            {s.target && s.target !== '-' && <> · <Target id={s.target} /></>}
            {' · '}
            {s.decision === 'ok'
              ? <span className={`badge tone-${s.retrievalStatus === 'OK' ? 'done' : 'unknown'}`}>{s.retrievalStatus ?? 'OK'}</span>
              : <span className="badge tone-attention">{DECISION_TEXT[s.decision ?? ''] ?? s.decision}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Validated IDs link to the console's own pages; anything else is shown as text. */
function Target({ id }: { id: string }) {
  if (/^ord_[A-Za-z0-9_-]{1,64}$/.test(id)) return <Link to={`/orders/${id}`}><code>{id}</code></Link>;
  return <code>{id}</code>;
}
