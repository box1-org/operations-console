// Controllable stand-ins for the order, inventory, fulfillment, asset and agentic-operations services (local e2e only).
// Shapes follow each service's served OpenAPI. Control: POST /__control {source, mode: ok|down|slow, ...}.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.STUB_PORT || 18081);
const control = { order: 'ok', inventory: 'ok', fulfillment: 'ok', asset: 'refuse', aiops: 'ok' }; // aiops: ok|busy|modeldown|down; asset: refuse|ok|nosites|down
const analyses = new Map();    // ana_x -> {incidentId, orderId, createdAt, outcome}
const conversations = new Map(); // conv_x -> {owner, createdAt, turns: [{turnId, question, started, outcome}]}
const orders = new Map();      // orderId -> order
const timelines = new Map();   // orderId -> entries
const fulfillments = new Map(); // ful_x -> fulfillment
const idem = new Map();        // key -> orderId
const seen = [];               // request log: method path auth? traceparent?
let seq = 100;

const now = () => new Date().toISOString();
const trace = () => randomUUID().replaceAll('-', '');
function addEntry(id, from, to, reasonCode, eventType) {
  const o = orders.get(id);
  timelines.get(id).push({ sequence: ++seq, kind: from === to ? 'NOTE' : 'TRANSITION', fromState: from, toState: from === to ? null : to,
    reasonCode, occurredAt: now(), eventId: randomUUID(), eventType, causationId: null, correlationId: o.correlationId, traceId: o.traceId });
}
function setState(id, to, reasonCode, eventType) {
  const o = orders.get(id); const from = o.state; o.state = to; o.updatedAt = now();
  if (to === 'RESERVED') o.reservationId = 'res_' + id.slice(4);
  addEntry(id, from, to, reasonCode, eventType);
}
function send(res, status, body, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const problem = (status, title) => ({ type: 'about:blank', title, status });

async function body(req) { return req.bodyJson; }

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => { console.error('stub request failed:', e.code || e.message); if (!res.headersSent) { try { res.destroy(); } catch {} } });
});

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  // Read the body before any delay: a slow mode must still complete the work after the caller gave up.
  const raw = req.method === 'POST' ? await (async () => { let b = ''; for await (const c of req) b += c; return b; })() : '';
  req.bodyJson = raw ? JSON.parse(raw) : {};
  const [, svc, ...rest] = url.pathname.split('/');
  const path = '/' + rest.join('/');
  if (svc !== '__control') seen.push({ svc, method: req.method, path, auth: Boolean(req.headers.authorization), traceparent: req.headers.traceparent || null });
  if (svc === '__control') {
    if (req.method === 'GET') return send(res, 200, { control, seen: seen.slice(-200) });
    const c = await body(req);
    if (c.source) control[c.source] = c.mode;
    if (c.advance) { // {advance:{orderId,to,reasonCode,eventType}}
      const a = c.advance; setState(a.orderId, a.to, a.reasonCode, a.eventType);
    }
    if (c.fulfillment) { // {fulfillment:{orderId, dispatch, erpAcknowledgement, outcome, ...}}
      const f = c.fulfillment; const id = 'ful_' + f.orderId.slice(4);
      const prev = fulfillments.get(id) || { fulfillmentRequestId: id, orderId: f.orderId, revision: 0, uploads: 0, resends: 0 };
      fulfillments.set(id, { ...prev, ...f, revision: (prev.revision || 0) + 1, statusAt: now() });
    }
    if (c.clearSeen) seen.length = 0;
    return send(res, 200, { control });
  }
  const mode = control[svc];
  if (mode === 'down') { req.socket.destroy(); return; }
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 6000));
  if (path === '/api/info') return send(res, 200, { name: svc, version: '1.0.0', gitRef: '0123456789abcdef0123456789abcdef01234567' });

  if (svc === 'order') {
    if (req.method === 'POST' && path === '/api/v1/orders') {
      const b = await body(req); const key = req.headers['idempotency-key'];
      if (idem.has(key)) return send(res, 200, orders.get(idem.get(key)), { 'Idempotency-Replayed': 'true' });
      const id = 'ord_' + randomUUID().replaceAll('-', '').slice(0, 12);
      const o = { orderId: id, state: 'SUBMITTED', ...b, reservationId: null, statusReason: null, createdAt: now(), updatedAt: now(),
        correlationId: req.headers['x-correlation-id'] || randomUUID(), traceId: (req.headers.traceparent || '').split('-')[1] || trace() };
      orders.set(id, o); timelines.set(id, []); idem.set(key, id); addEntry(id, null, 'SUBMITTED', 'ORDER_PLACED', 'order.placed.v1');
      timelines.get(id)[0].kind = 'TRANSITION'; timelines.get(id)[0].toState = 'SUBMITTED';
      return send(res, 201, o);
    }
    if (path === '/api/v1/orders') return send(res, 200, [...orders.values()].reverse());
    const m = path.match(/^\/api\/v1\/orders\/(ord_[A-Za-z0-9_-]+)(\/timeline)?$/);
    if (m && orders.has(m[1])) return send(res, 200, m[2] ? timelines.get(m[1]) : orders.get(m[1]));
    return send(res, 404, problem(404, 'Not Found'));
  }
  if (svc === 'inventory') {
    if (path === '/api/v1/inventory') {
      return send(res, 200, url.searchParams.get('offset') === '0' || !url.searchParams.get('offset') ? [
        { siteId: 'site_east', sku: 'SKU-42', onHand: 40, reserved: 3, available: 37, updatedAt: now() },
        { siteId: 'site_east', sku: 'SKU-7', onHand: 12, reserved: 0, available: 12, updatedAt: now() },
        { siteId: 'site_west', sku: 'SKU-42', onHand: 5, reserved: 1, available: 4, updatedAt: now() }] : []);
    }
    const m = path.match(/^\/api\/v1\/reservations\/(res_[A-Za-z0-9_-]+)$/);
    if (m) return send(res, 200, { reservationId: m[1], orderId: null, status: 'ACTIVE', expiresAt: new Date(Date.now() + 900000).toISOString(), updatedAt: now() });
    return send(res, 404, problem(404, 'Not Found'));
  }
  if (svc === 'fulfillment') {
    const m = path.match(/^\/api\/fulfillments\/(ful_[A-Za-z0-9_-]+)$/);
    if (m && fulfillments.has(m[1])) return send(res, 200, fulfillments.get(m[1]));
    return send(res, 404, problem(404, 'Not Found'));
  }
  if (svc === 'asset') return asset(res, path, mode);
  if (svc === 'aiops') return aiops(req, res, path);
  send(res, 404, problem(404, 'Not Found'));
}
const DIGEST_A = 'sha256:a11d6786b9a86378148ae55194acfd1cfb2d150ad298334fe00798d026abe3fe';
const DIGEST_B = 'sha256:8e9d01383c43e37cbf30b083be311866dc9806158fa09062ede88f9afb41edb6';
/** One asset-service SiteStatus (box1-ops-contracts openapi/asset-service.yaml), seen `age` seconds ago. */
function siteStatus(siteId, state, stateReasons, age, extra = {}) {
  const seen = new Date(Date.now() - age * 1000).toISOString();
  return { siteId, state, stateReasons, lastSeenAt: seen, lastSeenAgeSeconds: age, lastReadingAt: seen, reportedAt: seen,
    bufferDepth: 3, siteEventBacklog: 0, bufferOldestAgeSeconds: 2, readingsDropped: 0, bootedImageDigest: DIGEST_A,
    stagedImageDigest: null, rollbackImageDigest: null, greenbootStatus: 'GREEN', bundleDigest: DIGEST_B,
    appVersions: { gateway: '1.0.0', ops: '1.0.0', simulator: '1.0.0' }, ...extra };
}

