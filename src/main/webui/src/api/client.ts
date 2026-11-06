import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

export type Schemas = components['schemas'];
export type Problem = Schemas['Problem'];
export type SourceStatus = Schemas['SourceStatus'];

/** A fresh W3C traceparent per request; the console backend continues the trace to every service (D-009). */
function traceparent(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `00-${hex.slice(0, 32)}-${hex.slice(32, 48)}-01`;
}

const consoleHeaders: Middleware = {
  onRequest({ request }) {
    request.headers.set('traceparent', traceparent());
    request.headers.set('Accept', 'application/json');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // CSRF defence (D-003): the backend refuses state-changing calls without it.
      request.headers.set('X-Box1-Console', '1');
    }
    return request;
  },
};

/**
 * The one typed client, generated from the console backend's versioned OpenAPI (D-006). The session is an
 * HttpOnly cookie the browser sends automatically; no token is ever visible to this code.
 */
export const api = createClient<paths>({ baseUrl: '', credentials: 'same-origin', cache: 'no-store' });
api.use(consoleHeaders);

/** Normalise any failure into a Problem, so every page shows the same typed error. */
export function asProblem(error: unknown, status: number): Problem {
  if (error && typeof error === 'object' && 'code' in error && 'title' in error) {
    return error as Problem;
  }
  return {
    type: 'about:blank',
    title: status === 0 ? 'Console unreachable' : `Request failed (HTTP ${status})`,
    status,
    code: status === 0 ? 'NETWORK_ERROR' : 'UNEXPECTED',
    detail: status === 0 ? 'The console did not answer. Check your connection and retry.' : undefined,
  };
}
