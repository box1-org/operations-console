# Architecture

## Shape

```text
browser ──https──▶ Route (edge TLS) ──▶ operations-console pod
                                          ├─ static React app (META-INF/resources)
                                          └─ console backend /api/v1/*  ── session cookie (encrypted tokens)
                                                 │  in-cluster http, 1 s connect / 2.5 s read, 3 s page budget
                                                 ├─▶ order-service        (no token: the service has no auth, box1-docs#40)
                                                 ├─▶ inventory-service    (user access token, aud inventory-service)
                                                 ├─▶ fulfillment-adapter  (user access token, aud fulfillment-adapter)
                                                 └─▶ asset-service        (user access token; refused, see gaps)
browser ──https──▶ Keycloak (login only)
```

- The console owns no business state and no database.
- The browser talks only to the console's Route and to Keycloak's login pages. It never calls another service's Route, Kafka, PostgreSQL or a VM.

## Session and tokens

- **Login.** Keycloak authorization-code flow with PKCE (S256). The `operations-console` client is public, as every client in the `box1` realm is.
- **Token storage.** Tokens stay server-side. Quarkus encrypts them into `q_session*` cookies, which are `HttpOnly`, `Secure` and `SameSite=Strict`. Page JavaScript cannot read them, and `/api/v1/me` returns only a username and roles. The Firefox e2e checks `document.cookie`, `localStorage`, `sessionStorage`, page HTML and API bodies for JWTs.
- **Edge TLS.** The Route terminates TLS, so the pod builds https redirect URIs and Secure cookies explicitly (`force-redirect-https-scheme`, `cookie-force-secure`). Its own https origin is listed for CORS, because otherwise the pod sees http and refuses its own POSTs.
- **Challenge.**
  - A page navigation without a session is redirected to Keycloak, and the deep link is restored after login.
  - An `/api/*` call without a session gets **401** Problem JSON (`SESSION_REQUIRED`), never a redirect.
  - Missing roles get **403** (`ROLE_REQUIRED`).
- **CSRF.** Every `*.box1.org` application is same-site, so SameSite alone is not enough. A state-changing call also needs:
  - `X-Box1-Console: 1`, a header CORS never allows;
  - a JSON body;
  - an `Origin`, when present, equal to `CONSOLE_PUBLIC_ORIGIN`.
- **Logout.** `/logout` ends the Keycloak session and the cookie, then shows `/signed-out.html`.
- **Session key.** Without `CONSOLE_SESSION_KEY`, the key is generated per process. Restarts sign users out (observed locally: 200 before, 401 after), and only one replica works. A Secret-backed key is a new secret and needs approval.

## Roles

Client roles `console-viewer`, `console-operator` and `console-developer` live on `operations-console` and are read from `resource_access.operations-console.roles` in the access token.

- `@RolesAllowed` is on every console API method.
- `ConsoleSecurityTest` walks every operation in the contract: anonymous gets 401, no role gets 403.
- There is no customer role: no verified customer identity exists yet (#40), so a customer filter would trust a value the caller chooses.

## Console API

- The contract is `META-INF/openapi.yaml` 1.0.0. Its paths follow the Experience/BFF prompt (box1-docs#17) where that prompt defines them (`/api/v1/overview`, `/orders/{id}/summary`, `/incidents/{id}/evidence`). The BFF can serve the same contract later without page changes.
- Errors are RFC 9457 Problem JSON with a stable `code`.
- Aggregates carry `sources`: one `{source, status OK|DEGRADED|UNAVAILABLE|NOT_AUTHORIZED|NOT_CONFIGURED, detail, latencyMs}` per upstream. Values from a failed source are absent, never invented.

## Upstream calls

| Upstream | Calls | Token |
|---|---|---|
| order-service | list (2 pages of 100, newest first), get, timeline, create (pass-through with `Idempotency-Key`, `X-Consumer-Id: operations-console`) | none |
| inventory-service | reservation by id, stock list | user access token (aud via the console client's mapper) |
| fulfillment-adapter | `GET /api/fulfillments/{id}` | user access token |
| asset-service | `GET /api/v1/alerts` (access probe) | user access token |
| all | `/api/info` (revisions, cached 60 s) | none |

- Upstream calls have no retries. At most 8 are in flight per upstream, and excess calls fail fast as `DEGRADED`.
- Each call carries a W3C `traceparent`. The browser starts a trace per request and the backend continues it. Export is off until a collector exists (box1-docs#22).
- Logs are JSON and never include tokens, cookies or bodies.

## ERP progress

The order-service state label is always shown. When the fulfillment adapter answers, the console refines it as follows:

| Adapter | Label |
|---|---|
| `outcome=SHIPPED` | Shipped |
| `outcome=REJECTED` | Rejected by the ERP |
| `dispatch=NEEDS_ATTENTION` | Needs attention (+ reason) |
| `outcome=HELD` | Held by an ERP operator. Waiting, not a failure |
| `outcome=PENDING` | Accepted by the ERP |
| `AWAITING_ERP` + `UPLOADED` | Uploaded, awaiting ERP acknowledgement |
| `AWAITING_ERP` + `QUEUED` | Queued for the ERP |
| 404 | Not yet received by the fulfillment adapter |
| unreachable, slow, unknown combination, or no link | **ERP detail unavailable** |

## Known gaps (other services)

- **G-1:** no published API links an order to its fulfillment request. `CONSOLE_FULFILLMENT_LINK=derived` relies on order-service's internal `ful_<id>` convention. The permanent fix is exposing `fulfillmentRequestId` on the order API.
- **G-2:** asset-service accepts only tokens issued to its own client (`azp=asset-service`), so it refuses the console's token. Telemetry shows "refused the console" and links to the asset telemetry console.
- **G-3:** the deployed fulfillment adapter has SFTP disabled, so no ERP can hold a request on the cluster yet.
- **Order service without auth (#40):** the console enforces its own roles, but order-service's own Route remains open. The console adds no exposure.

## Brand

- `brand/box1-mark.png` is the `box1-org` avatar supplied by the project owner, byte-identical to asset-service's copy (SHA-256 `11ccbb2dc79258163cc516ed398132ad320ebf9870c75da64cb8b6f2919762ea`, asserted by `FrontendServingTest`). Do not regenerate it.
- The favicon is the same unmodified file.
- Styling uses system fonts and a monochrome palette with a faint grid. It respects `prefers-reduced-motion` and dark mode.