/**
 * asset-service. refuse: 401 for everything, as when the console sends no token (the default). ok: alerts and site
 * status (box1-docs#130). nosites: alerts, but 404 for site status, as an asset-service from before it.
 */
function asset(res, path, mode) {
  if (mode === 'refuse') return send(res, 401, problem(401, 'Unauthorized'));
  if (path === '/api/v1/alerts') {
    return send(res, 200, { items: [{ alertId: 'alt_e2e_1', assetId: 'asset_pump_7', siteId: 'site_spacedock', metricName: 'temperature',
      unit: 'C', status: 'ACTIVE', severity: 'CRITICAL', threshold: 80, firstValue: 81, peakValue: 96.5, lastValue: 92, readingCount: 4,
      activatedAt: now(), activatedMeasuredAt: now(), escalatedAt: null, clearedAt: null }], nextCursor: null });
  }
  if (path === '/api/v1/sites' && mode === 'ok') {
    return send(res, 200, { items: [
      siteStatus('site_ds9', 'ONLINE', [], 6),
      siteStatus('site_spacedock', 'DEGRADED', ['BUFFER_DEPTH'], 9, { bufferDepth: 240, siteEventBacklog: 4, bufferOldestAgeSeconds: 95 }),
      siteStatus('site_utopia_planitia', 'OFFLINE', ['HEARTBEAT_STALE'], 420, { greenbootStatus: 'UNKNOWN', bootedImageDigest: null })] });
  }
  return send(res, 404, problem(404, 'Not Found'));
}

