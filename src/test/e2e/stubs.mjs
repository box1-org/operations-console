// Controllable stand-ins for the order, inventory, fulfillment and asset services (local e2e only).
// Shapes follow each service's served OpenAPI. Control: POST /__control {source, mode: ok|down|slow, ...}.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.STUB_PORT || 18081);
const control = { order: 'ok', inventory: 'ok', fulfillment: 'ok', asset: 'refuse' };
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
  res.writeHead(status, { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const problem = (status, title) => ({ type: 'about:blank', title, status });

async function body(req) { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : {}; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
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
  if (svc === 'asset') return send(res, 401, problem(401, 'Unauthorized'));
  send(res, 404, problem(404, 'Not Found'));
});
server.listen(port, '127.0.0.1', () => console.log(`run18 stubs on ${port}`));
