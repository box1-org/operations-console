# Runbook

## Deployment

- Manifests live in `box1-org/box1-workloads-dev` at `workloads/operations-console/`. Argo Application `operations-console` auto-syncs with self-heal and no prune.
- Runtime settings are Deployment `env`, not the generated ConfigMap. A changed ConfigMap literal orphans the old hashed ConfigMap; without prune, Argo then reports OutOfSync and the release smoke task fails.
- The Keycloak client is `box1-gitops/platform/identity/keycloak/realm/operations-console-client.yaml`, synced by Application `keycloak`.
  - After a sync, check that the client roles exist.
  - Roles are assigned to people in the Keycloak admin console. Git assigns none.

## Health and signals

- Probes: `/q/health/started`, `/q/health/ready` and `/q/health/live`. Readiness does **not** depend on upstreams: a down upstream gives partial pages, not an unready console.
- Metrics: `console_upstream_calls_total{source,outcome}` counts upstream calls by outcome (`OK`, `UNAVAILABLE`, `NOT_AUTHORIZED`, `DEGRADED`, `NOT_CONFIGURED`). A rising `UNAVAILABLE` count for one source matches the "Partial data" banner users see.
- Logs: JSON with `traceId`. Find a user's request by the trace ID that appears in the order timeline.

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
| Keycloak "Invalid parameter: redirect_uri" | The client's redirect URIs do not cover the Route | Fix the KeycloakClient in box1-gitops |

## Rollback

Revert the image digest in `workloads/operations-console/kustomization.yaml` through a PR. The console holds no data, so rollback has no data step. Users sign in again.

## Limits

- One replica (session key).
- Lists scan at most the 200 most recent orders, because order-service offers no server-side filter.
- Incidents are derived by the console until an incident contract exists (#17).
- Demo control is read-only until the scenario controller (#19) exists.
