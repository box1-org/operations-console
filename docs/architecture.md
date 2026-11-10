# Architecture

## Shape

```text
browser ──https──▶ Route (edge TLS) ──▶ operations-console pod
                                          ├─ static React app (META-INF/resources)
                                          └─ console backend /api/v1/*  ── session cookie (encrypted tokens)
                                                 │  in-cluster http, 1 s connect / 2.5 s read, 3 s page budget
                                                 ├─▶ order-service        (no token; see box1-docs#40)
                                                 ├─▶ inventory-service    (no token while its reads are open)
                                                 ├─▶ fulfillment-adapter  (no token while its reads are open)
                                                 ├─▶ asset-service        (no token; refused, see gaps)
                                                 ├─▶ scenario-controller  (the user's token; box1-docs#19)
                                                 └─▶ agentic-operations   (the user's token; Assistant, box1-docs#101)
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
- **Logout.** `/logout` ends the Keycloak session and the cookie, then shows `/signed-out.html`. Logout is a GET. A page on a sibling `*.box1.org` site could therefore sign a user out, which is a nuisance only and accepted.
- **Content Security Policy.** `default-src 'self'`, with no inline script. `style-src` additionally allows exactly one stylesheet by hash: react-aria-components' `react-aria-pressable-style`, a `touch-action` rule. The Firefox e2e fails on any CSP violation, so a dependency update that changes the hash is caught.
- **Token forwarding.** The user's access token stays in the session and is **not forwarded** to any upstream (`CONSOLE_FORWARD_USER_TOKEN=false`). The client is public, so any realm user can hold its tokens. It must therefore carry no other service's audience, and the upstreams' reads are open today. Forwarding needs a client whose tokens are meant for those services, which is a user decision.
- **The one exception: the scenario controller** (box1-docs#19, user decision 2026-11-06). With `CONSOLE_SCENARIO_FORWARD_TOKEN=true` the user's access token is sent to the scenario controller and to no other upstream. The `operations-console` Keycloak client adds the audience `scenario-controller` and maps the controller's `scenario-viewer`/`scenario-operator` roles into the token, and the controller accepts `azp=operations-console`. Each person's own scenario role decides what they may do, and the controller's audit names the person (subject and username). Trade-off, accepted: any realm user who signs in to the console holds a token with that audience, but without a scenario role the controller refuses every call (403), the same as for its CLI client.
- **Second exception: agentic-operations, for the Assistant** (box1-docs#101, user decision 2026-11-06). With `CONSOLE_AIOPS_FORWARD_TOKEN=true` the user's token is sent to agentic-operations and to no other upstream. The `operations-console` Keycloak client adds the audience `agentic-operations` and maps only `aiops-viewer` and `aiops-analyst`; agentic-operations accepts `azp=operations-console` (`AIOPS_ALLOWED_AZP`), checks the person's own aiops role in its service layer, and its audit names the person. The same trade-off as for the scenario controller applies: a token without an aiops role is refused (403).
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
| inventory-service | reservation by id, stock list | none (forwarding off) |
| fulfillment-adapter | `GET /api/fulfillments/{id}` | none (forwarding off) |
| asset-service | `GET /api/v1/alerts?status=ACTIVE&limit=100`, `GET /api/v1/sites` (site status, box1-docs#130). Without a token both are refused, and each refusal is cached 60 s | the user's token (`CONSOLE_ASSET_FORWARD_TOKEN`), which carries only `telemetry-reader` |
| scenario-controller | catalog, runs, run, audit, fixtures; seed, start, stop, reset, confirm (actions with a 45 s timeout, `X-Correlation-Id`) | the user's token (`CONSOLE_SCENARIO_FORWARD_TOKEN`) |
| agentic-operations | `POST /api/v1/ai/incidents/{incidentId}/analyze` and `POST /api/v1/ai/conversations/{id}/messages` (10 s timeout, `X-Correlation-Id`), `POST /api/v1/ai/conversations`, `GET /api/v1/ai/analyses/{analysisId}`, `GET /api/v1/ai/conversations/{id}` | the user's token (`CONSOLE_AIOPS_FORWARD_TOKEN`) |
| all | `/api/info` (revisions, cached 60 s) | none |

- **Create semantics.** A create that times out or meets a 5xx returns 503: the order may or may not exist. The page then locks the form to the same values and key, and keeps them in the tab's `sessionStorage` (never a token), so any retry replays rather than duplicates. An upstream 4xx returns 502 `UPSTREAM_REFUSED`, because retrying will not help.
- **Scenario actions.** Console roles gate the page (`console-viewer` reads, `console-operator` acts); the controller then checks the person's scenario role. Its 4xx `detail` is shown as written (409 `SCENARIO_CONFLICT`, for example "another run is active"; 403 `SCENARIO_ROLE_REQUIRED`). A timeout or 5xx is 503 with "the outcome is unknown: check the run list"; nothing is retried. The Demo page shows the "Your step" callout only while a run is `AWAITING_OPERATOR`, and offers "I have done this" only for steps the controller asks to be confirmed.
- **Assistant** (box1-docs#101).
  - **Free text** goes to agentic-operations' chat (its decision D-016). Its model may call read-only evidence tools under the person's own token and roles, in a bounded loop: 8 reads, 4 model rounds and 90 s per message.
    - The console proxies `POST /api/v1/assistant/conversations`, `POST …/{conversationId}/messages` and `GET …/{conversationId}`. It runs no model and holds only the conversation ID in the tab's `sessionStorage`.
    - The page polls every 1.5 s while a message is answered, for at most 3 minutes, and shows each tool step as it lands ("Read order timeline · `ord_…` · OK").
    - The answer is shown as plain text, never HTML, with "Answers come from a model and can be wrong; check the sources" and the list of sources consulted. Step targets are IDs that agentic-operations validated; order IDs link to the console's own order page.
    - **Typed states:** a second message while one runs is 409 `TURN_IN_PROGRESS`; a full model queue is 429 `ASSISTANT_BUSY`; an expired or lost conversation is 404 `CONVERSATION_EXPIRED`, and the page then starts a new one with a note. `MODEL_UNAVAILABLE`, `MODEL_INVALID_OUTPUT` and `FAILED` show no answer.
  - **Slash commands** run deterministic console actions: `/incidents`, `/analyze <inc_ord_…|ord_…>`, `/show <ana_…>`, `/new`, `/clear` and `/help`.
    - `/analyze` starts an analysis in agentic-operations and polls it every 2 s for at most 3 minutes. Every final status is shown in plain words, and an expired analysis is 404 `ANALYSIS_EXPIRED`.
    - Suggested actions are labelled "Proposed only — never executed"; no console endpoint executes anything. The evidence entries' raw `data` is dropped.
  - The transcript holds IDs only, never results or tokens. All effects use block bodies: Chromium's `scrollIntoView` returns a Promise, which once crashed the page (fixed in #13).
- **Order service as the only source.** When order-service fails, the overview reports its indicators as absent (null), not zero. Order detail returns 503 naming the source.

- Upstream calls have no retries. At most 8 are in flight per upstream, and excess calls fail fast as `DEGRADED`.
- Each call carries a W3C `traceparent`. The browser starts a trace per request and the backend continues it (box1-docs#22).
- The order's **Trace** evidence links to the OpenShift console trace viewer (Observe > Traces, `box1-observability/box1`, tenant `dev`) through `CONSOLE_TRACE_URL_TEMPLATE`, with `{traceId}` replaced by the order's W3C trace ID. Opening it needs OpenShift access. An empty template, or a missing or all-zero trace ID, shows the ID without a link.
- The order's **Logs** evidence links to the OpenShift console log viewer (Observe > Logs) through `CONSOLE_LOGS_URL_TEMPLATE`: a LogQL query for application logs from every service whose JSON MDC carries the order's trace ID (`structured_mdc_traceId`), one line per entry as pod, level and message. The same trace-ID rules and OpenShift-access requirement as the trace link apply. The **Order flow dashboard** evidence links to the `box1-order-flow` dashboard in `box1-observability` (Observe > Dashboards) through `CONSOLE_DASHBOARD_URL`; it is the same for every order. Empty removes the link.
- Logs are JSON and never include tokens, cookies or bodies.

## Sites page (box1-docs#130)

`GET /api/v1/sites` reads three things in parallel within the page budget: inventory stock, asset-service active alerts and
asset-service site status. A site appears when any of them names it, so an edge site that has reported but has no stock
rows is listed. Inventory sites come first in inventory order (the Place order page lists only sites with stock), then the
others by `siteId`. The response is additive over 1.0.0: each site gains `status`, `activeAlerts` and `location`, and the
list gains `siteStatusSource`.

- **Status** is asset-service's `SiteStatus` (box1-ops-contracts `openapi/asset-service.yaml`). asset-service derives the
  state when it is read: `OFFLINE` without a heartbeat for 90 s, `DEGRADED` for buffer depth of 200 or more, an oldest
  buffered row over 5 minutes or a red greenboot, otherwise `ONLINE` (asset-service defaults, `SITE.md`). The console does
  not recompute it; a state it does not know is shown as `UNKNOWN`.
- **Site status read failures** are reported in `siteStatusSource`, separately from the alerts read in `sources`: an
  asset-service from before site status serves alerts but answers 404, or 403 because it denies unlisted paths. Either way
  the inventory sites are still returned, with `status` null, and the page says "Site status unavailable". When the same
  token read alerts but site status was refused, the detail says the deployed asset-service may not serve site status yet.
- **Map.** A self-contained inline SVG: a schematic outline, fixed places from `CONSOLE_SITE_MAP` and nothing loaded from
  elsewhere, so the CSP is unchanged (`img-src 'self' data:; connect-src 'self'`). Each marker is a link to the site's row
  in the status table, so it is reachable with Tab and has an accessible name with the state, last-seen time and alert
  count. State is shown by a text label and a shape (circle online, triangle degraded, square offline, diamond for no or
  unknown status), with colour only as a third cue; colours are the console's light and dark theme tokens.
- **Table.** State and reasons, last seen (asset-service's age at read time and the absolute time), buffer depth with
  site-event backlog, oldest-row age and dropped readings, the booted image digest (shortened; the full digest, and a
  staged one, open from it), greenboot status, and the site's active alert count ("or more" when only the newest 100
  alerts were read).
- The page refreshes every 15 s, the site heartbeat interval, with a pause control.

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
- **G-2:** asset-service accepts only tokens issued to its own client, so it does not answer the console. Telemetry shows "refused the console" and links to the asset telemetry console.
- **G-3:** the deployed fulfillment adapter has SFTP disabled, so no ERP can hold a request on the cluster yet.
- **Order service authentication** is tracked in box1-docs#40. The console enforces its own roles and adds no exposure.

## Brand

- `brand/box1-mark.png` is the `box1-org` avatar supplied by the project owner, byte-identical to asset-service's copy (SHA-256 `11ccbb2dc79258163cc516ed398132ad320ebf9870c75da64cb8b6f2919762ea`, asserted by `FrontendServingTest`). Do not regenerate it.
- Favicons `brand/box1-mark-32.png` (SHA-256 `1692fcb8…a576e`) and `brand/box1-mark-180.png` (`53961816…83f5e`) are **resized only** from that file, with `sips -z 32 32` and `sips -z 180 180` (sips-316, macOS 15.6). The user approved this on 2026-11-06. The hashes are asserted by `FrontendServingTest`.
- Styling uses system fonts and a monochrome palette with a faint grid. It respects `prefers-reduced-motion` and dark mode.
