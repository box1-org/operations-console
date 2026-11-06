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
  - `asset-service` stays `NOT_AUTHORIZED` by design (gap G-2). It is probed at most once a minute.
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
| Sites shows "refused the console" | Gap G-2 | Expected |

## Rollback

Revert the promotion commit in box1-workloads-dev through a PR. That commit changes both the digest in `kustomization.yaml` and the `box1.org/source-revision` annotation in `deployment.yaml`. The console holds no data, so rollback has no data step. Users sign in again. **Rollback has not been exercised.**

## Limits

- One replica (session key).
- Lists scan at most the 200 most recent orders, because order-service offers no server-side filter.
- Incidents are derived by the console until an incident contract exists (#17).
- Demo control is read-only until the scenario controller (#19) exists.
