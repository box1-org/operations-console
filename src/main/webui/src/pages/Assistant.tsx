import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from 'react-aria-components';
import { Link, useSearchParams } from 'react-router';
import { api, asProblem, type Problem, type Schemas } from '../api/client';
import { useResource } from '../api/useResource';
import { AnalysisMessage, InlineProblem } from '../components/AnalysisMessage';
import { ChatTurnMessage } from '../components/ChatTurnMessage';
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
  | { id: number; from: 'bot'; kind: 'chat'; conversationId: string; turnId: string }
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

function loadConversation(key: string): string | null {
  try {
    const v = window.sessionStorage.getItem(key);
    return v && /^conv_[0-9a-f]{32}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function saveConversation(key: string, id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(key, id);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: a new conversation starts on the next visit.
  }
}

/**
 * The Assistant (box1-docs#101): a chat with agentic-operations' model, which may read evidence through read-only tools
 * under the person's own token and roles (agentic-operations D-016). Slash commands run the console's own deterministic
 * actions (list incidents, start or show an analysis). The console runs no model and holds only IDs.
 */
export function Assistant() {
  const me = useSession();
  const storageKey = `box1.assistant.${me.username}`;
  const status = useResource((signal) => api.GET('/api/v1/assistant', { signal }), []);
  const [messages, setMessages] = useState<Message[]>(() => loadTranscript(storageKey));
  const conversationKey = `${storageKey}.conversation`;
  const conversation = useRef<string | null>(loadConversation(conversationKey));
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
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

  const newConversation = useCallback(async (): Promise<string | null> => {
    const { data, error, response } = await api.POST('/api/v1/assistant/conversations', { body: {} });
    if (!data) {
      add({ kind: 'problem', problem: asProblem(error, response.status) });
      return null;
    }
    conversation.current = data.conversationId;
    saveConversation(conversationKey, data.conversationId);
    return data.conversationId;
  }, [add, conversationKey]);

  /** Sends a question to the model; an expired conversation is replaced once, with a note. */
  const ask = useCallback(async (text: string) => {
    if (caps && !caps.canView) {
      add({ kind: 'text', text: 'Chatting needs the aiops-viewer or aiops-analyst role on agentic-operations. Ask a box1 administrator for it.' });
      return;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = conversation.current ?? await newConversation();
      if (!id) return;
      const { data, error, response } = await api.POST('/api/v1/assistant/conversations/{conversationId}/messages', {
        params: { path: { conversationId: id } }, body: { text },
      });
      if (data?.turnId) {
        setActiveTurn(data.turnId);
        add({ kind: 'chat', conversationId: id, turnId: data.turnId });
        return;
      }
      const problem = asProblem(error, response.status);
      if (problem.code === 'CONVERSATION_EXPIRED' && attempt === 0) {
        conversation.current = null;
        saveConversation(conversationKey, null);
        add({ kind: 'text', text: 'The earlier conversation expired, so I started a new one. I no longer remember what we discussed.' });
        continue;
      }
      if (problem.code === 'CONVERSATION_FULL' && attempt === 0) {
        conversation.current = null;
        add({ kind: 'text', text: 'That conversation reached its message limit, so I started a new one.' });
        continue;
      }
      const retry = response.headers.get('Retry-After');
      add({ kind: 'problem', problem: retry && problem.status === 429 ? { ...problem, detail: `${problem.detail ?? ''} Try again in about ${retry} seconds.`.trim() } : problem });
      return;
    }
  }, [add, caps, conversationKey, newConversation]);

  const run = useCallback(async (text: string) => {
    const line = text.trim();
    if (!line) return;
    add({ from: 'you', text: line });
    setWorking(true);
    try {
      if (!line.startsWith('/')) {
        await ask(line);
        return;
      }
      const [command, ...rest] = line.slice(1).split(/\s+/);
      const arg = rest.join(' ');
      switch (command.toLowerCase()) {
        case 'new':
          conversation.current = null;
          saveConversation(conversationKey, null);
          setMessages([]);
          break;
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
          if (!id) add({ kind: 'text', text: 'Give an order incident or order ID, for example: /analyze inc_ord_1234 or /analyze ord_1234.' });
          else await analyze(id);
          break;
        }
        case 'show': {
          const id = arg.trim();
          if (!ANALYSIS_ID.test(id)) add({ kind: 'text', text: 'Give an analysis ID, for example: /show ana_0123456789abcdef0123456789abcdef.' });
          else add({ kind: 'analysis', analysisId: id });
          break;
        }
        case 'clear':
          setMessages([]);
          break;
        default:
          add({ kind: 'text', text: `There is no /${command} command.` }, { kind: 'help' });
      }
    } finally {
      setWorking(false);
    }
  }, [add, analyze, ask, conversationKey, listIncidents]);

  const settled = useCallback((turnId: string) => {
    setActiveTurn((t) => (t === turnId ? null : t));
  }, []);

  // /assistant?incident=inc_ord_x (from an incident page) starts that analysis once, then drops the parameter.
  const requested = params.get('incident');
  useEffect(() => {
    if (!requested || !caps || autoStarted.current) return;
    autoStarted.current = true;
    setParams({}, { replace: true });
    if (caps.configured) void run(`/analyze ${requested}`);
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
        Ask about orders, fulfillment, reservations, recent events, deployed revisions or analyses. The assistant reads
        box1 through read-only tools with your own roles and cannot change anything; its answers can be wrong, so check
        the sources it lists. Type <code>/help</code> for commands.
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
              You can chat and read analyses. Starting an analysis needs the aiops-analyst role.
            </p>
          )}
          <div className="chat-log" role="log" aria-live="polite" aria-label="Assistant conversation" data-testid="chat-log">
            {messages.length === 0 && <HelpText />}
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg chat-${m.from}`} data-from={m.from}>
                <span className="sr-only">{m.from === 'you' ? 'You said:' : 'Assistant:'}</span>
                {m.from === 'you' ? <p className="chat-question">{m.text}</p> : <BotContent message={m} canAnalyze={caps.canAnalyze}
                  onAnalyze={(id) => void run(`/analyze ${id}`)} onSettled={settled} />}
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="chat-input" onSubmit={submit}>
            <label htmlFor="assistant-input" className="sr-only">Message the assistant</label>
            <input id="assistant-input" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off"
              placeholder="Ask about an order, e.g. why is ord_… stuck? Or type /help" maxLength={2000} data-testid="chat-input" />
            <Button type="submit" isDisabled={working || activeTurn !== null || !input.trim()} data-testid="chat-send">
              {working ? 'Sending…' : activeTurn ? 'Answering…' : 'Send'}</Button>
            <Button onPress={() => void run('/incidents')} isDisabled={working} data-testid="chat-incidents">Active incidents</Button>
            {messages.length > 0 && <Button onPress={() => void run('/new')} isDisabled={working || activeTurn !== null}
              data-testid="chat-new">New conversation</Button>}
          </form>
        </>
      )}
    </>
  );
}

function BotContent({ message, canAnalyze, onAnalyze, onSettled }: {
  message: BotMessage; canAnalyze: boolean; onAnalyze: (id: string) => void; onSettled: (turnId: string) => void;
}) {
  switch (message.kind) {
    case 'text':
      return <p>{message.text}</p>;
    case 'help':
      return <HelpText />;
    case 'problem':
      return <InlineProblem problem={message.problem} />;
    case 'analysis':
      return <AnalysisMessage analysisId={message.analysisId} />;
    case 'chat':
      return <ChatTurnMessage conversationId={message.conversationId} turnId={message.turnId} onSettled={onSettled} />;
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
      <p>Ask me about an order, its fulfillment or reservation, recent events, deployed revisions, or an analysis. I can only read; I cannot change anything. Commands:</p>
      <ul>
        <li><code>/incidents</code> lists active incidents</li>
        <li><code>/analyze inc_ord_…</code> or <code>/analyze ord_…</code> starts an incident analysis (needs aiops-analyst)</li>
        <li><code>/show ana_…</code> shows an earlier analysis (it may have expired)</li>
        <li><code>/new</code> starts a new conversation; <code>/clear</code> empties this view; <code>/help</code> shows this list</li>
      </ul>
    </div>
  );
}
