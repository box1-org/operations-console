# Runbook

## Deployment

- Manifests live in `box1-org/box1-workloads-dev` at `workloads/operations-console/`. Argo Application `operations-console` auto-syncs with self-heal and no prune.
- Runtime settings are Deployment `env`, not the generated ConfigMap. A changed ConfigMap literal orphans the old hashed ConfigMap; without prune, Argo then reports OutOfSync and the release smoke task fails.
- The Keycloak client is `box1-gitops/platform/identity/keycloak/realm/operations-console-client.yaml`, synced by Application `keycloak`.
  - After a sync, check that the client roles exist.
  - Roles are assigned to people in the Keycloak admin console. Git assigns none.

## Health and signals

- Probes: `/q/health/started`, `/q/health/ready` and `/q/health/live`. Readiness does **not** depend on upstreams: a down upstream gives partial pages, not an unready console.
- Metrics:
  - `console_upstream_calls_total{source,outcome}` counts calls by outcome (`OK`, `UNAVAILABLE`, `NOT_AUTHORIZED`, `DEGRADED`, `NOT_CONFIGURED`). A rising `UNAVAILABLE` count for one source matches the "Partial data" banner users see.
  - `console_upstream_duration_seconds{source,outcome}` gives upstream latency.
  - `asset-service` is `NOT_AUTHORIZED` when the console sends no token (`CONSOLE_ASSET_FORWARD_TOKEN` off). Its refusals of unsigned reads (alerts and site status) are cached, so it is probed at most once a minute each.
- Logs: JSON with `mdc.traceId`.
  - Each failed upstream call writes one WARN line: `upstream=<source> outcome=<OUTCOME> http=<status> latencyMs=<n>`. It never includes the URL, headers or body.
  - The browser starts the trace, and the same trace ID is propagated to the upstream services' own logs.

## Common situations

| Symptom | Meaning | Action |
|---|---|---|
| "Partial data: Fulfillment adapter — unavailable" | The adapter did not answer within 2.5 s | Check the adapter. The console needs nothing. |
| "ERP detail unavailable … no published link (gap G-1)" | `CONSOLE_FULFILLMENT_LINK=none` | Expected until G-1 is decided |
| "Asset telemetry service — refused the console" | asset-service requires `azp=asset-service` (G-2) | Expected. Use the telemetry console link. |
| Everyone signed out after a rollout | Per-process session key | Expected without `CONSOLE_SESSION_KEY` |
| Login loops with 2+ replicas | Per-process session key | Keep `replicas: 1` until a session key exists |
| 403 `ROLE_REQUIRED` | The user lacks a console role | Assign `console-viewer`/`-operator`/`-developer` in Keycloak |
| 403 `ORIGIN_MISMATCH` | `CONSOLE_PUBLIC_ORIGIN` does not match the Route | Fix the env value |
| Keycloak "Invalid parameter: redirect_uri" | The client's redirect URI is not exactly `<route>/callback` | Fix the KeycloakClient in box1-gitops |
| Page loads return 500, `/api/v1/*` returns 401, logs show `OidcProviderClientImpl` errors | Keycloak is unreachable (discovery or token endpoint) | Check Keycloak. Readiness stays UP by design: the console cannot help without it, and restarting does not help |
| One failed login during a rollout | `maxSurge: 1` runs old and new pods briefly, each with its own session key | Sign in again |
| Sites shows "refused the console" | asset-service refused the console's read (no token: `CONSOLE_ASSET_FORWARD_TOKEN` off, or the person lacks `telemetry-reader`) | Set `CONSOLE_ASSET_FORWARD_TOKEN=true`; assign the role in Keycloak |
| Sites: "Site status unavailable … (HTTP 404)" or "… may not serve site status yet" | The deployed asset-service predates site status (box1-docs#130) | Expected until asset-service with `GET /api/v1/sites` is promoted. Stock and alerts still show |
| Sites: a site shows "No status reported" | asset-service has no heartbeat from it: a non-edge (seed) site, or a site agent that never reached asset-service | For `site_ds9` and `site_spacedock`, check the site agent and its route to asset-service |
| Sites: a site shows "Offline" | asset-service received no heartbeat within its offline threshold (90 s default) | Check the site VM and its network; the state returns to Online with the next heartbeat |
| Sites: a site is not on the map | No `CONSOLE_SITE_MAP` entry for it, or an unreadable entry (logged once at start as a WARN naming the entry's position) | Add or fix `siteId=x/y[/region]` in the Deployment env |
| Assistant: "The assistant is not connected" | `AGENTIC_OPERATIONS_URL` or `CONSOLE_AIOPS_FORWARD_TOKEN` is unset | Set both in box1-workloads-dev |
| Assistant: 403 `AIOPS_ROLE_REQUIRED` | agentic-operations refused the person: no `aiops-viewer`/`aiops-analyst` role, or `operations-console` is missing from its `AIOPS_ALLOWED_AZP`, or the console client lacks the audience/scope mapping | Assign the role in Keycloak; check `AIOPS_ALLOWED_AZP` and the `operations-console` KeycloakClient |
| Assistant: 429 `ASSISTANT_BUSY` | agentic-operations' model queue is full (one vLLM slot, queue bound 4) | Wait for `Retry-After` and try again |
| Assistant: `MODEL_UNAVAILABLE` | vLLM did not answer; no diagnosis was produced | Check vLLM (box1-docs#26) and agentic-operations' runbook |
| Assistant: 409 `TURN_IN_PROGRESS` | The previous message in the conversation is still being answered | Wait for it; one message at a time per conversation |
| Assistant: "The earlier conversation expired, so I started a new one" | 2 h without activity, eviction, or an agentic-operations restart | Expected; the model no longer has the earlier messages |
| Assistant: an answer looks wrong | Model text; it can be wrong | Check the "Sources consulted" list and the linked pages. The model can only read |
| Assistant: 404 `ANALYSIS_EXPIRED` | The analysis expired (24 h), was evicted, or agentic-operations restarted | Expected; start a new analysis |

## Rollback

Revert the promotion commit in box1-workloads-dev through a PR. That commit changes both the digest in `kustomization.yaml` and the `box1.org/source-revision` annotation in `deployment.yaml`. The console holds no data, so rollback has no data step. Users sign in again. **Rollback has not been exercised.**

## Limits

- One replica (session key).
- Lists scan at most the 200 most recent orders, because order-service offers no server-side filter.
- Incidents are derived by the console until an incident contract exists (#17).
- Demo control drives the scenario controller (#19) with the signed-in person's token. A person needs `console-operator` here **and** `scenario-operator` on the controller to seed, start, stop, reset or confirm; `console-viewer` with `scenario-viewer` can follow runs. "Refused by the scenario controller" means the second role is missing (assign it in Keycloak). If the page says the controller is not configured, check `SCENARIO_CONTROLLER_URL` and `CONSOLE_SCENARIO_FORWARD_TOKEN`. The controller's own runbook covers stuck runs and resets.
