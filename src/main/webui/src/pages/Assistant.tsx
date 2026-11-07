import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from 'react-aria-components';
import { Link, useSearchParams } from 'react-router';
import { api, asProblem, type Problem, type Schemas } from '../api/client';
import { useResource } from '../api/useResource';
import { AnalysisMessage, InlineProblem } from '../components/AnalysisMessage';
import { Empty, Loading, ProblemView } from '../components/States';
import { useSession } from '../session';

type Incident = Schemas['Incident'];

/** One entry in the transcript. Analyses are stored by ID only and re-read from agentic-operations when shown. */
type Message =
  | { id: number; from: 'you'; text: string }
  | { id: number; from: 'bot'; kind: 'text'; text: string }
  | { id: number; from: 'bot'; kind: 'help' }
  | { id: number; from: 'bot'; kind: 'incidents'; items: Pick<Incident, 'incidentId' | 'orderId' | 'title' | 'kind'>[] }
  | { id: number; from: 'bot'; kind: 'analysis'; analysisId: string }
  | { id: number; from: 'bot'; kind: 'problem'; problem: Problem };

type BotMessage = Exclude<Message, { from: 'you' }>;
type NewBotMessage = BotMessage extends infer M ? M extends BotMessage ? Omit<M, 'id' | 'from'> : never : never;

const MAX_MESSAGES = 60;
const INCIDENT_ID = /^inc_ord_[A-Za-z0-9_-]{1,76}$/;
const ORDER_ID = /^ord_[A-Za-z0-9_-]{1,64}$/;
const ANALYSIS_ID = /^ana_[0-9a-f]{32}$/;

/** The transcript is kept per person in this browser tab only (never on the server); unreadable storage means none. */
function loadTranscript(key: string): Message[] {
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

function saveTranscript(key: string, messages: Message[]) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    // Storage full or blocked: the transcript simply is not kept.
  }
}

/** "inc_ord_x", "ord_x" or an incident link's last segment become the console's incident ID. */
export function toIncidentId(input: string): string | null {
  const v = input.trim().split('/').pop() ?? '';
  if (INCIDENT_ID.test(v)) return v;
  if (ORDER_ID.test(v)) return `inc_${v}`;
  return null;
}

/**
 * The Assistant (box1-docs#101): a chat over agentic-operations' evidence-grounded incident analysis. It runs no model
 * itself and understands a few commands; agentic-operations does the analysis with the person's own token and roles.
 */