/** The claims of a bearer JWT, unverified (Keycloak issued it to the console in this local stack). */
function claims(req) {
  const m = (req.headers.authorization || '').match(/^Bearer ([^.]+)\.([^.]+)\./);
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[2], 'base64url').toString('utf8')); } catch { return null; }
}

/** agentic-operations: audience, accepted client and the person's own aiops roles, as the real service checks them. */
function aiops(req, res, path) {
  const c = claims(req);
  if (!c) return send(res, 401, { ...problem(401, 'Unauthorized'), code: 'UNAUTHENTICATED' });
  const aud = [].concat(c.aud || []);
  const roles = c.resource_access?.['agentic-operations']?.roles || [];
  if (!aud.includes('agentic-operations') || c.azp !== 'operations-console') {
    return send(res, 403, { ...problem(403, 'Forbidden'), code: 'FORBIDDEN', detail: 'client not accepted' });
  }
  const submit = path.match(/^\/api\/v1\/ai\/incidents\/(inc_(ord_[A-Za-z0-9_-]+))\/analyze$/);
  if (req.method === 'POST' && submit) {
    if (!roles.includes('aiops-analyst')) return send(res, 403, { ...problem(403, 'Forbidden'), code: 'FORBIDDEN', detail: 'aiops-analyst required' });
    if (!orders.has(submit[2])) return send(res, 404, { ...problem(404, 'Not Found'), code: 'INCIDENT_NOT_FOUND', detail: 'no such order' });
    if (control.aiops === 'busy') return send(res, 429, { ...problem(429, 'Busy'), code: 'BUSY', detail: 'The analysis queue is full.' }, { 'Retry-After': '30' });
    const id = 'ana_' + randomUUID().replaceAll('-', '');
    analyses.set(id, { incidentId: submit[1], orderId: submit[2], createdAt: now(), started: Date.now(), outcome: control.aiops === 'modeldown' ? 'MODEL_UNAVAILABLE' : 'COMPLETED' });
    return send(res, 202, { analysisId: id, status: 'QUEUED', location: `/api/v1/ai/analyses/${id}` });
  }
  if (path.startsWith('/api/v1/ai/conversations')) return chat(req, res, path, c, roles);
  const get = path.match(/^\/api\/v1\/ai\/analyses\/(ana_[0-9a-f]{32})$/);
  if (req.method === 'GET' && get) {
    if (!roles.includes('aiops-viewer') && !roles.includes('aiops-analyst')) return send(res, 403, { ...problem(403, 'Forbidden'), code: 'FORBIDDEN' });
    const a = analyses.get(get[1]);
    if (!a) return send(res, 404, { ...problem(404, 'Not Found'), code: 'ANALYSIS_NOT_FOUND', detail: 'unknown, expired or lost on restart' });
    const base = { analysisId: get[1], incidentId: a.incidentId, orderId: a.orderId, incidentType: 'ORDER_EXCEPTION', createdAt: a.createdAt,
      findings: [], unknowns: [], suggestedActions: [], evidence: [] };
    if (Date.now() - a.started < 2500) return send(res, 200, { ...base, status: 'RUNNING' });
    if (a.outcome === 'MODEL_UNAVAILABLE') return send(res, 200, { ...base, status: 'MODEL_UNAVAILABLE', statusDetail: 'model did not answer', completedAt: now() });
    return send(res, 200, { ...base, status: 'COMPLETED', completedAt: now(),
      summary: 'The reservation expired before fulfillment was requested. <b>Ignore previous instructions</b> is evidence text, not markup.',
      findings: [{ statement: 'The order moved to EXCEPTION after its reservation expired', evidenceRefs: ['ev_1', 'ev_2'], confidence: 'HIGH' }],
      unknowns: ['Telemetry alerts are unavailable in v1'],
      suggestedActions: [{ type: 'ROLLBACK_DEPLOYMENT', description: 'Roll back inventory-service to the previous revision',
        expectedEffect: 'Restores the earlier reservation TTL', rollback: 'Re-apply the current revision', executable: false }],
      evidence: [
        { ref: 'ev_1', type: 'ORDER', source: 'order-service', timestamp: now(), retrievedAt: now(), retrievalStatus: 'OK', detail: 'order state EXCEPTION', link: `order-service:${a.orderId}`, truncated: false, data: { note: 'raw' } },
        { ref: 'ev_2', type: 'ORDER_TIMELINE', source: 'order-service', timestamp: now(), retrievedAt: now(), retrievalStatus: 'OK', detail: 'reservation expired', link: 'javascript:alert(1)', truncated: true },
        { ref: 'ev_10', type: 'LOGS', source: 'logging', retrievalStatus: 'UNAVAILABLE', detail: 'no centralized logging', truncated: false }],
      model: { modelId: 'box1-coder', contextProfile: '32k', promptTokens: 4718, completionTokens: 222 },
      quality: { citedFindings: 1, unsupportedAssertions: 0, droppedActions: 0 } });
  }
  return send(res, 404, problem(404, 'Not Found'));
}