export function Assistant() {
  const me = useSession();
  const storageKey = `box1.assistant.${me.username}`;
  const status = useResource((signal) => api.GET('/api/v1/assistant', { signal }), []);
  const [messages, setMessages] = useState<Message[]>(() => loadTranscript(storageKey));
  const [input, setInput] = useState('');
  const [working, setWorking] = useState(false);
  const [params, setParams] = useSearchParams();
  const nextId = useRef(messages.reduce((m, x) => Math.max(m, x.id), 0) + 1);
  const autoStarted = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  // Effects must return nothing: Chromium's scrollIntoView returns a Promise, which React would later call as a
  // cleanup function and crash on (found live, box1-docs#101).
  useEffect(() => { saveTranscript(storageKey, messages); }, [storageKey, messages]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [messages.length]);

  const add = useCallback((...entries: (NewBotMessage | { from: 'you'; text: string })[]) => {
    setMessages((m) => [...m, ...entries.map((e) => ({ from: 'bot', ...e, id: nextId.current++ }) as Message)].slice(-MAX_MESSAGES));
  }, []);

  const caps = status.state.kind === 'ready' ? status.state.data : null;

  const listIncidents = useCallback(async () => {
    try {
      const { data, error, response } = await api.GET('/api/v1/incidents');
      if (!data) {
        add({ kind: 'problem', problem: asProblem(error, response.status) });
        return;
      }
      const active = data.items.filter((i) => i.active);
      if (active.length === 0) {
        add({ kind: 'text', text: 'There are no active incidents right now.' });
      } else {
        add({ kind: 'incidents', items: active.map(({ incidentId, orderId, title, kind }) => ({ incidentId, orderId, title, kind })) });
      }
    } catch (e) {
      add({ kind: 'problem', problem: asProblem(e, 0) });
    }
  }, [add]);

  const analyze = useCallback(async (incidentId: string) => {
    if (caps && !caps.canAnalyze) {
      add({ kind: 'text', text: 'Starting an analysis needs the aiops-analyst role on agentic-operations. Ask a box1 administrator for it.' });
      return;
    }
    try {
      const { data, error, response } = await api.POST('/api/v1/assistant/incidents/{incidentId}/analyses', {
        params: { path: { incidentId } }, body: {},
      });
      if (data) {
        add({ kind: 'analysis', analysisId: data.analysisId });
        return;
      }
      const problem = asProblem(error, response.status);
      const retry = response.headers.get('Retry-After');
      add({ kind: 'problem', problem: retry && problem.status === 429 ? { ...problem, detail: `${problem.detail ?? ''} Try again in about ${retry} seconds.`.trim() } : problem });
    } catch (e) {
      add({ kind: 'problem', problem: asProblem(e, 0) });
    }
  }, [add, caps]);

  const run = useCallback(async (text: string) => {
    const line = text.trim();
    if (!line) return;
    add({ from: 'you', text: line });
    const [command, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');
    setWorking(true);
    try {
      switch (command.toLowerCase()) {
        case 'help':
        case '?':
          add({ kind: 'help' });
          break;
        case 'incidents':
          await listIncidents();
          break;
        case 'analyze':
        case 'analyse': {
          const id = toIncidentId(arg);
          if (!id) add({ kind: 'text', text: 'Give an order incident or order ID, for example: analyze inc_ord_1234 or analyze ord_1234.' });
          else await analyze(id);
          break;
        }
        case 'show': {
          const id = arg.trim();
          if (!ANALYSIS_ID.test(id)) add({ kind: 'text', text: 'Give an analysis ID, for example: show ana_0123456789abcdef0123456789abcdef.' });
          else add({ kind: 'analysis', analysisId: id });
          break;
        }
        case 'clear':
          setMessages([]);
          break;
        default:
          add({ kind: 'text', text: 'I only understand a few commands and do not answer free-form questions yet.' }, { kind: 'help' });
      }
    } finally {
      setWorking(false);
    }
  }, [add, analyze, listIncidents]);

  // /assistant?incident=inc_ord_x (from an incident page) starts that analysis once, then drops the parameter.
  const requested = params.get('incident');
  useEffect(() => {
    if (!requested || !caps || autoStarted.current) return;
    autoStarted.current = true;
    setParams({}, { replace: true });
    if (caps.configured) void run(`analyze ${requested}`);
  }, [requested, caps, run, setParams]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input;
    setInput('');
    void run(text);
  };

  return (
    <>
      <title>Assistant · box1 Operations</title>
      <h1>Assistant</h1>
      <p className="meta">
        Starts evidence-grounded incident analyses in agentic-operations and shows what it found, with the evidence it cites.
        Suggested actions are proposals only; nothing is ever executed from here.
      </p>
      {status.state.kind === 'loading' && <Loading label="Connecting to the assistant" />}
      {status.state.kind === 'error' && <ProblemView problem={status.state.problem} onRetry={status.reload} />}
      {caps && !caps.configured && (
        <Empty title="The assistant is not connected">
          This console is not configured to reach agentic-operations. See the console runbook (Assistant).
        </Empty>
      )}
      {caps && caps.configured && (
        <>
          {!caps.canView && (
            <p className="callout tone-attention" data-testid="aiops-role-note">
              Your account has no aiops-viewer or aiops-analyst role on agentic-operations, so it will refuse your requests.
              Ask a box1 administrator for the role you need.
            </p>
          )}
          {caps.canView && !caps.canAnalyze && (
            <p className="callout tone-neutral" data-testid="aiops-viewer-note">
              You can read analyses. Starting one needs the aiops-analyst role.
            </p>
          )}
          <div className="chat-log" role="log" aria-live="polite" aria-label="Assistant conversation" data-testid="chat-log">
            {messages.length === 0 && <HelpText />}
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg chat-${m.from}`} data-from={m.from}>
                <span className="sr-only">{m.from === 'you' ? 'You said:' : 'Assistant:'}</span>
                {m.from === 'you' ? <p>{m.text}</p> : <BotContent message={m} canAnalyze={caps.canAnalyze} onAnalyze={(id) => void run(`analyze ${id}`)} />}
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="chat-input" onSubmit={submit}>
            <label htmlFor="assistant-input" className="sr-only">Message the assistant</label>
            <input id="assistant-input" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off"
              placeholder="help, incidents, analyze ord_…, show ana_…" maxLength={200} data-testid="chat-input" />
            <Button type="submit" isDisabled={working || !input.trim()} data-testid="chat-send">{working ? 'Working…' : 'Send'}</Button>
            <Button onPress={() => void run('incidents')} isDisabled={working} data-testid="chat-incidents">Active incidents</Button>
            {messages.length > 0 && <Button onPress={() => setMessages([])} isDisabled={working}>Clear</Button>}
          </form>
        </>
      )}
    </>
  );
}

function BotContent({ message, canAnalyze, onAnalyze }: { message: BotMessage; canAnalyze: boolean; onAnalyze: (id: string) => void }) {
  switch (message.kind) {
    case 'text':
      return <p>{message.text}</p>;
    case 'help':
      return <HelpText />;
    case 'problem':
      return <InlineProblem problem={message.problem} />;
    case 'analysis':
      return <AnalysisMessage analysisId={message.analysisId} />;
    case 'incidents':
      return (
        <>
          <p>{message.items.length} active incident{message.items.length === 1 ? '' : 's'}:</p>
          <ul className="chat-incidents" data-testid="chat-incident-list">
            {message.items.map((i) => (
              <li key={i.incidentId}>
                <Link to={`/incidents/${i.incidentId}`}>{i.incidentId}</Link> — {i.title}{' '}
                {canAnalyze && <Button onPress={() => onAnalyze(i.incidentId)} data-testid={`analyze-${i.incidentId}`}>Analyze</Button>}
              </li>
            ))}
          </ul>
        </>
      );
  }
}

function HelpText() {
  return (
    <div className="chat-help">
      <p>I can start and show incident analyses from agentic-operations. Commands:</p>
      <ul>
        <li><code>incidents</code> lists active incidents</li>
        <li><code>analyze inc_ord_…</code> or <code>analyze ord_…</code> starts an analysis (needs aiops-analyst)</li>
        <li><code>show ana_…</code> shows an earlier analysis (it may have expired)</li>
        <li><code>clear</code> empties this conversation; <code>help</code> shows this list</li>
      </ul>
    </div>
  );
}