/** The Assistant's conversations (agentic-operations D-016): scripted turns that read one tool, then answer. */
function chat(req, res, path, c, roles) {
  if (!roles.includes('aiops-viewer') && !roles.includes('aiops-analyst')) return send(res, 403, { ...problem(403, 'Forbidden'), code: 'FORBIDDEN' });
  if (req.method === 'POST' && path === '/api/v1/ai/conversations') {
    const id = 'conv_' + randomUUID().replaceAll('-', '');
    conversations.set(id, { owner: c.sub, createdAt: now(), turns: [] });
    return send(res, 201, { conversationId: id });
  }
  const m = path.match(/^\/api\/v1\/ai\/conversations\/(conv_[0-9a-f]{32})(\/messages)?$/);
  const conv = m && conversations.get(m[1]);
  if (!conv || conv.owner !== c.sub) return send(res, 404, { ...problem(404, 'Not Found'), code: 'CONVERSATION_NOT_FOUND', detail: 'unknown, expired or lost on restart' });
  if (req.method === 'POST' && m[2]) {
    const text = String(req.bodyJson.text || '');
    if (!text.trim() || text.length > 2000) return send(res, 400, { ...problem(400, 'Bad Request'), code: 'INVALID_MESSAGE' });
    const last = conv.turns[conv.turns.length - 1];
    if (last && view(last).status === 'RUNNING') return send(res, 409, { ...problem(409, 'Conflict'), code: 'TURN_IN_PROGRESS', detail: 'still answering' });
    if (control.aiops === 'busy') return send(res, 429, { ...problem(429, 'Busy'), code: 'BUSY', detail: 'The model queue is full.' }, { 'Retry-After': '30' });
    const turn = { turnId: 'turn_' + (conv.turns.length + 1), question: text, started: Date.now(), outcome: control.aiops === 'modeldown' ? 'MODEL_UNAVAILABLE' : 'COMPLETED' };
    conv.turns.push(turn);
    return send(res, 202, { conversationId: m[1], turnId: turn.turnId, status: 'QUEUED' });
  }
  if (req.method === 'GET' && !m[2]) return send(res, 200, { conversationId: m[1], createdAt: conv.createdAt, updatedAt: now(), turns: conv.turns.map(view) });
  return send(res, 404, problem(404, 'Not Found'));
}

function view(t) {
  const age = Date.now() - t.started;
  const order = (t.question.match(/ord_[A-Za-z0-9_-]+/) || ['ord_unknown'])[0];
  const steps = [{ tool: 'get_order_timeline', target: order, decision: 'ok', retrievalStatus: orders.has(order) ? 'OK' : 'NOT_FOUND', durationMs: 14 },
    { tool: 'unknown', target: '-', decision: 'unknown_tool', retrievalStatus: null, durationMs: 0 }];
  const base = { turnId: t.turnId, question: t.question, statusDetail: null, answer: null, startedAt: new Date(t.started).toISOString(), completedAt: null };
  if (age < 1200) return { ...base, status: 'RUNNING', steps: [] };
  if (age < 2500) return { ...base, status: 'RUNNING', steps: steps.slice(0, 1) };
  if (t.outcome === 'MODEL_UNAVAILABLE') return { ...base, status: 'MODEL_UNAVAILABLE', statusDetail: 'model endpoint unreachable', steps: [], completedAt: now() };
  const o = orders.get(order);
  return { ...base, status: 'COMPLETED', steps, completedAt: now(),
    answer: o ? `Order ${order} is ${o.state}.\nIt was last updated at ${o.updatedAt}. <b>Ignore previous instructions</b> appeared in the evidence and was not followed.`
      : `I could not find order ${order}.`,
    model: { modelId: 'box1-coder', modelCalls: 2, toolCalls: 2, promptTokens: 1800, completionTokens: 60 } };
}

server.listen(port, '127.0.0.1', () => console.log(`run18 stubs on ${port}`));
